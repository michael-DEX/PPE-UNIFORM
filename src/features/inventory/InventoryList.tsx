import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Plus,
  Minus,
} from "lucide-react";
import {
  getTotalStock,
  getStockStatus,
  isLowStock,
  isOutOfStock,
} from "../../hooks/useInventory";
import { compareSizes } from "../../lib/sizeOrder";
import { safeQty } from "../../lib/qty";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import type { Item, CartItem } from "../../types";

interface Props {
  items: Item[];
  cartItems: CartItem[];
  onAdd: (
    item: Item,
    entry: { size: string; qty: number; isBackorder: boolean },
  ) => void;
  onAddToOrderList: (
    item: Item,
    entry: { size: string; qty: number },
  ) => void;
  onViewDetails: (item: Item) => void;
  /** Opens ItemDetailModal with the Adjust panel pre-set to "Received".
   *  Only shown when canReceive && item.isIssuedByTeam. */
  onReceive: (item: Item) => void;
  canReceive?: boolean;
  /** Controlled expansion — parent owns which row is open so deep-links can
   *  expand rows via URL params (e.g. dashboard's stock-alert flow). */
  expandedId: string | null;
  onExpandChange: (id: string | null) => void;
}

type SortField = "name" | "totalStock" | "status";
type SortDirection = "asc" | "desc";

function statusPriority(item: Item): number {
  if (isOutOfStock(item)) return 0;
  if (isLowStock(item)) return 1;
  return 2;
}

function statusDotClasses(item: Item): string {
  if (isOutOfStock(item)) return "bg-red-500";
  if (isLowStock(item)) return "bg-amber-500";
  return "bg-emerald-500";
}

