import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  ChevronDown,
  ChevronRight,
  Package,
  Send,
  MapPin,
  Clock,
  Settings,
  Plus,
  Minus,
  Equal,
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
  Camera,
} from "lucide-react";
import { onSnapshot, query, where, serverTimestamp } from "firebase/firestore";
import { backorderedRef } from "../../lib/firestore";
import { useAuthContext } from "../../app/AuthProvider";
import { usePersonnel } from "../../hooks/usePersonnel";
import { getTotalStock, getStockStatus, isLowStock, isOutOfStock } from "../../hooks/useInventory";
import { getCategoryLabel } from "../../constants/catalogCategories";
import { useCatalogCategories } from "../../hooks/useCatalogCategories";
import { commitIssue } from "../../lib/issueCommit";
import { commitStockAdjust } from "../../lib/stockCommit";
import { commitItemEdit } from "../../lib/itemEditCommit";
import { commitItemDelete } from "../../lib/itemDeleteCommit";
import { compareSizes } from "../../lib/sizeOrder";
import { safeQty } from "../../lib/qty";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import SearchInput from "../../components/ui/SearchInput";
import { useToast } from "../../components/ui/Toast";
import PackingSection from "./itemDetail/PackingSection";
import SettingsSection from "./itemDetail/SettingsSection";
import ActivitySection from "./itemDetail/ActivitySection";
import CategoryInlineAddModal from "./CategoryInlineAddModal";
import type { Item, Personnel, BackorderItem, ItemCategory } from "../../types";

interface Props {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  startInEdit?: boolean;
  startInAdjust?: boolean;
  /** When opening with `startInAdjust`, pre-select this reason in the
   *  adjust panel (e.g. "received" to jump straight into the receive flow). */
  startInAdjustReason?: string;
}

type AdjustMode = "add" | "remove" | "set";

interface AdjustReason {
  value: string;
  label: string;
  mode: AdjustMode;
  icon: typeof Plus;
  color: "emerald" | "red" | "blue";
}

const ADJUST_REASONS: AdjustReason[] = [
  { value: "received",       label: "Received",       mode: "add",    icon: Plus,  color: "emerald" },
  { value: "damage",         label: "Damaged",        mode: "remove", icon: Minus, color: "red" },
  { value: "loss",           label: "Lost",           mode: "remove", icon: Minus, color: "red" },
  { value: "recount",        label: "Recount",        mode: "set",    icon: Equal, color: "blue" },
  { value: "restock_return", label: "Restock Return", mode: "add",    icon: Plus,  color: "emerald" },
];

// "receive" is used for incoming stock (new units), "adjust" for corrections.
const REASON_TO_TYPE: Record<string, "receive" | "adjust"> = {
  received: "receive",
  restock_return: "receive",
  damage: "adjust",
  loss: "adjust",
  recount: "adjust",
};

