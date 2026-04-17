import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ShoppingCart, Package, Camera, Plus } from "lucide-react";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useInventory, getTotalStock } from "../../hooks/useInventory";
import { useDraftSave } from "../../hooks/useDraftSave";
import { useAuthContext } from "../../app/AuthProvider";
import { categoryMatches, getCategoryLabel } from "../../constants/catalogCategories";
import InventoryTable from "./InventoryTable";
import ItemDetailModal from "./ItemDetailModal";
import QuickIssueModal from "./QuickIssueModal";
import InventoryCart from "./InventoryCart";
import ReceiveStockDrawer from "./ReceiveStockDrawer";
import NewItemModal from "./NewItemModal";
import SearchInput from "../../components/ui/SearchInput";
import Spinner from "../../components/ui/Spinner";
import type { Item, CartItem } from "../../types";

export default function InventoryPage() {
  const { items, loading } = useInventory();
  const { isManager } = useAuthContext();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeCategory = searchParams.get("cat") ?? "all";
  const [search, setSearch] = useState("");

  // Detail modal state
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  // Quick issue modal state
  const [quickIssueItem, setQuickIssueItem] = useState<Item | null>(null);

  // Receive stock drawer state
  const [receiveItem, setReceiveItem] = useState<Item | null>(null);

  // New item modal state
  const [newItemOpen, setNewItemOpen] = useState(false);

  // Cart state
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Draft save/restore for cart
  const { hasDraft: hasCartDraft, loadDraft: loadCartDraft, clearDraft: clearCartDraft, saveDraft: saveCartDraft } = useDraftSave<CartItem[]>("ppe:inventory:cart");

  // Restore cart from draft on mount
  useEffect(() => {
    if (hasCartDraft) {
      const saved = loadCartDraft();
      if (saved && saved.length > 0) {
        setCartItems(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save cart to draft whenever it changes
  useEffect(() => {
    if (cartItems.length > 0) {
      saveCartDraft(cartItems);
    }
  }, [cartItems, saveCartDraft]);

  // Filter items by category and search
  const filtered = useMemo(() => {
    let result = items.filter((i) => i.isActive && i.isIssuedByTeam);

    // Category filter
    if (activeCategory !== "all") {
      result = result.filter((i) =>
        categoryMatches(activeCategory, i.catalogCategory ?? i.category)
      );
    }

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          (i.notes?.toLowerCase().includes(q) ?? false)
      );
    }

    return result;
  }, [items, activeCategory, search]);

  // Delete handler
  const handleDelete = useCallback(async (item: Item) => {
    const totalStock = getTotalStock(item);
    const warning = totalStock > 0
      ? `\n\nWARNING: "${item.name}" has ${totalStock} units in stock.`
      : "";
    if (!window.confirm(
      `Permanently delete "${item.name}"? This cannot be undone.${warning}`,
    )) return;
    try {
      await deleteDoc(doc(db, "items", item.id));
    } catch (err) {
      window.alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Cart handlers
  const addToCart = useCallback((item: Item) => {
    const sizes = Object.entries(item.sizeMap || {});
    const defaultSize = sizes[0]?.[0] ?? "one-size";
    const stock = item.sizeMap?.[defaultSize]?.qty ?? 0;

    setCartItems((prev) => {
      const key = `${item.id}::${defaultSize}`;
      const existing = prev.find((ci) => `${ci.itemId}::${ci.size}` === key);
      if (existing) {
        return prev.map((ci) =>
          `${ci.itemId}::${ci.size}` === key ? { ...ci, qty: ci.qty + 1 } : ci
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          size: defaultSize,
          qty: 1,
          isBackorder: stock <= 0,
          qtyBefore: stock,
        },
      ];
    });
    setCartOpen(true);
  }, []);

  const removeFromCart = useCallback((itemId: string, size: string | null) => {
    setCartItems((prev) => prev.filter((ci) => !(ci.itemId === itemId && ci.size === size)));
  }, []);

  const updateCartQty = useCallback((itemId: string, size: string | null, qty: number) => {
    if (qty < 1) return;
    setCartItems((prev) =>
      prev.map((ci) => (ci.itemId === itemId && ci.size === size ? { ...ci, qty } : ci))
    );
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
    setCartOpen(false);
    clearCartDraft();
  }, [clearCartDraft]);

  // Breadcrumb label
  const categoryLabel = activeCategory === "all" ? "All Items" : getCategoryLabel(activeCategory);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-gray-900 truncate">{categoryLabel}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{filtered.length} items</p>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {/* New Item (manager+admin only) */}
            {isManager && (
              <button
                onClick={() => setNewItemOpen(true)}
                className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 rounded-lg text-xs md:text-sm font-medium bg-navy-700 text-white hover:bg-navy-800 transition-colors"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New Item</span>
              </button>
            )}

            {/* Scan packing slip */}
            <button
              onClick={() => navigate("/logistics/inventory/scan")}
              className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 rounded-lg text-xs md:text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Camera size={16} />
              <span className="hidden sm:inline">Scan Slip</span>
            </button>

            {/* Cart button -- always visible */}
            <button
              onClick={() => setCartOpen(true)}
              className={`flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                cartItems.length > 0
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <ShoppingCart size={16} />
              {cartItems.length > 0 ? (
                <span>Cart ({cartItems.length})</span>
              ) : (
                <span className="hidden sm:inline">Cart</span>
              )}
            </button>
          </div>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search items by name, category, or notes..."
          className="w-full md:max-w-lg"
        />
      </div>

      {/* Table content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Package size={48} className="text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">No items found</h3>
            <p className="text-sm text-gray-500 mt-1">
              {search ? "Try a different search term" : "No items in this category"}
            </p>
          </div>
        ) : (
          <InventoryTable
            items={filtered}
            onSelectItem={setSelectedItem}
            onReceive={setReceiveItem}
            onAddToCart={addToCart}
            onDelete={handleDelete}
            canDelete={isManager}
          />
        )}
      </div>

      {/* Item Detail Modal */}
      <ItemDetailModal
        item={selectedItem}
        open={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
      />

      {/* Quick Issue Modal */}
      <QuickIssueModal
        item={quickIssueItem}
        open={quickIssueItem !== null}
        onClose={() => setQuickIssueItem(null)}
      />

      {/* Receive Stock Drawer */}
      <ReceiveStockDrawer
        item={receiveItem}
        open={receiveItem !== null}
        onClose={() => setReceiveItem(null)}
      />

      {/* Inventory Cart */}
      <InventoryCart
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cartItems={cartItems}
        onRemove={removeFromCart}
        onUpdateQty={updateCartQty}
        onClear={clearCart}
      />

      {/* New Item Modal */}
      <NewItemModal
        open={newItemOpen}
        onClose={() => setNewItemOpen(false)}
      />
    </div>
  );
}
