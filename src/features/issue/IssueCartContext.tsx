import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { CartItem, Personnel, Item } from "../../types";
import { ITEMS_MASTER } from "../../constants/itemsMaster";
import { ONBOARDING_TEMPLATE_ITEM_NAMES } from "../../constants/onboardingTemplate";

interface IssueCartState {
  cartItems: CartItem[];
  member: Personnel | null;
  setMember: (m: Personnel | null) => void;
  addItem: (item: CartItem) => void;
  removeItem: (itemId: string, size: string | null) => void;
  updateItemQty: (itemId: string, size: string | null, qty: number) => void;
  toggleBackorder: (itemId: string, size: string | null) => void;
  clearCart: () => void;
  loadTemplate: (firestoreItems: Item[], member: Personnel) => void;
}

const IssueCartContext = createContext<IssueCartState | null>(null);

export function IssueCartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [member, setMember] = useState<Personnel | null>(null);

  const addItem = useCallback((item: CartItem) => {
    setCartItems((prev) => {
      const key = `${item.itemId}::${item.size}`;
      const existing = prev.find((i) => `${i.itemId}::${i.size}` === key);
      if (existing) {
        return prev.map((i) =>
          `${i.itemId}::${i.size}` === key
            ? { ...i, qty: i.qty + item.qty }
            : i
        );
      }
      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((itemId: string, size: string | null) => {
    setCartItems((prev) =>
      prev.filter((i) => !(i.itemId === itemId && i.size === size))
    );
  }, []);

  const updateItemQty = useCallback(
    (itemId: string, size: string | null, qty: number) => {
      setCartItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && i.size === size ? { ...i, qty: Math.max(0, qty) } : i
        )
      );
    },
    []
  );

  const toggleBackorder = useCallback(
    (itemId: string, size: string | null) => {
      setCartItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && i.size === size
            ? { ...i, isBackorder: !i.isBackorder }
            : i
        )
      );
    },
    []
  );

  const clearCart = useCallback(() => {
    setCartItems([]);
    setMember(null);
  }, []);

  const loadTemplate = useCallback(
    (firestoreItems: Item[], mem: Personnel) => {
      setMember(mem);
      const items: CartItem[] = [];

      for (const templateName of ONBOARDING_TEMPLATE_ITEM_NAMES) {
        const masterEntry = ITEMS_MASTER.find((m) => m.name === templateName);
        const fsItem = firestoreItems.find((i) => i.name === templateName);
        if (!fsItem || !masterEntry) continue;

        // Load with qty=0 and no size — logistics person fills in manually
        items.push({
          itemId: fsItem.id,
          itemName: fsItem.name,
          size: null,
          qty: 0,
          isBackorder: false,
          qtyBefore: 0,
          needsSize: masterEntry.needsSize ?? false,
          suggestedQty: masterEntry.qtyRequired || 1,
        });
      }

      setCartItems(items);
    },
    []
  );

  return (
    <IssueCartContext.Provider
      value={{
        cartItems,
        member,
        setMember,
        addItem,
        removeItem,
        updateItemQty,
        toggleBackorder,
        clearCart,
        loadTemplate,
      }}
    >
      {children}
    </IssueCartContext.Provider>
  );
}

export function useIssueCart() {
  const ctx = useContext(IssueCartContext);
  if (!ctx) throw new Error("useIssueCart must be used within IssueCartProvider");
  return ctx;
}
