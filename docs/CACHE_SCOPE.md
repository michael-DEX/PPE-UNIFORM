# Cache Module — Scope

**Status:** Draft, pre-implementation
**Branch:** `feature/cache-module`
**Last updated:** May 1, 2026

---

## Purpose

Add equipment cache management to the CA-TF2 Logistics app as a new section under the `LOGISTICS` sidebar group, alongside the existing Uniforms / PPE module.

The eventual goal is to replace **DB Solution** (the current cache-tracking system) with a workflow that fits how CA-TF2 actually operates: ~1,000 boxes, ~20,000 items, divided into five funding/sponsoring caches (DOS, FEMA, Local, CAL OES, Training), stored primarily at the warehouse with some at an offsite training facility, and deployed as intact box sets on rescue missions.

This document defines what's in scope for the initial build and — just as importantly — what's deferred.

---

## Out of scope (explicitly)

These are real needs but not part of this module:

- **Cache rehab workflow.** Post-deployment refurbishment, repacking, recertification.
- **Deployment integration.** Tying boxes to specific rescue missions, mobilization rosters, or ICS event records.
- **Hazmat declarations (HAZDECS).** IATA / DOT shipping documentation generation.
- **Load planning.** Pallet building, aircraft loading, segregation rules. (Separate future sidebar item.)
- **Vehicle tracking.** Separate future sidebar item.
- **Migration tooling for DB Solution.** Replacement is the eventual goal but is not part of Stage 1 or Stage 2 — see "Open questions" below.

---

## Permissions

Admin-only. No manager- or specialist-level access in this module beyond what already exists for Uniforms / PPE.

---

## Data model

Three tiers, modeled as separate Firestore collections.

### `boxes` — one document per physical box

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `boxNumber` | string | Unique human-readable ID, e.g. `BOX-0042` |
| `description` | string | Free text |
| `cache` | enum | `DOS` \| `FEMA` \| `Local` \| `CAL_OES` \| `Training` — see "Caches as configurable list" below |
| `location` | string ref | Reference to a `locations` doc (Warehouse, Offsite Training Facility, etc.) |
| `containerType` | string | Hardigg, Pelican, footlocker, etc. |
| `dimensions` | `{ l, w, h }` | Inches |
| `weightKg` | number | |
| `volumeCuFt` | number | Computed or manual |
| `isHazMat` | bool | Aggregate flag — true if any contained item is hazmat |
| `valueUSD` | number | Total value of contents |
| `discipline` | string | Rescue / Medical / Logistics / Comms / etc. — optional grouping |
| `groupTags` | string[] | Free-form tags |
| `notes` | string | |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | audit fields | |

**Note on `itemCount`:** the USAR ONE prototype stores `itemCount` as a denormalized field on the box. **We compute it on read** instead, to avoid sync bugs. If we hit a perf problem with 1,000 boxes, we revisit with a Cloud Function trigger — not before.

### `itemTypes` — the catalog (one document per *kind* of thing)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `tfid` | string | Task Force Item ID — unique, e.g. `TF12345` |
| `name` | string | "Chainsaw, Stihl MS 261" |
| `description` | string | |
| `category` | string | Tool / PPE / Medical / Comms / etc. |
| `defaultUnit` | string | `each`, `pair`, `box`, `case` |
| `isSerialized` | bool | If true, every instance must have a unique `serialNumber` |
| `isHazMat` | bool | |
| `sdsUrl` | string \| null | Safety Data Sheet link |
| `notes` | string | |

A TFID identifies a *kind* of item, not a physical instance. Searching by TFID returns all instances across all boxes.

### `itemInstances` — what's actually in each box

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `boxId` | string ref | → `boxes` |
| `itemTypeId` | string ref | → `itemTypes` |
| `quantity` | number | For non-serialized items (e.g. `4` hammers in this box). For serialized, always `1`. |
| `serialNumber` | string \| null | Required if parent `itemType.isSerialized`, null otherwise |
| `condition` | enum | `serviceable` \| `unserviceable` \| `in_repair` \| `retired` |
| `notes` | string | |
| `createdAt`, `updatedAt` | audit | |

**Worked example.** Hammer (`TF98765`, not serialized) appears in 40 boxes with quantities of 1–4 each → 40 `itemInstances` rows, all `serialNumber: null`. Chainsaw (`TF12345`, serialized) has 10 physical units → 10 `itemInstances` rows, each `quantity: 1` and a unique `serialNumber`.

### `caches` and `locations` — configurable lists

Stored as small Firestore collections, not hardcoded enums. Each has `id`, `name`, `description`, `active` (bool). This way adding a new cache or storage location later is a UI action, not a code change.

Initial seed:

- **Caches:** DOS, FEMA, Local, CAL OES, Training
- **Locations:** Warehouse, Offsite Training Facility

---

## Stage 1 — Static cache management (next ~1 month)

