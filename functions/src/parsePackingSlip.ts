import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Admin SDK for server-side authz checks.
initializeApp();
const adminDb = getFirestore();

// Reject payloads over ~7 MiB of base64 (≈5 MiB image). Gemini refuses larger
// inline images anyway and this stops us burning quota on garbage.
const MAX_BASE64_LEN = 7 * 1024 * 1024;
const VALID_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function validateParseInput(raw: unknown): {
  imageBase64: string;
  mimeType: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", "Request body must be an object");
  }
  const { imageBase64, mimeType } = raw as Record<string, unknown>;

  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "imageBase64 must be a non-empty string",
    );
  }
  if (imageBase64.length > MAX_BASE64_LEN) {
    throw new HttpsError("invalid-argument", "Image is too large (max ~5 MiB)");
  }
  // Base64-url-safe + standard charset. Allow trailing = padding.
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(imageBase64)) {
    throw new HttpsError("invalid-argument", "imageBase64 is not valid base64");
  }

  const mime =
    typeof mimeType === "string" && VALID_MIMES.has(mimeType)
      ? mimeType
      : "image/jpeg";

  return { imageBase64, mimeType: mime };
}

interface ParsedItem {
  name: string;
  matchedName: string | null;
  size: string | null;
  qty: number;
  confidence: "high" | "medium" | "low";
}

interface ParseResult {
  items: ParsedItem[];
  vendor: string | null;
  date: string | null;
  overallConfidence: "high" | "medium" | "low";
}

async function assertActiveLogisticsUser(uid: string): Promise<void> {
  const snap = await adminDb.doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Not a logistics user");
  }
  const data = snap.data() ?? {};
  const isActive = data.isActive === true || data.status === "active";
  if (!isActive) {
    throw new HttpsError("permission-denied", "Inactive logistics user");
  }
}

// In-memory cache of the active items list, refreshed on first call after
// the TTL expires. Lives at module scope so it persists across invocations
// within the same Cloud Functions container — cold-start instances pay the
// query once, warm instances reuse for up to ITEMS_CACHE_TTL_MS. New items
// added in the admin UI propagate within that window.
let itemsCache: string[] | null = null;
let itemsCacheExpiry = 0;
const ITEMS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getKnownItems(
  db: FirebaseFirestore.Firestore,
): Promise<string[]> {
  const now = Date.now();
  if (itemsCache && now < itemsCacheExpiry) return itemsCache;
  const snapshot = await db
    .collection("items")
    .where("isActive", "==", true)
    .get();
  itemsCache = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      if (!data.name || typeof data.name !== "string") return null;
      return data.manufacturer
        ? `${data.manufacturer} ${data.name}`
        : data.name;
    })
    .filter((name): name is string => name !== null);
  itemsCacheExpiry = now + ITEMS_CACHE_TTL_MS;
  return itemsCache;
}

export const parsePackingSlip = onCall(
  {
    cors: true,
    secrets: [geminiApiKey],
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be authenticated");
    }
    await assertActiveLogisticsUser(request.auth.uid);

    const { imageBase64, mimeType: mime } = validateParseInput(request.data);

    // Live active-items list from Firestore so the matcher tracks the
    // catalog without redeploys. Cached at module scope (see
    // `getKnownItems`) so warm instances reuse the result for 5 min.
    // Format: "Manufacturer Name" when a manufacturer is set, else just
    // the bare name — extra signal for branded items (e.g. "Florence
    // Marine X F1 Boardshorts" vs the bare "F1 Boardshorts").
    const KNOWN_ITEMS = await getKnownItems(adminDb);

    const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

    const prompt = `You are reading a packing slip, shipping manifest, or delivery receipt for CA-TF2 / USA-02 USAR team equipment.

Extract ALL line items with their quantities and sizes (if applicable).

Return ONLY valid JSON — no markdown, no explanation. Use this exact structure:
{
  "items": [
    {
      "name": "exact text from the slip",
      "matchedName": "closest match from known items or null",
      "size": "size if shown, or null",
      "qty": number,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "vendor": "vendor/supplier name if visible, or null",
  "date": "date on slip if visible, or null",
  "overallConfidence": "high" | "medium" | "low"
}

Known item names for matching:
${KNOWN_ITEMS.map((n) => `- ${n}`).join("\n")}

Rules:
- Match extracted names to the closest known item when possible
- If an item clearly matches a known item, set matchedName to that exact known name and confidence to "high"
- If the match is uncertain, set confidence to "medium"
- If you can't match it, set matchedName to null and confidence to "low"
- Extract sizes exactly as printed (e.g., "XL", "10.5 M", "32x34")
- If a line shows quantity 0 or is a header/total row, skip it
- Return only the JSON object`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mime,
                  data: imageBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
      });

      const text = response.text ?? "";

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new HttpsError(
          "internal",
          "Failed to parse AI response as JSON"
        );
      }

      const parsed: ParseResult = JSON.parse(jsonMatch[0]);
      return parsed;
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpsError("internal", `OCR processing failed: ${message}`);
    }
  }
);
