import type { CartItem, Item } from "../../types";

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

// ── Section grouping ─────────────────────────────────────────────────────

/** Synthetic section id used for items that don't belong to any
 *  admin-defined section. Reserved double-underscore prefix avoids
 *  collisions with the `sec_<timestamp>_<rand4>` ids the template
 *  editor generates for real sections. */
export const UNASSIGNED_SECTION_ID = "__unassigned__";

export interface SectionGroup {
  /** Stable group key — the section's own id, or `UNASSIGNED_SECTION_ID`. */
  sectionId: string;
  /** Display label shown in the filter pill and the group header. */
  sectionLabel: string;
  rows: CartItem[];
  readyCount: number;
  totalCount: number;
  allPreviouslyIssued: boolean;
}

/**
 * Partition cart rows into template-section buckets and compute per-bucket
 * counts. Rows without a `sectionId` (the `unassigned` bucket on the
 * template doc, or any item from a pre-Phase-2 doc) collect under a
 * synthetic "Unassigned" group that always sorts to the end.
 *
 * Ordering: assigned sections appear in the order they're first
 * encountered in `rows`, which mirrors the order the template editor
 * wrote them — the cart is hydrated from `[...sections[*].items,
 * ...unassigned]`, so first-occurrence order = admin-defined section
 * order. Within each section, rows are sorted alphabetically by
 * `itemName` so card order stays deterministic across the size-pill
 * remove+add cycle in the cart (otherwise re-added rows visually drop
 * to the bottom of their bucket below the mobile fold).
 *
 * Takes `alreadyIssued` because both `readyCount` and
 * `allPreviouslyIssued` depend on per-row state, which depends on prior
 * transactions.
 */
export function groupBySection(
  rows: CartItem[],
  fsItems: Item[],
  alreadyIssued: Map<string, number>,
): SectionGroup[] {
  const byId = new Map<string, Item>();
  for (const it of fsItems) byId.set(it.id, it);

  const buckets = new Map<string, { label: string; rows: CartItem[] }>();
  for (const row of rows) {
    const sectionId = row.sectionId ?? UNASSIGNED_SECTION_ID;
    const label =
      sectionId === UNASSIGNED_SECTION_ID
        ? "Unassigned"
        : (row.sectionLabel ?? "Unassigned");
    const existing = buckets.get(sectionId);
    if (existing) existing.rows.push(row);
    else buckets.set(sectionId, { label, rows: [row] });
  }

  // Move the synthetic "Unassigned" bucket to the end (if present and not
  // already last), preserving admin-defined section order otherwise.
  const ordered: Array<[string, { label: string; rows: CartItem[] }]> = [];
  let unassigned: [string, { label: string; rows: CartItem[] }] | null = null;
  for (const entry of buckets) {
    if (entry[0] === UNASSIGNED_SECTION_ID) unassigned = entry;
    else ordered.push(entry);
  }
  if (unassigned) ordered.push(unassigned);

  return ordered.map(([sectionId, bucket]) => {
    const sortedRows = [...bucket.rows].sort((a, b) =>
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
      sectionId,
      sectionLabel: bucket.label,
      rows: sortedRows,
      readyCount,
      totalCount: sortedRows.length,
      allPreviouslyIssued: allPrior,
    };
  });
}

// ── Filter state ─────────────────────────────────────────────────────────

/**
 * `"__all__"` = show every section group.
 * Any other string = a `sectionId` from `groupBySection` output (a real
 * section id, or `UNASSIGNED_SECTION_ID`); the page filters groups to
 * just that one.
 */
export type SectionFilter = "__all__" | string;

/** Sentinel value matching `SectionFilter`'s "show all" branch. */
export const ALL_SECTIONS_FILTER = "__all__";
