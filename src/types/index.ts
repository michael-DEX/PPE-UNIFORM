import { Timestamp } from "firebase/firestore";

// ── Item Categories ──
export type ItemCategory =
  | "bags"
  | "patches"
  | "boots"
  | "bdus"
  | "clothing"
  | "ppe"
  | "helmet"
  | "sleeping"
  | "personal";

export interface PackingLocations {
  deploymentUniform: number;
  bag24hr: number;
  rollerBag: number;
  webGear: number;
  webGearBag: number;
  coldWeatherBag: number;
}

export interface SizeStock {
  qty: number;
  lowStockThreshold?: number;
}

// Catalog categories (Square-style hierarchy)
export type CatalogCategory =
  | "packs-bags"
  | "patches"
  | "footwear"
  | "clothing-bdus"
  | "clothing-shirts"
  | "clothing-outerwear"
  | "clothing-headwear"
  | "clothing-personal"
  | "ppe-equipment"
  | "head-protection"
  | "sleep-system"
  | "personal-items";

export interface Item {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  description?: string;
  squareCategory?: string;
  /**
   * Legacy category. Was a narrow `ItemCategory` enum; widened to `string`
   * so admins can type new category labels via the inline-create UX in
   * the New Item / Edit Item forms. The `ItemCategory` union still exists
   * below as documentation of the original built-in values, but is no
   * longer used to constrain this field.
   */
  category: string;
  /**
   * Catalog category (newer hierarchy). Was `CatalogCategory` enum; widened
   * to `string` for the same inline-create reason. Built-in catalog ids
   * use `-` as a separator (e.g., `clothing-bdus`); user-created entries
   * use `|` (e.g., `clothing|chest_rigs`) — see `categoryMatches` in
   * src/constants/catalogCategories.ts for the matching logic.
   */
  catalogCategory?: string;
  isIssuedByTeam: boolean;
  isActive: boolean;
  unitOfIssue: string;
  sizeMap: Record<string, SizeStock>;
  lowStockThreshold: number;
  packingLocations: PackingLocations;
  qtyRequired?: number;
  needsSize?: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Personnel ──
export interface MemberSizes {
  shirt?: string;
  pants?: string;
  boots?: string;
  helmet?: string;
  gloves?: string;
}

export interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  joinDate: Timestamp;
  sizes: MemberSizes;
  authUid?: string;
  createdAt: Timestamp;
  createdBy: string;
}

// ── Transactions ──
export type TransactionType =
  | "onboarding_issue"
  | "single_issue"
  | "return"
  | "exchange"
  | "ocr_import"
  | "receive"
  | "adjust";

/**
 * Physical state of a returned item.
 *   - "good"     → goes back into stock (sizeMap qty incremented)
 *   - "damaged"  → logged but NOT restocked (written off)
 *   - "lost"     → logged but NOT restocked (written off)
 *
 * Only meaningful on `return`-type transactions. Absent / undefined on every
 * other transaction type. On returns, an absent value is treated as "good"
 * by commitReturn for backwards compat with any pre-feature return docs.
 */
export type ItemCondition = "good" | "damaged" | "lost";

export interface TransactionItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyIssued: number;
  isBackorder: boolean;
  /** Only set on `return` transactions. See ItemCondition. */
  condition?: ItemCondition;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  personnelId: string | null;
  personnelName: string | null;
  personnelAuthUid?: string | null;
  items: TransactionItem[];
  status: "complete" | "partial";
  issuedBy: string;
  issuedByName: string;
  timestamp: Timestamp;
  notes?: string;
  signatureDataUrl?: string;
  sourceForm?: string;
  ocrConfidence?: "high" | "medium" | "low";
}

// ── Backorders ──
export interface BackorderItem {
  id: string;
  personnelId: string;
  personnelName: string;
  itemId: string;
  itemName: string;
  size: string | null;
  qtyNeeded: number;
  createdAt: Timestamp;
  createdBy: string;
  fulfilledAt: Timestamp | null;
  fulfilledBy: string | null;
  notificationSent: boolean;
  addedToOrderAt?: Timestamp | null;
}

// ── Requests (member-submitted) ──
export interface RequestItem {
  itemId: string;
  itemName: string;
  currentSize?: string;
  requestedSize?: string;
  qty: number;
}

export interface GearRequest {
  id: string;
  personnelId: string;
  personnelName: string;
  personnelAuthUid?: string;
  type: "new_item" | "exchange" | "return";
  items: RequestItem[];
  status: "pending" | "approved" | "fulfilled" | "cancelled";
  submittedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  notes?: string;
}

