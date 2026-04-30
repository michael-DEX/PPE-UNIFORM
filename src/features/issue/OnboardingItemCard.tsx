import { useMemo } from "react";
import {
  Check,
  Clock,
  ChevronRight,
  ChevronUp,
  Plus,
  Minus,
  AlertTriangle,
} from "lucide-react";
import type { CartItem, Item } from "../../types";
import { compareSizes } from "../../lib/sizeOrder";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import { getRowState, type RowState } from "./onboardingRowState";

export interface OnboardingItemCardProps {
  row: CartItem;
  fsItem: Item;
  /** How many of this item were already issued to the member in prior
   *  transactions (summed across sizes). Drives the "previouslyIssued" state. */
  alreadyIssuedQty: number;
  /** Latest prior-issuance date for display in the collapsed "previously
   *  issued" row, formatted "Mmm d". Optional — falls back to "previously". */
  alreadyIssuedLastDate?: Date;
  onSizeChange: (size: string | null) => void;
  onQtyChange: (qty: number) => void;
  onToggleBackorder: () => void;
  /** Invoked when the user taps a collapsed card (ready/previouslyIssued).
   *  Parent flips its own `expanded` flag and re-passes it in. */
  onExpand: () => void;
  expanded: boolean;
}

export default function OnboardingItemCard({
  row,
  fsItem,
  alreadyIssuedQty,
  alreadyIssuedLastDate,
  onSizeChange,
  onQtyChange,
  onToggleBackorder,
  onExpand,
  expanded,
}: OnboardingItemCardProps) {
  // Synthesize the Map the helper expects from the scalar prop so callers
  // don't need to thread a broader data structure through each card.
  const state = useMemo<RowState>(() => {
    const m = new Map<string, number>();
    if (alreadyIssuedQty > 0) m.set(row.itemId, alreadyIssuedQty);
    return getRowState(row, fsItem, m);
  }, [row, fsItem, alreadyIssuedQty]);

  // Catalog subtitle (manufacturer – model) — computed once per render so all
  // three layout states below can stack it between the name and the
  // state-derived line without duplicating the helper call.
  const itemSubtitle = subtitleFromItem(fsItem);

  // Collapsed "ready" — one-line confirmation. Whole card is a tap target
  // that calls onExpand() so the parent can flip us to the editable layout.
  if (state === "ready" && !expanded) {
    const isBackorder = row.isBackorder === true;
    const bgClasses = isBackorder
      ? "bg-[#FAEEDA] border-[#EF9F27]"
      : "bg-[#E1F5EE] border-[#5DCAA5]";
    const nameClasses = isBackorder ? "text-[#633806]" : "text-[#04342C]";
    const subtitleClasses = isBackorder ? "text-[#99571A]" : "text-[#0E5A4D]";
    const badgeBg = isBackorder ? "bg-[#EF9F27]" : "bg-[#5DCAA5]";
    const sizeLabel = row.size ?? "one size";
    const subtitle = isBackorder
      ? `Size ${sizeLabel} · Qty ${row.qty} · Backorder`
      : `Size ${sizeLabel} · Qty ${row.qty}`;
    return (
      <button
        type="button"
        onClick={onExpand}
        className={`w-full text-left rounded-2xl border p-3 min-h-[56px] flex items-center gap-3 transition-colors ${bgClasses}`}
      >
        <span
          aria-hidden="true"
          className={`shrink-0 w-[22px] h-[22px] rounded-full inline-flex items-center justify-center ${badgeBg}`}
        >
          <Check size={14} className="text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[15px] font-medium truncate ${nameClasses}`}>
            {row.itemName}
          </p>
          {itemSubtitle && (
            <p className={`text-xs truncate ${subtitleClasses} opacity-80`}>
              {itemSubtitle}
            </p>
          )}
          <p className={`text-xs truncate ${subtitleClasses}`}>{subtitle}</p>
        </div>
        <ChevronRight size={16} className={subtitleClasses} />
      </button>
    );
  }

  // Collapsed "previously issued" — dimmed, clock icon, date + prior qty.
  if (state === "previouslyIssued" && !expanded) {
    const dateLabel = alreadyIssuedLastDate
      ? alreadyIssuedLastDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "previously";
    return (
      <button
        type="button"
        onClick={onExpand}
        className="w-full text-left rounded-2xl border border-slate-200 bg-slate-50 opacity-70 p-3 min-h-[56px] flex items-center gap-3 transition-colors"
      >
        <span
          aria-hidden="true"
          className="shrink-0 w-[22px] h-[22px] rounded-full border border-slate-400 inline-flex items-center justify-center"
        >
          <Clock size={12} className="text-slate-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-slate-500 truncate">
            {row.itemName}
          </p>
          {itemSubtitle && (
            <p className="text-xs text-slate-400 truncate">{itemSubtitle}</p>
          )}
          <p className="text-xs text-slate-400 truncate">
            Issued {dateLabel} · Qty {alreadyIssuedQty}
          </p>
        </div>
        <ChevronRight size={16} className="text-slate-400" />
      </button>
    );
  }

  // Everything else (pending, outOfStock, or expanded ready/previouslyIssued)
  // renders as the editable layout. The sub-layout adapts to whatever
  // size/qty/backorder the row currently carries.
  //
  // `isExpandedFromCollapsed` is true when the user got here by tapping a
  // ready/previouslyIssued collapsed card — the editable layout shows a
  // "done editing" chevron that re-collapses by calling the parent's
  // onExpand (treated as a toggle).
  const isExpandedFromCollapsed =
    expanded && (state === "ready" || state === "previouslyIssued");

  return (
    <EditableLayout
      row={row}
      fsItem={fsItem}
      state={state}
      alreadyIssuedQty={alreadyIssuedQty}
      alreadyIssuedLastDate={alreadyIssuedLastDate}
      onSizeChange={onSizeChange}
      onQtyChange={onQtyChange}
      onToggleBackorder={onToggleBackorder}
      isExpandedFromCollapsed={isExpandedFromCollapsed}
      onCollapse={isExpandedFromCollapsed ? onExpand : undefined}
    />
  );
}

