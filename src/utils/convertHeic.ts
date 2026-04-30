import heic2any from "heic2any";

/**
 * Convert a HEIC / HEIF image to a JPEG `File`. Non-HEIC files pass
 * through unchanged. iPhones default to HEIC for camera output, and
 * downstream consumers (the Cloud Functions packing-slip OCR, the
 * server-side image preview) only accept JPEG / PNG — so every File
 * arriving from a `<input type="file" accept="image/*">` picker, drop
 * target, or camera capture should be funneled through this helper
 * before it's read or uploaded.
 */
export async function ensureJpeg(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.name.toLowerCase().endsWith(".heic") ||
    file.name.toLowerCase().endsWith(".heif");

  if (!isHeic) return file;

  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File(
    [blob],
    file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"),
    { type: "image/jpeg" },
  );
}