The goal of Stage 1 is to get the entire cache modeled in the app, browseable, editable, and exportable. No movement, no deployment, no checkout — just an accurate digital twin of what's on the warehouse shelves.

### Features

1. **Box CRUD.** List view (paginated, filterable by cache and location), detail view, create, edit, delete (soft delete with audit trail).
2. **Item type CRUD.** Catalog management — add a new TFID, edit name / category / hazmat / SDS link / serialization flag.
3. **Item instance management.** Add items to a box (search by TFID or name), set quantity or serial number, edit, remove. Bulk-add for non-serialized items.
4. **Search and lookup.**
   - By box number → box detail
   - By TFID or item name → list of all boxes containing that item, with quantities
   - By serial number → specific instance and its current box
5. **Cache and location management.** UI for the configurable lists in §"Caches and locations" above.
6. **Import.** CSV / Excel import for boxes and items. Critical for initial population — nobody is typing 20,000 items into a UI. Format TBD; will likely match a DB Solution export shape once we see one.
7. **Export.** CSV / Excel export of the full inventory or a filtered subset. For audits, reports, and as a transitional bridge while DB Solution is still authoritative.
8. **Pagination and indexed queries from day one.** With 1,000 boxes and 20,000 items, full-collection client-side filtering is not viable. Firestore composite indexes on `(cache, location)`, `(itemTypeId)`, etc.

### Out of Stage 1

- Photos / attachments per box or item (Stage 2 candidate)
- Per-shelf / per-bin sub-location tracking (deferred — see open questions)
- Barcode scanning UI (deferred — see open questions)
- Reporting dashboards beyond raw export

---

## Stage 2 — Operational state (later)

Layered on top of Stage 1's static model. Everything in Stage 2 assumes Stage 1 is solid.

### Features

1. **Checkout / deployment.** Mark a box (or set of boxes) as deployed. Captures destination, deploying personnel, expected return date. Box stays in the system; its *state* changes from `in_warehouse` to `deployed`.
2. **Transfer.** Move a box between locations (Warehouse ↔ Offsite Training Facility) without deploying it.
3. **Return.** Mark a deployed box as returned. Capture return date, condition notes.
4. **Movement history.** Per-box timeline: created → deployed (Turkey, 2023-02) → returned → transferred → deployed → returned. Queryable.
5. **Condition reports.** Flag a box or instance as needing repair / replacement.

State model on the box: `home_cache`, `home_location` (set in Stage 1) plus `current_state` and `current_location` (added in Stage 2). The home values never change; the current values track reality.

---

## Open questions

These need answers before or during Stage 1, not before this doc is approved.

1. **DB Solution export format.** What does a DB Solution data dump look like? CSV, Excel, XML? Field names? Resolving this defines the import format and shapes the Stage 1 import feature.
2. **Sub-location tracking.** Is "Warehouse" granular enough, or do we need shelf / row / bin? Recommend: **start with just the location, add sub-locations in a Stage 1.5 if needed.** Easy to add later, hard to remove if wrong.
3. **Barcode vs TFID-only.** Today identification is TFID + serial. Does CA-TF2 want to add barcode scanning as a parallel input method? If yes, when? Recommend: **deferred to post–Stage 1.** TFID is sufficient for the static catalog; barcodes become more valuable once Stage 2 checkout exists.
4. **Photos.** Should boxes and item types support photos? (USAR ONE supports box label photos via OCR.) Recommend: **deferred to Stage 2.**
5. **Soft delete vs hard delete.** Recommend soft delete with `deletedAt` field — losing a box record by accident is bad, and audit trails matter for federally funded equipment.
6. **Aggregate `isHazMat` on box.** Is this a manual flag, or computed from contained items' hazmat flags? Recommend: **computed**, with the same compute-on-read logic as `itemCount`.

---

## Implementation order (Stage 1)

Suggested feature-by-feature build order, one commit per feature, deployed only when the full Stage 1 set is stable. Branch: `feature/cache-module`.

1. Caches and locations CRUD (smallest collections, simplest UI — good warm-up)
2. Item types CRUD (the catalog, no dependencies on boxes)
3. Boxes CRUD (depends on caches and locations)
4. Item instances — add/edit/remove within a box
5. Search: by box number, by TFID, by serial number
6. CSV/Excel import (boxes + items)
7. CSV/Excel export
8. Polish: pagination, filters, performance pass against seeded 1k-box dataset

---

## Reference material

- **USAR ONE prototype** (`usar.logistics-main`) — `types.ts` for `LogisticsBox` / `LogisticsItem` shapes (note: their schema is flat, ours is product-vs-instance). UI patterns in their logistics views.
- **Existing PPE module** in this repo — pattern for Firestore collection wiring, audit logging, mobile card layouts.
- **DB Solution** — current source of truth for cache data. Eventual replacement target.