// ── Order Lists ──
export interface OrderListItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyToOrder: number;
  notes?: string;
}

export interface OrderList {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp;
  exportedAt: Timestamp | null;
  items: OrderListItem[];
}

// ── Onboarding Template ──

/**
 * Admin-defined section within the onboarding template. Sections are an
 * organizational tool for the template editor; the issuance workflow does
 * NOT consume section grouping (it continues to group by `item.category`).
 *
 * `id` is stable and never reused — generated client-side as
 * `sec_<timestamp>_<rand4>` when the section is first created. `label` is
 * mutable. `note` is optional plain text shown to the issuer during the
 * onboarding workflow (Phase 3 — not yet wired). `items` is the ordered
 * list of item IDs in this section.
 */
export interface OnboardingTemplateSection {
  id: string;
  label: string;
  note?: string;
  items: string[];
}

/**
 * Shape of `app_config/onboarding_template`. The legacy `itemIds` flat
 * array is still written redundantly during the rollback-compat window so
 * older code rolling back continues to work; once that window closes a
 * follow-up commit removes it. New code reads `sections` + `unassigned`
 * when present and falls back to `itemIds` only when neither exists
 * (pre-sections docs).
 */
export interface OnboardingTemplateDoc {
  sections?: OnboardingTemplateSection[];
  unassigned?: string[];
  itemNotes?: Record<string, string>;
  itemIds?: string[];
  updatedAt?: Timestamp;
  updatedBy?: string;
}

// ── Caches & Locations (configurable lists for the Cache module) ──

/**
 * A funding/sponsoring cache (DOS, FEMA, Local, CAL OES, Training, etc.).
 * Stored as its own Firestore doc rather than a hardcoded enum so admins can
 * add new caches without a code change. Soft-deleted via `active: false` —
 * federally funded equipment needs an audit trail, so docs are never
 * physically removed. `id` is the Firestore doc ID and serves as the stable
 * foreign key from `boxes.cache` (added in feature #3).
 */
