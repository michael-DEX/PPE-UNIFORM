import type { CartItem, Item } from "../../types";

// ── Category ordering ────────────────────────────────────────────────────
//
// Copied verbatim from the legacy OnboardingPage GearTable so the new
// card list orders categories identically. Items whose category isn't
// in this array sort to the end in insertion order.
export const CATEGORY_ORDER: readonly string[] = [
  "packs-bags",
  "patches",
  "footwear",
  "clothing-bdus",
  "clothing-shirts",
  "clothing-outerwear",
  "clothing-headwear",
  "clothing-personal",
  "ppe-equipment",
  "head-protection",
  "sleep-system",
  "personal-items",
  // Fallbacks for items using older category IDs.
  "bags",
  "boots",
  "bdus",
  "clothing",
  "ppe",
  "helmet",
  "sleeping",
  "personal",
];

// ── Row state ────────────────────────────────────────────────────────────

export type RowState = "pending" | "ready" | "previouslyIssued" | "outOfStock";

/**
 * A row is "ready to commit" when it has qty > 0 AND either doesn't need a
 * size or has one picked. Backorder does NOT bypass the size requirement;
 * it only relaxes the stock check (which is enforced by commit logic, not
 * by this helper).
 *
 * Note: no `fsItem` arg — readiness is a pure property of the row. Stock
 * availability gets its own check inside `getRowState`.
 */
export function isRowReady(row: CartItem): boolean {
  if (row.qty <= 0) return false;
  if (row.needsSize && row.size == null) return false;
  return true;
}

/**
 * Qty available at a specific size (e.g. "M"), or summed across all sizes
 * when `size` is null. Items have no top-level qty — all stock lives in
 * sizeMap, with a single "one-size" key for non-sized items.
 */
export function getAvailableStock(fsItem: Item, size: string | null): number {
  const sm = fsItem.sizeMap ?? {};
  if (size != null) return sm[size]?.qty ?? 0;
  return Object.values(sm).reduce(
    (sum, entry) => sum + (entry?.qty ?? 0),
    0,
  );
}

/**
 * Single discriminator the UI switches on. Priority order:
 *   1. previouslyIssued — prior transaction stamped this item for this
 *      member AND the user hasn't touched qty this session.
 *   2. ready — qty + (size or !needsSize); backorder-on rows also qualify.
 *   3. outOfStock — total stock === 0 across all sizes AND not backordered.
 *   4. pending — everything else.
 */
export function getRowState(
  row: CartItem,
  fsItem: Item,
  alreadyIssued: Map<string, number>,
): RowState {
  const prior = alreadyIssued.get(row.itemId) ?? 0;
  if (prior > 0 && row.qty === 0) return "previouslyIssued";
  if (isRowReady(row)) return "ready";
  const totalStock = getAvailableStock(fsItem, null);
  if (totalStock === 0 && !row.isBackorder) return "outOfStock";
  return "pending";
}

// ── Category grouping ────────────────────────────────────────────────────

export interface CategoryGroup {
  category: string;
  rows: CartItem[];
  readyCount: number;
  totalCount: number;
  allPreviouslyIssued: boolean;
}

/**
 * Partition cart rows into category buckets and compute per-bucket counts.
 * Category lookup falls through `fsItem.catalogCategory → fsItem.category →
 * "other"`, matching the legacy GearTable behavior. Ordering respects
 * CATEGORY_ORDER; unknown categories are appended in insertion order.
 *
 * Takes `alreadyIssued` because both `readyCount` and `allPreviouslyIssued`
 * depend on per-row state, which depends on prior transactions.
 */
export function groupByCategory(
  rows: CartItem[],
  fsItems: Item[],
  alreadyIssued: Map<string, number>,
): CategoryGroup[] {
  const byId = new Map<string, Item>();
  for (const it of fsItems) byId.set(it.id, it);

  const byCat = new Map<string, CartItem[]>();
  for (const row of rows) {
    const fs = byId.get(row.itemId);
    const cat = fs?.catalogCategory ?? fs?.category ?? "other";
    const bucket = byCat.get(cat);
    if (bucket) bucket.push(row);
    else byCat.set(cat, [row]);
  }

  const ordered: Array<[string, CartItem[]]> = [];
  for (const cat of CATEGORY_ORDER) {
    const bucket = byCat.get(cat);
    if (bucket) {
      ordered.push([cat, bucket]);
      byCat.delete(cat);
    }
  }
  for (const entry of byCat) ordered.push(entry);

  return ordered.map(([category, bucketRows]) => {
    // Alphabetical sort by itemName within each bucket. Makes card order
    // deterministic — a row's visual position depends on its name, not on
    // when it was appended to the cart. This fixes the "disappearing card"
    // bug where a size-pill tap causes `handleSizeChange` to remove+add the
    // row, which appends to the cart tail and lands at the bottom of its
    // bucket (visually "vanishing" below the mobile fold). Sorting here
    // is cheaper than changing cart-insert semantics in IssueCartContext,
    // which is shared with other issue flows.
    const sortedRows = [...bucketRows].sort((a, b) =>
      a.itemName.localeCompare(b.itemName),
    );
    let readyCount = 0;
    let allPrior = sortedRows.length > 0;
    for (const row of sortedRows) {
      const fs = byId.get(row.itemId);
      if (!fs) {
        allPrior = false;
        continue;
      }
      const state = getRowState(row, fs, alreadyIssued);
      if (state === "ready") readyCount++;
      if (state !== "previouslyIssued") allPrior = false;
    }
    return {
      category,
      rows: sortedRows,
      readyCount,
      totalCount: sortedRows.length,
      allPreviouslyIssued: allPrior,
    };
  });
}

// ── Filter state ─────────────────────────────────────────────────────────

/**
 * "all" = show every category group.
 * Any other string = a category id that appeared in groupByCategory output;
 * the page filters groups to just that one.
 */
export type CategoryFilter = "all" | string;
