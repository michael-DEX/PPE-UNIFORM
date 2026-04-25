import { useState, useEffect, useMemo } from "react";
import { onSnapshot, query, orderBy } from "firebase/firestore";
import { itemsRef } from "../lib/firestore";
import { safeQty } from "../lib/qty";
import type { Item } from "../types";

export function useInventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(itemsRef, orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Item));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { items, loading, error };
}

export function useFilteredInventory(
  items: Item[],
  search: string,
  category: string
) {
  return useMemo(() => {
    let filtered = items;
    if (category && category !== "all") {
      filtered = filtered.filter((i) => i.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((i) => i.name.toLowerCase().includes(q));
    }
    // Sort: low stock first, then alphabetical
    return [...filtered].sort((a, b) => {
      const aLow = isLowStock(a);
      const bLow = isLowStock(b);
      if (aLow && !bLow) return -1;
      if (!aLow && bLow) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [items, search, category]);
}

/**
 * Sum of qty across all sizes in an item. Each entry passes through
 * `safeQty` so malformed rows (NaN / undefined / negative / nested garbage)
 * coerce to 0 instead of poisoning the whole sum into NaN. Context is
 * passed so `console.warn` fires with item + size when corruption is hit —
 * visible in DevTools, silent to the user.
 */
export function getTotalStock(item: Item): number {
  const sizeMap = item.sizeMap || {};
  return Object.entries(sizeMap).reduce(
    (sum, [size, s]) =>
      sum + safeQty(s?.qty, { itemId: item.id, size }),
    0,
  );
}

export function isLowStock(item: Item): boolean {
  const sizeMap = item.sizeMap || {};
  return Object.entries(sizeMap).some(([size, s]) => {
    const threshold = s.lowStockThreshold ?? item.lowStockThreshold ?? 5;
    const q = safeQty(s?.qty, { itemId: item.id, size });
    return q <= threshold && q > 0;
  });
}

export function isOutOfStock(item: Item): boolean {
  return getTotalStock(item) === 0;
}

/**
 * Classify a single size's stock level. Coerces `qty` at entry so a NaN
 * input reads as out-of-stock (the correct semantic) rather than falling
 * through to "in-stock" (which the old un-sanitized compare produced
 * because `NaN <= 0` is false and `NaN <= threshold` is false). No context
 * param here — callers are typically per-render tile loops where a warn
 * per render would spam; the aggregation helpers upstream already warn.
 */
export function getStockStatus(qty: number, threshold: number): "in-stock" | "low-stock" | "out-of-stock" {
  const q = safeQty(qty);
  if (q <= 0) return "out-of-stock";
  if (q <= threshold) return "low-stock";
  return "in-stock";
}
