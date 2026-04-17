import { useState, useMemo } from "react";
import { X, Trash2, ShoppingCart, Check, Minus, Plus } from "lucide-react";
import { usePersonnel } from "../../hooks/usePersonnel";
import { useAuthContext } from "../../app/AuthProvider";
import { commitIssue } from "../../lib/issueCommit";
import SearchInput from "../../components/ui/SearchInput";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import type { Personnel, CartItem } from "../../types";

interface InventoryCartProps {
  open: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onRemove: (itemId: string, size: string | null) => void;
  onUpdateQty: (itemId: string, size: string | null, qty: number) => void;
  onClear: () => void;
}

export default function InventoryCart({
  open,
  onClose,
  cartItems,
  onRemove,
  onUpdateQty,
  onClear,
}: InventoryCartProps) {
  const { logisticsUser } = useAuthContext();
  const { members } = usePersonnel();
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Personnel | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return members.filter((m) => m.isActive).slice(0, 6);
    const q = memberSearch.toLowerCase();
    return members
      .filter(
        (m) =>
          m.isActive &&
          (m.firstName.toLowerCase().includes(q) ||
            m.lastName.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [members, memberSearch]);

  async function handleCheckout() {
    if (!logisticsUser || cartItems.length === 0) return;
    // Backorders require a recipient — block checkout if any item is backordered but no member selected
    if (!selectedMember && cartItems.some((ci) => ci.isBackorder)) {
      console.warn("Backordered items require a recipient.");
      return;
    }
    setSubmitting(true);
    try {
      await commitIssue({
        actor: logisticsUser,
        member: selectedMember,
        items: cartItems,
        type: "single_issue",
        notes: notes || undefined,
        sourceForm: "inventory_cart_issue",
      });
      setSuccess(true);
      setTimeout(() => {
        onClear();
        setSuccess(false);
        setSelectedMember(null);
        setNotes("");
        onClose();
      }, 1500);
    } catch (err) {
      console.error("Cart issue failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-navy-700" />
            <h2 className="text-lg font-semibold text-slate-900">
              Issue Cart
            </h2>
            <Badge>{cartItems.length}</Badge>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <Check size={32} className="text-emerald-600" />
            </div>
            <p className="text-lg font-medium text-slate-900">
              Issue Complete
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {cartItems.length} items issued
              {selectedMember ? ` to ${selectedMember.firstName} ${selectedMember.lastName}` : " (no recipient)"}
            </p>
          </div>
        ) : (
          <>
            {/* Cart items */}
            <div className="flex-1 overflow-y-auto">
              {cartItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <ShoppingCart size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Cart is empty</p>
                  <p className="text-xs mt-1">Add items from the inventory</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cartItems.map((ci) => (
                    <div
                      key={`${ci.itemId}::${ci.size}`}
                      className="px-5 py-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {ci.itemName}
                        </p>
                        <p className="text-xs text-slate-400">
                          {ci.size || "one-size"}
                        </p>
                        {ci.isBackorder && (
                          <Badge variant="backorder" className="mt-0.5">
                            Backorder
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() =>
                            onUpdateQty(ci.itemId, ci.size, ci.qty - 1)
                          }
                          disabled={ci.qty <= 1}
                          className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center text-sm font-medium">
                          {ci.qty}
                        </span>
                        <button
                          onClick={() =>
                            onUpdateQty(ci.itemId, ci.size, ci.qty + 1)
                          }
                          className="p-1 text-slate-400 hover:text-slate-600"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        onClick={() => onRemove(ci.itemId, ci.size)}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Member selection + checkout */}
            {cartItems.length > 0 && (
              <div className="border-t border-slate-200 px-5 py-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Issue to <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  {selectedMember ? (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                      <span className="text-sm font-medium">
                        {selectedMember.lastName}, {selectedMember.firstName}
                      </span>
                      <button
                        onClick={() => setSelectedMember(null)}
                        className="text-xs text-slate-500"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <SearchInput
                        value={memberSearch}
                        onChange={setMemberSearch}
                        placeholder="Search by name or email..."
                      />
                      {memberSearch && (
                        <div className="mt-1 max-h-28 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                          {filteredMembers.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedMember(m);
                                setMemberSearch("");
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
                            >
                              {m.lastName}, {m.firstName}{" "}
                              <span className="text-slate-400">
                                {m.email}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                />

                {!selectedMember && cartItems.some((ci) => ci.isBackorder) && (
                  <p className="text-xs text-amber-600">
                    Backordered items require a recipient.
                  </p>
                )}
                <Button
                  onClick={handleCheckout}
                  disabled={
                    submitting ||
                    (!selectedMember && cartItems.some((ci) => ci.isBackorder))
                  }
                  className="w-full"
                >
                  {submitting
                    ? "Processing..."
                    : `Issue ${cartItems.length} Item${cartItems.length > 1 ? "s" : ""}${!selectedMember ? " (no recipient)" : ""}`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
