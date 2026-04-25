import { writeBatch, doc } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { Item, LogisticsUser } from "../types";

export interface CommitItemCreateParams {
  /** Firestore doc ID for the new item. Typically slugified from name. */
  itemId: string;
  /**
   * Full item payload to write into `items/{itemId}`. Typed as
   * `Record<string, unknown>` rather than `Item` because the caller's
   * payload contains `createdAt` / `updatedAt: serverTimestamp()` — those
   * are `FieldValue` sentinels, not `Timestamp`, and `Item`'s declared
   * shape would reject them. Firestore serializes both sentinels and
   * plain values correctly inside a `set`. Should NOT carry an `id`
   * field (the ID lives in the Firestore path). The audit snapshot
   * written alongside WILL include `id` for forensic lookup.
   */
  payload: Record<string, unknown>;
  actor: LogisticsUser;
}

/**
 * Create a new item in the catalog with an audit trail.
 *
 * Mirrors the existing commit-helper pattern (issueCommit / stockCommit /
 * returnCommit): one `writeBatch` combining the item write + audit event
 * write, atomic on Firestore's side. No transactions-doc write — item
 * lifecycle events aren't gear flow and don't belong in the transactions
 * collection.
 *
 * Throws on Firestore errors; callers surface via their existing error
 * banner / toast pattern.
 */
export async function commitItemCreate(
  params: CommitItemCreateParams,
): Promise<void> {
  const { itemId, payload, actor } = params;

  const batch = writeBatch(db);

  // Item body written without `id` — Firestore path carries the id.
  batch.set(doc(db, "items", itemId), payload);

  // Audit snapshot gets `id` merged in so a reviewer looking at the event
  // in isolation doesn't need to reconstruct it from other context. Cast
  // to `Item` because the payload's Timestamp-typed fields are actually
  // `FieldValue` sentinels at this point (they resolve to real Timestamps
  // on commit). The snapshot is a Firestore-write object either way.
  const snapshot = { ...payload, id: itemId } as unknown as Item;

  // `.name` is typed unknown on the Record — narrow it for the action
  // string, falling back to a generic label if the caller didn't include it.
  const itemName =
    typeof payload.name === "string" ? payload.name : "(unnamed item)";

  addAuditEventToBatch(batch, {
    type: "item_create",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Created item "${itemName}"`,
    snapshot,
  });

  await batch.commit();
}
