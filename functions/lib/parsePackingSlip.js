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
// Known item names for matching — these are the items in the CA-TF2 inventory
const KNOWN_ITEMS = [
    "Large Roller Bag (90 lbs. MAX)",
    "24 Hour Pack (35 lbs. MAX)",
    "Web Gear Bag (40 lbs. MAX)",
    "Web Gear & Belt Kit",
    "Cold Weather Bag (40 lbs. MAX)",
    "American Flag BDU Patch",
    "CA-TF2 Shoulder Patch",
    "CA-TF2 Rocker",
    "CA-TF2 Large Back Patch",
    "FEMA Shoulder Patch",
    "CAL OES Patch",
    "Globe Rescue Boots",
    "Wide Area Search Boots (Tan)",
    "Cold Weather Boots",
    "BDU Top (5.11)",
    "BDU Top (Tru-Spec)",
    "BDU Pants (5.11)",
    "BDU Pants (Tru-Spec)",
    "BDU Shorts",
    "Belt",
    "CA-TF2 Short Sleeve",
    "CA-TF2 Long Sleeve",
    "CA-TF2 Polo",
    "Water Shirt",
    "Boardshorts",
    "3-in-1 Parka",
    "Thermal Top Light Wt.",
    "Thermal Bottom Light Wt.",
    "Thermal Top Medium Wt.",
    "Thermal Bottom Medium Wt.",
    "Boot Gaiters Pair",
    "Rain Pants",
    "USAR Ball Cap",
    "Boonie Hat",
    "Beanie",
    "Head/Neck Gaiter",
    "Work Gloves",
    "Cold Weather Work Gloves",
    "Cold Weather Gloves",
    "WMD Kit (Scott Mask, Adapters, Bag)",
    "Respirator Face Piece",
    "Respirator Cartridge Set",
    "Flashlight",
    "Multi-Tool",
    "Ear Plugs",
    "Safety Glasses",
    "Structural Specialist Guide",
    "Tech Rescue Guide",
    "USA-02 F.O.G.",
    "Shoring Guide",
    "IFAK",
    "Brief Relief Urinal Bag",
    "Brief Relief Kit",
    "MRE",
    "Insect Repellant",
    "Sunscreen",
    "Bath in a Bag Wipes",
    "Chemlight",
    "Helmet",
    "Goggles",
    "Headlamp",
    "Magpul Rails",
    "Vent Covers",
    "Decals",
    "Emergency Bivy Sack",
    "Sleeping Pad",
    "Sleeping Bag",
    "Sleeping Bag Girdle",
    "Pillow",
];
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
exports.parsePackingSlip = (0, https_1.onCall)({
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