/**
 * Admin-only page for managing the configurable `caches` and `locations`
 * lists used by the Cache module. Soft-delete only — toggling `active`
 * to false hides the entry from the default list view but preserves the
 * doc so historical box references stay resolvable. Restore via the
 * "Show inactive" toggle.
 *
 * Route: /logistics/admin/cache
 */

import { useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import {
  Boxes,
  MapPin,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Save,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/Toast";
import { useCachesAndLocations } from "../../hooks/useCachesAndLocations";
import { seedCachesAndLocations } from "../../lib/cachesAndLocationsSeed";
import { addAuditEventToBatch } from "../../lib/audit";
import Spinner from "../../components/ui/Spinner";
import Button from "../../components/ui/Button";
import Tabs from "../../components/ui/Tabs";
import Modal from "../../components/ui/Modal";
import Badge from "../../components/ui/Badge";
import EmptyState from "../../components/ui/EmptyState";
import type { Cache, Location, LogisticsUser, AuditEventType } from "../../types";

type EntryKind = "cache" | "location";
type Entry = Cache | Location;

// User-created entries get slug-based IDs so they read like human foreign
// keys in `boxes` docs (feature #3). Mirrors the catalog-categories pattern.
function slugifyId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const COLLECTION_BY_KIND: Record<EntryKind, "caches" | "locations"> = {
  cache: "caches",
  location: "locations",
};

const AUDIT_TYPE_BY_KIND: Record<EntryKind, AuditEventType> = {
  cache: "cache_edit",
  location: "location_edit",
};

const SINGULAR_LABEL: Record<EntryKind, string> = {
  cache: "cache",
  location: "location",
};

export default function CacheManagementPage() {
  const { isAdmin, logisticsUser } = useAuthContext();
  const toast = useToast();
  const { caches, locations, loading, isEmpty } = useCachesAndLocations();

  const [activeTab, setActiveTab] = useState<EntryKind>("cache");
  const [showInactive, setShowInactive] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  // Once-per-session guard so re-renders during a save don't re-fire the
  // seed. Belt-and-suspenders alongside the deterministic slug IDs in
  // `seedCachesAndLocations` (which already make racing seeds idempotent).
  const seededRef = useRef(false);

  const activeList = activeTab === "cache" ? caches : locations;
  const visibleList = useMemo(
    () => (showInactive ? activeList : activeList.filter((e) => e.active)),
    [activeList, showInactive],
  );
  const inactiveCount = useMemo(
    () => activeList.filter((e) => !e.active).length,
    [activeList],
  );

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-red-600">
        Access denied. Admin role required.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  async function handleSeed() {
    if (!logisticsUser) return;
    if (seededRef.current) return;
    seededRef.current = true;
    setSeeding(true);
    try {
      await seedCachesAndLocations(logisticsUser);
      toast.success("Caches and locations seeded.");
    } catch (err) {
      console.error("[CacheManagementPage] seed failed:", err);
      toast.error(err instanceof Error ? err.message : "Seed failed.");
      seededRef.current = false;
    } finally {
      setSeeding(false);
    }
  }

  // Empty state: no caches AND no locations. Surface the seed action — the
  // user can populate the defaults with one click.
  if (isEmpty) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <header className="flex items-center gap-3">
          <Boxes size={20} className="text-navy-700" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Cache Management</h1>
            <p className="text-sm text-slate-500">
              Configure the caches and storage locations used by the Cache module.
            </p>
          </div>
        </header>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
          <p className="text-sm text-slate-700">
            No caches or locations are configured yet. Seed the standard
            CA-TF2 defaults (DOS / FEMA / Local / CAL OES / Training,
            plus Warehouse and Offsite Training Facility) to begin.
          </p>
          <Button onClick={handleSeed} disabled={seeding}>
            <Plus size={16} />
            {seeding ? "Seeding…" : "Seed defaults"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header className="flex items-center gap-3">
        <Boxes size={20} className="text-navy-700" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cache Management</h1>
          <p className="text-sm text-slate-500">
            Configure the caches and storage locations used by the Cache module.
          </p>
        </div>
      </header>

      <Tabs
        tabs={[
          { id: "cache", label: "Caches", count: caches.length },
          { id: "location", label: "Locations", count: locations.length },
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as EntryKind)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-slate-300 text-navy-700 focus:ring-navy-500"
          />
          Show inactive
          {inactiveCount > 0 && (
            <span className="text-xs text-slate-400">
              ({inactiveCount} hidden)
            </span>
          )}
        </label>

        <Button
          onClick={() =>
            setEditorState({ mode: "create", kind: activeTab, name: "", description: "" })
          }
        >
          <Plus size={16} />
          Add {SINGULAR_LABEL[activeTab]}
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {visibleList.length === 0 ? (
          <EmptyState
            icon={activeTab === "cache" ? <Boxes size={36} /> : <MapPin size={36} />}
            title={`No ${activeTab === "cache" ? "caches" : "locations"} to show`}
            description={
              !showInactive && inactiveCount > 0
                ? `${inactiveCount} inactive ${activeTab === "cache" ? "cache(s)" : "location(s)"} hidden. Toggle "Show inactive" to view.`
                : `Add a ${SINGULAR_LABEL[activeTab]} to get started.`
            }
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {visibleList.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                kind={activeTab}
                onEdit={() =>
                  setEditorState({
                    mode: "edit",
                    kind: activeTab,
                    id: entry.id,
                    name: entry.name,
                    description: entry.description,
                  })
                }
                onToggleActive={(next) => toggleActive(entry, activeTab, next, logisticsUser, toast)}
              />
            ))}
          </ul>
        )}
      </div>

      {editorState && logisticsUser && (
        <EntryEditor
          state={editorState}
          existingIds={(editorState.kind === "cache" ? caches : locations).map((e) => e.id)}
          actor={logisticsUser}
          onClose={() => setEditorState(null)}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  kind,
  onEdit,
  onToggleActive,
}: {
  entry: Entry;
  kind: EntryKind;
  onEdit: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 ${entry.active ? "" : "bg-slate-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-semibold truncate ${entry.active ? "text-slate-900" : "text-slate-500"}`}>
            {entry.name}
          </h3>
          {!entry.active && <Badge variant="default">Inactive</Badge>}
        </div>
        {entry.description && (
          <p className={`text-sm mt-0.5 ${entry.active ? "text-slate-600" : "text-slate-400"}`}>
            {entry.description}
          </p>
        )}
        <p className="text-[11px] text-slate-400 font-mono mt-1 truncate">
          {entry.id}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          aria-label={`Edit ${SINGULAR_LABEL[kind]}`}
          title="Edit"
        >
          <Pencil size={16} />
        </button>
        {entry.active ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Mark "${entry.name}" inactive? It will be hidden from default views but preserved in the database.`)) {
                onToggleActive(false);
              }
            }}
            className="p-2 rounded-lg text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors"
            aria-label="Deactivate"
            title="Mark inactive"
          >
            <Archive size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggleActive(true)}
            className="p-2 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
            aria-label="Restore"
            title="Restore"
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

// ── Soft-delete / restore ───────────────────────────────────────────────

async function toggleActive(
  entry: Entry,
  kind: EntryKind,
  nextActive: boolean,
  actor: LogisticsUser | null,
  toast: ReturnType<typeof useToast>,
) {
  if (!actor) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, COLLECTION_BY_KIND[kind], entry.id), {
      active: nextActive,
      updatedAt: serverTimestamp(),
      updatedBy: actor.id,
    });
    addAuditEventToBatch(batch, {
      type: AUDIT_TYPE_BY_KIND[kind],
      actorUid: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: `${nextActive ? "Restored" : "Deactivated"} ${SINGULAR_LABEL[kind]} "${entry.name}"`,
    });
    await batch.commit();
    toast.success(`${nextActive ? "Restored" : "Deactivated"} "${entry.name}".`);
  } catch (err) {
    console.error("[CacheManagementPage] toggleActive failed:", err);
    toast.error(err instanceof Error ? err.message : "Update failed.");
  }
}

// ── Editor (create / edit modal) ────────────────────────────────────────

type EditorState =
  | { mode: "create"; kind: EntryKind; name: string; description: string }
  | { mode: "edit"; kind: EntryKind; id: string; name: string; description: string };

function EntryEditor({
  state,
  existingIds,
  actor,
  onClose,
}: {
  state: EditorState;
  existingIds: string[];
  actor: LogisticsUser;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(state.name);
  const [description, setDescription] = useState(state.description);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const proposedId = state.mode === "create" ? slugifyId(trimmedName) : state.id;
  const idCollision =
    state.mode === "create" && proposedId.length > 0 && existingIds.includes(proposedId);
  const canSave = trimmedName.length > 0 && proposedId.length > 0 && !idCollision && !saving;
  const titleNoun = SINGULAR_LABEL[state.kind];
  const title = state.mode === "create"
    ? `Add ${titleNoun}`
    : `Edit ${titleNoun}`;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      if (state.mode === "create") {
        batch.set(doc(db, COLLECTION_BY_KIND[state.kind], proposedId), {
          name: trimmedName,
          description: trimmedDescription,
          active: true,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.id,
          updatedBy: actor.id,
        });
        addAuditEventToBatch(batch, {
          type: AUDIT_TYPE_BY_KIND[state.kind],
          actorUid: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: `Created ${titleNoun} "${trimmedName}"`,
        });
      } else {
        batch.update(doc(db, COLLECTION_BY_KIND[state.kind], state.id), {
          name: trimmedName,
          description: trimmedDescription,
          updatedAt: now,
          updatedBy: actor.id,
        });
        addAuditEventToBatch(batch, {
          type: AUDIT_TYPE_BY_KIND[state.kind],
          actorUid: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: `Updated ${titleNoun} "${trimmedName}"`,
        });
      }
      await batch.commit();
      toast.success(`${state.mode === "create" ? "Added" : "Saved"} "${trimmedName}".`);
      onClose();
    } catch (err) {
      console.error("[CacheManagementPage] save failed:", err);
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={state.kind === "cache" ? "e.g. FEMA Region 9" : "e.g. Yard Container"}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
          {state.mode === "create" && trimmedName.length > 0 && (
            <p className="text-[11px] text-slate-500 font-mono mt-1">
              ID: {proposedId || "(invalid)"}
              {idCollision && (
                <span className="text-red-600 not-italic ml-2">
                  Already exists — pick a different name.
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Description <span className="text-slate-400">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>

        {state.mode === "edit" && (
          <p className="text-xs text-slate-400">
            ID is immutable — to “rename” an entry, edit the name. The ID stays
            stable so existing references keep resolving.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            <Save size={16} />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
