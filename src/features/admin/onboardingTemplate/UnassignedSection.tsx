/**
 * Always-present "Unassigned" bucket at the bottom of the onboarding
 * template editor. Holds items that haven't been placed into a named
 * section. Has no header rename, no section-level note, and no delete —
 * deleting a section moves its items here, and items added via the
 * typeahead also land here so the admin can move them after.
 */

import TemplateItemRow from "./TemplateItemRow";
import type { ResolvedItem } from "./SectionCard";
import type { OnboardingTemplateSection } from "../../../types";

interface Props {
  resolvedItems: ResolvedItem[];
  allSections: OnboardingTemplateSection[];
  showNoSectionsHint: boolean;
  onItemMoveToSection: (itemId: string, toSectionId: string | null) => void;
  onItemMoveUp: (itemId: string) => void;
  onItemMoveDown: (itemId: string) => void;
  onItemRemove: (itemId: string) => void;
  onItemNoteChange: (itemId: string, newNote: string) => void;
}

export default function UnassignedSection({
  resolvedItems,
  allSections,
  showNoSectionsHint,
  onItemMoveToSection,
  onItemMoveUp,
  onItemMoveDown,
  onItemRemove,
  onItemNoteChange,
}: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-900">Unassigned</span>
        <span className="text-xs text-slate-500 tabular-nums">
          {resolvedItems.length} item{resolvedItems.length === 1 ? "" : "s"}
        </span>
      </header>

      {showNoSectionsHint && (
        <p className="px-4 py-2 text-xs text-slate-500 bg-blue-50/40 border-b border-slate-100">
          Tip: create sections to organize items for the person issuing gear.
        </p>
      )}

      {resolvedItems.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          No unassigned items. Add items via the typeahead below — new items
          land here.
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
                currentSectionId={null}
                sections={allSections}
                onMoveToSection={(toSecId) =>
                  onItemMoveToSection(row.id, toSecId)
                }
                onMoveUp={() => onItemMoveUp(row.id)}
                onMoveDown={() => onItemMoveDown(row.id)}
                onRemove={() => onItemRemove(row.id)}
                onNoteChange={(newNote) => onItemNoteChange(row.id, newNote)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
