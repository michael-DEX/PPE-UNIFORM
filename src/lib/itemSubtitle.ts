import type { Item } from "../types";

/**
 * Produces the display subtitle for an item: `"Manufacturer – Model"`.
 * Returns an empty string when both fields are missing or blank — callers
 * should conditionally render based on truthiness so a blank subtitle
 * row never appears.
 *
 * Separator is a single en-dash (U+2013) surrounded by spaces. Do not
 * substitute em-dash (U+2014) or hyphen-minus (U+002D) — the app
 * standardizes on en-dash for this subtitle everywhere it renders.
 *
 * Accepts a `Pick<Item, ...>` rather than a full `Item` so callers with
 * only partial data (e.g., a lookup result hydrated from a projection
 * type) can pass without coercion. Both fields are treated as optional
 * and trimmed — pure-whitespace values count as blank.
 *
 * Examples:
 *   subtitleFromItem({ manufacturer: "Wolfpack Gear", model: "USAR Backpack" })
 *     → "Wolfpack Gear – USAR Backpack"
 *   subtitleFromItem({ manufacturer: "Wolfpack Gear" })
 *     → "Wolfpack Gear"
 *   subtitleFromItem({ model: "USAR Backpack" })
 *     → "USAR Backpack"
 *   subtitleFromItem({ manufacturer: "  ", model: undefined })
 *     → ""
 */
export function subtitleFromItem(
  item: Pick<Item, "manufacturer" | "model"> | undefined | null,
): string {
  if (!item) return "";
  const parts = [item.manufacturer, item.model].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return parts.map((p) => p.trim()).join(" \u2013 ");
}
