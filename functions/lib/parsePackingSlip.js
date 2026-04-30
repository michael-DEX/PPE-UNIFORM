"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePackingSlip = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const genai_1 = require("@google/genai");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const geminiApiKey = (0, params_1.defineSecret)("GEMINI_API_KEY");
// Admin SDK for server-side authz checks.
(0, app_1.initializeApp)();
const adminDb = (0, firestore_1.getFirestore)();
// Reject payloads over ~7 MiB of base64 (≈5 MiB image). Gemini refuses larger
// inline images anyway and this stops us burning quota on garbage.
const MAX_BASE64_LEN = 7 * 1024 * 1024;
const VALID_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);
function validateParseInput(raw) {
    if (!raw || typeof raw !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request body must be an object");
    }
    const { imageBase64, mimeType } = raw;
    if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "imageBase64 must be a non-empty string");
    }
    if (imageBase64.length > MAX_BASE64_LEN) {
        throw new https_1.HttpsError("invalid-argument", "Image is too large (max ~5 MiB)");
    }
    // Base64-url-safe + standard charset. Allow trailing = padding.
    if (!/^[A-Za-z0-9+/_-]+=*$/.test(imageBase64)) {
        throw new https_1.HttpsError("invalid-argument", "imageBase64 is not valid base64");
    }
    const mime = typeof mimeType === "string" && VALID_MIMES.has(mimeType)
        ? mimeType
        : "image/jpeg";
    return { imageBase64, mimeType: mime };
}
async function assertActiveLogisticsUser(uid) {
    const snap = await adminDb.doc(`users/${uid}`).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Not a logistics user");
    }
    const data = snap.data() ?? {};
    const isActive = data.isActive === true || data.status === "active";
    if (!isActive) {
        throw new https_1.HttpsError("permission-denied", "Inactive logistics user");
    }
}
// In-memory cache of the active items list, refreshed on first call after
// the TTL expires. Lives at module scope so it persists across invocations
// within the same Cloud Functions container — cold-start instances pay the
// query once, warm instances reuse for up to ITEMS_CACHE_TTL_MS. New items
// added in the admin UI propagate within that window.
let itemsCache = null;
let itemsCacheExpiry = 0;
const ITEMS_CACHE_TTL_MS = 5 * 60 * 1000;
async function getKnownItems(db) {
    const now = Date.now();
    if (itemsCache && now < itemsCacheExpiry)
        return itemsCache;
    const snapshot = await db
        .collection("items")
        .where("isActive", "==", true)
        .get();
    itemsCache = snapshot.docs
        .map((doc) => {
        const data = doc.data();
        if (!data.name || typeof data.name !== "string")
            return null;
        return data.manufacturer
            ? `${data.manufacturer} ${data.name}`
            : data.name;
    })
        .filter((name) => name !== null);
    itemsCacheExpiry = now + ITEMS_CACHE_TTL_MS;
    return itemsCache;
}
exports.parsePackingSlip = (0, https_1.onCall)({
    cors: true,
    secrets: [geminiApiKey],
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: "512MiB",
}, async (request) => {
    // Auth check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be authenticated");
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
    const ai = new genai_1.GoogleGenAI({ apiKey: geminiApiKey.value() });
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
            throw new https_1.HttpsError("internal", "Failed to parse AI response as JSON");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed;
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new https_1.HttpsError("internal", `OCR processing failed: ${message}`);
    }
});
//# sourceMappingURL=parsePackingSlip.js.map