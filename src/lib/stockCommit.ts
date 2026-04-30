import {
  writeBatch,
  doc,
  increment,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { AuditEventType, LogisticsUser } from "../types";

export interface StockAdjustItem {
  itemId: string;
  itemName: string;
  size: string;
  qtyChange: number; // positive = receive, negative = adjust down
  qtyBefore: number;
}

export type StockAdjustType = Extract<AuditEventType, "receive" | "adjust">;

export interface CommitStockAdjustParams {
  actor: LogisticsUser;
  type: StockAdjustType;
  items: StockAdjustItem[];
  notes?: string;
  /** Origin of a `receive` event — only set for receives. Threads through
   *  to the audit log so reviewers can distinguish OCR scans, manual
   *  entry, or a single submission containing both. */
  source?: "scan" | "manual" | "mixed";
}

export async function commitStockAdjust(
  params: CommitStockAdjustParams
): Promise<string> {
  const { actor, type, items, notes, source } = params;
  const batch = writeBatch(db);
  const txRef = doc(collection(db, "transactions"));

  const auditItems = items.map((item) => {
    const itemRef = doc(db, "items", item.itemId);
    batch.update(itemRef, {
      [`sizeMap.${item.size}.qty`]: increment(item.qtyChange),
      updatedAt: serverTimestamp(),
    });

    return {
      itemId: item.itemId,
      itemName: item.itemName,
      size: item.size,
      qtyBefore: item.qtyBefore,
      qtyAfter: item.qtyBefore + item.qtyChange,
      delta: item.qtyChange,
    };
  });

  // Write a lightweight transaction record for stock adjustments
  batch.set(txRef, {
    type,
    personnelId: null,
    personnelName: null,
    personnelAuthUid: null,
    items: items.map((i) => ({
      itemId: i.itemId,
      itemName: i.itemName,
      size: i.size,
      qtyIssued: i.qtyChange,
      isBackorder: false,
    })),
    status: "complete",
    issuedBy: actor.id,
    issuedByName: actor.name,
    timestamp: serverTimestamp(),
    notes: notes ?? null,
    sourceForm: "stock_adjust",
  });

  addAuditEventToBatch(batch, {
    type,
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `${type === "receive" ? "Received" : "Adjusted"} stock for ${items.length} item(s).`,
    transactionId: txRef.id,
    items: auditItems,
    source: type === "receive" ? source : undefined,
  });

  await batch.commit();
  return txRef.id;
}
