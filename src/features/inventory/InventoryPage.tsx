import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ShoppingCart, Package, Plus } from "lucide-react";
import { useInventory } from "../../hooks/useInventory";
import { useDraftSave } from "../../hooks/useDraftSave";
import { useAuthContext } from "../../app/AuthProvider";
import { useCatalogCategories } from "../../hooks/useCatalogCategories";
import { addToCurrentDraftOrderList } from "../../lib/orderListAdd";
import { categoryMatches, getCategoryLabel } from "../../constants/catalogCategories";
import InventoryList from "./InventoryList";
import ItemDetailModal from "./ItemDetailModal";
import QuickIssueModal from "./QuickIssueModal";
import InventoryCart from "./InventoryCart";
import NewItemModal from "./NewItemModal";
import SearchInput from "../../components/ui/SearchInput";
import Spinner from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import type { Item, CartItem } from "../../types";

export default function InventoryPage() {
  const { items, loading } = useInventory();
  const { isManager, logisticsUser } = useAuthContext();
  const { tree: categoryTree } = useCatalogCategories();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("cat") ?? "all";
  const [search, setSearch] = useState("");

  // Detail modal state. When `adjustReason` is set, the modal opens with its
  // Adjust panel auto-expanded and that reason pre-picked (e.g. "received" for
  // the accordion's Receive stock button).
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [adjustReason, setAdjustReason] = useState<string | undefined>(undefined);

  // Quick issue modal state
  const [quickIssueItem, setQuickIssueItem] = useState<Item | null>(null);

  // Which row in the accordion is expanded (lifted so deep-links can
  // auto-expand via the `quickAdd` URL param).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New item modal state
  const [newItemOpen, setNewItemOpen] = useState(false);

  // Cart state
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Total units across all cart lines — user-facing counts (header badge,
  // cart-drawer badge, checkout button label) should show total qty, not the
  // number of distinct size rows.
  const cartTotalQty = useMemo(
    () => cartItems.reduce((sum, ci) => sum + ci.qty, 0),
    [cartItems],
  );

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
    if (cartTotalQty > 0) {
      saveCartDraft(cartItems);
    }
  }, [cartItems, cartTotalQty, saveCartDraft]);

  // Deep-link: auto-expand a row for `?quickAdd=<item-id>`. Used by the
  // dashboard's stock-alert rows so clicking "BDU Pants — Low Stock" sends
  // the user here with that row already open.
  useEffect(() => {
    const quickAddId = searchParams.get("quickAdd");
    if (!quickAddId) return;
    // Wait until items finish loading so we don't prematurely clear the param.
    if (loading) return;

    const target = items.find((i) => i.id === quickAddId);
    if (target) {
      setExpandedId(target.id);
    }
    // Always clear the param once items are loaded — whether we found a match
    // or not — so a refresh doesn't re-trigger.
    setSearchParams(
      (prev) => {
        prev.delete("quickAdd");
        return prev;
      },
      { replace: true },
    );
  }, [searchParams, items, loading, setSearchParams]);

  // Filter items by category and search
  const filtered = useMemo(() => {
    let result = items.filter((i) => i.isActive && i.isIssuedByTeam);

    // Category filter
    if (activeCategory !== "all") {
      result = result.filter((i) =>
        categoryMatches(
          activeCategory,
          i.catalogCategory ?? i.category,
          categoryTree,
        )
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
  }, [items, activeCategory, search, categoryTree]);

  // Accordion "Receive stock" → open ItemDetailModal with the Adjust panel
  // pre-picked to "received". The modal owns its own delete flow via the
  // Settings section; there's no separate hard-delete path in this page.
  const handleReceiveStock = useCallback((item: Item) => {
    setSelectedItem(item);
    setAdjustReason("received");
  }, []);

  // Cart handlers — single source of truth for adding an entry to the cart.
  const addCartEntry = useCallback(
    (
      item: Item,
      entry: { size: string; qty: number; isBackorder: boolean },
    ) => {
      const stock = item.sizeMap?.[entry.size]?.qty ?? 0;
      setCartItems((prev) => {
        const key = `${item.id}::${entry.size}`;
        const existing = prev.find((ci) => `${ci.itemId}::${ci.size}` === key);
        if (existing) {
          return prev.map((ci) =>
            `${ci.itemId}::${ci.size}` === key
              ? {
                  ...ci,
                  qty: ci.qty + entry.qty,
                  isBackorder: ci.isBackorder || entry.isBackorder,
                }
              : ci,
          );
        }
        return [
          ...prev,
          {
            itemId: item.id,
            itemName: item.name,
            size: entry.size,
            qty: entry.qty,
            isBackorder: entry.isBackorder,
            qtyBefore: stock,
          },
        ];
      });
      // Don't auto-open the cart drawer — the toast confirms the add and the
      // header badge reflects the new total. Users explicitly open the cart
      // via the header button when they're ready to check out.
    },
    [],
  );

  // Called by the quick-add popover with the user's chosen size/qty.
  const handlePopoverAdd = useCallback(
    (
      item: Item,
      entry: { size: string; qty: number; isBackorder: boolean },
    ) => {
      addCartEntry(item, entry);
      toast.success(`Added ${entry.qty}× ${item.name} to cart`);
    },
    [addCartEntry, toast],
  );

  // Quick-add "Add to order list" — appends to the newest draft order list
  // (or creates one if none exists). No checkout UI; we just fire and toast.
  const handleAddToOrderList = useCallback(
    async (item: Item, entry: { size: string; qty: number }) => {
      if (!logisticsUser) return;
      try {
        const result = await addToCurrentDraftOrderList(logisticsUser, {
          itemId: item.id,
          itemName: item.name,
          size: entry.size,
          qtyToOrder: entry.qty,
        });
        toast.success(
          `Added ${entry.qty}× ${item.name} (${entry.size}) to "${result.listName}"`,
        );
      } catch (err) {
        console.error("Add to order list failed:", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to add to order list",
        );
      }
    },
    [logisticsUser, toast],
  );

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
  const categoryLabel =
    activeCategory === "all"
      ? "All Items"
      : getCategoryLabel(activeCategory, categoryTree);

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
        <div className="mb-3 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-2">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-gray-900 truncate">
              {categoryLabel}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">{filtered.length} items</p>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 sm:shrink-0">
            {/* New Item (manager+admin only) */}
            {isManager && (
              <button
                onClick={() => setNewItemOpen(true)}
                className="flex items-center gap-1.5 md:gap-2 px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium bg-navy-700 text-white hover:bg-navy-800 transition-colors"
              >
                <Plus size={18} />
                <span>New Item</span>
              </button>
            )}

            {/* Cart button -- always visible */}
            <button
              onClick={() => setCartOpen(true)}
              className={`flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                cartTotalQty > 0
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <ShoppingCart size={16} />
              {cartTotalQty > 0 ? (
                <span>Cart ({cartTotalQty})</span>
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

      {/* Accordion list */}
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
          <InventoryList
            items={filtered}
            cartItems={cartItems}
            expandedId={expandedId}
            onExpandChange={setExpandedId}
            onAdd={handlePopoverAdd}
            onAddToOrderList={handleAddToOrderList}
            onViewDetails={setSelectedItem}
            onReceive={handleReceiveStock}
            canReceive={isManager}
          />
        )}
      </div>

      {/* Item Detail Modal — opens with Adjust pre-picked when `adjustReason`
          is set (e.g. the accordion's Receive stock button). */}
      <ItemDetailModal
        item={selectedItem}
        open={selectedItem !== null}
        onClose={() => {
          setSelectedItem(null);
          setAdjustReason(undefined);
        }}
        startInAdjust={adjustReason !== undefined}
        startInAdjustReason={adjustReason}
      />

      {/* Quick Issue Modal */}
      <QuickIssueModal
        item={quickIssueItem}
        open={quickIssueItem !== null}
        onClose={() => setQuickIssueItem(null)}
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
