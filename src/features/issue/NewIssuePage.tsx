import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowLeft, Check, Trash2, AlertTriangle } from "lucide-react";
import { useInventory } from "../../hooks/useInventory";
import { usePersonnel } from "../../hooks/usePersonnel";
import { useAuthContext } from "../../app/AuthProvider";
import { useDraftSave } from "../../hooks/useDraftSave";
import { commitIssue } from "../../lib/issueCommit";
import { IssueCartProvider, useIssueCart } from "./IssueCartContext";
import SearchInput from "../../components/ui/SearchInput";
import Tabs from "../../components/ui/Tabs";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { compareSizes } from "../../lib/sizeOrder";
import { safeQty } from "../../lib/qty";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import type { Item, Personnel, CartItem } from "../../types";

interface IssueDraft {
  step: number;
  notes: string;
  memberId: string | null;
  cartItems: CartItem[];
}

const STEPS = ["Select Member", "Select Gear", "Review & Confirm"];

const CATEGORY_TABS = [
  { id: "all", label: "All" },
  { id: "bags", label: "Bags" },
  { id: "patches", label: "Patches" },
  { id: "boots", label: "Boots" },
  { id: "bdus", label: "BDUs" },
  { id: "clothing", label: "Clothing" },
  { id: "ppe", label: "PPE" },
  { id: "helmet", label: "Helmet" },
  { id: "sleeping", label: "Sleeping" },
];

export default function NewIssuePage() {
  return (
    <IssueCartProvider>
      <IssueFlow />
    </IssueCartProvider>
  );
}

