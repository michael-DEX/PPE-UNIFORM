import { useState, useEffect } from "react";
import { query, where, orderBy, onSnapshot } from "firebase/firestore";
import { transactionsRef } from "../lib/firestore";
import type { Transaction } from "../types";

export interface GearLockerItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qty: number;
  lastIssuedAt: Date | null;
  lastIssuedBy: string | null;
}

export function useGearLocker(personnelId: string | undefined) {
  const [gearLocker, setGearLocker] = useState<GearLockerItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!personnelId) return;

    const q = query(
      transactionsRef,
      where("personnelId", "==", personnelId),
      orderBy("timestamp", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const txs = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Transaction);
      setTransactions(txs);

      // Reconstruct current gear: issues minus returns
      const gearMap = new Map<string, GearLockerItem>();
      // Process oldest first
      const sorted = [...txs].reverse();
      for (const tx of sorted) {
        for (const item of tx.items) {
          if (item.isBackorder) continue;
          const key = `${item.itemId}::${item.size ?? "one-size"}`;
          const existing = gearMap.get(key);
          const delta =
            tx.type === "return" ? -item.qtyIssued : item.qtyIssued;

          if (existing) {
            existing.qty += delta;
            if (tx.type !== "return") {
              existing.lastIssuedAt = tx.timestamp?.toDate?.() ?? null;
              existing.lastIssuedBy = tx.issuedByName;
            }
          } else {
            gearMap.set(key, {
              itemId: item.itemId,
              itemName: item.itemName,
              size: item.size,
              qty: delta,
              lastIssuedAt: tx.timestamp?.toDate?.() ?? null,
              lastIssuedBy: tx.issuedByName,
            });
          }
        }
      }

      // Filter out zero/negative quantities
      setGearLocker(
        Array.from(gearMap.values()).filter((g) => g.qty > 0)
      );
      setLoading(false);
    });

    return unsub;
  }, [personnelId]);

  if (!personnelId) return { gearLocker: [], transactions: [], loading: false };
  return { gearLocker, transactions, loading };
}