// ── Editable layout ───────────────────────────────────────────────────────

function EditableLayout({
  row,
  fsItem,
  state,
  alreadyIssuedQty,
  alreadyIssuedLastDate,
  onSizeChange,
  onQtyChange,
  onToggleBackorder,
  isExpandedFromCollapsed,
  onCollapse,
}: {
  row: CartItem;
  fsItem: Item;
  state: RowState;
  alreadyIssuedQty: number;
  alreadyIssuedLastDate?: Date;
  onSizeChange: (size: string | null) => void;
  onQtyChange: (qty: number) => void;
  onToggleBackorder: () => void;
  isExpandedFromCollapsed: boolean;
  onCollapse?: () => void;
}) {
  const sizes = useMemo(
    () =>
      Object.entries(fsItem.sizeMap ?? {}).sort(([a], [b]) =>
        compareSizes(a, b),
      ),
    [fsItem.sizeMap],
  );
  const itemSubtitle = subtitleFromItem(fsItem);
  const hasSizes = sizes.length > 0;
  const needsSize = row.needsSize ?? false;
  const qtyDisabled = needsSize && row.size == null;
  const isOOS = state === "outOfStock";
  const isBackorderActive = row.isBackorder === true;
  const showBackorderPill = isOOS || isBackorderActive;

  // Subtitle copy changes by state so the user always knows why the row is
  // asking for attention.
  const subtitle = isOOS
    ? "Out of stock · add as backorder"
    : needsSize && row.size == null
      ? "Select a size"
      : "Required";

  function pickSize(size: string) {
    onSizeChange(size);
    // Save a tap: if qty is still 0, bump to the template-suggested qty.
    if (row.qty === 0) onQtyChange(row.suggestedQty ?? 1);
  }

  // Banner appears only when the user opened a previously-issued card. Inside
  // EditableLayout `state === "previouslyIssued"` implies expanded (the
  // collapsed variant is rendered by the parent, not this subcomponent).
  const showPreviouslyIssuedBanner = state === "previouslyIssued";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      {showPreviouslyIssuedBanner && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 mb-3 flex items-center gap-2">
          <Clock size={12} className="shrink-0" />
          <span>
            Previously issued Qty {alreadyIssuedQty}
            {alreadyIssuedLastDate
              ? ` on ${alreadyIssuedLastDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}`
              : ""}
          </span>
        </div>
      )}

      {/* Header: name/subtitle on the left, a stacked right column containing
          an optional "done editing" chevron above the qty stepper. */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-medium text-slate-900 leading-snug">
            {row.itemName}
          </h3>
          {itemSubtitle && (
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {itemSubtitle}
            </p>
          )}
          {row.note && (
            <p className="text-xs text-slate-500 italic mt-0.5">{row.note}</p>
          )}
          <p
            className={`text-xs mt-0.5 flex items-center gap-1 ${
              isOOS ? "text-[#993C1D]" : "text-slate-500"
            }`}
          >
            {isOOS && <AlertTriangle size={12} aria-hidden="true" />}
            <span>{subtitle}</span>
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {/* Fixed-size slot always reserved so the QtyStepper below doesn't
              jump ~40px when the chevron un-gates on the pending → ready
              state transition. Slot is empty whitespace when the gate
              fails; button renders inside when it passes. Pure layout
              stabilizer — the visibility gate itself is unchanged. */}
          <div className="w-8 h-8">
            {isExpandedFromCollapsed && onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Done editing"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <ChevronUp size={16} />
              </button>
            )}
          </div>
          <QtyStepper
            qty={row.qty}
            disabled={qtyDisabled}
            onQtyChange={onQtyChange}
          />
        </div>
      </div>

      {/* Size row — pills when fsItem has enumerated sizes, otherwise a
          "One size" pre-selectable pill, or a free-text input when an item
          flags needsSize but has no sizeMap entries. */}
      <div className="mt-3">
        {hasSizes ? (
          <div className="flex flex-wrap gap-2">
            {sizes.map(([size, entry]) => {
              const stock = entry?.qty ?? 0;
              const isSelected = row.size === size;
              const dimmed = isOOS || stock === 0;
              const pillClasses = isSelected
                ? "bg-blue-800 text-blue-50 border border-blue-800"
                : dimmed
                  ? "bg-white text-slate-400 border border-slate-200"
                  : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50";
              const stockClasses = isSelected
                ? "text-blue-100"
                : dimmed
                  ? "text-slate-300"
                  : "text-slate-400";
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => pickSize(size)}
                  aria-pressed={isSelected}
                  className={`min-h-[40px] px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${pillClasses}`}
                >
                  {size}
                  <span className={`ml-1 ${stockClasses}`}>·{stock}</span>
                </button>
              );
            })}
          </div>
        ) : needsSize ? (
          // Fallback: item flagged needsSize but has no enumerated sizeMap.
          // Render a text input directly so the user can type a size.
          <input
            type="text"
            value={row.size ?? ""}
            onChange={(e) => onSizeChange(e.target.value.trim() || null)}
            placeholder="Enter size"
            aria-label={`Size for ${row.itemName}`}
            className="w-full h-11 px-3 text-base border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        ) : (
          // Unsized item — a single "One size" pill that pre-selects on tap.
          <button
            type="button"
            onClick={() => {
              if (row.size == null) onSizeChange("one-size");
              if (row.qty === 0) onQtyChange(row.suggestedQty ?? 1);
            }}
            aria-pressed={row.size != null}
            className={`min-h-[40px] px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
              row.size != null
                ? "bg-blue-800 text-blue-50 border border-blue-800"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            One size
          </button>
        )}
      </div>

      {/* Backorder CTA — only visible when out of stock OR backorder is
          already toggled. Tapping while OFF → turns ON, tapping while ON →
          turns OFF. When ON, stock constraints relax and the row can reach
          the "ready" state even if selected size has qty 0. */}
      {showBackorderPill && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onToggleBackorder}
            aria-pressed={isBackorderActive}
            className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
              isBackorderActive
                ? "bg-amber-600 text-amber-50 border border-amber-600"
                : "bg-amber-50 text-amber-900 border border-amber-600 hover:bg-amber-100"
            }`}
          >
            {isBackorderActive ? <Check size={14} /> : <Plus size={14} />}
            {isBackorderActive ? "Backorder — pick size" : "Add as backorder"}
          </button>
        </div>
      )}

      {/* Done button — visible once the row is in the cart (state === "ready")
          and the parent has flagged this card as collapsible. Pure state
          transition: collapses the card into its ready variant. No cart
          mutation, no size/qty reset; re-expanding the collapsed card shows
          the same selection for editing. Match the app's primary confirm
          style (slate-900, white text) scaled down for an in-card action. */}
      {state === "ready" && onCollapse && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCollapse}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <Check size={14} aria-hidden="true" />
            Done
          </button>
        </div>
      )}
    </div>
  );
}

// ── Qty stepper ───────────────────────────────────────────────────────────

function QtyStepper({
  qty,
  disabled,
  onQtyChange,
}: {
  qty: number;
  disabled: boolean;
  onQtyChange: (qty: number) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 shrink-0 ${disabled ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={() => onQtyChange(Math.max(0, qty - 1))}
        disabled={disabled || qty <= 0}
        aria-label="Decrease quantity"
        className="w-11 h-11 rounded-full border border-slate-200 bg-white text-slate-700 inline-flex items-center justify-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <Minus size={18} />
      </button>
      <span className="min-w-[20px] text-center text-lg font-semibold text-slate-900 tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onQtyChange(qty + 1)}
        disabled={disabled}
        aria-label="Increase quantity"
        className="w-11 h-11 rounded-full border border-slate-200 bg-white text-slate-700 inline-flex items-center justify-center hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
