/**
 * Single item row inside a section or the unassigned bucket on the
 * onboarding template editor. All mutation callbacks bubble up to the
 * page so it can update its `pending*` state in one place.
 *
 * Note edit UX: textarea is hidden until the user clicks the note icon.
 * Local draft state mirrors the prop so typing feels instant; the draft
 * commits to parent state on blur. The icon switches color when a note
 * exists so admins can scan a section and see which items already carry
 * issuer instructions.
 */

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  StickyNote,
  Trash2,
} from "lucide-react";
import { subtitleFromItem } from "../../../lib/itemSubtitle";
import type { Item, OnboardingTemplateSection } from "../../../types";

interface Props {
  itemId: string;
  item: Item;
  note: string;
  indexLabel: number;
  isFirst: boolean;
  isLast: boolean;
  currentSectionId: string | null;
  sections: OnboardingTemplateSection[];
  onMoveToSection: (toSectionId: string | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onNoteChange: (newNote: string) => void;
}

export default function TemplateItemRow({
  itemId,
  item,
  note,
  indexLabel,
  isFirst,
  isLast,
  currentSectionId,
  sections,
  onMoveToSection,
  onMoveUp,
  onMoveDown,
  onRemove,
  onNoteChange,
}: Props) {
  const subtitle = subtitleFromItem(item);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(note);

  // Re-sync draft when the prop changes externally (e.g., the row's
  // identity shifts because of a reorder, or another commit reset
  // notes). Cheap because notes are short strings.
  useEffect(() => {
    setDraftNote(note);
  }, [note]);

  const hasNote = note.trim().length > 0;
  const noteOpenable = noteOpen || hasNote;

  function commitNote() {
    if (draftNote === note) return;
    onNoteChange(draftNote);
  }

  function handleSectionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const target = value === "__unassigned__" ? null : value;
    if (target === currentSectionId) return;
    onMoveToSection(target);
  }

  return (
    <li className="px-4 py-3" data-item-id={itemId}>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 tabular-nums w-6 shrink-0">
          {indexLabel}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">
            {item.name}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>

        <select
          value={currentSectionId ?? "__unassigned__"}
          onChange={handleSectionChange}
          aria-label="Move to section"
          className="shrink-0 max-w-[10rem] text-xs rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="__unassigned__">Unassigned</option>
          {sections.map((sec) => (
            <option key={sec.id} value={sec.id}>
              {sec.label || "(unnamed section)"}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            aria-label={hasNote ? "Edit note" : "Add note"}
            title={hasNote ? "Edit note" : "Add note"}
            className={`relative w-8 h-8 inline-flex items-center justify-center rounded transition-colors ${
              hasNote
                ? "text-amber-600 hover:bg-amber-50"
                : "text-slate-400 hover:bg-slate-100"
            }`}
          >
            <StickyNote size={16} />
            {hasNote && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500"
              />
            )}
          </button>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move up"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move down"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove"
            className="w-8 h-8 inline-flex items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {noteOpenable && (
        <div className="mt-2 ml-9">
          <textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onBlur={commitNote}
            placeholder="Note for the issuer (e.g., default size, qty per recipient)"
            rows={2}
            className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </li>
  );
}