function IssueFlow() {
  const [step, setStep] = useState(0);
  const { member, cartItems, clearCart, addItem } = useIssueCart();
  const { logisticsUser } = useAuthContext();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  // Pre-select member if ?member= param
  const preselectedId = searchParams.get("member");

  // Draft save/restore
  const { hasDraft, loadDraft, clearDraft, saveDraft } = useDraftSave<IssueDraft>("ppe:issue:draft");
  const [showResume, setShowResume] = useState(hasDraft);

  useEffect(() => {
    if (step < 2) {
      saveDraft({ step, notes, memberId: member?.id ?? null, cartItems });
    }
  }, [step, notes, member, cartItems, saveDraft]);

  async function handleCommit() {
    if (!logisticsUser || !member || cartItems.length === 0) return;
    setSubmitting(true);
    try {
      const txId = await commitIssue({
        actor: logisticsUser,
        member,
        items: cartItems,
        type: "single_issue",
        notes: notes || undefined,
        sourceForm: "desktop_issue",
      });
      clearDraft();
      setSuccess(txId);
    } catch (err) {
      console.error("Issue failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to issue items.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Issue Complete</h2>
        <p className="text-sm text-slate-500 mt-1">Transaction ID: {success}</p>
        <div className="flex gap-3 mt-6">
          <Button variant="secondary" onClick={() => { clearDraft(); clearCart(); setSuccess(null); setStep(0); setNotes(""); }}>
            New Issue
          </Button>
          <Button onClick={() => navigate("/logistics")}>
            Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {showResume && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-900">You have an unfinished issue</p>
            <p className="text-xs text-blue-700">Would you like to resume where you left off?</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const draft = loadDraft();
                if (draft) {
                  setStep(draft.step);
                  setNotes(draft.notes);
                  clearCart();
                  for (const ci of draft.cartItems) {
                    addItem(ci);
                  }
                }
                setShowResume(false);
              }}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Resume
            </button>
            <button
              onClick={() => { clearDraft(); setShowResume(false); }}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">New Issue</h1>
        {cartItems.length > 0 && (
          <Badge variant="info">{cartItems.length} items in cart</Badge>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                i === step
                  ? "bg-navy-700 text-white"
                  : i < step
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-sm ${i === step ? "font-medium text-slate-900" : "text-slate-400"}`}>
              {s}
            </span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <MemberStep
          preselectedId={preselectedId}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <GearStep onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <ReviewStep
          notes={notes}
          setNotes={setNotes}
          onBack={() => setStep(1)}
          onCommit={handleCommit}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function MemberStep({
  preselectedId,
  onNext,
}: {
  preselectedId: string | null;
  onNext: () => void;
}) {
  const { members, loading } = usePersonnel();
  const { member, setMember } = useIssueCart();
  const [search, setSearch] = useState("");

  // Auto-select preselected member
  if (preselectedId && !member && members.length > 0) {
    const found = members.find((m) => m.id === preselectedId);
    if (found) setMember(found);
  }

  const filtered = useMemo(() => {
    if (!search) return members.filter((m) => m.isActive);
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.isActive &&
        (m.firstName.toLowerCase().includes(q) ||
          m.lastName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q))
    );
  }, [members, search]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {member ? (
        <div className="bg-white rounded-xl border border-emerald-200 p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-900">
              {member.lastName}, {member.firstName}
            </p>
            <p className="text-sm text-slate-500">
              {member.email}
              {member.sizes?.shirt && ` · Shirt: ${member.sizes.shirt}`}
              {member.sizes?.boots && ` · Boots: ${member.sizes.boots}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
              Change
            </Button>
            <Button size="sm" onClick={onNext}>
              Next <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name or email..."
            className="max-w-sm"
          />
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => setMember(m)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <span className="font-medium text-slate-900">
                  {m.lastName}, {m.firstName}
                </span>
                <span className="text-sm text-slate-500 ml-3">
                  {m.email}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">
                No members found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GearStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { items, loading } = useInventory();
  const { cartItems, addItem, removeItem, member } = useIssueCart();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const teamItems = useMemo(() => {
    let filtered = items.filter((i) => i.isIssuedByTeam && i.isActive);
    if (category !== "all") filtered = filtered.filter((i) => i.category === category);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((i) => i.name.toLowerCase().includes(q));
    }
    return filtered;
  }, [items, search, category]);

  if (loading) return <Spinner />;

  const cartItemKeys = new Set(cartItems.map((c) => `${c.itemId}::${c.size}`));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search gear..." className="w-64" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </Button>
          <Button onClick={onNext} disabled={cartItems.length === 0}>
            Review ({cartItems.length}) <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      <Tabs tabs={CATEGORY_TABS} active={category} onChange={setCategory} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Size</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Stock</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody>
            {teamItems.map((item) => (
              <GearRow
                key={item.id}
                item={item}
                member={member}
                inCart={cartItemKeys}
                onAdd={(cartItem) => addItem(cartItem)}
                onRemove={(size) => removeItem(item.id, size)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GearRow({
  item,
  member,
  inCart,
  onAdd,
  onRemove,
}: {
  item: Item;
  member: Personnel | null;
  inCart: Set<string>;
  onAdd: (cartItem: CartItem) => void;
  onRemove: (size: string | null) => void;
}) {
  const sizes = Object.entries(item.sizeMap || {}).sort(([a], [b]) =>
    compareSizes(a, b),
  );
  const [selectedSize, setSelectedSize] = useState(() => {
    // Pre-fill from member sizes
    if (member?.sizes) {
      const cat = item.category;
      let preferred: string | undefined;
      if (cat === "boots") preferred = member.sizes.boots ?? undefined;
      else if (cat === "bdus" && item.name.toLowerCase().includes("pant"))
        preferred = member.sizes.pants ?? undefined;
      else if (item.name.toLowerCase().includes("glove"))
        preferred = member.sizes.gloves ?? undefined;
      else if (cat === "helmet") preferred = member.sizes.helmet ?? undefined;
      else preferred = member.sizes.shirt ?? undefined;

      if (preferred && sizes.some(([s]) => s === preferred)) return preferred;
    }
    // Prefer the first in-stock size in canonical sort order. Fall back to
    // first sorted entry if nothing has stock (backorder flow activates).
    const firstInStock = sizes.find(([, s]) => safeQty(s?.qty) > 0);
    return firstInStock?.[0] ?? sizes[0]?.[0] ?? "one-size";
  });

  const stock = safeQty(item.sizeMap?.[selectedSize]?.qty);
  const cartKey = `${item.id}::${selectedSize}`;
  const isInCart = inCart.has(cartKey);

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-3 min-w-0">
        <span className="font-medium text-slate-900 block truncate">{item.name}</span>
        {(() => {
          const subtitle = subtitleFromItem(item);
          return subtitle ? (
            <span className="text-xs text-slate-500 block truncate mt-0.5">
              {subtitle}
            </span>
          ) : null;
        })()}
        {item.notes && <span className="text-xs text-slate-400 block truncate">{item.notes}</span>}
      </td>
      <td className="px-4 py-3">
        {sizes.length > 1 ? (
          <select
            value={selectedSize}
            onChange={(e) => setSelectedSize(e.target.value)}
            className="px-2 py-1 text-sm border border-slate-300 rounded-lg"
          >
            {sizes.map(([s, v]) => (
              <option key={s} value={s}>
                {s} ({safeQty((v as { qty?: unknown }).qty)})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-600">{sizes[0]?.[0] ?? "one-size"}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm ${stock <= 0 ? "text-red-600" : stock <= 5 ? "text-amber-600" : "text-slate-600"}`}>
          {stock}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {isInCart ? (
          <Button variant="ghost" size="sm" onClick={() => onRemove(selectedSize)}>
            <Trash2 size={14} className="text-red-500" />
          </Button>
        ) : (
          <Button
            variant={stock <= 0 ? "secondary" : "primary"}
            size="sm"
            onClick={() =>
              onAdd({
                itemId: item.id,
                itemName: item.name,
                size: selectedSize,
                qty: 1,
                isBackorder: stock <= 0,
                qtyBefore: stock,
              })
            }
          >
            {stock <= 0 ? "Backorder" : "Add"}
          </Button>
        )}
      </td>
    </tr>
  );
}

function ReviewStep({
  notes,
  setNotes,
  onBack,
  onCommit,
  submitting,
}: {
  notes: string;
  setNotes: (v: string) => void;
  onBack: () => void;
  onCommit: () => void;
  submitting: boolean;
}) {
  const { cartItems, member, removeItem, updateItemQty } = useIssueCart();
  const issueItems = cartItems.filter((i) => !i.isBackorder);
  const backorderItems = cartItems.filter((i) => i.isBackorder);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </Button>
      </div>

      {/* Member summary */}
      {member && (
        <div className="bg-slate-50 rounded-lg p-4">
          <p className="text-sm text-slate-500">Issuing to</p>
          <p className="font-medium text-slate-900">
            {member.lastName}, {member.firstName} — {member.email}
          </p>
        </div>
      )}

      {/* Issue items */}
      {issueItems.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="font-semibold text-sm text-slate-700">
              Items to Issue ({issueItems.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {issueItems.map((item) => (
              <div key={`${item.itemId}::${item.size}`} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-900">{item.itemName}</span>
                  {item.size && <span className="text-sm text-slate-500 ml-2">({item.size})</span>}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    value={item.qty}
                    onChange={(e) => updateItemQty(item.itemId, item.size, parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-sm text-center border border-slate-300 rounded-lg"
                  />
                  <button onClick={() => removeItem(item.itemId, item.size)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backorder items */}
      {backorderItems.length > 0 && (
        <div className="bg-white rounded-xl border border-purple-200">
          <div className="px-4 py-3 border-b border-purple-100 flex items-center gap-2">
            <AlertTriangle size={14} className="text-purple-500" />
            <h3 className="font-semibold text-sm text-purple-700">
              Backordered ({backorderItems.length})
            </h3>
          </div>
          <div className="divide-y divide-purple-50">
            {backorderItems.map((item) => (
              <div key={`${item.itemId}::${item.size}`} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-slate-900">{item.itemName}</span>
                  {item.size && <span className="text-sm text-slate-500 ml-2">({item.size})</span>}
                  <Badge variant="backorder" className="ml-2">Backorder</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    value={item.qty}
                    onChange={(e) => updateItemQty(item.itemId, item.size, parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-sm text-center border border-slate-300 rounded-lg"
                  />
                  <button onClick={() => removeItem(item.itemId, item.size)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
          placeholder="Any notes about this issue..."
        />
      </div>

      {/* Commit */}
      <div className="flex justify-end">
        <Button onClick={onCommit} disabled={submitting || cartItems.length === 0} size="lg">
          {submitting ? "Processing..." : `Confirm Issue (${cartItems.length} items)`}
        </Button>
      </div>
    </div>
  );
}
