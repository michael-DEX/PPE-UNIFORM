import { writeBatch, doc } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { Item, ItemChanges, LogisticsUser, SizeStock } from "../types";

/**
 * The 13 user-editable scalar fields on `Item`. Matches the patch shape
 * assembled by `EditItemForm.handleSave` in ItemDetailModal. Order here is
 * the order they'll appear in the `changes.scalars` array.
 */
const SCALAR_FIELDS = [
  "name",
  "manufacturer",
  "model",
  "description",
  "category",
  "catalogCategory",
  "unitOfIssue",
  "lowStockThreshold",
  "qtyRequired",
  "needsSize",
  "isIssuedByTeam",
  "isActive",
  "notes",
] as const;

type SizeMap = Record<string, SizeStock>;

export interface CommitItemEditParams {
  itemId: string;
  /** Pre-edit snapshot — typically the `item` prop read from the live
   *  Firestore subscription. Has real `Timestamp` instances (not sentinels). */
  before: Item;
  /**
   * The patch object `EditItemForm` would have passed to `updateDoc`. Typed
   * as `Record<string, unknown>` rather than `Partial<Item>` because the
   * real patch contains `updatedAt: serverTimestamp()`, which is a
   * `FieldValue` sentinel — `Partial<Item>` expects a `Timestamp` there
   * and would reject the actual shape.
   */
  patch: Record<string, unknown>;
  actor: LogisticsUser;
}

/**
 * Edit an item's metadata with an audit trail.
 *
 * Diffs `before` vs `patch` to produce an `ItemChanges` structured-diff,
 * which is stamped on the audit event for forensic review. If nothing
 * actually changed (no scalar field differs AND no sizeMap entry added /
 * removed / modified), **this helper writes nothing at all** — no item
 * update, no audit event — and returns `{ changeCount: 0 }`. That's
 * intentional: blindly writing every save would pollute the audit log
 * with no-op saves (the patch always contains `updatedAt: serverTimestamp()`
 * so a naive "always write" path would log every click of Save).
 *
 * Throws on Firestore errors; callers surface via their existing UI.
 */
