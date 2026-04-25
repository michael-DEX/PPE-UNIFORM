import { useEffect, useState } from "react";
import { onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { transactionsRef } from "../../../lib/firestore";
import type { Item, Transaction } from "../../../types";

function formatActivityTime(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFullTimestamp(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ActivityEntry {
  txId: string;
  timestamp: Transaction["timestamp"];
  actorName: string;
  personnelName: string | null;
  type: Transaction["type"];
  sourceForm: string | undefined;
  notes: string | undefined;
  size: string | null;
  qty: number;
  isBackorder: boolean;
}

function activityLabel(entry: ActivityEntry): { label: string; color: string; sign: string } {
  // Legacy: pre-fix stock adjustments were written as single_issue; disambiguate by sourceForm
  // TODO: remove after historical data migration
  if (entry.sourceForm === "stock_adjust") {
    if (entry.qty > 0) return { label: "Received", color: "bg-emerald-100 text-emerald-700", sign: "+" };
    return { label: "Adjusted", color: "bg-amber-100 text-amber-700", sign: "" };
  }
  if (entry.type === "receive") return { label: "Received", color: "bg-emerald-100 text-emerald-700", sign: "+" };
  if (entry.type === "adjust") return { label: "Adjusted", color: "bg-amber-100 text-amber-700", sign: "" };
  if (entry.type === "return") return { label: "Returned", color: "bg-blue-100 text-blue-700", sign: "+" };
  if (entry.type === "exchange") return { label: "Exchanged", color: "bg-purple-100 text-purple-700", sign: "" };
  if (entry.type === "ocr_import") return { label: "Imported", color: "bg-slate-100 text-slate-700", sign: "+" };
  return { label: "Issued", color: "bg-red-50 text-red-700", sign: "-" };
}

export default function ActivitySection({ item }: { item: Item }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = query(transactionsRef, orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ActivityEntry[] = [];
        for (const d of snap.docs) {
          const tx = { ...d.data(), id: d.id } as Transaction;
          for (const ti of tx.items) {
            if (ti.itemId !== item.id) continue;
            list.push({
              txId: tx.id,
              timestamp: tx.timestamp,
              actorName: tx.issuedByName,
              personnelName: tx.personnelName,
              type: tx.type,
              sourceForm: tx.sourceForm,
              notes: tx.notes,
              size: ti.size,
              qty: ti.qtyIssued,
              isBackorder: ti.isBackorder,
            });
          }
        }
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load activity:", err);
        setLoading(false);
      },
    );
    return unsub;
  }, [item.id]);

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-4">Loading activity…</p>;
  }
  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No activity recorded for this item.</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((e) => {
        const { label, color, sign } = activityLabel(e);
        return (
          <div key={`${e.txId}::${e.size}::${e.qty}`} className="py-2">
            <div className="flex items-start gap-3">
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
                {label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 text-sm text-gray-900">
                  <span className="font-semibold">
                    {sign}
                    {Math.abs(e.qty)}
                  </span>
                  {e.size && <span className="text-xs text-gray-500">size {e.size}</span>}
                  {e.isBackorder && (
                    <span className="text-[10px] bg-orange-100 text-orange-700 rounded px-1">
                      backorder
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  by <span className="font-medium text-gray-700">{e.actorName}</span>
                  {e.personnelName && (
                    <>
                      {" → "}
                      <span className="font-medium text-gray-700">{e.personnelName}</span>
                    </>
                  )}
                </p>
                {e.notes && <p className="text-xs text-gray-500 italic mt-0.5 truncate">"{e.notes}"</p>}
              </div>
              <span
                className="text-xs text-gray-400 shrink-0"
                title={formatFullTimestamp(e.timestamp)}
              >
                {formatActivityTime(e.timestamp)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
