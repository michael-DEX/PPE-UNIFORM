import { useState, useMemo, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp, collection, query, where } from "firebase/firestore";
import { UserPlus, ArrowRight, Check, ChevronDown, ChevronRight, Cloud, Loader2, Plus, X } from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import { commitIssue } from "../../lib/issueCommit";
import { IssueCartProvider, useIssueCart } from "./IssueCartContext";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import { getCategoryLabel } from "../../constants/catalogCategories";
import type { Personnel, TeamRole, Item, CartItem } from "../../types";

const ROLES: { value: TeamRole; label: string }[] = [
  { value: "rescue_specialist", label: "Rescue Specialist" },
  { value: "search_specialist", label: "Search Specialist" },
  { value: "medical_specialist", label: "Medical Specialist" },
  { value: "logistics_specialist", label: "Logistics Specialist" },
  { value: "task_force_leader", label: "Task Force Leader" },
  { value: "k9_specialist", label: "K9 Specialist" },
];

export default function OnboardingPage() {
  return (
    <IssueCartProvider>
      <OnboardingFlow />
    </IssueCartProvider>
  );
}

function OnboardingFlow() {
  const { logisticsUser } = useAuthContext();
  const { items: firestoreItems, loading: itemsLoading } = useInventory();
  const { cartItems, member, setMember, loadTemplate, clearCart, addItem, removeItem, updateItemQty, toggleBackorder } = useIssueCart();
  const navigate = useNavigate();
  const { draftId } = useParams<{ draftId?: string }>();
  const [searchParams] = useSearchParams();
  const memberParam = searchParams.get("member");
  const [step, setStep] = useState(0); // 0=member, 1=review cart, 2=done
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [draftDocId, setDraftDocId] = useState<string | null>(draftId ?? null);
  const [draftLoaded, setDraftLoaded] = useState(!draftId); // true if no draft to load
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [alreadyIssued, setAlreadyIssued] = useState<Map<string, number>>(new Map());

  // New member form state
  const [form, setForm] = useState({
    firstName: "", lastName: "", rank: "",
    role: "rescue_specialist" as TeamRole, email: "", phone: "",
    shirt: "", pants: "", boots: "", helmet: "", gloves: "",
  });

  // Load existing member from ?member= param — skip step 1, go straight to gear
  useEffect(() => {
    if (!memberParam || draftId) return; // draftId takes priority
    (async () => {
      const memberSnap = await getDoc(doc(db, "personnel", memberParam));
      if (memberSnap.exists()) {
        const memberData = { id: memberSnap.id, ...memberSnap.data() } as Personnel;
        setMember(memberData);
        // Pre-fill form from member data
        setForm({
          firstName: memberData.firstName,
          lastName: memberData.lastName,
          rank: memberData.rank ?? "",
          role: (memberData.role ?? "rescue_specialist") as TeamRole,
          email: memberData.email,
          phone: memberData.phone ?? "",
          shirt: memberData.sizes?.shirt ?? "",
          pants: memberData.sizes?.pants ?? "",
          boots: memberData.sizes?.boots ?? "",
          helmet: memberData.sizes?.helmet ?? "",
          gloves: memberData.sizes?.gloves ?? "",
        });
        // Load gear template
        loadTemplate(firestoreItems, memberData);

        // Check what's already been issued to this member
        const txSnap = await getDocs(
          query(collection(db, "transactions"), where("personnelId", "==", memberParam))
        );
        const issued = new Map<string, number>();
        txSnap.docs.forEach((d) => {
          const tx = d.data();
          (tx.items || []).forEach((ti: { itemId: string; qtyIssued: number; isBackorder?: boolean }) => {
            if (!ti.isBackorder) {
              issued.set(ti.itemId, (issued.get(ti.itemId) || 0) + ti.qtyIssued);
            }
          });
        });
        setAlreadyIssued(issued);

        setStep(1);
      }
    })();
  }, [memberParam, firestoreItems.length]);

  // Load draft from Firestore if draftId is in URL
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const snap = await getDoc(doc(db, "onboarding_drafts", draftId));
      if (snap.exists()) {
        const data = snap.data();
        setForm(data.form as typeof form);
        setStep(data.step ?? 0);
        setNotes(data.notes ?? "");
        setDraftDocId(draftId);
        // Restore member
        if (data.memberId) {
          const memberSnap = await getDoc(doc(db, "personnel", data.memberId));
          if (memberSnap.exists()) {
            setMember({ id: memberSnap.id, ...memberSnap.data() } as Personnel);
          }
        }
        // Restore cart
        clearCart();
        if (data.cartItems) {
          for (const ci of data.cartItems) addItem(ci);
        }
      }
      setDraftLoaded(true);
    })();
  }, [draftId]);

  // Auto-save draft to Firestore (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftToFirestore = useCallback(() => {
    if (!logisticsUser || step >= 2) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      const draftData = {
        memberName: form.firstName && form.lastName ? `${form.lastName}, ${form.firstName}` : "",
        memberId: member?.id ?? null,
        form,
        step,
        notes,
        cartItems,
        createdBy: logisticsUser.id,
        updatedAt: serverTimestamp(),
        completedAt: null,
      };
      try {
        if (draftDocId) {
          await updateDoc(doc(db, "onboarding_drafts", draftDocId), draftData);
        } else if (form.firstName || form.lastName) {
          const ref = doc(collection(db, "onboarding_drafts"));
          await setDoc(ref, { ...draftData, createdAt: serverTimestamp() });
          setDraftDocId(ref.id);
        }
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1000);
  }, [logisticsUser, form, step, notes, member, cartItems, draftDocId]);

  useEffect(() => {
    saveDraftToFirestore();
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [form, step, notes, member?.id, cartItems]);

  function update(f: string, v: string) {
    setForm((p) => ({ ...p, [f]: v }));
  }

  async function handleCreateMember(e: FormEvent) {
    e.preventDefault();
    if (!logisticsUser) return;

    const ref = doc(collection(db, "personnel"));
    const newMember: Personnel = {
      id: ref.id,
      firstName: form.firstName,
      lastName: form.lastName,
      rank: form.rank || undefined,
      role: form.role || undefined,
      email: form.email,
      phone: form.phone || undefined,
      isActive: true,
      joinDate: serverTimestamp() as any,
      sizes: {
        shirt: form.shirt || undefined,
        pants: form.pants || undefined,
        boots: form.boots || undefined,
        helmet: form.helmet || undefined,
        gloves: form.gloves || undefined,
      },
      createdAt: serverTimestamp() as any,
      createdBy: logisticsUser.id,
    };

    await setDoc(ref, {
      firstName: form.firstName,
      lastName: form.lastName,
      rank: form.rank || null,
      role: form.role || null,
      email: form.email,
      phone: form.phone || null,
      isActive: true,
      joinDate: serverTimestamp(),
      sizes: {
        shirt: form.shirt || null,
        pants: form.pants || null,
        boots: form.boots || null,
        helmet: form.helmet || null,
        gloves: form.gloves || null,
      },
      createdAt: serverTimestamp(),
      createdBy: logisticsUser.id,
    });

    // Load onboarding template into cart
    loadTemplate(firestoreItems, newMember);
    setStep(1);
  }

  // Only items with qty > 0 will be issued
  const issuableItems = useMemo(
    () => cartItems.filter((i) => i.qty > 0 && (i.size || !i.needsSize)),
    [cartItems]
  );

  async function handleCommit() {
    if (!logisticsUser || !member || issuableItems.length === 0) return;
    setSubmitting(true);
    try {
      // Recalculate stock before for each item
      const itemsWithStock = issuableItems.map((ci) => {
        const fsItem = firestoreItems.find((i) => i.id === ci.itemId);
        const stock = fsItem?.sizeMap?.[ci.size ?? ""]?.qty ?? 0;
        return {
          ...ci,
          qtyBefore: stock,
          isBackorder: stock < ci.qty,
        };
      });

      const txId = await commitIssue({
        actor: logisticsUser,
        member,
        items: itemsWithStock,
        type: "onboarding_issue",
        notes: notes || undefined,
        sourceForm: "ipad_onboarding",
      });
      // Mark draft as completed
      if (draftDocId) {
        await updateDoc(doc(db, "onboarding_drafts", draftDocId), { completedAt: serverTimestamp() }).catch(() => {});
      }
      setSuccess(txId);
      setStep(2);
    } catch (err) {
      console.error("Onboarding issue failed:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (itemsLoading) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  if (success) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Onboarding Complete</h2>
        <p className="text-sm text-slate-500 mt-1">
          {member?.firstName} {member?.lastName} has been onboarded.
        </p>
        <p className="text-xs text-slate-400 mt-1">Transaction: {success}</p>
        <div className="flex gap-3 mt-6">
          <Button variant="secondary" onClick={() => { clearCart(); setSuccess(null); setStep(0); setNotes(""); setDraftDocId(null); setForm({ firstName: "", lastName: "", rank: "", role: "rescue_specialist", email: "", phone: "", shirt: "", pants: "", boots: "", helmet: "", gloves: "" }); navigate("/logistics/onboarding"); }}>
            Onboard Another
          </Button>
          <Button onClick={() => navigate("/logistics")}>Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6 space-y-4">
      {!draftLoaded && (
        <div className="flex justify-center py-16"><Spinner /></div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-navy-900 truncate">New Member Onboarding</h1>
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600">
              <Cloud size={12} />
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === 0 ? "bg-navy-700 text-white" : "bg-emerald-100 text-emerald-700"}`}>
            {step > 0 ? <Check size={14} /> : "1"}
          </div>
          <span className="text-xs md:text-sm text-slate-400">Member Info</span>
          <div className="w-4 md:w-8 h-px bg-slate-200" />
          <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === 1 ? "bg-navy-700 text-white" : step > 1 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
            {step > 1 ? <Check size={14} /> : "2"}
          </div>
          <span className="text-xs md:text-sm text-slate-400">Review Gear</span>
        </div>
      </div>

      {step === 0 && (
        <form onSubmit={handleCreateMember} className="bg-white rounded-xl border border-slate-200 p-4 md:p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">
            <UserPlus size={18} className="inline mr-2" />
            New Member Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">First Name *</label>
              <input type="text" required value={form.firstName} onChange={(e) => update("firstName", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Last Name *</label>
              <input type="text" required value={form.lastName} onChange={(e) => update("lastName", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rank</label>
              <input type="text" value={form.rank} onChange={(e) => update("rank", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={form.role} onChange={(e) => update("role", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500">
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Sizes (pre-fills gear template)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Shirt</label>
                <input type="text" value={form.shirt} onChange={(e) => update("shirt", e.target.value)} placeholder="L" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Pants</label>
                <input type="text" value={form.pants} onChange={(e) => update("pants", e.target.value)} placeholder="34x32" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Boots</label>
                <input type="text" value={form.boots} onChange={(e) => update("boots", e.target.value)} placeholder="10.5 M" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Helmet</label>
                <input type="text" value={form.helmet} onChange={(e) => update("helmet", e.target.value)} placeholder="M/L" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Gloves</label>
                <input type="text" value={form.gloves} onChange={(e) => update("gloves", e.target.value)} placeholder="L" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit">
              Create Member & Load Gear Template <ArrowRight size={14} />
            </Button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {member && (() => {
            const filledCount = cartItems.filter((i) => i.qty > 0).length;
            const total = cartItems.length;
            const pct = total > 0 ? Math.round((filledCount / total) * 100) : 0;
            return (
              <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-700">
                    Onboarding <strong>{member.firstName} {member.lastName}</strong>
                  </p>
                  <span className={`text-sm font-semibold ${pct === 100 ? "text-emerald-600" : "text-slate-700"}`}>
                    {filledCount} / {total} items ({pct}%)
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Enter qty and size for each item to issue. Items left at 0 will be skipped.
                </p>
              </div>
            );
          })()}

          <GearTable
            cartItems={cartItems}
            firestoreItems={firestoreItems}
            addItem={addItem}
            removeItem={removeItem}
            updateItemQty={updateItemQty}
            toggleBackorder={toggleBackorder}
            alreadyIssued={alreadyIssued}
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs md:text-sm text-slate-500">
              {issuableItems.length} item{issuableItems.length !== 1 ? "s" : ""} will be issued
              {cartItems.some((i) => i.qty > 0 && i.needsSize && !i.size) && (
                <span className="text-amber-600 ml-2">-- some items need a size</span>
              )}
            </p>
            <Button onClick={handleCommit} disabled={submitting || issuableItems.length === 0} size="lg" className="w-full sm:w-auto">
              {submitting ? "Processing..." : `Confirm Onboarding (${issuableItems.length} items)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category-grouped gear table ──

const CATEGORY_ORDER = [
  "packs-bags",
  "patches",
  "footwear",
  "clothing-bdus",
  "clothing-shirts",
  "clothing-outerwear",
  "clothing-headwear",
  "clothing-personal",
  "ppe-equipment",
  "head-protection",
  "sleep-system",
  "personal-items",
  // Fallbacks for items using old category IDs
  "bags", "boots", "bdus", "clothing", "ppe", "helmet", "sleeping", "personal",
];

function GearTable({
  cartItems,
  firestoreItems,
  addItem,
  removeItem,
  updateItemQty,
  toggleBackorder,
  alreadyIssued,
}: {
  cartItems: CartItem[];
  firestoreItems: Item[];
  addItem: (item: CartItem) => void;
  removeItem: (itemId: string, size: string | null) => void;
  updateItemQty: (itemId: string, size: string | null, qty: number) => void;
  toggleBackorder: (itemId: string, size: string | null) => void;
  alreadyIssued: Map<string, number>;
}) {
  // Group items by category
  const grouped = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const ci of cartItems) {
      const fsItem = firestoreItems.find((i) => i.id === ci.itemId);
      const cat = fsItem?.catalogCategory ?? fsItem?.category ?? "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ci);
    }
    // Sort groups by CATEGORY_ORDER
    const sorted: [string, CartItem[]][] = [];
    for (const cat of CATEGORY_ORDER) {
      if (map.has(cat)) {
        sorted.push([cat, map.get(cat)!]);
        map.delete(cat);
      }
    }
    // Any remaining categories not in the order
    for (const [cat, items] of map) {
      sorted.push([cat, items]);
    }
    return sorted;
  }, [cartItems, firestoreItems]);

  // Start all sections collapsed
  const allCats = useMemo(() => grouped.map(([cat]) => cat), [grouped]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(allCats));

  function toggleSection(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {grouped.map(([cat, items]) => {
        const isOpen = !collapsed.has(cat);
        const filledCount = items.filter((i) => i.qty > 0).length;

        return (
          <div key={cat} className="bg-white rounded-xl border border-slate-200">
            {/* Category header — clickable */}
            <button
              onClick={() => toggleSection(cat)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors rounded-t-xl"
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  {getCategoryLabel(cat)}
                </h3>
                <span className="text-xs text-slate-400">({items.length})</span>
              </div>
              {filledCount > 0 && (
                <span className="text-xs font-medium text-emerald-600">{filledCount} filled</span>
              )}
            </button>
            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="border-b border-slate-100 border-t border-slate-200">
                      <th className="text-left px-3 md:px-4 py-2 text-xs font-medium text-slate-400">Item</th>
                      <th className="text-center px-2 py-2 text-xs font-medium text-slate-400 w-16 md:w-20">Req</th>
                      <th className="text-left px-2 py-2 text-xs font-medium text-slate-400 w-28 md:w-32">Size</th>
                      <th className="text-center px-2 py-2 text-xs font-medium text-slate-400 w-16 md:w-20">Qty</th>
                      <th className="text-center px-2 py-2 text-xs font-medium text-slate-400 w-12 md:w-14">BO</th>
                      <th className="w-8 md:w-10 px-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(() => {
                      // Group items by itemId so multi-size entries render together
                      const groups: CartItem[][] = [];
                      const groupMap = new Map<string, CartItem[]>();
                      for (const ci of items) {
                        if (!groupMap.has(ci.itemId)) {
                          const arr: CartItem[] = [];
                          groupMap.set(ci.itemId, arr);
                          groups.push(arr);
                        }
                        groupMap.get(ci.itemId)!.push(ci);
                      }
                      return groups.map((entries) => (
                        <GearItemGroup
                          key={entries[0].itemId}
                          entries={entries}
                          fsItem={firestoreItems.find((i) => i.id === entries[0].itemId)}
                          addItem={addItem}
                          removeItem={removeItem}
                          updateItemQty={updateItemQty}
                          toggleBackorder={toggleBackorder}
                          issuedQty={alreadyIssued.get(entries[0].itemId) ?? 0}
                        />
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GearItemGroup({
  entries,
  fsItem,
  addItem,
  removeItem,
  updateItemQty,
  toggleBackorder,
  issuedQty,
}: {
  entries: CartItem[];
  fsItem: Item | undefined;
  addItem: (item: CartItem) => void;
  removeItem: (itemId: string, size: string | null) => void;
  updateItemQty: (itemId: string, size: string | null, qty: number) => void;
  toggleBackorder: (itemId: string, size: string | null) => void;
  issuedQty: number;
}) {
  const allSizes = Object.keys(fsItem?.sizeMap || {}).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
  const primary = entries[0];
  const hasUnsizedEntry = entries.some((e) => e.needsSize && !e.size);

  function handleAddSize() {
    addItem({
      itemId: primary.itemId,
      itemName: primary.itemName,
      size: null,
      qty: 0,
      isBackorder: false,
      qtyBefore: 0,
      needsSize: true,
      suggestedQty: undefined,
    });
  }

  return (
    <>
      {entries.map((item, idx) => {
        const isPrimary = idx === 0;
        const hasStock = item.size ? (fsItem?.sizeMap?.[item.size]?.qty ?? 0) : 0;
        // Filter out sizes already used by other entries in this group
        const otherUsedSizes = new Set(
          entries.filter((e) => e !== item).map((e) => e.size).filter(Boolean),
        );
        const selectableSizes = allSizes.filter((s) => !otherUsedSizes.has(s));

        return (
          <tr
            key={`${item.itemId}::${item.size ?? idx}`}
            className={`transition-colors ${item.qty > 0 ? "" : "opacity-50"} ${
              isPrimary ? "hover:bg-slate-50" : "hover:bg-slate-50 bg-slate-50/50"
            }`}
          >
            {/* Item name — only on primary row */}
            <td className="px-3 md:px-4 py-2">
              {isPrimary ? (
                <>
                  <span className={`font-medium ${issuedQty > 0 ? "text-slate-500" : "text-slate-900"}`}>
                    {item.itemName}
                  </span>
                  {issuedQty > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-medium">
                      Issued: {issuedQty}
                    </span>
                  )}
                  {item.qty > 0 && hasStock < item.qty && item.size && issuedQty === 0 && (
                    <span className="ml-2 text-xs text-amber-600">
                      {hasStock === 0 ? "Out of stock" : `Only ${hasStock} in stock`}
                    </span>
                  )}
                </>
              ) : (
                <span className="pl-3 text-xs text-slate-400 border-l-2 border-slate-200">
                  {item.size ? "" : "Select size..."}
                  {item.qty > 0 && hasStock < item.qty && item.size && (
                    <span className="text-amber-600">
                      {hasStock === 0 ? "Out of stock" : `Only ${hasStock}`}
                    </span>
                  )}
                </span>
              )}
            </td>

            {/* Suggested qty — only on primary row */}
            <td className="px-2 py-2 text-center">
              {isPrimary && <span className="text-xs text-slate-400">{item.suggestedQty ?? 1}</span>}
            </td>

            {/* Size selector */}
            <td className="px-2 py-2">
              {item.needsSize ? (
                selectableSizes.length > 0 ? (
                  <select
                    value={item.size ?? ""}
                    onChange={(e) => {
                      removeItem(item.itemId, item.size);
                      const newSize = e.target.value;
                      const stock = fsItem?.sizeMap?.[newSize]?.qty ?? 0;
                      addItem({
                        ...item,
                        size: newSize || null,
                        qtyBefore: stock,
                        isBackorder: item.qty > 0 && stock < item.qty,
                      });
                    }}
                    className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-navy-500 ${
                      !item.size && item.qty > 0 ? "border-amber-400 bg-amber-50" : "border-slate-300"
                    }`}
                  >
                    <option value="">Select size...</option>
                    {selectableSizes.map((s) => (
                      <option key={s} value={s}>
                        {s} ({fsItem?.sizeMap?.[s]?.qty ?? 0} avail)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={item.size ?? ""}
                    onChange={(e) => {
                      removeItem(item.itemId, item.size);
                      addItem({ ...item, size: e.target.value.toUpperCase() || null });
                    }}
                    placeholder="Enter size"
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
                  />
                )
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </td>

            {/* Qty */}
            <td className="px-2 py-2">
              <input
                type="number"
                min={0}
                value={item.qty}
                onChange={(e) => updateItemQty(item.itemId, item.size, parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-xs text-center border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500"
              />
            </td>

            {/* Backorder toggle */}
            <td className="px-2 py-2 text-center">
              {item.qty > 0 && (
                <input
                  type="checkbox"
                  checked={item.isBackorder}
                  onChange={() => toggleBackorder(item.itemId, item.size)}
                  title="Mark as backorder"
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
              )}
            </td>

            {/* Action: "+" on primary for sized items, "×" on sub-rows */}
            <td className="px-2 py-2">
              {isPrimary && item.needsSize ? (
                <button
                  onClick={handleAddSize}
                  disabled={hasUnsizedEntry}
                  title="Add another size"
                  className={`p-1 rounded transition-colors ${
                    hasUnsizedEntry
                      ? "text-slate-200 cursor-not-allowed"
                      : "text-slate-400 hover:text-navy-600 hover:bg-navy-50"
                  }`}
                >
                  <Plus size={14} />
                </button>
              ) : !isPrimary ? (
                <button
                  onClick={() => removeItem(item.itemId, item.size)}
                  title="Remove this size"
                  className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              ) : (
                <button
                  onClick={() => removeItem(item.itemId, item.size)}
                  className="text-slate-300 hover:text-red-500 transition-colors"
                >
                  &times;
                </button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
