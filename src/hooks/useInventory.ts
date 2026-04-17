import { useState, useEffect, useMemo } from "react";
import { onSnapshot, query, orderBy } from "firebase/firestore";
import { itemsRef } from "../lib/firestore";
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

export function getTotalStock(item: Item): number {
  return Object.values(item.sizeMap || {}).reduce((sum, s) => sum + s.qty, 0);
}

export function isLowStock(item: Item): boolean {
  const sizeMap = item.sizeMap || {};
  return Object.entries(sizeMap).some(([_, s]) => {
    const threshold = s.lowStockThreshold ?? item.lowStockThreshold ?? 5;
    return s.qty <= threshold && s.qty > 0;
  });
}

export function isOutOfStock(item: Item): boolean {
  return getTotalStock(item) === 0;
}

export function getStockStatus(qty: number, threshold: number): "in-stock" | "low-stock" | "out-of-stock" {
  if (qty <= 0) return "out-of-stock";
  if (qty <= threshold) return "low-stock";
  return "in-stock";
}
