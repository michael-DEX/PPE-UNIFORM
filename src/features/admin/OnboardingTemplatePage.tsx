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
 *   - 2C (shipped): edit mode for the flat itemIds list — reorder, remove,
 *     add, prune missing, dirty-state + race banners, batched Save.
 *   - 2D (this file): manual sections + per-section notes + per-item
 *     notes. Schema widens to `{ sections, unassigned, itemNotes }`;
 *     legacy `itemIds` is still written redundantly for the rollback
 *     compatibility window.
 *
 * Editing model (unchanged in spirit from 2C): all mutations update local
 * `pending*` state only. Firestore is untouched until the user clicks
 * Save. A `hasLocalEditsRef` guard prevents the live `onSnapshot`
 * subscription from stomping on the user's in-progress edits — if another
 * admin saves while this admin is editing, we preserve pending + show a
 * race banner.
 *
 * Issuance workflow consumption is NOT changed in this commit — sections
 * and notes will surface in the issuance UI in Phase 3.
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
  ListChecks,
  Plus,
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
import SectionCard, { type ResolvedItem } from "./onboardingTemplate/SectionCard";
import UnassignedSection from "./onboardingTemplate/UnassignedSection";
import type {
  Item,
  OnboardingTemplateDoc,
  OnboardingTemplateSection,
} from "../../types";

// ── Local helpers ───────────────────────────────────────────────────────

interface NormalizedTemplate {
  sections: OnboardingTemplateSection[];
  unassigned: string[];
  itemNotes: Record<string, string>;
}

/**
 * Read-time compat: convert any template doc shape — pre-sections (only
 * `itemIds`), post-sections (`sections` + `unassigned`), or a partial
 * mix — into the canonical triple the page edits.
 */
function normalizeTemplate(
  raw: OnboardingTemplateDoc | null | undefined,
): NormalizedTemplate {
  if (!raw) return { sections: [], unassigned: [], itemNotes: {} };

  if (raw.sections !== undefined || raw.unassigned !== undefined) {
    return {
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      unassigned: Array.isArray(raw.unassigned) ? raw.unassigned : [],
      itemNotes:
        raw.itemNotes && typeof raw.itemNotes === "object" ? raw.itemNotes : {},
    };
  }

  // Pre-sections doc: everything is unassigned.
  return {
    sections: [],
    unassigned: Array.isArray(raw.itemIds) ? raw.itemIds : [],
    itemNotes: {},
  };
}

/**
 * Stable JSON-style stringify that sorts object keys before serializing.
 * Used as a cheap deep-equal substitute for the `pending` vs `baseline`
 * vs `current` triple comparisons. Sorts keys because `itemNotes` is a
 * Record whose insertion order can drift across snapshots and edits, and
 * Firestore may return object fields in a different order than we wrote
 * them. Arrays preserve order (semantically meaningful here).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

function eqNorm(a: NormalizedTemplate, b: NormalizedTemplate): boolean {
  return stableStringify(a) === stableStringify(b);
}

function matchesQuery(item: Item, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return false;
  const haystacks = [item.name, item.manufacturer, item.model].filter(
    (v): v is string => typeof v === "string",
  );
  return haystacks.some((h) => h.toLowerCase().includes(query));
}

function flattenItems(norm: NormalizedTemplate): string[] {
  return [...norm.sections.flatMap((s) => s.items), ...norm.unassigned];
}

/** Legacy phrasing — preserves existing audit log copy for users who
 *  haven't started using sections + notes yet. */
function buildLegacyActionText(before: string[], after: string[]): string {
  const added = after.filter((id) => !before.includes(id)).length;
  const removed = before.filter((id) => !after.includes(id)).length;
  if (added === 0 && removed === 0) return "Reordered onboarding template";
  if (added > 0 && removed === 0)
    return `Added ${added} item${added !== 1 ? "s" : ""} to onboarding template`;
  if (removed > 0 && added === 0)
    return `Removed ${removed} item${removed !== 1 ? "s" : ""} from onboarding template`;
  return `Updated onboarding template (${added} added, ${removed} removed)`;
}

