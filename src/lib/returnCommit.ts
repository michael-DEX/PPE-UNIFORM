import {
  writeBatch,
  doc,
  increment,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch, type AuditEventInputItem } from "./audit";
import type {
  CartItem,
  ItemCondition,
  LogisticsUser,
  Personnel,
} from "../types";

/**
 * A cart row augmented with its return condition. When `condition` is absent,
 * commitReturn defaults to `"good"` (restock) for backwards compat.
 */
export type ReturnCartItem = CartItem & { condition?: ItemCondition };

export interface CommitReturnParams {
  actor: LogisticsUser;
  member: Personnel;
  items: ReturnCartItem[];
  notes?: string;
}

/**
 * Commit a batch of returns for one member.
 *
 * Per-item branching on `condition`:
 *   - "good"    → increment sizeMap qty; audit delta = +qty, qtyAfter = qtyBefore + qty
 *   - "damaged" → NO stock change;       audit delta = 0,    qtyAfter = qtyBefore
 *   - "lost"    → NO stock change;       audit delta = 0,    qtyAfter = qtyBefore
 *
 * The transaction doc is always `type: "return"`, `status: "complete"`, and
 * each stamped item carries its `condition`. Downstream readers that fold
 * transactions into current holdings (e.g. useGearLocker) treat ALL returns
 * as "item left the member" regardless of condition — which is correct:
 * whether gear goes back on the shelf or into the trash, the member no
 * longer holds it.
 *
 * The audit event's `action` string varies so reviewers can scan the log
 * without expanding each row:
 *   - all "good"            → "Returned N item(s) from Firstname Lastname."
 *   - all "damaged"         → "Returned N damaged item(s) from …"
 *   - all "lost"            → "Wrote off N lost item(s) from …"
 *   - mixed                 → "Returned N item(s) from … (A good, B damaged, C lost)."
 */
export async function commitReturn(params: CommitReturnParams): Promise<string> {
  const { actor, member, items, notes } = params;
  const batch = writeBatch(db);
  const txRef = doc(collection(db, "transactions"));
  const auditItems: AuditEventInputItem[] = [];

  let goodCount = 0;
  let damagedCount = 0;
  let lostCount = 0;

  for (const item of items) {
    const condition: ItemCondition = item.condition ?? "good";
    const shouldRestock = condition === "good";
    const itemRef = doc(db, "items", item.itemId);
    const sizeKey = item.size ?? "one-size";

    if (shouldRestock) {
      batch.update(itemRef, {
        [`sizeMap.${sizeKey}.qty`]: increment(item.qty),
        updatedAt: serverTimestamp(),
      });
      goodCount++;
    } else if (condition === "damaged") {
      damagedCount++;
    } else {
      lostCount++;
    }

    auditItems.push({
      itemId: item.itemId,
      itemName: item.itemName,
      size: item.size,
      qtyBefore: item.qtyBefore,
      qtyAfter: shouldRestock ? item.qtyBefore + item.qty : item.qtyBefore,
      delta: shouldRestock ? item.qty : 0,
      condition,
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
      condition: i.condition ?? "good",
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
    action: buildReturnActionText({
      total: items.length,
      good: goodCount,
      damaged: damagedCount,
      lost: lostCount,
      memberFirst: member.firstName,
      memberLast: member.lastName,
    }),
    transactionId: txRef.id,
    items: auditItems,
  });

  await batch.commit();
  return txRef.id;
}

// ── Action-text helper ───────────────────────────────────────────────────

interface ActionTextInput {
  total: number;
  good: number;
  damaged: number;
  lost: number;
  memberFirst: string;
  memberLast: string;
}

/**
 * Picks one of four phrasings so the audit feed reads naturally.
 *
 *   total=3, good=3                        → "Returned 3 item(s) from …"
 *   total=2, damaged=2                     → "Returned 2 damaged item(s) from …"
 *   total=1, lost=1                        → "Wrote off 1 lost item(s) from …"
 *   total=4, good=2, damaged=1, lost=1     → "Returned 4 item(s) from … (2 good, 1 damaged, 1 lost)."
 *
 * The mixed breakdown only lists buckets with count > 0, so "1 good, 1 lost"
 * doesn't include a dangling ", 0 damaged".
 */
function buildReturnActionText({
  total,
  good,
  damaged,
  lost,
  memberFirst,
  memberLast,
}: ActionTextInput): string {
  const who = `${memberFirst} ${memberLast}`;

  if (total === good) {
    return `Returned ${total} item(s) from ${who}.`;
  }
  if (total === damaged) {
    return `Returned ${total} damaged item(s) from ${who}.`;
  }
  if (total === lost) {
    return `Wrote off ${total} lost item(s) from ${who}.`;
  }

  const parts: string[] = [];
  if (good > 0) parts.push(`${good} good`);
  if (damaged > 0) parts.push(`${damaged} damaged`);
  if (lost > 0) parts.push(`${lost} lost`);
  return `Returned ${total} item(s) from ${who} (${parts.join(", ")}).`;
}