export default function InventoryList({
  items,
  cartItems,
  onAdd,
  onAddToOrderList,
  onViewDetails,
  onReceive,
  canReceive,
  expandedId,
  onExpandChange,
}: Props) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  const sortedItems = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (sortField) {
        case "name":
          return multiplier * a.name.localeCompare(b.name);
        case "totalStock":
          return multiplier * (getTotalStock(a) - getTotalStock(b));
        case "status":
          return multiplier * (statusPriority(a) - statusPriority(b));
        default:
          return 0;
      }
    });
  }, [items, sortField, sortDirection]);

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No items found
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Sort bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
        <span className="mr-2 font-medium uppercase tracking-wide text-[10px]">
          Sort
        </span>
        <SortButton
          label="Name"
          active={sortField === "name"}
          direction={sortDirection}
          onClick={() => handleSort("name")}
        />
        <SortButton
          label="Stock"
          active={sortField === "totalStock"}
          direction={sortDirection}
          onClick={() => handleSort("totalStock")}
        />
        <SortButton
          label="Status"
          active={sortField === "status"}
          direction={sortDirection}
          onClick={() => handleSort("status")}
        />
      </div>

      {/* Rows */}
      <ul className="bg-white">
        {sortedItems.map((item) => {
          const isExpanded = expandedId === item.id;
          const total = getTotalStock(item);
          const subtitle = subtitleFromItem(item);
          return (
            <li
              key={item.id}
              className="border-b border-slate-100 last:border-b-0"
            >
              <button
                type="button"
                onClick={() =>
                  onExpandChange(isExpanded ? null : item.id)
                }
                aria-expanded={isExpanded}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <span
                  aria-hidden="true"
                  className={`shrink-0 w-2 h-2 rounded-full ${statusDotClasses(item)}`}
                />
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
                <span
                  className={`shrink-0 tabular-nums text-sm font-semibold ${
                    total === 0 ? "text-red-600" : "text-slate-700"
                  }`}
                >
                  {total}
                </span>
                <ChevronRight
                  size={18}
                  className={`shrink-0 text-slate-400 transition-transform duration-150 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              </button>

              {isExpanded && (
                <ExpandedPanel
                  key={item.id}
                  item={item}
                  cartItems={cartItems}
                  onAdd={onAdd}
                  onAddToOrderList={onAddToOrderList}
                  onViewDetails={onViewDetails}
                  onReceive={onReceive}
                  canReceive={canReceive}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Sort button ─────────────────────────────────────────────────────────────

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-0.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? "bg-white text-slate-900 shadow-sm border border-slate-200"
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
      }`}
    >
      <span>{label}</span>
      {active ? (
        direction === "asc" ? (
          <ChevronUp size={12} />
        ) : (
          <ChevronDown size={12} />
        )
      ) : (
        <ArrowUpDown size={12} className="opacity-40" />
      )}
    </button>
  );
}

// ── Expanded panel ──────────────────────────────────────────────────────────

function ExpandedPanel({
  item,
  cartItems,
  onAdd,
  onAddToOrderList,
  onViewDetails,
  onReceive,
  canReceive,
}: {
  item: Item;
  cartItems: CartItem[];
  onAdd: Props["onAdd"];
  onAddToOrderList: Props["onAddToOrderList"];
  onViewDetails: Props["onViewDetails"];
  onReceive: Props["onReceive"];
  canReceive?: boolean;
}) {
  const sizes = useMemo(
    () =>
      Object.entries(item.sizeMap || {}).sort(([a], [b]) =>
        compareSizes(a, b),
      ),
    [item],
  );

  // Parent remounts via `key={item.id}` so these initializers give us a
  // fresh selection + qty each time a different row expands. Prefer the
  // first in-stock size so the user doesn't open a tile and immediately
  // see the action button in backorder-mode. If no size has stock, fall
  // back to the first-in-sort-order (the button will correctly flip to
  // "Add to backorder").
  const firstInStock = sizes.find(([, s]) => safeQty(s?.qty) > 0);
  const firstSize = firstInStock?.[0] ?? sizes[0]?.[0] ?? "one-size";
  const [selectedSize, setSelectedSize] = useState<string>(firstSize);
  const [qty, setQty] = useState(1);

  const cartQtyBySize = useMemo(() => {
    const m = new Map<string, number>();
    for (const ci of cartItems) {
      if (ci.itemId !== item.id) continue;
      const key = ci.size ?? "one-size";
      m.set(key, (m.get(key) ?? 0) + ci.qty);
    }
    return m;
  }, [cartItems, item.id]);

  // safeQty at both display points: tile color + action-button backorder
  // flip. Without this, a NaN/undefined qty would fall through to
  // "in-stock" styling and the action would say "Add to cart" on an
  // unusable size. With it, corrupt qty reads as 0 → tile renders red/OOS
  // and the button correctly says "Add to backorder".
  const selectedStock = safeQty(item.sizeMap?.[selectedSize]?.qty);
  const selectedIsOOS = selectedStock <= 0;
  const itemThreshold = item.lowStockThreshold ?? 5;

  function handleAdd() {
    onAdd(item, { size: selectedSize, qty, isBackorder: selectedIsOOS });
  }

  function handleAddToOrderList() {
    onAddToOrderList(item, { size: selectedSize, qty });
  }

  return (
    <div
      role="region"
      aria-label={`${item.name} details`}
      className="bg-slate-50 border-t border-slate-100 p-4 space-y-4"
    >
      {/* Size chips */}
      {sizes.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-2">
            {sizes.length === 1 ? "Size" : "Pick a size"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {sizes.map(([size, s]) => {
              // safeQty coerces NaN/undefined/negative/strings → 0 so
              // corrupt rows render as OOS tiles (red + "0 · OOS")
              // instead of slipping through to "in-stock" styling.
              const q = safeQty(s?.qty);
              const threshold = s?.lowStockThreshold ?? itemThreshold;
              const status = getStockStatus(q, threshold);
              const isSelected = selectedSize === size;
              const cartQty = cartQtyBySize.get(size) ?? 0;
              const base =
                "relative inline-flex flex-col items-center justify-center min-h-[44px] px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border";
              let variant: string;
              if (isSelected) {
                variant = "bg-navy-700 text-white border-navy-700";
              } else if (status === "out-of-stock") {
                variant =
                  "bg-red-50 text-red-700 border-red-200 hover:bg-red-100";
              } else if (status === "low-stock") {
                variant =
                  "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";
              } else {
                variant =
                  "bg-white text-slate-700 border-slate-200 hover:bg-slate-100";
              }
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedSize(size)}
                  aria-pressed={isSelected}
                  className={`${base} ${variant}`}
                >
                  <span className="leading-tight">{size}</span>
                  <span
                    className={`text-[10px] leading-tight mt-0.5 ${
                      isSelected ? "text-white/80" : "text-slate-500"
                    }`}
                  >
                    {q}
                    {status === "out-of-stock" && !isSelected ? " · OOS" : ""}
                  </span>
                  {cartQty > 0 && !isSelected && (
                    <span
                      aria-label={`${cartQty} in cart`}
                      className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 inline-flex items-center justify-center text-[10px] font-bold text-white bg-red-600 rounded-full"
                    >
                      {cartQty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          This item has no sizes configured.
        </p>
      )}

      {/* Quantity stepper */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500">Quantity</span>
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setQty((n) => Math.max(1, n - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Minus size={20} />
          </button>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) setQty(Math.floor(n));
            }}
            aria-label="Quantity"
            className="h-11 w-16 text-center text-base font-medium border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
          <button
            type="button"
            onClick={() => setQty((n) => n + 1)}
            aria-label="Increase quantity"
            className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* Actions — 2×2 grid. "Receive stock" is manager-only + team-issued only;
          when hidden, "View full details" spans the second row. */}
      {(() => {
        const showReceive = !!canReceive && item.isIssuedByTeam;
        const outlinedClasses =
          "inline-flex items-center justify-center gap-1.5 px-3 py-3 min-h-[44px] rounded-lg text-sm font-semibold text-navy-700 bg-white border border-navy-300 hover:bg-navy-50 transition-colors";
        // "View full details" is the tertiary action — demoted to a ghost
        // button so it doesn't visually compete with the operational
        // outlined pair (Add to order list / Receive stock).
        const ghostClasses =
          "inline-flex items-center justify-center gap-1.5 px-3 py-3 min-h-[44px] rounded-lg text-sm font-medium text-slate-500 bg-transparent border border-transparent hover:text-slate-700 transition-colors";
        return (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-3 min-h-[44px] rounded-lg text-sm font-semibold text-white transition-colors ${
                selectedIsOOS
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-navy-700 hover:bg-navy-800"
              }`}
            >
              {selectedIsOOS ? "Add to backorder" : "Add to cart"}
            </button>
            <button
              type="button"
              onClick={handleAddToOrderList}
              className={outlinedClasses}
            >
              Add to order list
            </button>
            {showReceive && (
              <button
                type="button"
                onClick={() => onReceive(item)}
                className={outlinedClasses}
              >
                Receive stock
              </button>
            )}
            <button
              type="button"
              onClick={() => onViewDetails(item)}
              className={`${ghostClasses} ${showReceive ? "" : "col-span-2"}`}
            >
              View full details
            </button>
          </div>
        );
      })()}
    </div>
  );
}