/** Richer phrasing summarizing section + note changes in a `;`-joined
 *  list. Falls back to the legacy text when no sections / notes are in
 *  play before or after, so the audit log doesn't visibly regress for
 *  admins who haven't adopted sections yet. */
function buildActionText(
  before: NormalizedTemplate,
  after: NormalizedTemplate,
): string {
  const beforeFlat = flattenItems(before);
  const afterFlat = flattenItems(after);

  const noSectionsOrNotes =
    before.sections.length === 0 &&
    after.sections.length === 0 &&
    Object.keys(before.itemNotes).length === 0 &&
    Object.keys(after.itemNotes).length === 0;
  if (noSectionsOrNotes) {
    return buildLegacyActionText(beforeFlat, afterFlat);
  }

  const parts: string[] = [];

  const beforeSecMap = new Map(before.sections.map((s) => [s.id, s]));
  const afterSecMap = new Map(after.sections.map((s) => [s.id, s]));

  const addedSecs = after.sections.filter((s) => !beforeSecMap.has(s.id));
  const removedSecs = before.sections.filter((s) => !afterSecMap.has(s.id));
  const renamedSecs = after.sections.filter((s) => {
    const b = beforeSecMap.get(s.id);
    return b && b.label !== s.label;
  });

  if (addedSecs.length === 1) {
    parts.push(`Added section "${addedSecs[0].label}"`);
  } else if (addedSecs.length > 1) {
    parts.push(
      `Added ${addedSecs.length} sections (${addedSecs.map((s) => s.label).join(", ")})`,
    );
  }

  if (removedSecs.length === 1) {
    const itemCount = removedSecs[0].items.length;
    if (itemCount > 0) {
      parts.push(
        `Deleted section "${removedSecs[0].label}" and moved ${itemCount} item${itemCount === 1 ? "" : "s"} to Unassigned`,
      );
    } else {
      parts.push(`Deleted section "${removedSecs[0].label}"`);
    }
  } else if (removedSecs.length > 1) {
    parts.push(
      `Deleted ${removedSecs.length} sections (${removedSecs.map((s) => s.label).join(", ")})`,
    );
  }

  if (renamedSecs.length === 1) {
    const b = beforeSecMap.get(renamedSecs[0].id);
    if (b) parts.push(`Renamed section "${b.label}" → "${renamedSecs[0].label}"`);
  } else if (renamedSecs.length > 1) {
    parts.push(`Renamed ${renamedSecs.length} sections`);
  }

  // Cross-section item moves — exclude items that moved because their
  // section was deleted (those are already covered by the deletion text).
  const beforeLoc = new Map<string, string | null>();
  for (const s of before.sections)
    for (const id of s.items) beforeLoc.set(id, s.id);
  for (const id of before.unassigned) beforeLoc.set(id, null);
  const afterLoc = new Map<string, string | null>();
  for (const s of after.sections)
    for (const id of s.items) afterLoc.set(id, s.id);
  for (const id of after.unassigned) afterLoc.set(id, null);

  let movedCount = 0;
  for (const [id, prevLoc] of beforeLoc) {
    if (!afterLoc.has(id)) continue;
    const newLoc = afterLoc.get(id) ?? null;
    if (prevLoc === newLoc) continue;
    if (prevLoc !== null && !afterSecMap.has(prevLoc)) continue; // deleted-section cascade
    movedCount++;
  }
  if (movedCount > 0) {
    parts.push(
      `Moved ${movedCount} item${movedCount === 1 ? "" : "s"} between sections`,
    );
  }

  // Item add/remove (flat).
  const beforeIds = new Set(beforeLoc.keys());
  const afterIds = new Set(afterLoc.keys());
  let itemsAdded = 0;
  for (const id of afterIds) if (!beforeIds.has(id)) itemsAdded++;
  let itemsRemoved = 0;
  for (const id of beforeIds) if (!afterIds.has(id)) itemsRemoved++;
  if (itemsAdded > 0)
    parts.push(`Added ${itemsAdded} item${itemsAdded === 1 ? "" : "s"}`);
  if (itemsRemoved > 0)
    parts.push(`Removed ${itemsRemoved} item${itemsRemoved === 1 ? "" : "s"}`);

  // Item notes diff.
  const noteKeys = new Set([
    ...Object.keys(before.itemNotes),
    ...Object.keys(after.itemNotes),
  ]);
  let itemNoteChanges = 0;
  for (const k of noteKeys) {
    if ((before.itemNotes[k] ?? "") !== (after.itemNotes[k] ?? ""))
      itemNoteChanges++;
  }
  if (itemNoteChanges > 0) {
    parts.push(
      `Edited ${itemNoteChanges} item note${itemNoteChanges === 1 ? "" : "s"}`,
    );
  }

  // Section notes diff (only sections present in both before and after).
  let sectionNoteChanges = 0;
  for (const s of after.sections) {
    const b = beforeSecMap.get(s.id);
    if (!b) continue;
    if ((b.note ?? "") !== (s.note ?? "")) sectionNoteChanges++;
  }
  if (sectionNoteChanges > 0) {
    parts.push(
      `Edited ${sectionNoteChanges} section note${sectionNoteChanges === 1 ? "" : "s"}`,
    );
  }

  if (parts.length === 0) {
    // Pure reorder fallthrough.
    if (
      stableStringify(beforeFlat) !== stableStringify(afterFlat) ||
      stableStringify(before.sections.map((s) => s.id)) !==
        stableStringify(after.sections.map((s) => s.id))
    ) {
      parts.push("Reordered onboarding template");
    } else {
      parts.push("Updated onboarding template");
    }
  }

  return parts.join("; ");
}