export async function commitItemEdit(
  params: CommitItemEditParams,
): Promise<{ changeCount: number }> {
  const { itemId, before, patch, actor } = params;

  const changes: ItemChanges = {
    scalars: diffScalars(before, patch),
    sizeMap: diffSizeMap(
      (before.sizeMap as SizeMap | undefined) ?? undefined,
      patch.sizeMap as SizeMap | undefined,
    ),
  };

  const totalChanges = changes.scalars.length + changes.sizeMap.length;
  if (totalChanges === 0) {
    // No-op edit: skip the write entirely. Save button closes silently.
    return { changeCount: 0 };
  }

  const batch = writeBatch(db);
  batch.update(doc(db, "items", itemId), patch);

  addAuditEventToBatch(batch, {
    type: "item_edit",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Edited item "${before.name}" (${totalChanges} change${
      totalChanges === 1 ? "" : "s"
    })`,
    changes,
  });

  await batch.commit();
  return { changeCount: totalChanges };
}

// ── Diff internals ──────────────────────────────────────────────────────

/**
 * Collapse the three "empty" representations of a string scalar —
 * `undefined` (missing key in Firestore), `null`, and `""` (empty string
 * from an unbound form input) — into a single canonical `null`. Any
 * non-empty value passes through unchanged. Non-string values also pass
 * through untouched (numbers, booleans, objects aren't subject to the
 * undefined-vs-empty-string aliasing this solves).
 *
 * Why this exists: `NewItemModal` uses conditional spread for the four
 * optional string fields (manufacturer / model / description / notes), so
 * a "blank" create stores them as MISSING keys in the Firestore doc.
 * `EditItemForm`'s `initialFormState` reads them back with `?? ""`, and
 * its patch builder writes them unconditionally via `form.X.trim()` —
 * which produces `""` for blank fields. Without normalization, the diff
 * loop sees `before: undefined, after: ""` and emits a phantom change for
 * each of those 4 fields, which (a) pollutes the audit log with
 * meaningless "4 changes" events on no-op saves, and (b) produces
 * Firestore-invalid audit payloads when `before` is undefined.
 *
 * A real clear-field edit (e.g. `"Tru-Spec" → ""`) still emits correctly:
 * `"Tru-Spec"` stays `"Tru-Spec"`, `""` normalizes to `null`, and
 * `"Tru-Spec" !== null` is still a diff. The audit records
 * `before: "Tru-Spec", after: null`.
 */
function normalizeScalar(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v === "") return null;
  return v;
}

/**
 * Per-field scalar diff. Only emits an entry when the field is present in
 * the patch (`patch[field] !== undefined`) AND the *normalized* values
 * differ. A patch that omits a field is treated as "unchanged," matching
 * Firestore update semantics.
 *
 * `updatedAt` is deliberately excluded — the patch always stamps a fresh
 * server timestamp, so treating it as a change would defeat the whole
 * no-op-skip mechanism.
 *
 * Both sides are normalized before comparison AND the normalized values
 * are what get emitted. Normalization inherently handles the "don't write
 * undefined to Firestore" constraint (all three empty-state representations
 * collapse to `null`), so there's no separate emit-time coalesce needed.
 * The raw `patch[field] === undefined` short-circuit at the top must stay
 * raw — checking normalized here would silently drop user's clear-field
 * intent (`""` and `undefined` would both read as "skip").
 */
function diffScalars(
  before: Item,
  patch: Record<string, unknown>,
): ItemChanges["scalars"] {
  const out: ItemChanges["scalars"] = [];
  const beforeAny = before as unknown as Record<string, unknown>;
  for (const field of SCALAR_FIELDS) {
    if (patch[field] === undefined) continue;
    const prev = normalizeScalar(beforeAny[field]);
    const next = normalizeScalar(patch[field]);
    if (prev !== next) {
      out.push({ field, before: prev, after: next });
    }
  }
  return out;
}

/**
 * Coerce a value to a finite number, falling back to 0 for
 * undefined/null/NaN/Infinity/non-numeric. Used at every sizeMap diff
 * extraction point because corrupt Firestore docs can have malformed
 * entries — e.g. Globe Rescue Boots had `"9": { "5 M": { qty: -1 } }`
 * (a nested object where a `{ qty: number }` entry was expected). Reading
 * `prev.qty` on that returns `undefined`, which Firestore refuses to
 * accept in a write payload. Coercing to 0 gives the audit event a
 * Firestore-safe value and implicitly flags "this field was garbage" to
 * a reviewer comparing the audit log against the actual item state.
 */
function safeQty(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * SizeMap diff. Emits add/remove/modify ops keyed by size. Skips if the
 * patch doesn't include a sizeMap (treat as unchanged). Thresholds
 * normalize `undefined` → `null` so the audit payload is Firestore-safe
 * (Firestore rejects undefined values inside objects).
 *
 * All qty extractions go through `safeQty` so malformed source entries
 * (missing/undefined/NaN qty, or entirely wrong-shape entry like a nested
 * object) don't leak `undefined` into the audit payload. Predicate and
 * emit both use the coerced values so an unchanged-but-garbage entry
 * doesn't falsely register as "modified" (both sides → 0 → 0 !== 0 is
 * false → no emit).
 */
function diffSizeMap(
  before: SizeMap | undefined,
  patch: SizeMap | undefined,
): ItemChanges["sizeMap"] {
  if (patch === undefined) return [];
  const out: ItemChanges["sizeMap"] = [];
  const beforeSafe = before ?? {};

  // Added + modified
  for (const [size, entry] of Object.entries(patch)) {
    const prev = beforeSafe[size];
    const nextQty = safeQty(entry?.qty);
    const nextThreshold = entry?.lowStockThreshold ?? null;
    if (!prev) {
      const addOp: {
        op: "add";
        size: string;
        qty: number;
        lowStockThreshold?: number | null;
      } = { op: "add", size, qty: nextQty };
      if (nextThreshold !== null) {
        addOp.lowStockThreshold = nextThreshold;
      }
      out.push(addOp);
      continue;
    }
    const prevQty = safeQty(prev.qty);
    const prevThreshold = prev.lowStockThreshold ?? null;
    if (prevQty !== nextQty || prevThreshold !== nextThreshold) {
      out.push({
        op: "modify",
        size,
        qtyBefore: prevQty,
        qtyAfter: nextQty,
        thresholdBefore: prevThreshold,
        thresholdAfter: nextThreshold,
      });
    }
  }

  // Removed (in before but not in patch)
  for (const [size, prev] of Object.entries(beforeSafe)) {
    if (patch[size] === undefined) {
      out.push({ op: "remove", size, qtyBefore: safeQty(prev?.qty) });
    }
  }

  return out;
}
