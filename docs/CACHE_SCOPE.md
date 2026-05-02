# Cache Module — Scope

**Status:** Draft v3, pre-implementation
**Branch:** `feature/cache-module`
**Last updated:** May 1, 2026
**Supersedes:** v1 (initial draft) and v2 (post-EMOS-export rewrite). v3 incorporates the box-item join table dump (11,632 assignments across 918 boxes and 4,727 items).

---

## Purpose

Add equipment cache management to the CA-TF2 Logistics app as a new section under the `LOGISTICS` sidebar group, alongside the existing Uniforms / PPE module.

The eventual goal is to replace **EMOS-CATF2** (the FileMaker-based system currently used to track CA-TF2's equipment cache) with a workflow that fits how the task force actually operates: ~8,300 items, ~918 boxes (more than the rough "1,000" estimate), divided into five funding/sponsoring caches (DOS, FEMA, Local, CAL OES, Training), stored primarily at the warehouse with some at an offsite training facility, and deployed as intact box sets on rescue missions.

This document defines what's in scope for the initial build and what's deferred.

### What changed in v3

The box-item join table (Box_Items.xlsx) revealed a few things v2 had wrong:

- **Boxes have load specs, not just current contents.** Each box-item assignment has both `quantityDefined` (what *should* be in the box per the load list) and `quantityTotal` (what's actually in it right now). 29% of assignments have a delta — boxes are overpacked, underpacked, or missing items relative to their spec. This is operational signal worth preserving.
- **Box numbering is unstructured.** Real box numbers include `1 01 01A`, `1R032`, `REMS1R`, `USAR BC45`, `USAR COOR`, `WORKSHOP`. No regex validates this. `boxNumber` is free-text with a uniqueness constraint, not a structured format.
- **`cacheBoxType` is its own concept, distinct from `cache`.** The `cache` field is the funding source (FEMA, DOS, CAL OES, Local, Training). The `cacheBoxType` is the functional category (RESCUE, MEDICAL, LOGISTICS, HAZMAT, TECHNICAL, COMMUNICATION, WATER RESCUE, PLANNING, LOCAL USAR, WAREHOUSE, ADMINISTRATIVE). Both fields exist on a box and are independent.
- **Casing inconsistency is too widespread to defer.** Existing data has `RESCUE` / `Rescue`, `MEDICAL` / `Medical`, `LOGISTICS` / `Logistics`, `HazMat` / `Hazmat`, all in the live dataset. v2 flagged this as a Stage 1.5 problem. v3 makes it Stage 1: `cacheBoxType` is a controlled list from day one.
- **EMOS migration is more achievable than v2 assumed.** v2 said box assignments were "stuck inside FileMaker." Per-table exports cover items + box-assignments + box-types. Combined with the FEMA cache list, this is a workable migration source for everything except hazmat compliance details, vendor relationships, PM tasks, files, and notes — which remain stuck and require FileMaker Data API access.

### What changed from v1 (recap, still relevant)

- **Schema is two-tier, not three-tier.** EMOS uses one row per physical item with serial number on the row when applicable. Three-tier was overengineered.
- **Two ID fields, not one.** `idCacheTF` is the local primary key; `idCacheFEMA` is an optional reference to FEMA's master cache list.
- **Cache standards (FEMA Type I list, etc.) deferred to Stage 2.** Schema flagged in this doc so we don't paint into a corner.

---

## Out of scope (explicitly)

- **Cache rehab workflow.** Post-deployment refurbishment, repacking, recertification.
- **Deployment integration.** Tying boxes to specific rescue missions, mobilization rosters, or ICS event records.
- **Hazmat declarations (HAZDECS).** IATA / DOT shipping documentation generation.
- **Load planning.** Pallet building, aircraft loading, segregation rules. Separate future sidebar item.
- **Vehicle tracking.** Separate future sidebar item.
- **Cache standards / Master Cache Link.** "FEMA / DOS / CAL OES says you should have X" is real but separate. Stage 2 candidate.
- **PM tasks (preventive maintenance scheduling).** Visible in EMOS but not in the export. Could be its own module.
- **Vendor / procurement tracking.** Visible in EMOS, not in the export.
- **File / photo attachments per item or box.** Stage 2 candidate.
- **Migration of EMOS data not covered by per-table exports.** Hazmat compliance details (UN#, CLASS, PG), vendor relationships, PM tasks, files, notes — these remain in FileMaker and require Data API access. Not blocking for Stage 1.

---

## Permissions

Admin-only for write. `isLogistics()` for read. Same pattern as `caches` and `locations` from feature #1.

---

## Data model

Three Firestore collections for Stage 1: `items`, `boxes`, `boxAssignments`. Plus the `caches` and `locations` collections already built in feature #1, plus a new lookup collection `cacheBoxTypes` for the controlled-list discipline values.

### `items` — one document per physical item (or stack of identical non-serialized items)

Each row represents either a unique serialized item (one chainsaw, one radio) or a count of identical non-serialized items (40 hammers, 612 respirator cartridges).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID — uses `idCacheTF` value (e.g. `TF-0269`) |
| `idCacheTF` | string | Required. Primary identifier. Format: `TF-\d+`. Immutable once created. |
| `idCacheFEMA` | string \| null | Optional. FEMA cache item number. Format: `[A-Z]{2}-\d{4}\.\d{2}`. Immutable once set. |
| `description` | string | Required. Free-text. |
| `manufacturer` | string \| null | |
| `modelPartNum` | string \| null | |
| `serialNumber` | string \| null | Present for serialized items. Null for bulk consumables. |
| `propertyID` | string \| null | Federal property tag (A-prefix). |
| `barcodeTF` | string \| null | Local barcode. |
| `barcodeFEMA` | string \| null | FEMA-assigned barcode. |
| `lotNum` | string \| null | Lot number. |
| `quantityTotal` | number | Total count owned. `1` for serialized, `N` for bulk. |
| `quantityAvailable` | number | In stock. Stage 1 always equals `quantityTotal`. Diverges in Stage 2. |
| `quantityOut` | number | Checked out. Stage 1 always `0`. Populated in Stage 2. |
| `dateInService` | timestamp \| null | |
| `dateExpire` | timestamp \| null | |
| `dateRetired` | timestamp \| null | |
| `statusItem` | enum | `IN` \| `OUT` \| `N/A`. |
| `isHazMat` | bool | |
| `unitMeasure` | string | `each` (default), `pair`, `box`, `case`, etc. |
| `unitCost` | number \| null | USD. |
| `cache` | string ref | → `caches` collection. Funding source. |
| `category` | string \| null | Optional grouping. See open questions. |
| `subcategory` | string \| null | |
| `notes` | string \| null | |
| `active` | bool | Soft delete. |
| audit fields | | `createdAt`, `updatedAt`, `createdBy`, `updatedBy`. |

### `boxes` — one document per physical box

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID. |
| `boxNumber` | string | Required. Unique. **Free text** — real numbers include `1 01 01A`, `REMS1R`, `WORKSHOP`. No regex. Uniqueness enforced on create. Immutable. |
| `description` | string | |
| `cache` | string ref | → `caches` collection. Funding source (FEMA / DOS / Local / CAL OES / Training). |
| `cacheBoxType` | string ref | → `cacheBoxTypes` collection. Functional category (RESCUE / MEDICAL / etc.). Controlled list. |
| `location` | string ref | → `locations` collection. |
| `containerType` | string \| null | Hardigg, Pelican, footlocker, etc. |
| `dimensions` | `{ l, w, h }` \| null | Inches. |
| `weightKg` | number \| null | |
| `volumeCuFt` | number \| null | |
| `groupTags` | string[] | Free-form tags. |
| `notes` | string | |
| `active` | bool | Soft delete. |
| audit fields | | |

**Computed fields (read-time, not stored):** `itemCount`, `valueUSD`, `isHazMat`, and the load-spec compliance summary (count of assignments where `quantityTotal != quantityDefined`). All derived from joining `boxAssignments` with `items`. We do not denormalize. Revisit with a Cloud Function trigger only if perf actually breaks.

### `boxAssignments` — join between items and boxes, with load-spec semantics

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID. |
| `itemId` | string ref | → `items`. |
| `boxId` | string ref | → `boxes`. |
| `quantityDefined` | number | **Spec quantity** — what the box's load list says should be in the box. |
| `quantityTotal` | number | **Actual quantity** — what's currently physically in the box. |
| `notes` | string \| null | Per-assignment notes (e.g. "missing safety guard"). |
| `condition` | enum \| null | `serviceable` / `unserviceable` / `in_repair`. Stage 2 candidate. Nullable in Stage 1. |
| audit fields | | |

The `quantityDefined` vs `quantityTotal` delta is the source of "this box is overpacked / underpacked / missing items" reports — operational signal worth preserving from EMOS.

A given item can appear in multiple boxes (the P100 cartridge example: 612 total spread across 8 boxes). The join is `(itemId, boxId)` with quantities per row.

### `cacheBoxTypes` — controlled list of functional categories

Same shape as `caches` and `locations` from feature #1. Initial seed (after normalizing existing casing inconsistencies):

`RESCUE`, `MEDICAL`, `LOGISTICS`, `HAZMAT`, `TECHNICAL`, `COMMUNICATION`, `WATER RESCUE`, `PLANNING`, `LOCAL USAR`, `WAREHOUSE`, `ADMINISTRATIVE`

Stored as a Firestore collection (not a hardcoded enum) so admins can add new types via the UI without a code change.

### `caches` and `locations`

Already built in feature #1. No schema changes.

---

## Stage 1 — Static cache management (next ~1 month)

The goal: the entire cache modeled in the app, browseable, editable, exportable, and importable from the EMOS exports. No checkouts, no deployments, no movement history.

### Implementation order

Each step is a single focused commit. Stop and verify before moving on.

1. **`cacheBoxTypes` CRUD.** Smallest collection, mirrors `caches`/`locations` exactly. Quick warm-up. Seed the 11 initial types.
2. **Items CRUD.** New page at `/logistics/admin/items`. List, paginated, searchable by `idCacheTF` / `idCacheFEMA` / description / serial / barcode. Filterable by cache, hazmat, status. Edit modal. Soft delete with Show Inactive.
3. **CSV / Excel import for items.** Import the 22-column EMOS export. Map columns explicitly, validate, report errors row-by-row, commit only on user confirmation. Required — 8,300 rows is not a hand-entry task.
4. **Boxes CRUD.** Page at `/logistics/admin/boxes`. List/detail/edit. Free-text `boxNumber`, controlled-list `cacheBoxType`.
5. **Box assignments.** UI to add items to boxes (search by TF# or description), set `quantityDefined` and `quantityTotal`. Box detail view shows all assigned items with delta indicators. Item detail view shows "in N boxes, total qty X."
6. **CSV import for boxes + assignments.** Two-step: first import unique boxes (derived from the join file's distinct `boxNumber` values), then import the 11,632-row join. Match items by `idCacheTF`, fail loud on misses.
7. **Aggregate views.** Box-level totals (count, value, hazmat, spec-vs-actual delta count). Item-level (in N boxes).
8. **Export.** CSV / Excel of items, boxes, or full inventory.

### Out of Stage 1

- Photos / attachments per box or item (Stage 2 candidate)
- Per-shelf / per-bin sub-location tracking (deferred — see open questions)
- Barcode scanning UI for item lookup (deferred — see open questions)
- Hazmat compliance details (UN#, Class, PG) — schema reservation only, no UI
- Cache standards / Master Cache Link / compliance reporting (Stage 2)
- Vendor relationships, PM tasks, file attachments (out of module scope or Stage 2)
- Reporting dashboards beyond raw export and the box load-spec delta

---

## Stage 2 — Operational state (later)

Layered on Stage 1's static model.

### Features

1. **Checkout / deployment.** Mark items or boxes as deployed. Captures destination, deploying personnel, expected return date.
2. **Transfer.** Move a box between locations without deploying.
3. **Return.** Mark deployed items/boxes returned. Capture return date and condition.
4. **Movement history.** Per-item and per-box timelines.
5. **Condition reports.** Flag items as needing repair / replacement.
6. **Cache standards (`cacheStandards` collection).** Import the FEMA Type I Cache List (and DOS, CAL OES equivalents). Items link via `idCacheFEMA`. Compliance reporting: "FEMA requires 45 PAPRs, you have 45, missing 0."
7. **Box rehab / load-spec reconciliation.** Tools that walk the `quantityDefined` vs `quantityTotal` deltas across all boxes and surface a worklist: "Box 1 01 06 is missing 5 items, has 3 surplus items."

State model: `quantityAvailable` and `quantityOut` start equaling `quantityTotal` and `0` respectively (Stage 1 invariant). Stage 2 introduces transactions that move quantity between Available and Out.

---

## Open questions

These need resolution during Stage 1 build, not before this doc is approved.

1. **Category / subcategory taxonomy on items.** EMOS has free-text Category and Subcategory fields with quality issues. Three options: (a) free text with normalize-on-display; (b) controlled list (existing `app_config/catalog_categories` or new `cacheCategories`); (c) adopt FEMA's SECTION / GROUP. **Recommend (b)** with one-time normalization during import.
2. **Sub-location tracking.** Warehouse-level only, or do we need shelf / row / bin? **Recommend deferral** to Stage 1.5 if needed.
3. **Barcode scanning UI.** Two barcode fields exist but no scan UX in Stage 1. **Recommend deferral.**
4. **Hazmat compliance schema.** Reserve a `hazmatCompliance` subcollection on items now, or wait? **Recommend reserving the schema** in this doc, no UI in Stage 1.
5. **Soft delete vs hard delete.** **Recommend soft delete** with `active: false`. Federal equipment audits demand records.
6. **Box-import strategy.** The join file gives us 918 unique `boxNumber` + `cacheBoxType` combinations but no other box metadata (containerType, dimensions, weight, etc.). Two options: (a) seed boxes with just number + type, fill metadata later by hand; (b) wait for a separate boxes-table export from EMOS before importing assignments. **Recommend (a)** — start with what we have, enrich incrementally.
7. **EMOS migration completeness.** Hazmat compliance details, vendor relationships, PM tasks, files, and notes are stuck inside FileMaker until Data API access is available. The new app must function as the source of truth for *new* data even if some EMOS history is never migrated.

---

## Reference material

- **EMOS-CATF2** — current source of truth for cache data. FileMaker-based. Per-table exports cover catalog and box-item join. Full migration via FileMaker Data API is a separate problem.
- **EMOS export — Items** (CacheItem_63913243122.xlsx) — 8,304 items, 22 columns. Source for the items collection.
- **EMOS export — Box assignments** (Box_Items.xlsx) — 11,632 assignments, 918 unique boxes, 4,727 unique items, 15 columns. Source for boxes + boxAssignments.
- **2025 FEMA Approved Equipment Cache List** — Type I master spec, 2,146 line items across 13 sections. Stage 2's `cacheStandards` seed.
- **USAR ONE prototype** (`usar.logistics-main`) — `types.ts` for reference shapes only. Their schema is flat and lacks the two-ID system; do not copy verbatim.
- **Existing PPE module** — pattern for Firestore collection wiring, audit logging, soft delete UX.