// ── Page component ──────────────────────────────────────────────────────

export default function OnboardingTemplatePage() {
  const { isAdmin, logisticsUser } = useAuthContext();
  const { items: inventoryItems, loading: inventoryLoading } = useInventory();
  const toast = useToast();

  const [templateDoc, setTemplateDoc] =
    useState<OnboardingTemplateDoc | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // Editing state — three-piece replacement for the old `pendingItemIds`.
  const [pendingSections, setPendingSections] = useState<
    OnboardingTemplateSection[]
  >([]);
  const [pendingUnassigned, setPendingUnassigned] = useState<string[]>([]);
  const [pendingItemNotes, setPendingItemNotes] = useState<
    Record<string, string>
  >({});

  // Baseline = what we last synced from Firestore. Diverges from the
  // current `templateDoc` IFF another admin saved concurrently.
  const [baselineSnapshot, setBaselineSnapshot] = useState<NormalizedTemplate>({
    sections: [],
    unassigned: [],
    itemNotes: {},
  });
  const hasLocalEditsRef = useRef(false);

  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Per-section UI state. Expanded set; `pendingFocusSectionId` triggers
  // the inline rename input to autofocus on a freshly-added section.
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(
    new Set(),
  );
  const [pendingFocusSectionId, setPendingFocusSectionId] = useState<
    string | null
  >(null);

  // Live subscription so concurrent admin writes surface immediately.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "app_config", "onboarding_template"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as DocumentData;
          setTemplateDoc({
            sections: Array.isArray(data.sections)
              ? (data.sections as OnboardingTemplateSection[])
              : undefined,
            unassigned: Array.isArray(data.unassigned)
              ? (data.unassigned as string[])
              : undefined,
            itemNotes:
              data.itemNotes && typeof data.itemNotes === "object"
                ? (data.itemNotes as Record<string, string>)
                : undefined,
            itemIds: Array.isArray(data.itemIds)
              ? (data.itemIds as string[])
              : undefined,
            updatedAt: data.updatedAt,
            updatedBy:
              typeof data.updatedBy === "string" ? data.updatedBy : undefined,
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
    const norm = normalizeTemplate(templateDoc);
    setPendingSections(norm.sections);
    setPendingUnassigned(norm.unassigned);
    setPendingItemNotes(norm.itemNotes);
    setBaselineSnapshot(norm);
  }, [templateDoc]);

  // Clear the autoFocus marker on the next render after a new section is
  // added — `<input autoFocus>` only runs on mount, so leaving the marker
  // set won't cause re-focus, but clearing keeps the page state tidy.
  useEffect(() => {
    if (pendingFocusSectionId === null) return;
    const t = setTimeout(() => setPendingFocusSectionId(null), 0);
    return () => clearTimeout(t);
  }, [pendingFocusSectionId]);

  // ── Derived state ─────────────────────────────────────────────────────

  const inventoryById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of inventoryItems) m.set(it.id, it);
    return m;
  }, [inventoryItems]);

  const currentNorm = useMemo(
    () => normalizeTemplate(templateDoc),
    [templateDoc],
  );

  const pendingNorm = useMemo<NormalizedTemplate>(
    () => ({
      sections: pendingSections,
      unassigned: pendingUnassigned,
      itemNotes: pendingItemNotes,
    }),
    [pendingSections, pendingUnassigned, pendingItemNotes],
  );

  const isDirty = useMemo(
    () => templateDoc !== null && !eqNorm(pendingNorm, currentNorm),
    [templateDoc, pendingNorm, currentNorm],
  );

  const hasExternalUpdate = useMemo(
    () => templateDoc !== null && !eqNorm(baselineSnapshot, currentNorm),
    [templateDoc, baselineSnapshot, currentNorm],
  );

  // All item IDs currently in the template (for typeahead exclusion +
  // orphan detection).
  const allPendingItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of pendingSections) for (const id of s.items) set.add(id);
    for (const id of pendingUnassigned) set.add(id);
    return set;
  }, [pendingSections, pendingUnassigned]);

  const unresolvedIds = useMemo(() => {
    const orphans: string[] = [];
    for (const id of allPendingItemIds) {
      if (!inventoryById.has(id)) orphans.push(id);
    }
    return orphans;
  }, [allPendingItemIds, inventoryById]);

  const availableItems = useMemo(
    () =>
      inventoryItems.filter(
        (i) => i.isActive && !allPendingItemIds.has(i.id),
      ),
    [inventoryItems, allPendingItemIds],
  );

  const filteredAvailable = useMemo(
    () =>
      searchQuery
        ? availableItems.filter((i) => matchesQuery(i, searchQuery))
        : [],
    [availableItems, searchQuery],
  );

  // Resolved items for render — joins each pending ID against the
  // inventory and pulls in the per-item note. Orphans surface as `item:
  // null`; SectionCard / UnassignedSection skip rendering those.
  const resolvedSections = useMemo(
    () =>
      pendingSections.map((sec) => ({
        section: sec,
        resolvedItems: sec.items.map<ResolvedItem>((id) => ({
          id,
          item: inventoryById.get(id) ?? null,
          note: pendingItemNotes[id] ?? "",
        })),
      })),
    [pendingSections, pendingItemNotes, inventoryById],
  );

  const resolvedUnassigned = useMemo<ResolvedItem[]>(
    () =>
      pendingUnassigned.map((id) => ({
        id,
        item: inventoryById.get(id) ?? null,
        note: pendingItemNotes[id] ?? "",
      })),
    [pendingUnassigned, pendingItemNotes, inventoryById],
  );

  const resolvedItemCount = useMemo(() => {
    let n = 0;
    for (const s of resolvedSections)
      for (const r of s.resolvedItems) if (r.item) n++;
    for (const r of resolvedUnassigned) if (r.item) n++;
    return n;
  }, [resolvedSections, resolvedUnassigned]);

  // ── beforeunload prompt while dirty ───────────────────────────────────
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Item location lookup (used by row callbacks) ──────────────────────

  function findItemLocation(
    itemId: string,
  ): { fromSecId: string | null; fromIdx: number } | null {
    for (const sec of pendingSections) {
      const idx = sec.items.indexOf(itemId);
      if (idx >= 0) return { fromSecId: sec.id, fromIdx: idx };
    }
    const idx = pendingUnassigned.indexOf(itemId);
    if (idx >= 0) return { fromSecId: null, fromIdx: idx };
    return null;
  }

  // ── Section ops ───────────────────────────────────────────────────────

  function addSection() {
    const id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    hasLocalEditsRef.current = true;
    setPendingSections((prev) => [
      ...prev,
      { id, label: "New Section", items: [] },
    ]);
    setExpandedSectionIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setPendingFocusSectionId(id);
  }

  function renameSection(secId: string, newLabel: string) {
    hasLocalEditsRef.current = true;
    setPendingSections((prev) =>
      prev.map((s) => (s.id === secId ? { ...s, label: newLabel } : s)),
    );
  }

  function updateSectionNote(secId: string, newNote: string) {
    hasLocalEditsRef.current = true;
    setPendingSections((prev) =>
      prev.map((s) => {
        if (s.id !== secId) return s;
        if (newNote === "") {
          // Avoid persisting empty-string notes; absence = no note.
          const { note: _drop, ...rest } = s;
          void _drop;
          return rest;
        }
        return { ...s, note: newNote };
      }),
    );
  }

  function deleteSection(secId: string) {
    const sec = pendingSections.find((s) => s.id === secId);
    if (!sec) return;
    hasLocalEditsRef.current = true;
    setPendingSections((prev) => prev.filter((s) => s.id !== secId));
    setPendingUnassigned((prev) => [...prev, ...sec.items]);
    setExpandedSectionIds((prev) => {
      const next = new Set(prev);
      next.delete(secId);
      return next;
    });
  }

  function moveSectionUp(secId: string) {
    hasLocalEditsRef.current = true;
    setPendingSections((prev) => {
      const idx = prev.findIndex((s) => s.id === secId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveSectionDown(secId: string) {
    hasLocalEditsRef.current = true;
    setPendingSections((prev) => {
      const idx = prev.findIndex((s) => s.id === secId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function toggleSectionExpanded(secId: string) {
    setExpandedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  }

  // ── Item ops ──────────────────────────────────────────────────────────

  function moveItemToSection(itemId: string, toSecId: string | null) {
    const loc = findItemLocation(itemId);
    if (!loc) return;
    if (loc.fromSecId === toSecId) return;
    hasLocalEditsRef.current = true;

    if (loc.fromSecId === null) {
      setPendingUnassigned((prev) => prev.filter((id) => id !== itemId));
    } else {
      const fromId = loc.fromSecId;
      setPendingSections((prev) =>
        prev.map((s) =>
          s.id === fromId
            ? { ...s, items: s.items.filter((id) => id !== itemId) }
            : s,
        ),
      );
    }

    if (toSecId === null) {
      setPendingUnassigned((prev) => [...prev, itemId]);
    } else {
      setPendingSections((prev) =>
        prev.map((s) =>
          s.id === toSecId ? { ...s, items: [...s.items, itemId] } : s,
        ),
      );
    }
  }

  function moveItemUp(itemId: string) {
    const loc = findItemLocation(itemId);
    if (!loc) return;
    if (loc.fromIdx <= 0) return;
    hasLocalEditsRef.current = true;
    if (loc.fromSecId === null) {
      setPendingUnassigned((prev) => {
        const next = [...prev];
        [next[loc.fromIdx - 1], next[loc.fromIdx]] = [
          next[loc.fromIdx],
          next[loc.fromIdx - 1],
        ];
        return next;
      });
    } else {
      const secId = loc.fromSecId;
      setPendingSections((prev) =>
        prev.map((s) => {
          if (s.id !== secId) return s;
          const next = [...s.items];
          [next[loc.fromIdx - 1], next[loc.fromIdx]] = [
            next[loc.fromIdx],
            next[loc.fromIdx - 1],
          ];
          return { ...s, items: next };
        }),
      );
    }
  }

  function moveItemDown(itemId: string) {
    const loc = findItemLocation(itemId);
    if (!loc) return;
    hasLocalEditsRef.current = true;
    if (loc.fromSecId === null) {
      setPendingUnassigned((prev) => {
        if (loc.fromIdx >= prev.length - 1) return prev;
        const next = [...prev];
        [next[loc.fromIdx], next[loc.fromIdx + 1]] = [
          next[loc.fromIdx + 1],
          next[loc.fromIdx],
        ];
        return next;
      });
    } else {
      const secId = loc.fromSecId;
      setPendingSections((prev) =>
        prev.map((s) => {
          if (s.id !== secId) return s;
          if (loc.fromIdx >= s.items.length - 1) return s;
          const next = [...s.items];
          [next[loc.fromIdx], next[loc.fromIdx + 1]] = [
            next[loc.fromIdx + 1],
            next[loc.fromIdx],
          ];
          return { ...s, items: next };
        }),
      );
    }
  }

  function removeItem(itemId: string) {
    const loc = findItemLocation(itemId);
    if (!loc) return;
    hasLocalEditsRef.current = true;
    if (loc.fromSecId === null) {
      setPendingUnassigned((prev) => prev.filter((id) => id !== itemId));
    } else {
      const secId = loc.fromSecId;
      setPendingSections((prev) =>
        prev.map((s) =>
          s.id === secId
            ? { ...s, items: s.items.filter((id) => id !== itemId) }
            : s,
        ),
      );
    }
    // Drop the item's note so we don't leave orphan note entries.
    setPendingItemNotes((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function updateItemNote(itemId: string, newNote: string) {
    hasLocalEditsRef.current = true;
    setPendingItemNotes((prev) => {
      if (newNote === "") {
        if (!(itemId in prev)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      if (prev[itemId] === newNote) return prev;
      return { ...prev, [itemId]: newNote };
    });
  }

  function handleAdd(itemId: string) {
    if (allPendingItemIds.has(itemId)) return;
    hasLocalEditsRef.current = true;
    setPendingUnassigned((prev) => [...prev, itemId]);
    setSearchQuery("");
  }

  function handlePrune() {
    if (unresolvedIds.length === 0) return;
    const missing = new Set(unresolvedIds);
    hasLocalEditsRef.current = true;
    setPendingSections((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.filter((id) => !missing.has(id)),
      })),
    );
    setPendingUnassigned((prev) => prev.filter((id) => !missing.has(id)));
    setPendingItemNotes((prev) => {
      let changed = false;
      const next: Record<string, string> = { ...prev };
      for (const id of missing) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    toast.info(
      `Removed ${missing.size} missing item${missing.size === 1 ? "" : "s"} from the template. Click Save to persist.`,
    );
  }

  function handleDiscard() {
    if (!templateDoc) return;
    const norm = normalizeTemplate(templateDoc);
    hasLocalEditsRef.current = false;
    setPendingSections(norm.sections);
    setPendingUnassigned(norm.unassigned);
    setPendingItemNotes(norm.itemNotes);
    setBaselineSnapshot(norm);
    setSearchQuery("");
  }

  async function handleSave() {
    if (!logisticsUser || !templateDoc) return;
    if (saving) return;
    // Snapshot deterministic values before the await so the audit event
    // doesn't race with state changes.
    const beforeNorm = normalizeTemplate(templateDoc);
    const afterNorm: NormalizedTemplate = {
      sections: pendingSections,
      unassigned: pendingUnassigned,
      itemNotes: pendingItemNotes,
    };
    const beforeFlat = flattenItems(beforeNorm);
    const afterFlat = flattenItems(afterNorm);

    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "app_config", "onboarding_template"), {
        sections: afterNorm.sections,
        unassigned: afterNorm.unassigned,
        itemNotes: afterNorm.itemNotes,
        // Rollback compat: redundant flat itemIds for code rolling back
        // before sections existed. Removable in a follow-up commit once
        // the rollback window has closed.
        itemIds: afterFlat,
        updatedAt: serverTimestamp(),
        updatedBy: logisticsUser.id,
      });
      addAuditEventToBatch(batch, {
        type: "onboarding_template_edit",
        actorUid: logisticsUser.id,
        actorName: logisticsUser.name,
        actorRole: logisticsUser.role,
        action: buildActionText(beforeNorm, afterNorm),
        templateChange: {
          before: beforeFlat,
          after: afterFlat,
          sectionsBefore: beforeNorm.sections,
          sectionsAfter: afterNorm.sections,
          unassignedBefore: beforeNorm.unassigned,
          unassignedAfter: afterNorm.unassigned,
          itemNotesBefore: beforeNorm.itemNotes,
          itemNotesAfter: afterNorm.itemNotes,
        },
      });
      await batch.commit();
      hasLocalEditsRef.current = false;
      setBaselineSnapshot(afterNorm);
      toast.success("Template saved.");
    } catch (err) {
      console.error("[OnboardingTemplatePage] save failed:", err);
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  const showNoSectionsHint =
    pendingSections.length === 0 && pendingUnassigned.length > 0;

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
              while this admin was mid-edit. */}
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

          {isDirty && (
            <div
              role="status"
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex items-center justify-between gap-3"
            >
              <span>
                You have unsaved changes. Click "Save changes" to persist them.
              </span>
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

          {/* Summary header (counts + last-updated). */}
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm min-w-0">
              <span className="font-medium text-slate-900">
                {resolvedItemCount} item{resolvedItemCount === 1 ? "" : "s"}
              </span>
              {pendingSections.length > 0 && (
                <span className="text-slate-500">
                  {" "}across {pendingSections.length} section
                  {pendingSections.length === 1 ? "" : "s"}
                </span>
              )}
              {unresolvedIds.length > 0 && (
                <span className="text-slate-500">
                  {" "}(+{unresolvedIds.length} missing)
                </span>
              )}
              {templateDoc.updatedAt &&
                typeof templateDoc.updatedAt.toDate === "function" && (
                  <span className="text-xs text-slate-500 ml-3">
                    Last updated{" "}
                    {templateDoc.updatedAt
                      .toDate()
                      .toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                  </span>
                )}
            </div>
          </div>

          {/* Sections list */}
          <div className="space-y-3">
            {resolvedSections.map(({ section, resolvedItems }, idx) => (
              <SectionCard
                key={section.id}
                section={section}
                resolvedItems={resolvedItems}
                isFirst={idx === 0}
                isLast={idx === resolvedSections.length - 1}
                allSections={pendingSections}
                expanded={expandedSectionIds.has(section.id)}
                autoFocusLabel={pendingFocusSectionId === section.id}
                onToggleExpanded={() => toggleSectionExpanded(section.id)}
                onRename={(newLabel) => renameSection(section.id, newLabel)}
                onUpdateNote={(newNote) =>
                  updateSectionNote(section.id, newNote)
                }
                onDelete={() => deleteSection(section.id)}
                onMoveSectionUp={() => moveSectionUp(section.id)}
                onMoveSectionDown={() => moveSectionDown(section.id)}
                onItemMoveToSection={moveItemToSection}
                onItemMoveUp={moveItemUp}
                onItemMoveDown={moveItemDown}
                onItemRemove={removeItem}
                onItemNoteChange={updateItemNote}
              />
            ))}
          </div>

          <div>
            <button
              type="button"
              onClick={addSection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus size={16} />
              Add section
            </button>
          </div>

          <UnassignedSection
            resolvedItems={resolvedUnassigned}
            allSections={pendingSections}
            showNoSectionsHint={showNoSectionsHint}
            onItemMoveToSection={moveItemToSection}
            onItemMoveUp={moveItemUp}
            onItemMoveDown={moveItemDown}
            onItemRemove={removeItem}
            onItemNoteChange={updateItemNote}
          />

          {/* Add-item search */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Add an item to the template
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {availableItems.length} active catalog item
              {availableItems.length === 1 ? "" : "s"} available to add. New
              items land in Unassigned.
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
