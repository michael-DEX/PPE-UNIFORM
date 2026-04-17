import { useState, useEffect, useMemo } from "react";
import {
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  arrayRemove,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { orderListsRef } from "../../lib/firestore";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import Spinner from "../../components/ui/Spinner";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import EmptyState from "../../components/ui/EmptyState";
import { Plus, FileDown, Printer, Trash2, Package, Check, Search, FolderTree, PenLine, ArrowLeft } from "lucide-react";
import { CATALOG_TREE, categoryMatches, getCategoryLabel } from "../../constants/catalogCategories";
import type { OrderList, OrderListItem, Item } from "../../types";

// ── Helpers ──

function formatDate(ts: { toDate(): Date } | null): string {
  if (!ts) return "";
  const d = ts.toDate();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function defaultListName(): string {
  return `Order List \u2014 ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function downloadCSV(list: OrderList) {
  const header = "Item,Size,Qty,Notes";
  const rows = list.items.map(
    (i) =>
      `"${i.itemName}","${i.size ?? ""}",${i.qtyToOrder},"${(i.notes ?? "").replace(/"/g, '""')}"`
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${list.name.replace(/[^a-zA-Z0-9 -]/g, "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ──

export default function OrderListsPage() {
  const { user } = useAuthContext();
  const { items: inventoryItems, loading: inventoryLoading } = useInventory();

  const [lists, setLists] = useState<OrderList[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Subscribe to order_lists collection
  useEffect(() => {
    const q = query(orderListsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map(
          (d) => ({ ...d.data(), id: d.id }) as OrderList
        );
        setLists(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId]
  );

  // ── Create new order list ──
  async function handleCreate() {
    if (!user) return;
    const ref = await addDoc(orderListsRef, {
      name: defaultListName(),
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      exportedAt: null,
      items: [] as OrderListItem[],
    });
    setSelectedId(ref.id);
  }

  // ── Delete order list ──
  async function handleDelete(id: string) {
    if (!confirm("Delete this order list? This cannot be undone.")) return;
    await deleteDoc(doc(db, "order_lists", id));
    if (selectedId === id) setSelectedId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* -- Left Panel: Order Lists -- */}
      <div className={`w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 overflow-y-auto flex flex-col shrink-0 ${
        selectedId ? "hidden md:flex" : "flex"
      }`}>
        <div className="p-4 border-b border-slate-200">
          <Button onClick={handleCreate} className="w-full">
            <Plus size={16} />
            New Order List
          </Button>
        </div>

        {lists.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-sm text-slate-500 text-center">
              No order lists yet. Create one to start tracking items to reorder.
            </p>
          </div>
        ) : (
          <div className="flex-1 divide-y divide-slate-200">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => setSelectedId(list.id)}
                className={`w-full text-left px-4 py-3 transition-colors hover:bg-white ${
                  selectedId === list.id
                    ? "bg-white border-l-2 border-navy-600"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900 truncate">
                    {list.name}
                  </span>
                  {list.exportedAt && (
                    <Badge variant="success" className="ml-2 shrink-0">
                      <Check size={10} className="mr-0.5" />
                      Exported
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span>{list.items.length} item{list.items.length !== 1 ? "s" : ""}</span>
                  <span>&middot;</span>
                  <span>{formatDate(list.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* -- Right Panel: Detail -- */}
      <div className={`flex-1 overflow-y-auto ${
        selectedId ? "flex flex-col" : "hidden md:flex md:flex-col"
      }`}>
        {!selectedList ? (
          <EmptyState
            icon={<Package size={48} />}
            title="Select an order list to view details"
          />
        ) : (
          <OrderListDetail
            list={selectedList}
            inventoryItems={inventoryItems}
            inventoryLoading={inventoryLoading}
            onDelete={() => handleDelete(selectedList.id)}
            onBack={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── Detail Panel ──

function OrderListDetail({
  list,
  inventoryItems,
  inventoryLoading,
  onDelete,
  onBack,
}: {
  list: OrderList;
  inventoryItems: Item[];
  inventoryLoading: boolean;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [editName, setEditName] = useState(list.name);

  // Sync local name when switching lists
  useEffect(() => {
    setEditName(list.name);
  }, [list.id, list.name]);

  async function saveName() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== list.name) {
      await updateDoc(doc(db, "order_lists", list.id), { name: trimmed });
    }
  }

  async function handleMarkExported() {
    await updateDoc(doc(db, "order_lists", list.id), {
      exportedAt: serverTimestamp(),
    });
  }

  async function handleRemoveItem(item: OrderListItem) {
    if (!confirm("Remove this item from the order list?")) return;
    await updateDoc(doc(db, "order_lists", list.id), {
      items: arrayRemove(item),
    });
  }

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      {/* -- Back button (mobile only) -- */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 md:hidden"
      >
        <ArrowLeft size={16} />
        All Lists
      </button>

      {/* -- Header -- */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 md:gap-4">
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="text-xl md:text-2xl font-bold text-navy-900 bg-transparent border-b-2 border-transparent focus:border-navy-500 focus:outline-none w-full max-w-lg"
        />
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadCSV(list)}
            disabled={list.items.length === 0}
          >
            <FileDown size={14} />
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer size={14} />
            Print
          </Button>
          {!list.exportedAt && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkExported}
              disabled={list.items.length === 0}
            >
              <Check size={14} />
              Mark Exported
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {list.exportedAt && (
        <Badge variant="success">
          <Check size={10} className="mr-1" />
          Exported {formatDate(list.exportedAt)}
        </Badge>
      )}

      {/* -- Items Table -- */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">
                Item Name
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">
                Size
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">
                Qty to Order
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">
                Notes
              </th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {list.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="text-sm text-slate-500">
                    No items added yet. Search and add items below.
                  </p>
                </td>
              </tr>
            ) : (
              list.items.map((item, idx) => (
                <tr
                  key={`${item.itemId}-${item.size}-${idx}`}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {item.itemName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.size ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.qtyToOrder}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {item.notes || "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRemoveItem(item)}
                      className="text-slate-400 hover:text-red-600 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* ── Add Item Row ── */}
        <AddItemRow
          listId={list.id}
          inventoryItems={inventoryItems}
          inventoryLoading={inventoryLoading}
        />
      </div>
    </div>
  );
}

// ── Add Item Section ──

type AddMode = "search" | "browse" | "custom";

function AddItemRow({
  listId,
  inventoryItems,
}: {
  listId: string;
  inventoryItems: Item[];
  inventoryLoading: boolean;
}) {
  const [mode, setMode] = useState<AddMode>("search");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  // Search mode state
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // Browse mode state
  const [selectedCat, setSelectedCat] = useState("");
  const [selectedSubcat, setSelectedSubcat] = useState("");

  // Custom mode state
  const [customName, setCustomName] = useState("");

  const sizes = selectedItem ? Object.keys(selectedItem.sizeMap || {}) : [];

  // Search results
  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return inventoryItems.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [inventoryItems, search]);

  // Browse: get children of selected category
  const selectedCatNode = useMemo(
    () => CATALOG_TREE.find((n) => n.id === selectedCat),
    [selectedCat]
  );
  const subcategories = selectedCatNode?.children ?? [];

  // Browse: items matching selected category/subcategory
  const browseItems = useMemo(() => {
    const catId = selectedSubcat || selectedCat;
    if (!catId) return [];
    return inventoryItems
      .filter((i) => categoryMatches(catId, i.catalogCategory ?? i.category))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventoryItems, selectedCat, selectedSubcat]);

  function reset() {
    setSelectedItem(null);
    setSize("");
    setQty(1);
    setNotes("");
    setSearch("");
    setShowDropdown(false);
    setSelectedCat("");
    setSelectedSubcat("");
    setCustomName("");
  }

  function selectItem(item: Item) {
    setSelectedItem(item);
    setShowDropdown(false);
    const itemSizes = Object.keys(item.sizeMap || {});
    if (itemSizes.length === 1) setSize(itemSizes[0]);
  }

  async function handleAdd() {
    let newItem: OrderListItem;
    if (mode === "custom") {
      if (!customName.trim() || qty < 1) return;
      newItem = {
        itemId: "custom",
        itemName: customName.trim(),
        size: size || null,
        qtyToOrder: qty,
        ...(notes ? { notes } : {}),
      };
    } else {
      if (!selectedItem || qty < 1) return;
      newItem = {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        size: size || null,
        qtyToOrder: qty,
        ...(notes ? { notes } : {}),
      };
    }
    // Aggregate: if same item+size exists, increase qty instead of duplicating
    const listSnap = await getDoc(doc(db, "order_lists", listId));
    const currentItems: OrderListItem[] = listSnap.data()?.items ?? [];
    const existingIdx = currentItems.findIndex(
      (i) => i.itemId === newItem.itemId && i.size === newItem.size
    );
    let updatedItems: OrderListItem[];
    if (existingIdx >= 0) {
      updatedItems = currentItems.map((i, idx) =>
        idx === existingIdx ? { ...i, qtyToOrder: i.qtyToOrder + newItem.qtyToOrder } : i
      );
    } else {
      updatedItems = [...currentItems, newItem];
    }
    await updateDoc(doc(db, "order_lists", listId), { items: updatedItems });
    reset();
  }

  const canAdd = mode === "custom" ? customName.trim().length > 0 && qty >= 1 : selectedItem !== null && qty >= 1;

  const inputCls = "w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500";
  const disabledCls = "disabled:opacity-50 disabled:bg-slate-100";

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-3 md:px-4 py-3 space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1">
        {([
          { id: "search" as AddMode, label: "Search", icon: Search },
          { id: "browse" as AddMode, label: "Browse", icon: FolderTree },
          { id: "custom" as AddMode, label: "Custom", icon: PenLine },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setMode(id); reset(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === id
                ? "bg-navy-700 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-3 flex-wrap">
        {/* -- Item selector (varies by mode) -- */}
        <div className="relative flex-1 min-w-0 md:min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Item</label>

          {/* Already selected (search/browse) */}
          {mode !== "custom" && selectedItem ? (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-slate-900">{selectedItem.name}</span>
              <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-700">change</button>
            </div>
          ) : mode === "search" ? (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => { if (search) setShowDropdown(true); }}
                placeholder="Type to search items..."
                className={inputCls}
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="text-slate-400 ml-2 text-xs">
                        {getCategoryLabel(item.catalogCategory || item.category)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {showDropdown && search.length >= 2 && searchResults.length === 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm text-slate-500 text-center">
                  No items found
                </div>
              )}
            </>
          ) : mode === "browse" ? (
            <div className="flex gap-2">
              {/* Category */}
              <select
                value={selectedCat}
                onChange={(e) => { setSelectedCat(e.target.value); setSelectedSubcat(""); setSelectedItem(null); }}
                className={`${inputCls} flex-1`}
              >
                <option value="">Category...</option>
                {CATALOG_TREE.map((n) => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
              {/* Subcategory (if applicable) */}
              {subcategories.length > 0 && (
                <select
                  value={selectedSubcat}
                  onChange={(e) => { setSelectedSubcat(e.target.value); setSelectedItem(null); }}
                  className={`${inputCls} flex-1`}
                >
                  <option value="">All {selectedCatNode?.label}...</option>
                  {subcategories.map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
                </select>
              )}
              {/* Item picker */}
              {selectedCat && (
                <select
                  value={selectedItem?.id ?? ""}
                  onChange={(e) => {
                    const item = inventoryItems.find((i) => i.id === e.target.value);
                    if (item) selectItem(item);
                  }}
                  className={`${inputCls} flex-1`}
                >
                  <option value="">Select item...</option>
                  {browseItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            /* Custom mode */
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Type item name (e.g., New Vendor Boots)"
              className={inputCls}
            />
          )}
        </div>

        {/* Size */}
        <div className="w-full md:w-28">
          <label className="block text-xs font-medium text-slate-600 mb-1">Size</label>
          {selectedItem && sizes.length > 0 ? (
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className={inputCls}
            >
              <option value="">Select...</option>
              {sizes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value.toUpperCase())}
              placeholder={mode === "custom" || selectedItem ? "e.g., 11" : "N/A"}
              disabled={mode !== "custom" && !selectedItem}
              className={`${inputCls} ${disabledCls}`}
            />
          )}
        </div>

        {/* Qty */}
        <div className="w-full md:w-20">
          <label className="block text-xs font-medium text-slate-600 mb-1">Qty</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            disabled={mode !== "custom" && !selectedItem}
            className={`${inputCls} ${disabledCls}`}
          />
        </div>

        {/* Notes */}
        <div className="flex-1 min-w-0 md:min-w-[120px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={mode !== "custom" && !selectedItem}
            placeholder="Optional"
            className={`${inputCls} ${disabledCls}`}
          />
        </div>

        {/* Add */}
        <Button size="sm" onClick={handleAdd} disabled={!canAdd}>
          <Plus size={14} />
          Add
        </Button>
      </div>
    </div>
  );
}
