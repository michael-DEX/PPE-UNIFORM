/**
 * Admin-only page for viewing AND editing the onboarding equipment-issue
 * template.
 *
 * Route: /logistics/admin/onboarding-template
 *
 * Phases:
 *   - 2A (shipped): Firestore rule + audit type + seed helper + loadTemplate
 *     Firestore-first refactor.
 *   - 2B (shipped): three render states (loading / not-seeded / seeded);
 *     seeded view was read-only with disabled edit controls.
 *   - 2C (this file): edit mode live — reorder, remove, add, prune missing,
 *     dirty-state banner + beforeunload guard, race-condition banner,
 *     Save button writes a batched doc + audit event.
 *
 * Editing model: all mutations update `pendingItemIds` (local state) only.
 * Firestore is untouched until the user clicks Save. A `hasLocalEditsRef`
 * guard prevents the live `onSnapshot` subscription from stomping on the
 * user's in-progress edits — if another admin saves while this admin is
 * editing, we preserve pending + show a race banner.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  onSnapshot,
  doc,
  writeBatch,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ListChecks,
  Trash2,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import { useToast } from "../../components/ui/Toast";
import Spinner from "../../components/ui/Spinner";
import { seedOnboardingTemplate } from "../../lib/onboardingTemplateSeed";
import { addAuditEventToBatch } from "../../lib/audit";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import { ONBOARDING_TEMPLATE_ITEM_NAMES } from "../../constants/onboardingTemplate";
import type { Item } from "../../types";

interface TemplateDoc {
  itemIds: string[];
  updatedAt?: { toDate?: () => Date };
  updatedBy?: string;
}

// ── Small local helpers ─────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function matchesQuery(item: Item, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return false;
  const haystacks = [item.name, item.manufacturer, item.model].filter(
    (v): v is string => typeof v === "string",
  );
  return haystacks.some((h) => h.toLowerCase().includes(query));
}

function buildActionText(before: string[], after: string[]): string {
  const added = after.filter((id) => !before.includes(id)).length;
  const removed = before.filter((id) => !after.includes(id)).length;
  if (added === 0 && removed === 0) return "Reordered onboarding template";
  if (added > 0 && removed === 0)
    return `Added ${added} item${added !== 1 ? "s" : ""} to onboarding template`;
  if (removed > 0 && added === 0)
    return `Removed ${removed} item${removed !== 1 ? "s" : ""} from onboarding template`;
  return `Updated onboarding template (${added} added, ${removed} removed)`;
}

// ── Page component ──────────────────────────────────────────────────────

export default function OnboardingTemplatePage() {
  const { isAdmin, logisticsUser } = useAuthContext();
  const { items: inventoryItems, loading: inventoryLoading } = useInventory();
  const toast = useToast();

  const [templateDoc, setTemplateDoc] = useState<TemplateDoc | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // Edit-mode state.
  //   pendingItemIds  — what the user sees in the list, reorderable/removable
  //   baselineItemIds — the snapshot of Firestore the user last synced with;
  //                     diverges from templateDoc.itemIds IFF another admin
  //                     saved concurrently, which triggers the race banner.
  //   hasLocalEditsRef — guards the Firestore → local sync. See effect below.
  //   saving — disables Save + Discard during the batch commit.
  //   searchQuery — controls the inline add-item dropdown visibility.
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);
  const [baselineItemIds, setBaselineItemIds] = useState<string[]>([]);
  const hasLocalEditsRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Live subscription so concurrent admin writes surface immediately.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "app_config", "onboarding_template"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as DocumentData;
          setTemplateDoc({
            itemIds: Array.isArray(data.itemIds) ? (data.itemIds as string[]) : [],
            updatedAt: data.updatedAt,
            updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
          });
        } else {
          setTemplateDoc(null);
        }
        setTemplateLoading(false);
      },
      (err) => {
        console.error("[OnboardingTemplatePage] template subscription failed:", err);
        setTemplateLoading(false);
      },
    );
    return unsub;
  }, []);

  // Sync pending+baseline from Firestore ONLY when the user hasn't edited.
  // If hasLocalEditsRef is true (user has dirty edits), we leave pending
  // untouched AND leave baseline stale — the stale baseline is what makes
  // the race-condition banner fire (baseline ≠ current templateDoc).
  useEffect(() => {
    if (!templateDoc) return;
    if (hasLocalEditsRef.current) return;
    setPendingItemIds(templateDoc.itemIds);
    setBaselineItemIds(templateDoc.itemIds);
  }, [templateDoc]);

  // ── Derived state ─────────────────────────────────────────────────────

  const inventoryById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of inventoryItems) m.set(it.id, it);
    return m;
  }, [inventoryItems]);

  // isDirty: pending vs. CURRENT Firestore. Drives Save button enablement
  // and the blue unsaved-changes banner.
  const isDirty = useMemo(
    () =>
      templateDoc !== null &&
      !arraysEqual(pendingItemIds, templateDoc.itemIds),
    [pendingItemIds, templateDoc],
  );

  // hasExternalUpdate: baseline vs. CURRENT Firestore. Drives the amber
  // race banner. Fires only when another admin saved while this admin was
  // mid-edit.
  const hasExternalUpdate = useMemo(
    () =>
      templateDoc !== null &&
      !arraysEqual(baselineItemIds, templateDoc.itemIds),
    [baselineItemIds, templateDoc],
  );

  // Pending itemIds whose catalog item has been deleted. Drives the
  // yellow "⚠ N missing" banner and the Prune Missing button.
  const unresolvedIds = useMemo(
    () => pendingItemIds.filter((id) => !inventoryById.has(id)),
    [pendingItemIds, inventoryById],
  );

  // Items NOT currently in the template (for the add-item search), filtered
  // to active-only so admins don't add inactive items.
  const availableItems = useMemo(
    () =>
      inventoryItems.filter(
        (i) => i.isActive && !pendingItemIds.includes(i.id),
      ),
    [inventoryItems, pendingItemIds],
  );

  const filteredAvailable = useMemo(
    () =>
      searchQuery
        ? availableItems.filter((i) => matchesQuery(i, searchQuery))
        : [],
    [availableItems, searchQuery],
  );

  // Resolved rows for render, in template order. Missing (deleted) items
  // are rendered separately in a summary banner, not mixed into the list.
  const resolvedRows = useMemo(() => {
    const rows: Array<{ itemId: string; item: Item }> = [];
    for (const id of pendingItemIds) {
      const item = inventoryById.get(id);
      if (item) rows.push({ itemId: id, item });
    }
    return rows;
  }, [pendingItemIds, inventoryById]);

  // ── beforeunload prompt while dirty ───────────────────────────────────
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge require a returnValue assignment to trigger the
      // native "Leave site?" prompt. Modern browsers ignore the message
      // string and render their own generic copy — that's expected.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Edit handlers (all flip hasLocalEditsRef) ─────────────────────────

  function moveUp(index: number) {
    if (index <= 0) return;
    hasLocalEditsRef.current = true;
    setPendingItemIds((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    hasLocalEditsRef.current = true;
    setPendingItemIds((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function removeAt(index: number) {
    hasLocalEditsRef.current = true;
    setPendingItemIds((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAdd(itemId: string) {
    // Defensive: don't add duplicates even if the dropdown somehow surfaces
    // an already-in-list item. filteredAvailable already filters; this is
    // belt-and-suspenders.
    if (pendingItemIds.includes(itemId)) return;
    hasLocalEditsRef.current = true;
    setPendingItemIds((prev) => [...prev, itemId]);
    setSearchQuery("");
  }

  function handlePrune() {
    if (unresolvedIds.length === 0) return;
    const missing = new Set(unresolvedIds);
    hasLocalEditsRef.current = true;
    setPendingItemIds((prev) => prev.filter((id) => !missing.has(id)));
    toast.info(
      `Removed ${missing.size} missing item${missing.size === 1 ? "" : "s"} from the template. Click Save to persist.`,
    );
  }

  function handleDiscard() {
    if (!templateDoc) return;
    hasLocalEditsRef.current = false;
    setPendingItemIds(templateDoc.itemIds);
    setBaselineItemIds(templateDoc.itemIds);
    setSearchQuery("");
  }

  async function handleSave() {
    if (!logisticsUser || !templateDoc) return;
    if (saving) return;
    // Snapshot the before/after so the audit event is deterministic even
    // if state shifts during the await.
    const beforeIds = [...templateDoc.itemIds];
    const afterIds = [...pendingItemIds];

    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "app_config", "onboarding_template"), {
        itemIds: afterIds,
        updatedAt: serverTimestamp(),
        updatedBy: logisticsUser.id,
      });
      addAuditEventToBatch(batch, {
        type: "onboarding_template_edit",
        actorUid: logisticsUser.id,
        actorName: logisticsUser.name,
        actorRole: logisticsUser.role,
        action: buildActionText(beforeIds, afterIds),
        templateChange: {
          before: beforeIds,
          after: afterIds,
        },
      });
      await batch.commit();
      // Clear the local-edits flag BEFORE the next snapshot fires so the
      // sync effect correctly aligns pending + baseline with the freshly-
      // written doc. Also update baseline explicitly here in case the
      // snapshot arrives slower than this callback.
      hasLocalEditsRef.current = false;
      setBaselineItemIds(afterIds);
      toast.success("Template saved.");
    } catch (err) {
      console.error("[OnboardingTemplatePage] save failed:", err);
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Don't reset hasLocalEditsRef — user's edits are still in pending
      // and we want the sync effect to continue protecting them.
    } finally {
      setSaving(false);
    }
  }

  // ── Seed handler (unchanged from Phase 2B) ────────────────────────────

  async function handleSeed() {
    if (!logisticsUser) return;
    setSeeding(true);
    try {
      const result = await seedOnboardingTemplate(inventoryItems, logisticsUser);
      if (result.unresolvedNames.length > 0) {
        toast.info(
          `Seeded ${result.seededItemIds.length} items. ${result.unresolvedNames.length} couldn't be resolved: ${result.unresolvedNames.join(", ")}`,
        );
      } else {
        toast.success(
          `Seeded ${result.seededItemIds.length} items to onboarding template.`,
        );
      }
    } catch (err) {
      console.error("[OnboardingTemplatePage] seed failed:", err);
      toast.error(
        `Seed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSeeding(false);
    }
  }

  // ── Pre-seed stats for the "not seeded" empty state ───────────────────
  const preSeedStats = useMemo(() => {
    const byName = new Map<string, Item>();
    for (const it of inventoryItems) byName.set(it.name, it);
    let resolvedCount = 0;
    const unresolved: string[] = [];
    for (const name of ONBOARDING_TEMPLATE_ITEM_NAMES) {
      if (byName.has(name)) resolvedCount++;
      else unresolved.push(name);
    }
    return {
      totalNames: ONBOARDING_TEMPLATE_ITEM_NAMES.length,
      resolvedCount,
      unresolved,
    };
  }, [inventoryItems]);

  // ── Access gate ───────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-red-600">
        Access denied. Admin role required.
      </div>
    );
  }

  // ── State A: loading ──────────────────────────────────────────────────
  if (inventoryLoading || templateLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  // ── Page shell ────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <header className="flex items-center gap-3">
        <ListChecks size={20} className="text-navy-700" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Onboarding Template
          </h1>
          <p className="text-sm text-slate-500">
            Controls which items appear in the onboarding equipment-issue
            workflow.
          </p>
        </div>
      </header>

      {templateDoc === null ? (
        <NotSeededCard
          stats={preSeedStats}
          seeding={seeding}
          onSeed={handleSeed}
        />
      ) : (
        <>
          {/* Race-condition banner — fires only when another admin saved
              while this admin was mid-edit. Amber so it's distinct from
              the blue "unsaved changes" banner. */}
          {isDirty && hasExternalUpdate && (
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              ⚠ Another admin updated this template while you were editing.
              Your pending changes will overwrite theirs if you save. Click
              "Discard changes" to see their update.
            </div>
          )}

          {/* Unsaved changes banner */}
          {isDirty && (
            <div
              role="status"
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
            >
              You have unsaved changes. Click "Save changes" to persist them.
            </div>
          )}

          {/* Missing items warning */}
          {unresolvedIds.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-3">
              <AlertTriangle
                size={18}
                className="text-amber-700 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900">
                  {unresolvedIds.length} item
                  {unresolvedIds.length === 1 ? "" : "s"} in this template no
                  longer exist in the catalog
                </p>
                <p className="text-xs text-amber-800 mt-1 break-all">
                  Missing IDs: {unresolvedIds.join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={handlePrune}
                className="shrink-0 inline-flex items-center gap-1.5 min-h-9 px-3 py-1.5 rounded-md border border-amber-300 bg-white text-amber-800 text-sm font-medium hover:bg-amber-100 transition-colors"
              >
                Prune missing
              </button>
            </div>
          )}

          {/* List card */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="text-sm min-w-0">
                <span className="font-medium text-slate-900">
                  {resolvedRows.length} items
                </span>
                {unresolvedIds.length > 0 && (
                  <span className="text-slate-500">
                    {" "}(+{unresolvedIds.length} missing)
                  </span>
                )}
                {templateDoc.updatedAt?.toDate && (
                  <span className="text-xs text-slate-500 ml-3">
                    Last updated{" "}
                    {templateDoc.updatedAt.toDate().toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              {isDirty && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    Discard changes
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || unresolvedIds.length > 0}
                    title={
                      unresolvedIds.length > 0
                        ? "Prune missing items before saving"
                        : undefined
                    }
                    className="px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              )}
            </div>

            {resolvedRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">
                No resolvable items in this template.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {resolvedRows.map(({ itemId, item }, idx) => {
                  const subtitle = subtitleFromItem(item);
                  const isFirst = idx === 0;
                  const isLast = idx === resolvedRows.length - 1;
                  return (
                    <li
                      key={itemId}
                      className="px-4 py-3 flex items-center gap-3"
                    >
                      <span className="text-xs text-slate-400 tabular-nums w-6 shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {item.name}
                        </p>
                        {subtitle && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {subtitle}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveUp(idx)}
                          disabled={isFirst}
                          aria-label="Move up"
                          className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDown(idx)}
                          disabled={isLast}
                          aria-label="Move down"
                          className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAt(idx)}
                          aria-label="Remove"
                          className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add-item search */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Add an item to the template
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {availableItems.length} active catalog item
              {availableItems.length === 1 ? "" : "s"} available to add.
            </p>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, manufacturer, or model…"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <ul className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {filteredAvailable.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-slate-500">
                    No matches.
                  </li>
                ) : (
                  filteredAvailable.map((item) => {
                    const subtitle = subtitleFromItem(item);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => handleAdd(item.id)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                        >
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {item.name}
                          </p>
                          {subtitle && (
                            <p className="text-xs text-slate-500 truncate mt-0.5">
                              {subtitle}
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── State B: not seeded (unchanged from Phase 2B) ───────────────────────

function NotSeededCard({
  stats,
  seeding,
  onSeed,
}: {
  stats: { totalNames: number; resolvedCount: number; unresolved: string[] };
  seeding: boolean;
  onSeed: () => void;
}) {
  const skipped = stats.totalNames - stats.resolvedCount;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Template not yet configured
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          The onboarding template is currently read from a hardcoded array.
          Seeding migrates it to Firestore, where it can be edited without
          code changes.
        </p>
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 space-y-1">
        <p>
          Current hardcoded template has{" "}
          <span className="font-semibold">{stats.totalNames}</span> items.
        </p>
        <p>
          <span className="font-semibold text-emerald-700">
            {stats.resolvedCount}
          </span>{" "}
          match a live catalog item and will be seeded.
        </p>
        {skipped > 0 && (
          <p className="text-amber-700">
            <span className="font-semibold">{skipped}</span> won't resolve and
            will be skipped:{" "}
            <span className="italic">{stats.unresolved.join(", ")}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSeed}
          disabled={seeding || stats.resolvedCount === 0}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {seeding ? "Seeding…" : "Seed from current template"}
        </button>
        <p className="text-xs text-slate-500">
          One-shot. Writes {stats.resolvedCount} items to Firestore + one audit
          event.
        </p>
      </div>
    </div>
  );
}
