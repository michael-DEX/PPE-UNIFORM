import {
  writeBatch,
  doc,
  increment,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { CartItem, LogisticsUser, Personnel, TransactionType } from "../types";

export interface CommitIssueParams {
  actor: LogisticsUser;
  member: Personnel | null;
  items: CartItem[];
  type: TransactionType;
  notes?: string;
  sourceForm: string;
}

export async function commitIssue(params: CommitIssueParams): Promise<string> {
  const { actor, member, items, type, notes, sourceForm } = params;
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

  const memberName = member ? `${member.lastName}, ${member.firstName}` : null;
  const memberId = member?.id ?? null;
  const memberAuthUid = member?.authUid ?? null;

  for (const item of items) {
    if (item.isBackorder) {
      if (!member) {
        throw new Error("Backorder items require a personnel recipient.");
      }
      const boRef = doc(collection(db, "backordered"));
      batch.set(boRef, {
        personnelId: member.id,
        personnelName: `${member.lastName}, ${member.firstName}`,
        itemId: item.itemId,
        itemName: item.itemName,
        size: item.size,
        qtyNeeded: item.qty,
        createdAt: serverTimestamp(),
        createdBy: actor.id,
        fulfilledAt: null,
        fulfilledBy: null,
        notificationSent: false,
      });
    } else {
      // Decrement stock using dot-notation into sizeMap
      const itemRef = doc(db, "items", item.itemId);
      const sizeKey = item.size ?? "one-size";
      batch.update(itemRef, {
        [`sizeMap.${sizeKey}.qty`]: increment(-item.qty),
        updatedAt: serverTimestamp(),
      });

      auditItems.push({
        itemId: item.itemId,
        itemName: item.itemName,
        size: item.size,
        qtyBefore: item.qtyBefore,
        qtyAfter: item.qtyBefore - item.qty,
        delta: -item.qty,
      });
    }
  }

  // Transaction record
  batch.set(txRef, {
    type,
    personnelId: memberId,
    personnelName: memberName,
    personnelAuthUid: memberAuthUid,
    items: items.map((i) => ({
      itemId: i.itemId,
      itemName: i.itemName,
      size: i.size,
      qtyIssued: i.qty,
      isBackorder: i.isBackorder,
    })),
    status: items.some((i) => i.isBackorder) ? "partial" : "complete",
    issuedBy: actor.id,
    issuedByName: actor.name,
    timestamp: serverTimestamp(),
    notes: notes ?? null,
    sourceForm,
  });

  const nonBackorderCount = items.filter((i) => !i.isBackorder).length;
  const action = member
    ? `Issued ${nonBackorderCount} item(s) to ${member.firstName} ${member.lastName}.`
    : `Issued ${nonBackorderCount} item(s) (no recipient).`;

  // Audit event in same batch
  addAuditEventToBatch(batch, {
    type: "issue",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    personnelId: memberId ?? undefined,
    personnelName: memberName ?? undefined,
    action,
    transactionId: txRef.id,
    items: auditItems,
  });

  await batch.commit();
  return txRef.id;
}
