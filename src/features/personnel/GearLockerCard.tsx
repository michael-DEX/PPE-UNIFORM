import type { GearLockerItem } from "../../hooks/useGearLocker";

export interface GearLockerCardProps {
  row: GearLockerItem;
  /**
   * Pre-computed "Manufacturer – Model" string from the parent (which
   * has `useInventory` in scope for the full catalog lookup). Empty
   * string means no subtitle row renders. Passed down rather than
   * looked up in-component so we don't spawn a Firestore subscription
   * per card — there can be 20+ GearLockerCards rendered at once.
   */
  subtitle?: string;
  onReturnClick: (row: GearLockerItem) => void;
}

/**
 * Card form of a single gear locker row — replaces the <tr>-shaped
 * `GearLockerRow` as part of the mobile-first PersonnelDetailPage rewrite.
 *
 * Pure props-in, render-out. No hooks, no internal state. The Return
 * button bubbles the row back to the parent, which decides whether to
 * open the ReturnItemSheet.
 */
export default function GearLockerCard({
  row,
  subtitle,
  onReturnClick,
}: GearLockerCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Left column — min-w-0 so `truncate` actually clips when the
            itemName is long. Without it, the flex child refuses to shrink
            below its intrinsic content width and the Return button gets
            pushed off-screen on narrow viewports. */}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-slate-900 truncate">
            {row.itemName}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {subtitle}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            {row.size ? `Size ${row.size}` : "One size"} · Qty {row.qty}
          </p>
          {row.lastIssuedAt && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              Issued{" "}
              {row.lastIssuedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
              {row.lastIssuedBy ? ` by ${row.lastIssuedBy}` : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onReturnClick(row)}
          className="min-h-9 px-3.5 rounded-md border border-slate-300 bg-white text-sm font-medium text-blue-700 hover:bg-slate-50 transition-colors flex-shrink-0"
        >
          Return
        </button>
      </div>
    </div>
  );
}
