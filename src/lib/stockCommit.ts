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

export interface CommitStockAdjustParams {
  actor: LogisticsUser;
  type: AuditEventType; // "receive" or "adjust"
  items: StockAdjustItem[];
  notes?: string;
}

export async function commitStockAdjust(
  params: CommitStockAdjustParams
): Promise<string> {
  const { actor, type, items, notes } = params;
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
    type: type === "receive" ? "single_issue" : "single_issue",
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
  });

  await batch.commit();
  return txRef.id;
}
