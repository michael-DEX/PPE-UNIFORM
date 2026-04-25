import { writeBatch, doc } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { Item, LogisticsUser } from "../types";

export interface CommitItemDeleteParams {
  itemId: string;
  /**
   * Full pre-delete snapshot. Typically the `item` prop from
   * `ItemDetailModal`, which already includes `id` because `useInventory`
   * composes `{ ...doc.data(), id: doc.id }` on read. Stamped on the audit
   * event verbatim so a reviewer can reconstruct the deleted item without
   * archaeology.
   */
  snapshot: Item;
  actor: LogisticsUser;
}

/**
 * Delete an item from the catalog with an audit trail.
 *
 * One `writeBatch` combining the deleteDoc + audit event write, atomic.
 * No transactions-doc write (item lifecycle, not gear flow). Throws on
 * Firestore errors for the caller to surface.
 *
 * The snapshot preserves the item's full pre-delete state — useful if
 * "accidentally deleted, need to restore" comes up later. Firestore
 * rejects `update` / `delete` on `audit_log`, so the snapshot is
 * append-only and safe from tampering.
 */
export async function commitItemDelete(
  params: CommitItemDeleteParams,
): Promise<void> {
  const { itemId, snapshot, actor } = params;

  const batch = writeBatch(db);
  batch.delete(doc(db, "items", itemId));

  addAuditEventToBatch(batch, {
    type: "item_delete",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Deleted item "${snapshot.name}"`,
    snapshot,
  });

  await batch.commit();
}