export interface Cache {
  id: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

/**
 * A physical storage location (Warehouse, Offsite Training Facility, etc.).
 * Same shape and lifecycle as `Cache` — see that comment. `id` is the stable
 * foreign key from `boxes.location` (added in feature #3).
 */
export interface Location {
  id: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ── Audit Log ──
export type AuditEventType =
  | "issue"
  | "receive"
  | "return"
  | "adjust"
  | "scan"
  | "login"
  | "logout"
  | "item_create"
  | "item_edit"
  | "item_delete"
  | "onboarding_template_edit"
  | "catalog_categories_edit"
  | "cache_edit"
  | "location_edit";

export interface AuditItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyBefore: number;
  qtyAfter: number;
  delta: number;
}

/**
 * Structured diff between a pre-edit `Item` and the patch written to
 * Firestore. Stamped on `item_edit` audit events so reviewers can see
 * exactly what changed without re-fetching the previous doc state.
 *
 *   - `scalars`: per-field before/after for the 13 user-editable scalar
 *     fields on `Item` (name, manufacturer, flags, numeric thresholds, etc.)
 *   - `sizeMap`: add/remove/modify operations on the `Item.sizeMap` record
 *
 * Both arrays may be empty on a given event. Empty on both = commitItemEdit
 * short-circuits and writes nothing (no-op save). Defined in types rather
 * than lib/audit.ts because `AuditEvent` (read side) references it and
 * types must not import from lib.
 */
export interface ItemChanges {
  scalars: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
  sizeMap: Array<
    | { op: "add"; size: string; qty: number; lowStockThreshold?: number | null }
    | { op: "remove"; size: string; qtyBefore: number }
    | {
        op: "modify";
        size: string;
        qtyBefore: number;
        qtyAfter: number;
        thresholdBefore: number | null;
        thresholdAfter: number | null;
      }
  >;
}

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: Timestamp;
  actorUid: string;
  actorName: string;
  actorRole: string;
  personnelId: string | null;
  personnelName: string | null;
  action: string;
  /** Present on commit-style events (issue/receive/return/adjust/scan).
   *  Access events (login/logout) omit it — they're not tied to a transaction. */
  transactionId?: string;
  /**
   * The specific `TransactionType` that produced this audit event, when one
   * exists — e.g. `"onboarding_issue"` vs `"single_issue"` for `type: "issue"`
   * events. Keeps the granular distinction available to future audit queries
   * without breaking the broader `type` filter tabs on the Audit Log page.
   * Absent on access events (login/logout) and on older events written before
   * this field was introduced. */
  transactionType?: TransactionType;
  /** Same optional contract as transactionId — only commit events carry items. */
  items?: AuditItem[];
  /**
   * Structured diff for `item_edit` events. Empty arrays on both `scalars`
   * and `sizeMap` means nothing actually changed — in which case
   * commitItemEdit short-circuits and no event is written at all. */
  changes?: ItemChanges;
  /**
   * Full `Item` snapshot for `item_create` and `item_delete` events — the
   * item as created, or the item at the moment of deletion. Includes `id`
   * even though `items/{id}` docs don't carry an `id` field in the body
   * (the ID lives in the Firestore path), so the audit event is
   * self-contained for forensic lookup. */
  snapshot?: Item;
  /**
   * Before/after snapshots of the onboarding template for
   * `onboarding_template_edit` events. One event per Save (not per
   * add/remove/reorder mutation), so a reviewer can diff before vs. after
   * to reconstruct exactly what changed. Absent on all non-template
   * event types.
   *
   * `before` / `after` are flat itemId arrays preserved for backward
   * compatibility with audit-log readers written before sections existed.
   * The `sectionsBefore` / `sectionsAfter`, `unassignedBefore` /
   * `unassignedAfter`, and `itemNotesBefore` / `itemNotesAfter` fields
   * carry the new structured payload. All "After" fields exist iff the
   * save wrote sections — the seed helper still writes only the legacy
   * `before` / `after` flat arrays. */
  templateChange?: {
    before: string[];
    after: string[];
    sectionsBefore?: OnboardingTemplateSection[];
    sectionsAfter?: OnboardingTemplateSection[];
    unassignedBefore?: string[];
    unassignedAfter?: string[];
    itemNotesBefore?: Record<string, string>;
    itemNotesAfter?: Record<string, string>;
  };
  /**
   * For `receive` events, distinguishes whether the stock-in originated
   * from the OCR-driven packing-slip scanner (`"scan"`), the manual
   * receive form (`"manual"`), or a single submission that includes
   * items from both flows (`"mixed"`). Absent on every other event
   * type. */
  source?: "scan" | "manual" | "mixed";
}

// ── Logistics Users ──
export type LogisticsRole = "admin" | "manager" | "staff";
export interface LogisticsUser {
  id: string;
  name: string;
  role: LogisticsRole;
  email: string;
  isActive: boolean;
  createdAt: Timestamp;
}

// ── Onboarding Drafts ──
export interface OnboardingDraft {
  id: string;
  memberName: string;           // "Doe, John" — for display in sidebar
  memberId: string | null;      // personnel doc ID (null if member not yet created)
  form: {
    firstName: string;
    lastName: string;
    email: string;
    shirt: string;
    pants: string;
    boots: string;
    helmet: string;
    gloves: string;
  };
  step: number;
  notes: string;
  cartItems: CartItem[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

// ── Cart (client-side only, not persisted) ──
export interface CartItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qty: number;
  isBackorder: boolean;
  qtyBefore: number;
  needsSize?: boolean;      // hint: this item requires a size entry
  suggestedQty?: number;    // hint: recommended qty from gear template
  /**
   * Per-item note from the onboarding template's `itemNotes` map. Plain
   * text, surfaced read-only to the issuer in the onboarding flow.
   * Absent / empty string both mean "no note" — the UI treats them the
   * same and renders nothing. */
  note?: string;
  /**
   * Note from the template section this item belongs to (if any).
   * Hydrated by `loadTemplate` from `sections[*].note`; items in the
   * unassigned bucket get no `sectionNote`. The onboarding page renders
   * the section's note as a callout above its group header — items in
   * the same group share the same value by construction. */
  sectionNote?: string;
  /**
   * Stable section id this item belongs to, mirrored from the template
   * doc's `sections[*].id`. Drives section grouping in the issuance
   * flow. Items in the unassigned bucket (or pre-Phase-2 docs with no
   * sections) leave this absent — those items render under a synthetic
   * "Unassigned" group. */
  sectionId?: string;
  /**
   * Display label of the section this item belongs to, mirrored from
   * `sections[*].label`. Used as the group header in the issuance flow.
   * Absent when `sectionId` is absent. */
  sectionLabel?: string;
}
