/**
 * Collapsible card representing one admin-defined section in the
 * onboarding template editor. Owns the section's header (rename, item
 * count, expand/collapse, reorder, delete), the section-level note
 * textarea, and the list of `TemplateItemRow`s for items assigned to
 * this section.
 *
 * Section label and section-level note both use the same draft-on-blur
 * pattern as item notes — local draft state for snappy typing, commit
 * to parent state when the user blurs.
 */

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import TemplateItemRow from "./TemplateItemRow";
import type { Item, OnboardingTemplateSection } from "../../../types";

export interface ResolvedItem {
  id: string;
  item: Item | null;
  note: string;
}

interface Props {
  section: OnboardingTemplateSection;
  resolvedItems: ResolvedItem[];
  isFirst: boolean;
  isLast: boolean;
  allSections: OnboardingTemplateSection[];
  expanded: boolean;
  autoFocusLabel: boolean;
  onToggleExpanded: () => void;
  onRename: (newLabel: string) => void;
  onUpdateNote: (newNote: string) => void;
  onDelete: () => void;
  onMoveSectionUp: () => void;
  onMoveSectionDown: () => void;
  onItemMoveToSection: (itemId: string, toSectionId: string | null) => void;
  onItemMoveUp: (itemId: string) => void;
  onItemMoveDown: (itemId: string) => void;
  onItemRemove: (itemId: string) => void;
  onItemNoteChange: (itemId: string, newNote: string) => void;
}

export default function SectionCard({
  section,
  resolvedItems,
  isFirst,
  isLast,
  allSections,
  expanded,
  autoFocusLabel,
  onToggleExpanded,
  onRename,
  onUpdateNote,
  onDelete,
  onMoveSectionUp,
  onMoveSectionDown,
  onItemMoveToSection,
  onItemMoveUp,
  onItemMoveDown,
  onItemRemove,
  onItemNoteChange,
}: Props) {
  // Draft state for the inline rename input + section-note textarea.
  // Synced from props via the React-recommended "adjust during render"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // — `lastSeen*` mirrors the prop and triggers a draft reset only when
  // the prop genuinely changed (e.g., concurrent edit, discard).
  const [draftLabel, setDraftLabel] = useState(section.label);
  const [lastSeenLabel, setLastSeenLabel] = useState(section.label);
  if (lastSeenLabel !== section.label) {
    setLastSeenLabel(section.label);
    setDraftLabel(section.label);
  }

  const initialNote = section.note ?? "";
  const [draftNote, setDraftNote] = useState(initialNote);
  const [lastSeenNote, setLastSeenNote] = useState(initialNote);
  if (lastSeenNote !== initialNote) {
    setLastSeenNote(initialNote);
    setDraftNote(initialNote);
  }

  function commitLabel() {
    const trimmed = draftLabel.trim();
    const next = trimmed || "Untitled section";
    if (next !== section.label) onRename(next);
    if (trimmed === "") setDraftLabel(next);
  }

  function commitNote() {
    const current = section.note ?? "";
    if (draftNote === current) return;
    onUpdateNote(draftNote);
  }

  function handleDelete() {
    const itemCount = section.items.length;
    const message =
      itemCount === 0
        ? `Delete section "${section.label}"?`
        : `Delete section "${section.label}"? Its ${itemCount} item${itemCount === 1 ? "" : "s"} will move to Unassigned (notes preserved).`;
    if (!window.confirm(message)) return;
    onDelete();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse section" : "Expand section"}
          className="w-7 h-7 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-200 transition-colors shrink-0"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={commitLabel}
          autoFocus={autoFocusLabel}
          aria-label="Section name"
          className="flex-1 min-w-0 px-2 py-1 text-sm font-semibold rounded-md border border-transparent bg-transparent text-slate-900 hover:border-slate-300 focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-slate-500 tabular-nums shrink-0">
          {section.items.length} item{section.items.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onMoveSectionUp}
            disabled={isFirst}
            aria-label="Move section up"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            onClick={onMoveSectionDown}
            disabled={isLast}
            aria-label="Move section down"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete section"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {expanded && (
        <>
          <div className="px-4 py-3 border-b border-slate-100">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Section note (visible to issuer during onboarding)
            </label>
            <textarea
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              onBlur={commitNote}
              placeholder="Optional. Shown alongside this section's items in the issuance workflow."
              rows={2}
              className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {resolvedItems.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              No items in this section yet. Add items from the typeahead below,
              or move existing items here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {resolvedItems.map((row, idx) => {
                if (!row.item) return null;
                return (
                  <TemplateItemRow
                    key={row.id}
                    itemId={row.id}
                    item={row.item}
                    note={row.note}
                    indexLabel={idx + 1}
                    isFirst={idx === 0}
                    isLast={idx === resolvedItems.length - 1}
                    currentSectionId={section.id}
                    sections={allSections}
                    onMoveToSection={(toSecId) =>
                      onItemMoveToSection(row.id, toSecId)
                    }
                    onMoveUp={() => onItemMoveUp(row.id)}
                    onMoveDown={() => onItemMoveDown(row.id)}
                    onRemove={() => onItemRemove(row.id)}
                    onNoteChange={(newNote) =>
                      onItemNoteChange(row.id, newNote)
                    }
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
