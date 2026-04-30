import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
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

      // ── Builders ────────────────────────────────────────────────────
      //
      // Two paths produce the cart seed:
      //   - Firestore path: doc exists + has itemIds → ID-joined, rename-safe
      //   - Hardcoded path: legacy dual lookup by name against
      //     ONBOARDING_TEMPLATE_ITEM_NAMES + ITEMS_MASTER. This is the
      //     grace-period fallback until the admin seeds the doc via the
      //     Settings page (phase 2B). Both paths produce identical
      //     CartItem shapes so the UI doesn't know which ran.

      const buildFromFirestoreIds = (
        itemIds: string[],
        itemNotes: Record<string, string>,
        sectionNoteByItemId: Record<string, string>,
        sectionIdByItemId: Record<string, string>,
        sectionLabelByItemId: Record<string, string>,
      ): CartItem[] => {
        const seeded: CartItem[] = [];
        for (const itemId of itemIds) {
          const fsItem = firestoreItems.find((i) => i.id === itemId);
          // Silent skip for itemIds pointing to deleted/missing catalog docs.
          // The Settings editor surfaces a "⚠ N items missing" badge for
          // admins; onboarding just ignores them at seed time.
          if (!fsItem) continue;
          // ITEMS_MASTER lookup by item NAME for needsSize / qtyRequired
          // defaults. Works today because recon confirmed template ↔
          // ITEMS_MASTER are fully in sync. If an admin adds an item via
          // Settings that isn't in ITEMS_MASTER, we fall back to the live
          // Item's own fields (both optional on Item), else sensible
          // defaults (no-size, qty=1). Cleanup after the Settings UI
          // stabilizes will remove ITEMS_MASTER dependency entirely.
          const masterEntry = ITEMS_MASTER.find((m) => m.name === fsItem.name);
          const note = (itemNotes[fsItem.id] ?? "").trim();
          const sectionNote = sectionNoteByItemId[fsItem.id];
          const sectionId = sectionIdByItemId[fsItem.id];
          const sectionLabel = sectionLabelByItemId[fsItem.id];
          const ci: CartItem = {
            itemId: fsItem.id,
            itemName: fsItem.name,
            size: null,
            qty: 0,
            isBackorder: false,
            qtyBefore: 0,
            needsSize:
              masterEntry?.needsSize ?? fsItem.needsSize ?? false,
            suggestedQty:
              masterEntry?.qtyRequired ?? fsItem.qtyRequired ?? 1,
          };
          if (note) ci.note = note;
          if (sectionNote) ci.sectionNote = sectionNote;
          if (sectionId) ci.sectionId = sectionId;
          if (sectionLabel) ci.sectionLabel = sectionLabel;
          seeded.push(ci);
        }
        return seeded;
      };

      const buildFromHardcoded = (): CartItem[] => {
        const seeded: CartItem[] = [];
        for (const templateName of ONBOARDING_TEMPLATE_ITEM_NAMES) {
          const masterEntry = ITEMS_MASTER.find((m) => m.name === templateName);
          const fsItem = firestoreItems.find((i) => i.name === templateName);
          if (!fsItem || !masterEntry) continue;

          seeded.push({
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
        return seeded;
      };

      // ── Fetch + dispatch ────────────────────────────────────────────
      //
      // Non-async outer signature (callers are synchronous — handleCreateMember
      // calls loadTemplate then immediately setStep(1), so we can't block
      // them). The `getDoc` resolves asynchronously and calls setCartItems
      // when it does. During the brief window before it resolves, cartItems
      // is still its previous value (empty on first load, which renders as
      // "loading gear…" style empty state — same as today if the template
      // were slow to build).
      getDoc(doc(db, "app_config", "onboarding_template"))
        .then((snap) => {
          const data = snap.exists() ? snap.data() : null;
          const itemIds =
            data && Array.isArray(data.itemIds)
              ? (data.itemIds as string[])
              : null;

          // Notes lookups. Both default to empty when the doc lacks the
          // field (pre-Phase-2 docs, or rolled-back state). Empty
          // lookups → CartItems get no `note` / `sectionNote` →
          // OnboardingPage / OnboardingItemCard render nothing extra.
          const itemNotes: Record<string, string> =
            data &&
            data.itemNotes &&
            typeof data.itemNotes === "object" &&
            !Array.isArray(data.itemNotes)
              ? (data.itemNotes as Record<string, string>)
              : {};

          const sectionNoteByItemId: Record<string, string> = {};
          const sectionIdByItemId: Record<string, string> = {};
          const sectionLabelByItemId: Record<string, string> = {};
          const sectionsRaw =
            data && Array.isArray(data.sections) ? data.sections : [];
          for (const sec of sectionsRaw as Array<Record<string, unknown>>) {
            const secId = typeof sec.id === "string" ? sec.id : "";
            const secLabel = typeof sec.label === "string" ? sec.label : "";
            const note = typeof sec.note === "string" ? sec.note.trim() : "";
            const items = Array.isArray(sec.items) ? sec.items : [];
            for (const id of items) {
              if (typeof id !== "string") continue;
              // Sections are disjoint by construction (admin editor
              // enforces it), but if duplicates ever leak through, the
              // first section wins — deterministic.
              if (secId && !(id in sectionIdByItemId)) {
                sectionIdByItemId[id] = secId;
              }
              if (secLabel && !(id in sectionLabelByItemId)) {
                sectionLabelByItemId[id] = secLabel;
              }
              if (note && !(id in sectionNoteByItemId)) {
                sectionNoteByItemId[id] = note;
              }
            }
          }

          if (itemIds && itemIds.length > 0) {
            setCartItems(
              buildFromFirestoreIds(
                itemIds,
                itemNotes,
                sectionNoteByItemId,
                sectionIdByItemId,
                sectionLabelByItemId,
              ),
            );
          } else {
            console.info(
              "[loadTemplate] Firestore doc not found, using hardcoded fallback",
            );
            setCartItems(buildFromHardcoded());
          }
        })
        .catch((err) => {
          console.warn(
            "[loadTemplate] Firestore read failed, using hardcoded fallback:",
            err,
          );
          setCartItems(buildFromHardcoded());
        });
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

// eslint-disable-next-line react-refresh/only-export-components
export function useIssueCart() {
  const ctx = useContext(IssueCartContext);
  if (!ctx) throw new Error("useIssueCart must be used within IssueCartProvider");
  return ctx;
}
