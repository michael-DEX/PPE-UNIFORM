import { useState, useMemo, useEffect } from "react";
import { Check } from "lucide-react";
import { usePersonnel } from "../../hooks/usePersonnel";
import { useAuthContext } from "../../app/AuthProvider";
import { commitIssue } from "../../lib/issueCommit";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import SearchInput from "../../components/ui/SearchInput";
import type { Item, Personnel } from "../../types";

interface Props {
  item: Item | null;
  open: boolean;
  onClose: () => void;
}

export default function QuickIssueModal({ item, open, onClose }: Props) {
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

  // Reset form when item changes
  useEffect(() => {
    if (item) {
      setSelectedMember(null);
      setMemberSearch("");
      const sizes = Object.keys(item.sizeMap || {});
      setSelectedSize(sizes[0] ?? "one-size");
      setQty(1);
      setIsBackorder(false);
      setNotes("");
      setSuccess(false);
    }
  }, [item]);

  // Pre-fill size from member profile when member is selected
  useEffect(() => {
    if (selectedMember && item) {
      const sizes = Object.keys(item.sizeMap || {});
      let preferred: string | undefined;
      const cat = item.category;
      if (cat === "boots") preferred = selectedMember.sizes?.boots ?? undefined;
      else if (cat === "bdus" && item.name.toLowerCase().includes("pant"))
        preferred = selectedMember.sizes?.pants ?? undefined;
      else if (item.name.toLowerCase().includes("glove"))
        preferred = selectedMember.sizes?.gloves ?? undefined;
      else if (cat === "helmet")
        preferred = selectedMember.sizes?.helmet ?? undefined;
      else preferred = selectedMember.sizes?.shirt ?? undefined;

      if (
        preferred &&
        sizes.some((s) => s.toLowerCase() === preferred!.toLowerCase())
      ) {
        const match = sizes.find(
          (s) => s.toLowerCase() === preferred!.toLowerCase(),
        );
        if (match) setSelectedSize(match);
      }
    }
  }, [selectedMember, item]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return members.filter((m) => m.isActive);
    const q = memberSearch.toLowerCase();
    return members.filter(
      (m) =>
        m.isActive &&
        (m.firstName.toLowerCase().includes(q) ||
          m.lastName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q)),
    );
  }, [members, memberSearch]);

  if (!item) return null;

  const sizes = Object.entries(item.sizeMap || {});
  const stock = item.sizeMap?.[selectedSize]?.qty ?? 0;

  async function handleSubmit() {
    if (!logisticsUser || !selectedMember || !item) return;
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
        sourceForm: "inventory_quick_issue",
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      console.error("Quick issue failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Issue: ${item.name}`} wide>
      {success ? (
        <div className="text-center py-8">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check size={28} className="text-emerald-600" />
          </div>
          <p className="text-lg font-medium text-slate-900">
            Issued Successfully
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {qty}x {item.name} ({selectedSize}) &rarr;{" "}
            {selectedMember?.firstName} {selectedMember?.lastName}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Member selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Issue to Member *
            </label>
            {selectedMember ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-slate-900">
                  {selectedMember.lastName}, {selectedMember.firstName} — {selectedMember.email}
                </span>
                <button
                  onClick={() => setSelectedMember(null)}
                  className="text-xs text-slate-500 hover:text-slate-700"
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
                <div className="mt-2 max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {filteredMembers.slice(0, 8).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMember(m)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-medium">
                        {m.lastName}, {m.firstName}
                      </span>
                      <span className="text-slate-400 ml-2">
                        {m.email}
                      </span>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">
                      No members found
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Size & Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Size
              </label>
              {sizes.length > 0 ? (
                <select
                  value={selectedSize}
                  onChange={(e) => {
                    setSelectedSize(e.target.value);
                    const newStock =
                      item.sizeMap?.[e.target.value]?.qty ?? 0;
                    setIsBackorder(newStock <= 0);
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                >
                  {sizes.map(([s, v]) => (
                    <option key={s} value={s}>
                      {s} ({v.qty} avail)
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-400 py-2">
                  No sizes configured
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) =>
                  setQty(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
              />
            </div>
          </div>

          {/* Stock info */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              Available:{" "}
              <strong
                className={stock <= 0 ? "text-red-600" : "text-slate-900"}
              >
                {stock}
              </strong>
            </span>
            {stock < qty && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isBackorder}
                  onChange={(e) => setIsBackorder(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-xs text-purple-700">Backorder</span>
              </label>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Quick note..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !selectedMember || submitting || (stock < qty && !isBackorder)
              }
            >
              {submitting
                ? "Issuing..."
                : isBackorder
                  ? "Issue (Backorder)"
                  : `Issue ${qty}x`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
