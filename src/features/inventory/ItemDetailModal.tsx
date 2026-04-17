import { useState, useEffect, useMemo } from "react";
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
  Check,
  AlertTriangle,
  Trash2,
  Edit2,
} from "lucide-react";
import { onSnapshot, query, where, doc, deleteDoc, updateDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { backorderedRef, transactionsRef } from "../../lib/firestore";
import { useAuthContext } from "../../app/AuthProvider";
import { usePersonnel } from "../../hooks/usePersonnel";
import { getTotalStock, getStockStatus, isLowStock, isOutOfStock } from "../../hooks/useInventory";
import { getCategoryLabel, CATALOG_TREE } from "../../constants/catalogCategories";
import { commitIssue } from "../../lib/issueCommit";
import { commitStockAdjust } from "../../lib/stockCommit";
import SearchInput from "../../components/ui/SearchInput";
import type { Item, Personnel, BackorderItem, ItemCategory, Transaction } from "../../types";

interface Props {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  startInEdit?: boolean;
  startInAdjust?: boolean;
}

const PACKING_LABELS: Record<string, string> = {
  deploymentUniform: "Deployment Uniform",
  bag24hr: "24HR Bag",
  rollerBag: "Roller Bag",
  webGear: "Web Gear",
  webGearBag: "Web Gear Bag",
  coldWeatherBag: "Cold Weather Bag",
};

const ADJUST_REASONS = [
  { value: "received", label: "Stock Received" },
  { value: "recount", label: "Inventory Recount" },
  { value: "damage", label: "Damage" },
  { value: "theft", label: "Theft" },
  { value: "loss", label: "Loss" },
  { value: "restock_return", label: "Restock Return" },
] as const;

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
export default function ItemDetailModal({ item, open, onClose, startInEdit = false, startInAdjust = false }: Props) {
  const { isManager } = useAuthContext();

  // Reset all local state when item changes
  const [key, setKey] = useState(0);
  const [editing, setEditing] = useState(startInEdit && isManager);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setKey((k) => k + 1);
      setEditing(startInEdit && isManager);
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
      setDeleteError(null);
    }
  }, [item?.id, startInEdit, isManager]);

  async function confirmDelete() {
    if (!item || deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDoc(doc(db, "items", item.id));
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
              {(item.manufacturer || item.model) && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {[item.manufacturer, item.model].filter(Boolean).join(" — ")}
                </p>
              )}
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
                  {getCategoryLabel(item.catalogCategory || item.category)}
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
                <StockSection item={item} autoAdjust={startInAdjust} />
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
                <ActivitySection item={item} />
              </Section>

              {/* 5. Settings */}
              <Section title="Settings" icon={Settings} defaultOpen={false}>
                <SettingsSection item={item} />
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
function StockSection({ item, autoAdjust = false }: { item: Item; autoAdjust?: boolean }) {
  const { logisticsUser } = useAuthContext();
  const sizeEntries = Object.entries(item.sizeMap || {}).sort(([a], [b]) => a.localeCompare(b));

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
  useEffect(() => {
    if (autoAdjust) setAdjustMode(true);
  }, [autoAdjust, item.id]);
  const [reason, setReason] = useState("received");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const hasQty = Object.values(quantities).some((q) => q !== 0);
  const isDeduction = ["damage", "theft", "loss"].includes(reason);

  async function handleAdjust() {
    if (!logisticsUser || !hasQty) return;
    setSubmitting(true);
    try {
      const stockItems = Object.entries(quantities)
        .filter(([, qty]) => qty !== 0)
        .map(([size, qty]) => ({
          itemId: item.id,
          itemName: item.name,
          size,
          qtyChange: isDeduction ? -Math.abs(qty) : Math.abs(qty),
          qtyBefore: item.sizeMap[size]?.qty ?? 0,
        }));

      await commitStockAdjust({
        actor: logisticsUser,
        type: reason === "received" || reason === "restock_return" ? "receive" : "adjust",
        items: stockItems,
        notes: `[${ADJUST_REASONS.find((r) => r.value === reason)?.label}] ${notes}`.trim(),
      });

      setSuccess(true);
      setTimeout(() => {
        setAdjustMode(false);
        setQuantities({});
        setNotes("");
        setSuccess(false);
      }, 1500);
    } catch (err) {
      console.error("Stock adjust failed:", err);
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
            onClick={() => {
              setAdjustMode(false);
              setQuantities({});
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Reason selector (when adjusting) */}
      {adjustMode && (
        <div className="bg-blue-50 rounded-lg p-3 space-y-2">
          <label className="block text-xs font-medium text-gray-700">Adjustment Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ADJUST_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {isDeduction && (
            <p className="text-xs text-red-600">Quantities entered will be deducted from stock.</p>
          )}
        </div>
      )}

      {/* Size table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Size</th>
              <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Qty</th>
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
              {adjustMode && (
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">
                  {isDeduction ? "Remove" : "Add"}
                </th>
              )}
              {adjustMode && (
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">New Qty</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sizeEntries.map(([size, stock]) => {
              const threshold = stock.lowStockThreshold ?? item.lowStockThreshold ?? 5;
              const status = getStockStatus(stock.qty, threshold);
              const delta = quantities[size] || 0;
              const newQty = isDeduction ? stock.qty - Math.abs(delta) : stock.qty + Math.abs(delta);

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
                  {adjustMode && (
                    <td className="py-1 px-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() =>
                            setQuantities((p) => ({
                              ...p,
                              [size]: Math.max(0, (p[size] || 0) - 1),
                            }))
                          }
                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={delta || ""}
                          onChange={(e) =>
                            setQuantities((p) => ({
                              ...p,
                              [size]: Math.max(0, parseInt(e.target.value) || 0),
                            }))
                          }
                          className="w-14 text-center text-sm border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="0"
                        />
                        <button
                          onClick={() =>
                            setQuantities((p) => ({
                              ...p,
                              [size]: (p[size] || 0) + 1,
                            }))
                          }
                          className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                  {adjustMode && (
                    <td
                      className={`py-2 px-2 text-right font-mono text-sm ${
                        delta > 0
                          ? isDeduction
                            ? "text-red-600 font-medium"
                            : "text-emerald-600 font-medium"
                          : "text-gray-400"
                      }`}
                    >
                      {delta > 0 ? newQty : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Adjust submit */}
      {adjustMode && (
        <div className="space-y-2 pt-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (e.g., PO #1234, vendor shipment)"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {success ? (
            <div className="flex items-center justify-center gap-2 py-2 text-emerald-600">
              <Check size={18} />
              <span className="text-sm font-medium">Stock Updated</span>
            </div>
          ) : (
            <button
              onClick={handleAdjust}
              disabled={!hasQty || submitting}
              className="w-full py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting
                ? "Saving..."
                : `Apply ${isDeduction ? "Deduction" : "Adjustment"} (${
                    Object.values(quantities).filter((q) => q > 0).length
                  } sizes)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Issue Section ──
function IssueSection({ item, onDone }: { item: Item; onDone: () => void }) {
  const { logisticsUser } = useAuthContext();
  const { members } = usePersonnel();
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Personnel | null>(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [qty, setQty] = useState(1);
  const [isBackorder, setIsBackorder] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Set default size
  useEffect(() => {
    const sizes = Object.keys(item.sizeMap || {});
    setSelectedSize(sizes[0] ?? "one-size");
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

  const sizes = Object.entries(item.sizeMap || {});
  const stock = item.sizeMap?.[selectedSize]?.qty ?? 0;

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
                  const avail = item.sizeMap?.[val]?.qty ?? 0;
                  if (avail <= 0) setIsBackorder(true);
                }}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sizes.map(([s, v]) => (
                  <option key={s} value={s}>
                    {s} ({v.qty} avail)
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

// ── Packing Locations Section ──
function PackingSection({ item }: { item: Item }) {
  const entries = Object.entries(item.packingLocations || {}).filter(([, qty]) => qty > 0);

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 italic py-4 text-center">No packing locations assigned</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3">
      {entries.map(([key, qty]) => (
        <div key={key} className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">{PACKING_LABELS[key] || key}</p>
          <p className="text-lg font-bold text-gray-900">{qty}</p>
        </div>
      ))}
    </div>
  );
}

// ── Settings Section ──
const ITEM_CATEGORIES: ItemCategory[] = [
  "bags", "patches", "boots", "bdus", "clothing", "ppe", "helmet", "sleeping", "personal",
];

interface SizeRow {
  key: string;
  qty: number;
  lowStockThreshold: number | undefined;
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

function initialFormState(item: Item): EditFormState {
  const cc = item.catalogCategory ?? "";
  // Determine parent vs child based on CATALOG_TREE
  let catalogParent = cc;
  let catalogChild = "";
  for (const node of CATALOG_TREE) {
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
    category: item.category,
    catalogParent,
    catalogChild,
    unitOfIssue: item.unitOfIssue || "each",
    lowStockThreshold: item.lowStockThreshold ?? 5,
    qtyRequired: item.qtyRequired ?? 1,
    needsSize: item.needsSize ?? false,
    isIssuedByTeam: item.isIssuedByTeam,
    isActive: item.isActive,
    notes: item.notes ?? "",
    sizes: Object.entries(item.sizeMap || {}).map(([k, v]) => ({
      key: k,
      qty: v.qty,
      lowStockThreshold: v.lowStockThreshold,
    })),
  };
}

function SettingsSection({ item }: { item: Item }) {
  const formatDate = (ts: { toDate?: () => Date } | null | undefined) => {
    if (!ts || !ts.toDate) return "—";
    return ts.toDate().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3 pt-3">
      <Row label="Manufacturer" value={item.manufacturer || "—"} />
      <Row label="Model" value={item.model || "—"} />
      <Row label="Description" value={item.description || "—"} />
      <Row label="Notes" value={item.notes || "—"} />
      <Row label="Low Stock Threshold" value={String(item.lowStockThreshold)} />
      <Row label="Unit of Issue" value={item.unitOfIssue || "each"} />
      <Row label="Status" value={item.isActive ? "Active" : "Inactive"} />
      <Row label="Last Updated" value={formatDate(item.updatedAt)} />
      <Row label="Created" value={formatDate(item.createdAt)} />
    </div>
  );
}

function EditItemForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const [form, setForm] = useState<EditFormState>(() => initialFormState(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form if the item prop changes (e.g. after Firestore snapshot refresh)
  useEffect(() => {
    setForm(initialFormState(item));
  }, [item]);

  function update<K extends keyof EditFormState>(field: K, value: EditFormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateSize(idx: number, patch: Partial<SizeRow>) {
    setForm((f) => ({
      ...f,
      sizes: f.sizes.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  }

  function addSize() {
    setForm((f) => ({
      ...f,
      sizes: [...f.sizes, { key: "", qty: 0, lowStockThreshold: undefined }],
    }));
  }

  function removeSize(idx: number) {
    setForm((f) => ({ ...f, sizes: f.sizes.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    setError(null);
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
      await updateDoc(doc(db, "items", item.id), patch);
      onDone();
    } catch (err) {
      console.error("Failed to save item:", err);
      setError(err instanceof Error ? err.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  const parentNode = CATALOG_TREE.find((n) => n.id === form.catalogParent);
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
              update("catalogParent", e.target.value);
              update("catalogChild", "");
            }}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          >
            <option value="">—</option>
            {CATALOG_TREE.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Subcategory</label>
          <select
            value={form.catalogChild}
            onChange={(e) => update("catalogChild", e.target.value)}
            disabled={childOptions.length === 0}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">—</option>
            {childOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
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
            {form.sizes.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-center">
                <input
                  type="text"
                  value={s.key}
                  onChange={(e) => updateSize(i, { key: e.target.value })}
                  placeholder="e.g. M or 32X30"
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <input
                  type="number"
                  min={0}
                  value={s.qty}
                  onChange={(e) => updateSize(i, { qty: Number(e.target.value) })}
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <input
                  type="number"
                  min={0}
                  value={s.lowStockThreshold ?? ""}
                  onChange={(e) =>
                    updateSize(i, {
                      lowStockThreshold: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="—"
                  className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
                <button
                  onClick={() => removeSize(i)}
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
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between text-sm py-1 border-b border-gray-50">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ── Activity Section ──────────────────────────────────────────────────
function formatActivityTime(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFullTimestamp(ts: { toDate?: () => Date } | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ActivityEntry {
  txId: string;
  timestamp: Transaction["timestamp"];
  actorName: string;
  personnelName: string | null;
  type: Transaction["type"];
  sourceForm: string | undefined;
  notes: string | undefined;
  size: string | null;
  qty: number;
  isBackorder: boolean;
}

function activityLabel(entry: ActivityEntry): { label: string; color: string; sign: string } {
  // Stock adjustments have null personnelId and sourceForm="stock_adjust"
  if (entry.sourceForm === "stock_adjust") {
    if (entry.qty > 0) return { label: "Received", color: "bg-emerald-100 text-emerald-700", sign: "+" };
    return { label: "Adjusted", color: "bg-amber-100 text-amber-700", sign: "" };
  }
  if (entry.type === "return") return { label: "Returned", color: "bg-blue-100 text-blue-700", sign: "+" };
  if (entry.type === "exchange") return { label: "Exchanged", color: "bg-purple-100 text-purple-700", sign: "" };
  if (entry.type === "ocr_import") return { label: "Imported", color: "bg-slate-100 text-slate-700", sign: "+" };
  // onboarding_issue / single_issue
  return { label: "Issued", color: "bg-red-50 text-red-700", sign: "-" };
}

function ActivitySection({ item }: { item: Item }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = query(transactionsRef, orderBy("timestamp", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ActivityEntry[] = [];
        for (const d of snap.docs) {
          const tx = { ...d.data(), id: d.id } as Transaction;
          for (const ti of tx.items) {
            if (ti.itemId !== item.id) continue;
            list.push({
              txId: tx.id,
              timestamp: tx.timestamp,
              actorName: tx.issuedByName,
              personnelName: tx.personnelName,
              type: tx.type,
              sourceForm: tx.sourceForm,
              notes: tx.notes,
              size: ti.size,
              qty: ti.qtyIssued,
              isBackorder: ti.isBackorder,
            });
          }
        }
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load activity:", err);
        setLoading(false);
      },
    );
    return unsub;
  }, [item.id]);

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-4">Loading activity…</p>;
  }
  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No activity recorded for this item.</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((e) => {
        const { label, color, sign } = activityLabel(e);
        return (
          <div key={`${e.txId}::${e.size}::${e.qty}`} className="py-2">
            <div className="flex items-start gap-3">
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
                {label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 text-sm text-gray-900">
                  <span className="font-semibold">
                    {sign}
                    {Math.abs(e.qty)}
                  </span>
                  {e.size && <span className="text-xs text-gray-500">size {e.size}</span>}
                  {e.isBackorder && (
                    <span className="text-[10px] bg-orange-100 text-orange-700 rounded px-1">
                      backorder
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  by <span className="font-medium text-gray-700">{e.actorName}</span>
                  {e.personnelName && (
                    <>
                      {" → "}
                      <span className="font-medium text-gray-700">{e.personnelName}</span>
                    </>
                  )}
                </p>
                {e.notes && <p className="text-xs text-gray-500 italic mt-0.5 truncate">"{e.notes}"</p>}
              </div>
              <span
                className="text-xs text-gray-400 shrink-0"
                title={formatFullTimestamp(e.timestamp)}
              >
                {formatActivityTime(e.timestamp)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
