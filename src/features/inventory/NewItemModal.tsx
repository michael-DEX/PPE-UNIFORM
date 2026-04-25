/**
 * Modal for creating a new inventory item from scratch.
 *
 * Opened from the Inventory page via the "+ New Item" button (manager/admin only).
 * Writes a new doc to the `items` collection with an ID derived from the item name.
 */

import { useState } from "react";
import { X, Plus, Check } from "lucide-react";
import { doc, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { commitItemCreate } from "../../lib/itemCreateCommit";
import { useAuthContext } from "../../app/AuthProvider";
import { CATALOG_TREE } from "../../constants/catalogCategories";
import type { ItemCategory, PackingLocations } from "../../types";

const ITEM_CATEGORIES: ItemCategory[] = [
  "bags", "patches", "boots", "bdus", "clothing", "ppe", "helmet", "sleeping", "personal",
];

const EMPTY_PACKING: PackingLocations = {
  deploymentUniform: 0,
  bag24hr: 0,
  rollerBag: 0,
  webGear: 0,
  webGearBag: 0,
  coldWeatherBag: 0,
};

function nameToDocId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface SizeRow {
  key: string;
  qty: number;
  lowStockThreshold: number | undefined;
}

interface FormState {
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

const INITIAL_FORM: FormState = {
  name: "",
  manufacturer: "",
  model: "",
  description: "",
  category: "clothing",
  catalogParent: "",
  catalogChild: "",
  unitOfIssue: "each",
  lowStockThreshold: 5,
  qtyRequired: 1,
  needsSize: false,
  isIssuedByTeam: true,
  isActive: true,
  notes: "",
  sizes: [],
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (itemId: string) => void;
}

export default function NewItemModal({ open, onClose, onCreated }: Props) {
  const { logisticsUser } = useAuthContext();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
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

  function resetAndClose() {
    setForm(INITIAL_FORM);
    setError(null);
    onClose();
  }

  async function handleCreate() {
    setError(null);
    if (!logisticsUser) {
      setError("You must be signed in to create an item.");
      return;
    }
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

    const sizeMap: Record<string, { qty: number; lowStockThreshold?: number }> = {};
    for (let i = 0; i < form.sizes.length; i++) {
      const s = form.sizes[i];
      const entry: { qty: number; lowStockThreshold?: number } = { qty: Number(s.qty) || 0 };
      if (s.lowStockThreshold !== undefined && !Number.isNaN(s.lowStockThreshold)) {
        entry.lowStockThreshold = Number(s.lowStockThreshold);
      }
      sizeMap[trimmedKeys[i]] = entry;
    }

    const catalogCategory = form.catalogChild || form.catalogParent || undefined;
    const docId = nameToDocId(form.name.trim());
    if (!docId) {
      setError("Invalid name — must contain letters or numbers.");
      return;
    }

    setSaving(true);
    try {
      // Check for duplicate ID
      const existing = await getDoc(doc(db, "items", docId));
      if (existing.exists()) {
        setError(`An item with this name already exists. Please pick a different name.`);
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        unitOfIssue: form.unitOfIssue.trim() || "each",
        sizeMap,
        lowStockThreshold: Number(form.lowStockThreshold) || 5,
        qtyRequired: Number(form.qtyRequired) || 1,
        needsSize: form.needsSize,
        isIssuedByTeam: form.isIssuedByTeam,
        isActive: form.isActive,
        packingLocations: { ...EMPTY_PACKING },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (catalogCategory) payload.catalogCategory = catalogCategory;
      if (form.manufacturer.trim()) payload.manufacturer = form.manufacturer.trim();
      if (form.model.trim()) payload.model = form.model.trim();
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();

      await commitItemCreate({ itemId: docId, payload, actor: logisticsUser });
      onCreated?.(docId);
      resetAndClose();
    } catch (err) {
      console.error("Failed to create item:", err);
      setError(err instanceof Error ? err.message : "Failed to create item.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const parentNode = CATALOG_TREE.find((n) => n.id === form.catalogParent);
  const childOptions = parentNode?.children ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-0 pb-0 md:pt-8 md:pb-8">
      <div className="absolute inset-0 bg-black/40" onClick={() => !saving && resetAndClose()} />
      <div className="relative bg-gray-50 rounded-none md:rounded-xl shadow-2xl w-full h-full md:h-auto md:max-w-2xl md:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-white rounded-none md:rounded-t-xl border-b border-gray-200 px-4 md:px-6 py-3 md:py-4 shrink-0 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Item</h2>
          <button
            onClick={resetAndClose}
            disabled={saving}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              autoFocus
              placeholder="e.g. Flashlight Batteries Spare Set"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
              <input
                type="text"
                value={form.manufacturer}
                onChange={(e) => update("manufacturer", e.target.value)}
                placeholder="e.g. 5.11"
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

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-600">Initial Stock by Size</label>
              <button
                onClick={addSize}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-navy-50 rounded transition-colors"
              >
                <Plus size={12} />
                Add size
              </button>
            </div>
            {form.sizes.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No sizes added yet. Use "Add size" to include initial stock, or leave empty.</p>
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
                      placeholder="e.g. M or 32X30 or STANDARD"
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

          {error && (
            <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white rounded-none md:rounded-b-xl border-t border-gray-200 px-4 md:px-6 py-3 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={resetAndClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            {saving ? "Creating…" : "Create Item"}
          </button>
        </div>
      </div>
    </div>
  );
}
