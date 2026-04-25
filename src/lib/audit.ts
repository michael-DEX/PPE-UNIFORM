import { writeBatch, doc, serverTimestamp, collection } from "firebase/firestore";
import { db } from "./firebase";
import type {
  AuditEventType,
  AuditItem,
  Item,
  ItemChanges,
  ItemCondition,
  TransactionType,
} from "../types";

/**
 * Per-item shape accepted by `addAuditEventToBatch`. Superset of the stored
 * `AuditItem` — on `return` events, callers may tack on a `condition` tag so
 * readers can distinguish restocks from write-offs without re-deriving it
 * from `delta`. Other event types ignore this field.
 *
 * Kept as an intersection rather than baked into `AuditItem` itself because
 * the read-side `AuditEvent` type (consumed by AuditLogPage) has no need to
 * know about return-specific fields.
 */
export type AuditEventInputItem = AuditItem & { condition?: ItemCondition };

export interface AuditEventInput {
  type: AuditEventType;
  actorUid: string;
  actorName: string;
  actorRole: string;
  personnelId?: string;
  personnelName?: string;
  action: string;
  /** Commit events (issue/receive/return/adjust/scan) include this;
   *  access events (login/logout) don't. */
  transactionId?: string;
  /**
   * Optional granular variant (e.g. `"onboarding_issue"` vs `"single_issue"`)
   * when `type: "issue"` can come from multiple transaction shapes. Stored
   * alongside `type` so future queries can filter by exact transaction flavor
   * without breaking the broader `type`-based filter tabs already in use. */
  transactionType?: TransactionType;
  items?: AuditEventInputItem[];
  /**
   * Structured diff for `item_edit` events. See `ItemChanges` in types.
   * Callers should not pass an empty diff — commitItemEdit short-circuits
   * to a no-op before ever calling this helper when nothing changed. */
  changes?: ItemChanges;
  /**
   * Full `Item` snapshot for `item_create` / `item_delete` events. Written
   * as-is; Firestore serializes `Timestamp` instances inside the doc body
   * correctly. Includes `id` for forensic lookup. */
  snapshot?: Item;
  /**
   * Before/after `itemIds` arrays for `onboarding_template_edit` events.
   * See `AuditEvent.templateChange` in types/index.ts for the read-side
   * shape. One event per Save; reviewers diff before vs. after. */
  templateChange?: {
    before: string[];
    after: string[];
  };
}

/**
 * Recursively remove `undefined` values from an object tree. Firestore rejects
 * any document containing literal `undefined` at any depth, and three hotfixes
 * in this commit helper have each chased a specific leak site. Rather than
 * whack-a-mole further, this is the last-line-of-defense applied at the
 * audit-log write boundary. Existing targeted fixes (normalizeScalar,
 * conditional spreads, the safeQty coerce in diffSizeMap) still run first —
 * this just catches anything that slips past them.
 *
 * Rules:
 *   - `null` is preserved. Firestore accepts null; semantically "cleared
 *     field" means null (explicit) vs. undefined (absent).
 *   - Arrays: undefined *elements* are filtered out (not replaced with null —
 *     removing matches "as if the element weren't there"). Empty arrays are
 *     fine and preserved.
 *   - Non-plain objects (FieldValue sentinels from serverTimestamp(),
 *     Timestamp instances from Firestore reads, DocumentReference, etc.)
 *     are passed through untouched. Detection is via prototype check:
 *     plain objects have `Object.prototype` as their prototype; class
 *     instances have their own prototype chain. Recursing into a FieldValue
 *     would destroy the sentinel and break every timestamp.
 *   - Primitives (string, number, boolean) pass through.
 *   - `NaN` and `Infinity` pass through — out of scope for this strip
 *     (Firestore's own handling applies). If callers produce NaN we have
 *     a separate bug class.
 *
 * Exported so other audit-log write sites (e.g. authCommit's writeAccessEvent)
 * can opt in. Currently only applied at addAuditEventToBatch because that's
 * where the known leak lives; other sites have simpler payloads.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    const filtered = (value as unknown[])
      .filter((el) => el !== undefined)
      .map((el) => stripUndefinedDeep(el));
    return filtered as unknown as T;
  }

  if (typeof value === "object") {
    // Only recurse into plain objects. Class instances (FieldValue,
    // Timestamp, etc.) have their own prototype and must pass through
    // untouched — recursing would destroy sentinels.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }

  return value;
}

/** Add an audit event doc to an existing WriteBatch. Never commits on its own. */
export function addAuditEventToBatch(
  batch: ReturnType<typeof writeBatch>,
  event: AuditEventInput
) {
  const ref = doc(collection(db, "audit_log"));
  // Deep-strip before writing: catches any `undefined` leak from
  // callers/diff helpers that slipped past their own targeted guards. See
  // the docstring on stripUndefinedDeep for the FieldValue pass-through
  // rationale — `timestamp: serverTimestamp()` below MUST survive the
  // strip intact.
  const payload = stripUndefinedDeep({
    ...event,
    timestamp: serverTimestamp(),
    personnelId: event.personnelId ?? null,
    personnelName: event.personnelName ?? null,
  });
  batch.set(ref, payload);
  return ref.id;
}