// --- Collapsible Section ---
function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  badge,
}: {
  title: string;
  icon: typeof Package;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors rounded-t-lg"
      >
        <Icon size={18} className="text-gray-400 shrink-0" />
        <span className="text-sm font-semibold text-gray-900 flex-1">{title}</span>
        {badge}
        {open ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// --- Main Component ---
export default function ItemDetailModal({ item, open, onClose, startInEdit = false, startInAdjust = false, startInAdjustReason }: Props) {
  const { isManager, logisticsUser } = useAuthContext();
  const { tree: categoryTree } = useCatalogCategories();

  // Reset all local state when item changes
  const [key, setKey] = useState(0);
  const [editing, setEditing] = useState(startInEdit && isManager);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setKey((k) => k + 1);
    setEditing(startInEdit && isManager);
    setShowDeleteConfirm(false);
    setDeleteConfirmText("");
    setDeleteError(null);
  }, [item?.id, startInEdit, isManager]);

  async function confirmDelete() {
    if (!item || deleteConfirmText !== "DELETE") return;
    if (!logisticsUser) {
      setDeleteError("You must be signed in to delete an item.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await commitItemDelete({
        itemId: item.id,
        snapshot: item,
        actor: logisticsUser,
      });
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
      onClose();
    } catch (err) {
      console.error("Failed to delete item:", err);
      setDeleteError(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setDeleting(false);
    }
  }

  if (!open || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-0 pb-0 md:pt-8 md:pb-8">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-gray-50 rounded-none md:rounded-xl shadow-2xl w-full h-full md:h-auto md:max-w-3xl md:max-h-[90vh] flex flex-col">
        {/* -- Fixed Header -- */}
        <div className="bg-white rounded-none md:rounded-t-xl border-b border-gray-200 px-4 md:px-6 py-3 md:py-4 shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 truncate">{item.name}</h2>
              {(() => {
                // Standardized via `subtitleFromItem` so every surface across
                // the app uses the same en-dash separator and trim logic.
                // Previously em-dash ("—"), swapped to en-dash for consistency.
                const subtitle = subtitleFromItem(item);
                return subtitle ? (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {subtitle}
                  </p>
                ) : null;
              })()}
              {item.squareCategory && (
                <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={item.squareCategory}>
                  {item.squareCategory}
                </p>
              )}
              {item.description && (
                <p
                  className="text-xs text-gray-600 mt-1.5 line-clamp-2"
                  title={item.description}
                >
                  {item.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs text-gray-500">
                  {getCategoryLabel(item.catalogCategory || item.category, categoryTree)}
                </span>
                <span className="text-gray-300">·</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.isIssuedByTeam
                      ? "bg-blue-50 text-blue-700"
                      : "bg-purple-50 text-purple-700"
                  }`}
                >
                  {item.isIssuedByTeam ? "Team-issued" : "Personal"}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.isActive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {item.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 ml-4 shrink-0">
              {isManager && !editing && (
                <>
                  <button
                    onClick={() => setEditing(true)}
                    title="Edit item"
                    className="p-1.5 text-gray-500 hover:text-navy-700 hover:bg-navy-50 rounded-lg transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteConfirmText("");
                      setDeleteError(null);
                      setShowDeleteConfirm(true);
                    }}
                    title="Delete item"
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Quick stats bar */}
          <div className="flex items-center gap-3 md:gap-4 mt-3 pt-3 border-t border-gray-100 flex-wrap">
            <Stat label="Total Stock" value={getTotalStock(item)} />
            <Stat label="Sizes" value={Object.keys(item.sizeMap || {}).length} />
            <div className="flex-1" />
            <StockStatusPill item={item} />
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" key={key}>
          {editing ? (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <EditItemForm item={item} onDone={() => setEditing(false)} />
            </div>
          ) : (
            <>
              {/* 1. Stock & Sizes */}
              <Section title="Stock & Sizes" icon={Package} defaultOpen={true}>
                <StockSection item={item} autoAdjust={startInAdjust} autoReason={startInAdjustReason} />
              </Section>

              {/* 2. Issue / Return */}
              {item.isIssuedByTeam && (
                <Section title="Issue to Member" icon={Send} defaultOpen={false}>
                  <IssueSection item={item} onDone={onClose} />
                </Section>
              )}

              {/* 3. Packing Locations */}
              <Section title="Packing Locations" icon={MapPin} defaultOpen={false}>
                <PackingSection item={item} />
              </Section>

              {/* 4. Activity */}
              <Section title="Activity" icon={Clock} defaultOpen={false}>
                <ActivitySection key={item.id} item={item} />
              </Section>

              {/* 5. Settings */}
              <Section title="Settings" icon={Settings} defaultOpen={false}>
                <SettingsSection
                  item={item}
                  canDelete={isManager}
                  onRequestDelete={() => {
                    setDeleteConfirmText("");
                    setDeleteError(null);
                    setShowDeleteConfirm(true);
                  }}
                />
              </Section>
            </>
          )}
        </div>

        {/* Delete confirmation overlay (inside modal) */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-none md:rounded-xl">
            <div
              className="absolute inset-0 bg-black/50 rounded-none md:rounded-xl"
              onClick={() => !deleting && setShowDeleteConfirm(false)}
            />
            <div className="relative bg-white rounded-lg shadow-2xl max-w-md w-[90%] p-5">
              <h3 className="text-lg font-semibold text-gray-900">
                Delete "{item.name}"?
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                This permanently removes the item. Transaction history will keep referencing the deleted ID. This cannot be undone.
              </p>
              {getTotalStock(item) > 0 && (
                <p className="mt-2 text-sm text-orange-600 font-medium">
                  This item has {getTotalStock(item)} units in stock.
                </p>
              )}
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Type <span className="font-mono font-bold">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              {deleteError && (
                <p className="mt-2 text-xs text-red-600">{deleteError}</p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteConfirmText !== "DELETE" || deleting}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function StockStatusPill({ item }: { item: Item }) {
  if (isOutOfStock(item)) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
        Out of Stock
      </span>
    );
  }
  if (isLowStock(item)) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
        Low Stock
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
      In Stock
    </span>
  );
}

// ── Stock & Sizes Section ──
function StockSection({
  item,
  autoAdjust = false,
  autoReason,
}: {
  item: Item;
  autoAdjust?: boolean;
  autoReason?: string;
}) {
  const { logisticsUser } = useAuthContext();
  const toast = useToast();
  const navigate = useNavigate();
  const sizeEntries = Object.entries(item.sizeMap || {}).sort(([a], [b]) => compareSizes(a, b));

  // Listen for pending backorders on this item
  const [pendingBackorders, setPendingBackorders] = useState<BackorderItem[]>([]);
  useEffect(() => {
    const q = query(backorderedRef, where("itemId", "==", item.id), where("fulfilledAt", "==", null));
    const unsub = onSnapshot(q, (snap) => {
      setPendingBackorders(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as BackorderItem));
    });
    return unsub;
  }, [item.id]);

  const [adjustMode, setAdjustMode] = useState(autoAdjust);

  // `reason` starts null — user must pick a reason before editing any row.
  // `quantities` is a per-size value whose meaning depends on the mode:
  //   add    → amount to add (positive int)
  //   remove → amount to remove (positive int, capped at current qty)
  //   set    → new absolute total (non-negative int, pre-seeded with current)
  const [reason, setReason] = useState<string | null>(
    autoAdjust && autoReason ? (autoReason ?? null) : null,
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    if (!autoAdjust || !autoReason) return {};
    const r = ADJUST_REASONS.find((x) => x.value === autoReason);
    if (!r || r.mode !== "set") return {};
    const seed: Record<string, number> = {};
    for (const [size, stock] of Object.entries(item.sizeMap || {})) {
      seed[size] = stock.qty;
    }
    return seed;
  });

  useEffect(() => {
    if (autoAdjust) setAdjustMode(true);
    if (autoAdjust && autoReason) {
      const r = ADJUST_REASONS.find((x) => x.value === autoReason);
      if (r) {
        setReason(r.value);
        if (r.mode === "set") {
          const seed: Record<string, number> = {};
          for (const [size, stock] of Object.entries(item.sizeMap || {})) {
            seed[size] = stock.qty;
          }
          setQuantities(seed);
        } else {
          setQuantities({});
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdjust, autoReason, item.id]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const reasonMeta = ADJUST_REASONS.find((r) => r.value === reason) ?? null;
  const mode: AdjustMode | null = reasonMeta?.mode ?? null;

  function computeDelta(value: number, currentQty: number): number {
    if (mode === "add") return Math.max(0, value);
    if (mode === "remove") return -Math.min(Math.max(0, value), currentQty);
    if (mode === "set") return value - currentQty;
    return 0;
  }

  const netChange = sizeEntries.reduce((sum, [size, stock]) => {
    const val = quantities[size] ?? 0;
    return sum + computeDelta(val, stock.qty);
  }, 0);

  const hasChange = sizeEntries.some(([size, stock]) => {
    const val = quantities[size] ?? 0;
    return computeDelta(val, stock.qty) !== 0;
  });

  // Picking a reason resets the row values — "set" mode seeds rows with the
  // current qty so an untouched row reads as "no change". Other modes start empty.
  function pickReason(next: AdjustReason) {
    setReason(next.value);
    if (next.mode === "set") {
      const seeded: Record<string, number> = {};
      for (const [size, stock] of sizeEntries) seeded[size] = stock.qty;
      setQuantities(seeded);
    } else {
      setQuantities({});
    }
  }

  function resetAdjust() {
    setAdjustMode(false);
    setReason(null);
    setQuantities({});
    setNotes("");
  }

  async function handleAdjust() {
    if (!logisticsUser || !hasChange || !reason || !reasonMeta) return;
    setSubmitting(true);
    try {
      const stockItems = sizeEntries
        .map(([size, stock]) => {
          const val = quantities[size] ?? 0;
          const delta = computeDelta(val, stock.qty);
          return {
            itemId: item.id,
            itemName: item.name,
            size,
            qtyChange: delta,
            qtyBefore: stock.qty,
          };
        })
        .filter((e) => e.qtyChange !== 0);

      await commitStockAdjust({
        actor: logisticsUser,
        type: REASON_TO_TYPE[reason] ?? "adjust",
        items: stockItems,
        notes: `[${reasonMeta.label}] ${notes}`.trim(),
      });

      setSuccess(true);
      setTimeout(() => {
        setAdjustMode(false);
        setReason(null);
        setQuantities({});
        setNotes("");
        setSuccess(false);
      }, 1500);
    } catch (err) {
      console.error("Stock adjust failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to adjust stock.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sizeEntries.length === 0) {
    return <p className="text-sm text-gray-400 italic py-4 text-center">No size variants configured</p>;
  }

  return (
    <div className="space-y-3 pt-3">
      {/* Backorder alert banner */}
      {pendingBackorders.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-amber-800">
              {pendingBackorders.length} pending backorder{pendingBackorders.length !== 1 ? "s" : ""}
            </p>
            <div className="mt-1 space-y-0.5">
              {pendingBackorders.slice(0, 4).map((bo) => (
                <p key={bo.id} className="text-xs text-amber-700">
                  {bo.personnelName} — {bo.size ?? "one-size"} x{bo.qtyNeeded}
                </p>
              ))}
              {pendingBackorders.length > 4 && (
                <p className="text-xs text-amber-600">+{pendingBackorders.length - 4} more</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Adjust toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {sizeEntries.length} size{sizeEntries.length !== 1 ? "s" : ""} · {getTotalStock(item)} total
        </p>
        {!adjustMode ? (
          <button
            onClick={() => setAdjustMode(true)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            + Adjust Stock
          </button>
        ) : (
          <button
            onClick={resetAdjust}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        )}
      </div>

      {adjustMode ? (
        <>
          {/* Reason grid — 5 tappable cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ADJUST_REASONS.map((r) => {
              const isSelected = reason === r.value;
              const Icon = r.icon;
              const sign = r.mode === "add" ? "+" : r.mode === "remove" ? "\u2212" : "=";
              const selectedClasses =
                r.color === "emerald"
                  ? "bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-200"
                  : r.color === "red"
                    ? "bg-red-50 border-red-500 text-red-900 ring-2 ring-red-200"
                    : "bg-blue-50 border-blue-500 text-blue-900 ring-2 ring-blue-200";
              const selectedIconClasses =
                r.color === "emerald"
                  ? "text-emerald-600"
                  : r.color === "red"
                    ? "text-red-600"
                    : "text-blue-600";
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => pickReason(r)}
                  aria-pressed={isSelected}
                  className={`min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                    isSelected
                      ? selectedClasses
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon size={16} className={`shrink-0 ${isSelected ? selectedIconClasses : "text-gray-400"}`} />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span
                    className={`shrink-0 font-bold ${
                      isSelected ? selectedIconClasses : "text-gray-300"
                    }`}
                  >
                    {sign}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Scan packing slip shortcut — only when Received is picked */}
          {reason === "received" && (
            <button
              type="button"
              onClick={() => navigate("/logistics/inventory/scan")}
              className="w-full flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              <Camera size={16} />
              Scan packing slip to auto-fill
            </button>
          )}

          {/* Placeholder when nothing picked yet */}
          {!reason && (
            <p className="text-sm text-gray-500 text-center py-4">
              Pick a reason to adjust stock.
            </p>
          )}

          {/* Size rows — shape varies by mode */}
          {reason && mode && (
            <div className="space-y-1.5">
              {sizeEntries.map(([size, stock]) => {
                const currentQty = stock.qty;
                const value = quantities[size] ?? 0;
                const delta = computeDelta(value, currentQty);
                const newQty = currentQty + delta;
                const isActive = delta !== 0;
                const tint =
                  !isActive
                    ? ""
                    : mode === "add"
                      ? "bg-emerald-50 border-emerald-200"
                      : mode === "remove"
                        ? "bg-red-50 border-red-200"
                        : "bg-blue-50 border-blue-200";

                if (mode === "set") {
                  return (
                    <div
                      key={size}
                      className={`flex items-center gap-2 p-2 rounded-lg border border-gray-100 ${tint}`}
                    >
                      <span className="w-14 shrink-0 font-medium text-sm text-gray-900">{size}</span>
                      <span
                        className={`text-xs tabular-nums text-gray-500 ${isActive ? "line-through" : ""}`}
                      >
                        Was {currentQty}
                      </span>
                      <span className="flex-1" />
                      <input
                        type="number"
                        min={0}
                        value={value}
                        onChange={(e) =>
                          setQuantities((p) => ({
                            ...p,
                            [size]: Math.max(0, parseInt(e.target.value) || 0),
                          }))
                        }
                        aria-label={`New qty for ${size}`}
                        className="h-11 w-20 text-center text-base font-medium border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span
                        className={`w-12 text-right text-xs font-medium tabular-nums ${
                          isActive ? "text-blue-700" : "text-gray-300"
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "="}
                      </span>
                    </div>
                  );
                }

                // add | remove
                const atMin = value <= 0;
                const atMax = mode === "remove" && value >= currentQty;
                const minusActive = mode === "remove" && value > 0;
                const plusActive = mode === "add" && value > 0;

                return (
                  <div
                    key={size}
                    className={`flex items-center gap-2 p-2 rounded-lg border border-gray-100 ${tint}`}
                  >
                    <span className="w-14 shrink-0 font-medium text-sm text-gray-900">{size}</span>
                    <span className="text-xs text-gray-500 tabular-nums">Cur {currentQty}</span>
                    <span className="flex-1" />
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setQuantities((p) => ({
                            ...p,
                            [size]: Math.max(0, (p[size] ?? 0) - 1),
                          }))
                        }
                        disabled={atMin}
                        aria-label={`Decrease ${size}`}
                        className={`h-11 w-11 inline-flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          minusActive
                            ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        <Minus size={18} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={mode === "remove" ? currentQty : undefined}
                        value={value || ""}
                        onChange={(e) => {
                          const v = Math.max(0, parseInt(e.target.value) || 0);
                          const capped = mode === "remove" ? Math.min(v, currentQty) : v;
                          setQuantities((p) => ({ ...p, [size]: capped }));
                        }}
                        placeholder="0"
                        aria-label={`Qty to ${mode} for ${size}`}
                        className="h-11 w-16 text-center text-base font-medium border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setQuantities((p) => {
                            const next = (p[size] ?? 0) + 1;
                            const capped = mode === "remove" ? Math.min(next, currentQty) : next;
                            return { ...p, [size]: capped };
                          })
                        }
                        disabled={atMax}
                        aria-label={`Increase ${size}`}
                        className={`h-11 w-11 inline-flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          plusActive
                            ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <span
                      className={`w-16 text-right text-xs font-medium tabular-nums ${
                        isActive
                          ? mode === "add"
                            ? "text-emerald-700"
                            : "text-red-700"
                          : "text-gray-300"
                      }`}
                    >
                      {isActive ? `\u2192 ${newQty}` : "\u2014"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes + color-coded footer */}
          {reason && (
            <div className="space-y-2 pt-2">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (e.g., PO #1234, vendor shipment)"
                className="w-full text-base border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {success ? (
                <div className="flex items-center justify-center gap-2 py-3 text-emerald-700 bg-emerald-50 rounded-lg">
                  <Check size={18} />
                  <span className="text-sm font-medium">Stock Updated</span>
                </div>
              ) : (
                <div
                  className={`flex items-center gap-3 rounded-lg p-3 ${
                    mode === "add"
                      ? "bg-emerald-50"
                      : mode === "remove"
                        ? "bg-red-50"
                        : "bg-blue-50"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      mode === "add"
                        ? "text-emerald-900"
                        : mode === "remove"
                          ? "text-red-900"
                          : "text-blue-900"
                    }`}
                  >
                    {mode === "add" &&
                      `Adding +${netChange} unit${netChange === 1 ? "" : "s"}`}
                    {mode === "remove" &&
                      `Removing \u2212${Math.abs(netChange)} unit${Math.abs(netChange) === 1 ? "" : "s"}`}
                    {mode === "set" &&
                      `Net change ${netChange > 0 ? "+" : ""}${netChange} unit${Math.abs(netChange) === 1 ? "" : "s"}`}
                  </span>
                  <span className="flex-1" />
                  <button
                    onClick={handleAdjust}
                    disabled={!hasChange || submitting}
                    className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      mode === "add"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : mode === "remove"
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {submitting ? "Saving..." : "Apply"}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* View mode — stock table (no adjust columns) */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Size</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {sizeEntries.map(([size, stock]) => {
                const threshold = stock.lowStockThreshold ?? item.lowStockThreshold ?? 5;
                const status = getStockStatus(stock.qty, threshold);
                return (
                  <tr key={size} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-2 font-medium text-gray-900">{size}</td>
                    <td
                      className={`py-2 px-2 text-right font-mono font-medium ${
                        status === "out-of-stock"
                          ? "text-red-600"
                          : status === "low-stock"
                            ? "text-amber-600"
                            : "text-gray-900"
                      }`}
                    >
                      {stock.qty}
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          status === "out-of-stock"
                            ? "bg-red-100 text-red-700"
                            : status === "low-stock"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {status === "out-of-stock" ? "Out" : status === "low-stock" ? "Low" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Issue Section ──
function IssueSection({ item, onDone }: { item: Item; onDone: () => void }) {
  const { logisticsUser } = useAuthContext();
  const { members } = usePersonnel();
  const toast = useToast();
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Personnel | null>(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [qty, setQty] = useState(1);
  const [isBackorder, setIsBackorder] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Set default size — prefer first in-stock in canonical sort order, fall
  // back to first sorted entry (even if OOS) so there's always a valid
  // selection for the backorder flow.
  useEffect(() => {
    const sortedEntries = Object.entries(item.sizeMap || {}).sort(
      ([a], [b]) => compareSizes(a, b),
    );
    const firstInStock = sortedEntries.find(
      ([, s]) => safeQty(s?.qty) > 0,
    );
    setSelectedSize(
      firstInStock?.[0] ?? sortedEntries[0]?.[0] ?? "one-size",
    );
  }, [item]);

  // Pre-fill from member profile
  useEffect(() => {
    if (!selectedMember || !item) return;
    const sizes = Object.keys(item.sizeMap || {});
    let preferred: string | undefined;
    const cat = item.category;
    if (cat === "boots") preferred = selectedMember.sizes?.boots ?? undefined;
    else if (cat === "bdus" && item.name.toLowerCase().includes("pant"))
      preferred = selectedMember.sizes?.pants ?? undefined;
    else if (item.name.toLowerCase().includes("glove"))
      preferred = selectedMember.sizes?.gloves ?? undefined;
    else if (cat === "helmet") preferred = selectedMember.sizes?.helmet ?? undefined;
    else preferred = selectedMember.sizes?.shirt ?? undefined;

    if (preferred) {
      const match = sizes.find((s) => s.toLowerCase() === preferred!.toLowerCase());
      if (match) setSelectedSize(match);
    }
  }, [selectedMember, item]);

  const filteredMembers = useMemo(() => {
    const active = members.filter((m) => m.isActive);
    if (!memberSearch) return active;
    const q = memberSearch.toLowerCase();
    return active.filter(
      (m) =>
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const sizes = Object.entries(item.sizeMap || {}).sort(([a], [b]) =>
    compareSizes(a, b),
  );
  const stock = safeQty(item.sizeMap?.[selectedSize]?.qty);

  async function handleSubmit() {
    if (!logisticsUser || !selectedMember) return;
    setSubmitting(true);
    try {
      await commitIssue({
        actor: logisticsUser,
        member: selectedMember,
        items: [
          {
            itemId: item.id,
            itemName: item.name,
            size: selectedSize,
            qty,
            isBackorder,
            qtyBefore: stock,
          },
        ],
        type: "single_issue",
        notes: notes || undefined,
        sourceForm: "item_detail_issue",
      });
      setSuccess(true);
      setTimeout(onDone, 1500);
    } catch (err) {
      console.error("Issue failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to issue item.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-emerald-600">
        <Check size={20} />
        <span className="font-medium">
          Issued {qty}x {item.name} ({selectedSize}) to {selectedMember?.firstName}{" "}
          {selectedMember?.lastName}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-3">
      {/* Member search */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Issue to Member</label>
        {selectedMember ? (
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <span className="text-sm font-medium text-gray-900">
              {selectedMember.lastName}, {selectedMember.firstName} — {selectedMember.email}
            </span>
            <button
              onClick={() => setSelectedMember(null)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <SearchInput value={memberSearch} onChange={setMemberSearch} placeholder="Search by name or email..." />
            <div className="mt-1.5 max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
              {filteredMembers.slice(0, 6).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMember(m)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="font-medium">{m.lastName}, {m.firstName}</span>
                  <span className="text-gray-400 ml-2">{m.email}</span>
                </button>
              ))}
              {filteredMembers.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">No members found</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Size + Qty */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Size</label>
          {sizes.length > 0 ? (
            <>
              <select
                value={sizes.some(([s]) => s === selectedSize) ? selectedSize : "__custom__"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__custom__") {
                    setSelectedSize("__custom__");
                    setIsBackorder(true);
                    return;
                  }
                  setSelectedSize(val);
                  const avail = safeQty(item.sizeMap?.[val]?.qty);
                  if (avail <= 0) setIsBackorder(true);
                }}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sizes.map(([s, v]) => (
                  <option key={s} value={s}>
                    {s} ({safeQty(v?.qty)} avail)
                  </option>
                ))}
                <option value="__custom__">Other size...</option>
              </select>
              {(selectedSize === "__custom__" || !sizes.some(([s]) => s === selectedSize)) && (
                <input
                  type="text"
                  value={selectedSize === "__custom__" ? "" : selectedSize}
                  onChange={(e) => {
                    setSelectedSize(e.target.value.toUpperCase() || "__custom__");
                    setIsBackorder(true);
                  }}
                  placeholder="Enter size (e.g., 11, XL, 32X34)"
                  autoFocus
                  className="w-full mt-1.5 text-sm border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
            </>
          ) : (
            <input
              type="text"
              value={selectedSize === "one-size" ? "" : selectedSize}
              onChange={(e) => {
                setSelectedSize(e.target.value.toUpperCase() || "one-size");
                setIsBackorder(true);
              }}
              placeholder="Enter size (e.g., 11, XL)"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Stock + backorder */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-500">
          Available: <strong className={stock <= 0 ? "text-red-600" : "text-gray-900"}>{stock}</strong>
        </span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={isBackorder}
            onChange={(e) => setIsBackorder(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className={`text-xs ${isBackorder ? "text-purple-700 font-medium" : "text-gray-500"}`}>Backorder</span>
        </label>
      </div>

      {/* Notes */}
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!selectedMember || submitting || (stock < qty && !isBackorder) || selectedSize === "__custom__" || selectedSize === ""}
        className="w-full py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "Issuing..." : isBackorder ? "Issue (Backorder)" : `Issue ${qty}x`}
      </button>
    </div>
  );
}

const ITEM_CATEGORIES: ItemCategory[] = [
  "bags", "patches", "boots", "bdus", "clothing", "ppe", "helmet", "sleeping", "personal",
];

interface SizeRow {
  /**
   * Stable per-row ID used as the React `key` across re-renders. Survives
   * `key` field edits (rename from "9 M" → "9.5 M") so React doesn't
   * destroy the `<input>` DOM node underneath the user's fingers mid-type.
   * Also survives re-sort: the sorted view runs on every render (see
   * `sortedSizes` useMemo in EditItemForm), so rows can swap positions
   * without losing focus or input state.
   */
  id: string;
  key: string;
  qty: number;
  lowStockThreshold: number | undefined;
}

// Module-scoped monotonic counter for SizeRow IDs. Doesn't reset across
// EditItemForm mounts — not a problem, IDs only need to be unique within
// a given render pass. `crypto.randomUUID()` was the alternative but would
// break in non-secure contexts; a counter is simpler and deterministic.
let sizeRowIdCounter = 1;
function nextSizeRowId(): string {
  return `sr-${sizeRowIdCounter++}`;
}

interface EditFormState {
  name: string;
  manufacturer: string;
  model: string;
  description: string;
  category: ItemCategory;
  catalogParent: string;
  catalogChild: string;
  unitOfIssue: string;
  lowStockThreshold: number;
  qtyRequired: number;
  needsSize: boolean;
  isIssuedByTeam: boolean;
  isActive: boolean;
  notes: string;
  sizes: SizeRow[];
}

function initialFormState(item: Item, tree: Array<{ id: string; children?: Array<{ id: string }> }>): EditFormState {
  const cc = item.catalogCategory ?? "";
  // Determine parent vs child based on CATALOG_TREE
  let catalogParent = cc;
  let catalogChild = "";
  for (const node of tree) {
    if (node.children?.some((c) => c.id === cc)) {
      catalogParent = node.id;
      catalogChild = cc;
      break;
    }
  }
  return {
    name: item.name,
    manufacturer: item.manufacturer ?? "",
    model: item.model ?? "",
    description: item.description ?? "",
    category: item.category as ItemCategory,
    catalogParent,
    catalogChild,
    unitOfIssue: item.unitOfIssue || "each",
    lowStockThreshold: item.lowStockThreshold ?? 5,
    qtyRequired: item.qtyRequired ?? 1,
    needsSize: item.needsSize ?? false,
    isIssuedByTeam: item.isIssuedByTeam,
    isActive: item.isActive,
    notes: item.notes ?? "",
    // Initial order: canonical (compareSizes) so the form opens sorted.
    // The render-time sortedSizes useMemo re-applies this on every
    // subsequent render to handle adds/renames.
    sizes: Object.entries(item.sizeMap || {})
      .sort(([a], [b]) => compareSizes(a, b))
      .map(([k, v]) => ({
        id: nextSizeRowId(),
        key: k,
        qty: safeQty(v?.qty),
        lowStockThreshold: v.lowStockThreshold,
      })),
  };
}

function EditItemForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const { logisticsUser, isManager } = useAuthContext();
  const { tree: categoryTree } = useCatalogCategories();
  const [form, setForm] = useState<EditFormState>(() =>
    initialFormState(item, categoryTree),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addSubcatOpen, setAddSubcatOpen] = useState(false);

  // Reset form if the item prop changes (e.g. after Firestore snapshot refresh)
  useEffect(() => {
    setForm(initialFormState(item, categoryTree));
  }, [item, categoryTree]);

  function update<K extends keyof EditFormState>(field: K, value: EditFormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // All three helpers address rows by their stable `id` rather than by
  // array index. Necessary because the render uses a sorted VIEW of
  // `form.sizes` — a row's display position doesn't match its position
  // in the underlying state array, so index-based updates would hit the
  // wrong row after the user edits anything that changes sort order.
  function updateSize(id: string, patch: Partial<SizeRow>) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }

  function addSize() {
    setForm((f) => ({
      ...f,
      sizes: [
        ...f.sizes,
        { id: nextSizeRowId(), key: "", qty: 0, lowStockThreshold: undefined },
      ],
    }));
  }

  function removeSize(id: string) {
    setForm((f) => ({ ...f, sizes: f.sizes.filter((s) => s.id !== id) }));
  }

  // Sorted view used only for render. The underlying `form.sizes` array
  // keeps whatever order edits produced; this useMemo re-sorts every time
  // the array reference changes (i.e. on every edit/add/remove). Stable
  // `id`-keyed rows mean React reconciles by identity rather than by
  // position, so an input that moves due to re-sort preserves focus +
  // cursor position mid-type. Sort cost is negligible (~15 entries).
  const sortedSizes = useMemo(
    () => [...form.sizes].sort((a, b) => compareSizes(a.key, b.key)),
    [form.sizes],
  );

  async function handleSave() {
    setError(null);
    if (!logisticsUser) {
      setError("You must be signed in to save changes.");
      return;
    }
    // Validation
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    const trimmedKeys = form.sizes.map((s) => s.key.trim().toUpperCase());
    if (trimmedKeys.some((k) => !k)) {
      setError("Size keys cannot be empty.");
      return;
    }
    const dupes = trimmedKeys.filter((k, i) => trimmedKeys.indexOf(k) !== i);
    if (dupes.length > 0) {
      setError(`Duplicate size keys: ${[...new Set(dupes)].join(", ")}`);
      return;
    }

    // Rebuild sizeMap from form
    const newSizeMap: Record<string, { qty: number; lowStockThreshold?: number }> = {};
    for (let i = 0; i < form.sizes.length; i++) {
      const s = form.sizes[i];
      const entry: { qty: number; lowStockThreshold?: number } = { qty: Number(s.qty) || 0 };
      if (s.lowStockThreshold !== undefined && s.lowStockThreshold !== null && !Number.isNaN(s.lowStockThreshold)) {
        entry.lowStockThreshold = Number(s.lowStockThreshold);
      }
      newSizeMap[trimmedKeys[i]] = entry;
    }

    // catalogCategory = child if picked, else parent (if any)
    const catalogCategory = form.catalogChild || form.catalogParent || undefined;

    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim(),
        model: form.model.trim(),
        description: form.description.trim(),
        category: form.category,
        unitOfIssue: form.unitOfIssue.trim() || "each",
        lowStockThreshold: Number(form.lowStockThreshold) || 5,
        qtyRequired: Number(form.qtyRequired) || 1,
        needsSize: form.needsSize,
        isIssuedByTeam: form.isIssuedByTeam,
        isActive: form.isActive,
        notes: form.notes.trim(),
        sizeMap: newSizeMap,
        updatedAt: serverTimestamp(),
      };
      if (catalogCategory) patch.catalogCategory = catalogCategory;
      // commitItemEdit diffs before/patch and short-circuits on no-op saves
      // (no write, no audit event). Either way we close the form — save
      // semantics match the pre-audit behavior from the user's POV.
      await commitItemEdit({
        itemId: item.id,
        before: item,
        patch,
        actor: logisticsUser,
      });
      onDone();
    } catch (err) {
      console.error("Failed to save item:", err);
      setError(err instanceof Error ? err.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  const parentNode = categoryTree.find((n) => n.id === form.catalogParent);
  const childOptions = parentNode?.children ?? [];

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
        />
      </div>

      {/* Manufacturer + Model */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
          <input
            type="text"
            value={form.manufacturer}
            onChange={(e) => update("manufacturer", e.target.value)}
            placeholder="e.g. 5.11, Tru-Spec"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
          <input
            type="text"
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder="e.g. TDU Blouse"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
          placeholder="Short product description"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
        />
      </div>

      {/* Category + Subcategory */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select
            value={form.catalogParent}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__add_category__") {
                setAddCatOpen(true);
                return;
              }
              update("catalogParent", val);
              update("catalogChild", "");
            }}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          >
            <option value="">—</option>
            {categoryTree.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
            {isManager && (
              <option value="__add_category__">+ Add new category…</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Subcategory</label>
          <select
            value={form.catalogChild}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__add_subcategory__") {
                setAddSubcatOpen(true);
                return;
              }
              update("catalogChild", val);
            }}
            disabled={childOptions.length === 0 && !(isManager && form.catalogParent)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">—</option>
            {childOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
            {isManager && form.catalogParent && (
              <option value="__add_subcategory__">
                + Add new subcategory…
              </option>
            )}
          </select>
        </div>
      </div>

      {/* Legacy category */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Legacy Category</label>
        <select
          value={form.category}
          onChange={(e) => update("category", e.target.value as ItemCategory)}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
        >
          {ITEM_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Numeric fields */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Unit of Issue</label>
          <input
            type="text"
            value={form.unitOfIssue}
            onChange={(e) => update("unitOfIssue", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Low Stock Threshold</label>
          <input
            type="number"
            min={0}
            value={form.lowStockThreshold}
            onChange={(e) => update("lowStockThreshold", Number(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qty Required</label>
          <input
            type="number"
            min={0}
            value={form.qtyRequired}
            onChange={(e) => update("qtyRequired", Number(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.needsSize}
            onChange={(e) => update("needsSize", e.target.checked)}
            className="rounded border-slate-300"
          />
          Needs Size
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.isIssuedByTeam}
            onChange={(e) => update("isIssuedByTeam", e.target.checked)}
            className="rounded border-slate-300"
          />
          Issued by Team
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
            className="rounded border-slate-300"
          />
          Active
        </label>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
        />
      </div>

      {/* Sizes editor */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-medium text-gray-600">Sizes</label>
          <button
            onClick={addSize}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-navy-50 rounded transition-colors"
          >
            <Plus size={12} />
            Add size
          </button>
        </div>
        {form.sizes.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No sizes defined</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_80px_80px_auto] gap-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider px-1">
              <span>Size</span>
              <span>Qty</span>
              <span>Threshold</span>
              <span />
            </div>
            {sortedSizes.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-center"
              >
                <input
                  type="text"
                  value={s.key}
                  onChange={(e) => updateSize(s.id, { key: e.target.value })}
                  placeholder="e.g. M or 32X30"
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <input
                  type="number"
                  min={0}
                  value={s.qty}
                  onChange={(e) => updateSize(s.id, { qty: Number(e.target.value) })}
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <input
                  type="number"
                  min={0}
                  value={s.lowStockThreshold ?? ""}
                  onChange={(e) =>
                    updateSize(s.id, {
                      lowStockThreshold: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="—"
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <button
                  onClick={() => removeSize(s.id)}
                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  title="Remove size"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="pt-4 border-t border-gray-200 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {logisticsUser && (
        <>
          <CategoryInlineAddModal
            open={addCatOpen}
            mode="category"
            onClose={() => setAddCatOpen(false)}
            baseTree={categoryTree}
            actor={logisticsUser}
            onCreated={(id) => {
              update("catalogParent", id);
              update("catalogChild", "");
            }}
          />
          <CategoryInlineAddModal
            open={addSubcatOpen}
            mode="subcategory"
            onClose={() => setAddSubcatOpen(false)}
            baseTree={categoryTree}
            actor={logisticsUser}
            parentId={form.catalogParent || undefined}
            onCreated={(id) => {
              update("catalogChild", id);
            }}
          />
        </>
      )}
    </div>
  );
}

