/**
 * Coerce any value to a finite, non-negative number — the shape Firestore
 * item stock "should" always have but sometimes doesn't (observed: Globe
 * Rescue Boots had `{ "9": { "5 M": { qty: -1 } } }` nested corruption
 * where `.qty` on the entry resolved to `undefined`, poisoning downstream
 * `sum + qty` into `NaN`).
 *
 * Rules:
 *   - Real finite non-negative numbers pass through unchanged.
 *   - `null`, `undefined`, `NaN`, `Infinity`, negative numbers, and
 *     non-numeric strings all coerce to `0`.
 *   - Numeric strings like `"5"` parse and pass through (legacy data may
 *     have been written as strings by older OCR import paths).
 *
 * `context` is optional — when provided, a `console.warn` fires with the
 * item ID and size key so an operator with DevTools open can find corrupt
 * rows without the user seeing any visual noise. Callers that can easily
 * supply context (aggregation helpers) should; tile/display-time callers
 * typically skip context because the warning would spam on every render.
 */
export function safeQty(
  qty: unknown,
  context?: { itemId?: string; size?: string },
): number {
  const n = typeof qty === "number" ? qty : Number(qty);
  if (!Number.isFinite(n) || n < 0) {
    if (context) {
      console.warn(
        `[safeQty] corrupt qty for item ${context.itemId ?? "?"} size "${
          context.size ?? "?"
        }": ${JSON.stringify(qty)}`,
      );
    }
    return 0;
  }
  return n;
}
