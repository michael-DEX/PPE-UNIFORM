import { useEffect, useRef, useState } from "react";
import {
  X,
  Check,
  Minus,
  Plus,
  ChevronRight,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { commitReturn } from "../../lib/returnCommit";
import type { GearLockerItem } from "../../hooks/useGearLocker";
import type {
  ItemCondition,
  LogisticsUser,
  Personnel,
} from "../../types";

export interface ReturnItemSheetProps {
  /** Parent controls visibility. */
  open: boolean;
  /** The gear locker row being returned; null while closed. Drives header. */
  row: GearLockerItem | null;
  /** Member returning the gear. */
  member: Personnel;
  /** Logistics officer processing the return (actor on tx + audit). */
  actor: LogisticsUser;
  /**
   * Current sizeMap qty for this item at this size, read off the live
   * inventory snapshot by the parent. Stamped into the audit event as
   * qtyBefore so the log shows pre/post stock levels.
   */
  currentStockForSize: number;
  /**
   * Pre-computed "Manufacturer – Model" subtitle from the parent. Empty
   * string → no subtitle line renders in the item context card. Parent
   * already has `inventoryItems` in scope for other computed props;
   * composing the subtitle there keeps this sheet Firestore-free.
   */
  subtitle?: string;
  /** Cancel, close X, backdrop tap — all fire this. Not destructive. */
  onClose: () => void;
  /** Fires after commitReturn resolves. Parent typically just closes. */
  onSubmitted: (transactionId: string) => void;
}

// ── Condition palette ────────────────────────────────────────────────────
//
// The project ships with default Tailwind (teal/amber/rose) plus custom
// navy/gold tokens — no "coral" namespace. We use rose for "lost" per the
// phase-3 spec's explicit fallback.

interface ConditionVisual {
  /** Button-selected classes (solid bg). */
  selectedBtn: string;
  /** Helper banner classes (bg + border + text). */
  banner: string;
  /** Banner icon color. */
  iconColor: string;
  /** Banner icon component. */
  Icon: typeof Check | typeof AlertTriangle | typeof XCircle;
  /** Short headline inside banner. */
  title: string;
  /** Prose under the headline — takes qty since copy is pluralized. */
  body: (qty: number) => string;
  /** Visible label on the picker button. */
  label: string;
}

const CONDITION_VISUALS: Record<ItemCondition, ConditionVisual> = {
  good: {
    selectedBtn: "bg-teal-600 text-white border border-teal-600",
    banner: "bg-teal-50 border-teal-200 text-teal-900",
    iconColor: "text-teal-700",
    Icon: Check,
    title: "Returned to stock",
    body: (qty) =>
      `${qty} unit${qty > 1 ? "s" : ""} will be added back to inventory.`,
    label: "Good",
  },
  damaged: {
    selectedBtn: "bg-amber-500 text-white border border-amber-500",
    banner: "bg-amber-50 border-amber-200 text-amber-900",
    iconColor: "text-amber-700",
    Icon: AlertTriangle,
    title: "Removed from service",
    body: () => "Stock will not be updated. Item flagged for inspection.",
    label: "Damaged",
  },
  lost: {
    selectedBtn: "bg-rose-600 text-white border border-rose-600",
    banner: "bg-rose-50 border-rose-200 text-rose-900",
    iconColor: "text-rose-700",
    Icon: XCircle,
    title: "Written off",
    body: () => "Stock will not be updated. Item removed from accountability.",
    label: "Lost",
  },
};

const CONDITIONS: ItemCondition[] = ["good", "damaged", "lost"];

// ── Component ────────────────────────────────────────────────────────────

export default function ReturnItemSheet({
  open,
  row,
  member,
  actor,
  currentStockForSize,
  subtitle,
  onClose,
  onSubmitted,
}: ReturnItemSheetProps) {
  const [qty, setQty] = useState(1);
  const [condition, setCondition] = useState<ItemCondition>("good");
  const [note, setNote] = useState("");
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // State reset between returns is handled via unmount: the parent only
  // mounts this component while a row is selected, so each new return
  // flow gets fresh `useState` defaults. Keeping state wipes out of an
  // effect body avoids a known anti-pattern (setState-in-effect).

  // Lock body scroll while the sheet is up so the page behind doesn't
  // scroll under finger drags on mobile.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ESC closes. Matches the Modal component's behavior; no focus trap here
  // (this is a bottom sheet, tab order is naturally linear down the form).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !row) return null;

  const maxQty = row.qty;
  const visual = CONDITION_VISUALS[condition];
  const HelperIcon = visual.Icon;

  async function handleSubmit() {
    if (!row) return;
    setSubmitting(true);
    setError(null);
    try {
      const txId = await commitReturn({
        actor,
        member,
        items: [
          {
            itemId: row.itemId,
            itemName: row.itemName,
            size: row.size,
            qty,
            qtyBefore: currentStockForSize,
            isBackorder: false,
            condition,
          },
        ],
        notes: note.trim() || undefined,
      });
      onSubmitted(txId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  function openNote() {
    setNoteExpanded(true);
    // Defer focus until the textarea has mounted.
    window.setTimeout(() => noteRef.current?.focus(), 0);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Return item"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — full-width on mobile, max-w-md centered on desktop. Aligned
          bottom on every viewport so it reads as a bottom sheet and keeps
          primary actions inside thumb reach on mobile. */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Grabber */}
        <div className="pt-2 pb-1">
          <div className="w-9 h-1 bg-slate-300 rounded mx-auto" aria-hidden="true" />
        </div>

        {/* Title row */}
        <div className="flex items-center justify-between px-5 pt-2 pb-3">
          <h3 className="text-lg font-semibold text-slate-900">Return item</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Item context card */}
        <div className="mx-5 mb-4 bg-slate-50 rounded-lg p-3">
          <p className="text-sm font-medium text-slate-900">{row.itemName}</p>
          {subtitle && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{subtitle}</p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            Size {row.size ?? "—"} · Currently holds {maxQty}
          </p>
        </div>

        {/* Quantity section */}
        <div className="px-5 space-y-2 mb-4">
          <label className="text-sm font-medium text-slate-700">
            Quantity to return
          </label>
          <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty === 1}
              aria-label="Decrease quantity"
              className="w-11 h-11 flex items-center justify-center rounded-md text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus size={18} />
            </button>
            <span className="text-2xl font-medium text-slate-900 tabular-nums">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty === maxQty}
              aria-label="Increase quantity"
              className="w-11 h-11 flex items-center justify-center rounded-md text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Condition picker */}
        <div className="px-5 space-y-2 mb-3">
          <label className="text-sm font-medium text-slate-700">Condition</label>
          <div className="grid grid-cols-3 gap-2">
            {CONDITIONS.map((c) => {
              const isSelected = condition === c;
              const v = CONDITION_VISUALS[c];
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondition(c)}
                  aria-pressed={isSelected}
                  className={`min-h-12 rounded-md text-sm font-medium flex flex-col items-center justify-center gap-1 transition-colors ${
                    isSelected
                      ? v.selectedBtn
                      : "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {isSelected && <Check size={14} aria-hidden="true" />}
                  <span>{v.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Condition helper banner */}
        <div className="px-5 mb-4">
          <div
            className={`flex gap-2 rounded-md border p-3 text-sm ${visual.banner}`}
          >
            <HelperIcon
              size={18}
              className={`${visual.iconColor} flex-shrink-0 mt-0.5`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-medium">{visual.title}</p>
              <p className="text-xs mt-0.5 opacity-90">{visual.body(qty)}</p>
            </div>
          </div>
        </div>

        {/* Note (collapsed by default) */}
        <div className="px-5 mb-4">
          {noteExpanded ? (
            <div className="space-y-1">
              <label
                htmlFor="return-note"
                className="text-sm font-medium text-slate-700"
              >
                Note (optional)
              </label>
              <textarea
                id="return-note"
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Optional note"
                className="w-full text-base p-3 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navy-400"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={openNote}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900 transition-colors min-h-9"
            >
              Add note (optional)
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Inline error, shown above the action row */}
        {error && (
          <div className="mx-5 mb-3 bg-rose-50 border border-rose-200 rounded-md p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* Action row */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 min-h-12 px-4 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 min-h-12 px-4 rounded-md bg-navy-700 text-white text-sm font-medium hover:bg-navy-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? "Returning…"
              : `Return ${qty} item${qty > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
