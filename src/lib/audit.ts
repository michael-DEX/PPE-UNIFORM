import { writeBatch, doc, serverTimestamp, collection } from "firebase/firestore";
import { db } from "./firebase";
import type { AuditEventType, AuditItem } from "../types";

export interface AuditEventInput {
  type: AuditEventType;
  actorUid: string;
  actorName: string;
  actorRole: string;
  personnelId?: string;
  personnelName?: string;
  action: string;
  transactionId: string;
  items: AuditItem[];
}

/** Add an audit event doc to an existing WriteBatch. Never commits on its own. */
export function addAuditEventToBatch(
  batch: ReturnType<typeof writeBatch>,
  event: AuditEventInput
) {
  const ref = doc(collection(db, "audit_log"));
  batch.set(ref, {
    ...event,
    timestamp: serverTimestamp(),
    personnelId: event.personnelId ?? null,
    personnelName: event.personnelName ?? null,
  });
  return ref.id;
}
