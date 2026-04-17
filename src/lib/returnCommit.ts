import {
  writeBatch,
  doc,
  increment,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { CartItem, LogisticsUser, Personnel } from "../types";

export interface CommitReturnParams {
  actor: LogisticsUser;
  member: Personnel;
  items: CartItem[];
  notes?: string;
}

export async function commitReturn(params: CommitReturnParams): Promise<string> {
  const { actor, member, items, notes } = params;
  const batch = writeBatch(db);
  const txRef = doc(collection(db, "transactions"));
  const auditItems: {
    itemId: string;
    itemName: string;
    size: string | null;
    qtyBefore: number;
    qtyAfter: number;
    delta: number;
  }[] = [];

  for (const item of items) {
    const itemRef = doc(db, "items", item.itemId);
    const sizeKey = item.size ?? "one-size";
    batch.update(itemRef, {
      [`sizeMap.${sizeKey}.qty`]: increment(item.qty),
      updatedAt: serverTimestamp(),
    });

    auditItems.push({
      itemId: item.itemId,
      itemName: item.itemName,
      size: item.size,
      qtyBefore: item.qtyBefore,
      qtyAfter: item.qtyBefore + item.qty,
      delta: item.qty,
    });
  }

  batch.set(txRef, {
    type: "return",
    personnelId: member.id,
    personnelName: `${member.lastName}, ${member.firstName}`,
    personnelAuthUid: member.authUid ?? null,
    items: items.map((i) => ({
      itemId: i.itemId,
      itemName: i.itemName,
      size: i.size,
      qtyIssued: i.qty,
      isBackorder: false,
    })),
    status: "complete",
    issuedBy: actor.id,
    issuedByName: actor.name,
    timestamp: serverTimestamp(),
    notes: notes ?? null,
    sourceForm: "desktop_return",
  });

  addAuditEventToBatch(batch, {
    type: "return",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    personnelId: member.id,
    personnelName: `${member.lastName}, ${member.firstName}`,
    action: `Returned ${items.length} item(s) from ${member.firstName} ${member.lastName}.`,
    transactionId: txRef.id,
    items: auditItems,
  });

  await batch.commit();
  return txRef.id;
}
