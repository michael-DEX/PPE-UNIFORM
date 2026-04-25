import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
} from "firebase/firestore";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Cloud,
  Loader2,
  Check,
  ArrowRight,
  UserPlus,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import { commitIssue } from "../../lib/issueCommit";
import { IssueCartProvider, useIssueCart } from "./IssueCartContext";
import OnboardingItemCard from "./OnboardingItemCard";
import {
  groupByCategory,
  getRowState,
  type CategoryFilter,
  type RowState,
} from "./onboardingRowState";
import { getCategoryLabel } from "../../constants/catalogCategories";
import Spinner from "../../components/ui/Spinner";
import Button from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import type { Personnel, Item, CartItem } from "../../types";

export default function OnboardingPage() {
  return (
    <IssueCartProvider>
      <OnboardingFlow />
    </IssueCartProvider>
  );
}

function OnboardingFlow() {
  const { logisticsUser } = useAuthContext();
  const toast = useToast();
  const { items: firestoreItems, loading: itemsLoading } = useInventory();
  const {
    cartItems,
    member,
    setMember,
    loadTemplate,
    clearCart,
    addItem,
    removeItem,
    updateItemQty,
    toggleBackorder,
  } = useIssueCart();

  const navigate = useNavigate();
  const { draftId } = useParams<{ draftId?: string }>();
  const [searchParams] = useSearchParams();
  const memberParam = searchParams.get("member");

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [draftDocId, setDraftDocId] = useState<string | null>(draftId ?? null);
  const [draftLoaded, setDraftLoaded] = useState(!draftId);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [alreadyIssued, setAlreadyIssued] = useState<Map<string, number>>(
    new Map(),
  );
  const [alreadyIssuedDates, setAlreadyIssuedDates] = useState<
    Map<string, Date>
  >(new Map());

  // Step 0 narrowed from 11 fields (First/Last/Email/Phone/Rank/Role + 5 sizes)
  // down to 3. The dropped 8 fields are stubbed with empty strings when writing
  // drafts so the OnboardingDraft.form type stays valid and legacy drafts still
  // load without a migration.
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  // Tracks which cards the user has EXPLICITLY collapsed via the Done
  // button (or the ChevronUp affordance). Default behavior: cards render
  // expanded. A card collapses only when the user opts in, and re-expands
  // when the user taps the collapsed card or otherwise toggles. Inverted
  // from the previous `expandedIds` design, which required every code
  // path that surfaces a ready row to remember to add the id — easy to
  // miss (e.g., cart loaded from a prior session, one-size add via qty
  // stepper). By tracking only explicit user collapses, nothing auto-
  // collapses and there's nothing to forget.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);
  const [prevIssuedOpen, setPrevIssuedOpen] = useState(false);

  const fsItemsById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of firestoreItems) m.set(it.id, it);
    return m;
  }, [firestoreItems]);

  // ── Deep link: `?member=<id>` pre-fills + jumps to step 1 ───────────────
  useEffect(() => {
    if (!memberParam || draftId) return;
    (async () => {
      const memberSnap = await getDoc(doc(db, "personnel", memberParam));
      if (!memberSnap.exists()) return;
      const memberData = {
        id: memberSnap.id,
        ...memberSnap.data(),
      } as Personnel;
      setMember(memberData);
      setForm({
        firstName: memberData.firstName,
        lastName: memberData.lastName,
        email: memberData.email,
      });
      loadTemplate(firestoreItems, memberData);

      // Pull every prior transaction for this member to build the
      // "previouslyIssued" counts + latest-issued-date map the cards consume.
      const txSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("personnelId", "==", memberParam),
        ),
      );
      const issued = new Map<string, number>();
      const dates = new Map<string, Date>();
      txSnap.docs.forEach((d) => {
        const tx = d.data();
        const ts: Date | null = tx.timestamp?.toDate?.() ?? null;
        (tx.items || []).forEach(
          (ti: {
            itemId: string;
            qtyIssued: number;
            isBackorder?: boolean;
          }) => {
            if (ti.isBackorder) return;
            issued.set(
              ti.itemId,
              (issued.get(ti.itemId) || 0) + ti.qtyIssued,
            );
            if (ts) {
              const existing = dates.get(ti.itemId);
              if (!existing || ts > existing) dates.set(ti.itemId, ts);
            }
          },
        );
      });
      setAlreadyIssued(issued);
      setAlreadyIssuedDates(dates);
      setStep(1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberParam, firestoreItems.length]);

  // ── Draft resume: `/onboarding/<draftId>` ──────────────────────────────
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const snap = await getDoc(doc(db, "onboarding_drafts", draftId));
      if (snap.exists()) {
        const data = snap.data();
        // Only the 3 active fields are pulled into form state. Legacy fields
        // (phone/rank/role/shirt/pants/boots/helmet/gloves) are ignored even
        // if they exist on the stored doc.
        setForm({
          firstName: data.form?.firstName ?? "",
          lastName: data.form?.lastName ?? "",
          email: data.form?.email ?? "",
        });
        setStep(data.step ?? 0);
        setNotes(data.notes ?? "");
        setDraftDocId(draftId);
        if (data.memberId) {
          const memberSnap = await getDoc(doc(db, "personnel", data.memberId));
          if (memberSnap.exists()) {
            setMember({
              id: memberSnap.id,
              ...memberSnap.data(),
            } as Personnel);
          }
        }
        clearCart();
        if (data.cartItems) {
          for (const ci of data.cartItems) addItem(ci);
        }
      }
      setDraftLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // ── Debounced draft autosave ───────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftToFirestore = useCallback(() => {
    if (!logisticsUser || step >= 2) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      const draftData = {
        memberName:
          form.firstName && form.lastName
            ? `${form.lastName}, ${form.firstName}`
            : "",
        memberId: member?.id ?? null,
        // Write the legacy 11-field shape for backward compat — stub the
        // removed fields with empty strings so OnboardingDraft.form stays
        // type-valid without needing a schema migration.
        form: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          rank: "",
          role: "",
          phone: "",
          shirt: "",
          pants: "",
          boots: "",
          helmet: "",
          gloves: "",
        },
        step,
        notes,
        cartItems,
        createdBy: logisticsUser.id,
        updatedAt: serverTimestamp(),
        completedAt: null,
      };
      try {
        if (draftDocId) {
          await updateDoc(
            doc(db, "onboarding_drafts", draftDocId),
            draftData,
          );
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
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, step, notes, member?.id, cartItems]);

  // ── Form update helper ────────────────────────────────────────────────
  function update<K extends "firstName" | "lastName" | "email">(
    field: K,
    value: string,
  ) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  // ── Create member + load template (step 0 submit) ─────────────────────
  async function handleCreateMember(e: FormEvent) {
    e.preventDefault();
    if (!logisticsUser) return;

    const ref = doc(collection(db, "personnel"));
    await setDoc(ref, {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      isActive: true,
      joinDate: serverTimestamp(),
      sizes: {},
      createdAt: serverTimestamp(),
      createdBy: logisticsUser.id,
    });

    const newMember: Personnel = {
      id: ref.id,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      isActive: true,
      joinDate: serverTimestamp() as unknown as Personnel["joinDate"],
      sizes: {},
      createdAt: serverTimestamp() as unknown as Personnel["createdAt"],
      createdBy: logisticsUser.id,
    };

    loadTemplate(firestoreItems, newMember);
    setStep(1);
  }

  // ── Commit handler (unchanged signature to commitIssue) ───────────────
  const issuableItems = useMemo(
    () => cartItems.filter((i) => i.qty > 0 && (i.size || !i.needsSize)),
    [cartItems],
  );

  async function handleCommit() {
    if (!logisticsUser || !member || issuableItems.length === 0) return;
    setSubmitting(true);
    try {
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

      if (draftDocId) {
        await updateDoc(doc(db, "onboarding_drafts", draftDocId), {
          completedAt: serverTimestamp(),
        }).catch(() => {});
      }
      setSuccess(txId);
      setStep(2);
    } catch (err) {
      console.error("Onboarding issue failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to complete onboarding issue.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Per-row handlers for OnboardingItemCard ───────────────────────────
  //
  // Card's onSizeChange needs a remove+add because IssueCartContext keys
  // rows by (itemId, size). We preserve qty (or bump from 0 → suggestedQty)
  // and recompute qtyBefore from the new size's stock. Mirrors the legacy
  // OnboardingPage:697-708 size-change logic.
  function handleSizeChange(
    row: CartItem,
    fsItem: Item | undefined,
    newSize: string | null,
  ) {
    if (newSize === row.size) return;
    removeItem(row.itemId, row.size);
    const stock =
      newSize && fsItem?.sizeMap?.[newSize]?.qty != null
        ? fsItem.sizeMap[newSize].qty
        : 0;
    const nextQty = row.qty > 0 ? row.qty : (row.suggestedQty ?? 1);
    addItem({
      ...row,
      size: newSize,
      qty: nextQty,
      qtyBefore: stock,
      isBackorder: row.isBackorder,
    });
    // No expand-set needed here: cards default to expanded under the
    // inverted `collapsedIds` model. Size-select never collapses.
  }

  // Toggles whether a given card is user-collapsed. Wired to the card's
  // `onExpand` prop (which is also its onCollapse — the card treats the
  // single callback as a flip-between-states signal). The card doesn't
  // know or care that the parent now tracks collapsed-ness instead of
  // expanded-ness; it just calls the toggle on user interaction.
  function toggleRowCollapsed(itemId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // ── Derived state for step 1 rendering ────────────────────────────────

  const groups = useMemo(
    () => groupByCategory(cartItems, firestoreItems, alreadyIssued),
    [cartItems, firestoreItems, alreadyIssued],
  );

  // Separate previously-issued rows into their own bottom section. Each
  // activeGroup carries only its "current session" rows so the progress
  // count only tracks new work, not legacy.
  const activeGroups = useMemo(
    () =>
      groups
        .filter((g) => !g.allPreviouslyIssued)
        .map((g) => {
          const rows = g.rows.filter((row) => {
            const fs = fsItemsById.get(row.itemId);
            if (!fs) return true;
            return getRowState(row, fs, alreadyIssued) !== "previouslyIssued";
          });
          const remaining = rows.filter((row) => {
            const fs = fsItemsById.get(row.itemId);
            if (!fs) return true;
            return getRowState(row, fs, alreadyIssued) !== "ready";
          }).length;
          const readyInGroup = rows.length - remaining;
          return {
            category: g.category,
            rows,
            readyCount: readyInGroup,
            totalCount: rows.length,
            remaining,
          };
        })
        .filter((g) => g.rows.length > 0),
    [groups, fsItemsById, alreadyIssued],
  );

  const previouslyIssuedRows = useMemo(() => {
    const list: CartItem[] = [];
    for (const row of cartItems) {
      const fs = fsItemsById.get(row.itemId);
      if (!fs) continue;
      if (getRowState(row, fs, alreadyIssued) === "previouslyIssued") {
        list.push(row);
      }
    }
    return list;
  }, [cartItems, fsItemsById, alreadyIssued]);

  // Per-row state lookup used for the progress bar + footer counts.
  const rowStatesArr = useMemo(() => {
    return cartItems.map((row): { row: CartItem; state: RowState } => {
      const fs = fsItemsById.get(row.itemId);
      return {
        row,
        state: fs ? getRowState(row, fs, alreadyIssued) : "pending",
      };
    });
  }, [cartItems, fsItemsById, alreadyIssued]);

  const readyCount = rowStatesArr.filter((s) => s.state === "ready").length;
  const backorderCount = rowStatesArr.filter(
    (s) => s.state === "ready" && s.row.isBackorder,
  ).length;
  const pendingCount = rowStatesArr.filter(
    (s) => s.state === "pending" || s.state === "outOfStock",
  ).length;
  const sessionTotal = rowStatesArr.filter(
    (s) => s.state !== "previouslyIssued",
  ).length;

  const progressPct =
    sessionTotal > 0 ? Math.round((readyCount / sessionTotal) * 100) : 0;

  const hasUnsizedReady = cartItems.some(
    (r) => r.qty > 0 && r.needsSize && !r.size,
  );
  const canCommit = readyCount > 0 && !hasUnsizedReady && !submitting;

  // ── Early returns: loading / success ──────────────────────────────────

  if (itemsLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (success) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Onboarding Complete</h2>
        <p className="text-sm text-slate-500 mt-1">
          {member?.firstName} {member?.lastName} has been onboarded.
        </p>
        <p className="text-xs text-slate-400 mt-1">Transaction: {success}</p>
        <div className="flex flex-wrap gap-3 mt-6 justify-center">
          <Button
            variant="secondary"
            onClick={() => {
              clearCart();
              setSuccess(null);
              setStep(0);
              setNotes("");
              setDraftDocId(null);
              setForm({ firstName: "", lastName: "", email: "" });
              navigate("/logistics/onboarding");
            }}
            className="min-h-[48px]"
          >
            Onboard Another
          </Button>
          <Button onClick={() => navigate("/logistics")} className="min-h-[48px]">
            Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!draftLoaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  // ── Step 0 — compact 3-field member form ───────────────────────────────
  if (step === 0) {
    const canSubmit = !!(form.firstName && form.lastName && form.email);
    return (
      <div className="max-w-xl mx-auto min-h-screen flex flex-col bg-slate-50">
        <TopHeader saveStatus={saveStatus} onBack={() => navigate(-1)} />
        <main className="flex-1 p-4">
          <form
            onSubmit={handleCreateMember}
            className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4"
          >
            <div className="flex items-center gap-2">
              <UserPlus size={18} className="text-navy-600" />
              <h2 className="text-lg font-semibold text-slate-900">
                New Member Information
              </h2>
            </div>
            <div className="space-y-3">
              <Field
                label="First Name *"
                value={form.firstName}
                type="text"
                onChange={(v) => update("firstName", v)}
              />
              <Field
                label="Last Name *"
                value={form.lastName}
                type="text"
                onChange={(v) => update("lastName", v)}
              />
              <Field
                label="Email *"
                value={form.email}
                type="email"
                onChange={(v) => update("email", v)}
              />
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white font-medium text-base disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              Create Member &amp; Load Gear Template
              <ArrowRight size={16} />
            </button>
          </form>
        </main>
      </div>
    );
  }

  // ── Step 1 — gear issuance (card list) ─────────────────────────────────

  const filterPills: Array<{ id: CategoryFilter; label: string; count: number }> =
    [
      { id: "all", label: "All", count: pendingCount },
      ...activeGroups.map((g) => ({
        id: g.category,
        label: getCategoryLabel(g.category),
        count: g.remaining,
      })),
    ];

  const visibleGroups =
    categoryFilter === "all"
      ? activeGroups
      : activeGroups.filter((g) => g.category === categoryFilter);

  const notesLabel = notes.trim() ? "Notes (1 line)" : "Notes";

  return (
    <div className="max-w-xl mx-auto min-h-screen flex flex-col bg-slate-50">
      <TopHeader saveStatus={saveStatus} onBack={() => navigate(-1)} />

      {/* Person summary */}
      {member && (
        <section className="bg-white border-b border-slate-200 px-4 py-4">
          <p className="text-[15px] font-semibold text-slate-900 truncate">
            {member.lastName}, {member.firstName}
          </p>
          <p className="text-xs text-slate-500 truncate">{member.email}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  progressPct === 100 ? "bg-amber-500" : "bg-blue-800"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 tabular-nums shrink-0">
              {readyCount} / {sessionTotal}
            </span>
          </div>
        </section>
      )}

      {/* Category filter pills — sticky */}
      <nav
        aria-label="Category filter"
        className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2.5 flex gap-1.5 overflow-x-auto"
      >
        {filterPills.map((p) => {
          const isActive = categoryFilter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setCategoryFilter(p.id)}
              aria-pressed={isActive}
              className={`rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap min-h-[32px] transition-colors ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p.label} · {p.count}
            </button>
          );
        })}
      </nav>

      {/* Main scrollable content */}
      <main className="flex-1 px-4 py-3 space-y-4">
        {visibleGroups.map((group) => (
          <section key={group.category}>
            {categoryFilter === "all" && (
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium px-1 mt-1 mb-2">
                {getCategoryLabel(group.category)} · {group.readyCount}/
                {group.totalCount} ready
              </p>
            )}
            <div className="space-y-2">
              {group.rows.map((row) => {
                const fs = fsItemsById.get(row.itemId);
                if (!fs) return null;
                return (
                  <OnboardingItemCard
                    key={`${row.itemId}::${row.size ?? "null"}`}
                    row={row}
                    fsItem={fs}
                    alreadyIssuedQty={alreadyIssued.get(row.itemId) ?? 0}
                    alreadyIssuedLastDate={alreadyIssuedDates.get(row.itemId)}
                    expanded={!collapsedIds.has(row.itemId)}
                    onExpand={() => toggleRowCollapsed(row.itemId)}
                    onSizeChange={(size) => handleSizeChange(row, fs, size)}
                    onQtyChange={(qty) =>
                      updateItemQty(row.itemId, row.size, qty)
                    }
                    onToggleBackorder={() =>
                      toggleBackorder(row.itemId, row.size)
                    }
                  />
                );
              })}
            </div>
          </section>
        ))}

        {visibleGroups.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-400">
            No items match this filter.
          </div>
        )}

        {/* Previously-issued section — only under "All" filter */}
        {categoryFilter === "all" && previouslyIssuedRows.length > 0 && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => setPrevIssuedOpen((v) => !v)}
              aria-expanded={prevIssuedOpen}
              className="w-full flex items-center justify-between px-1 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider hover:text-slate-700"
            >
              <span>
                Previously issued · {previouslyIssuedRows.length} items
              </span>
              {prevIssuedOpen ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
            {prevIssuedOpen && (
              <div className="space-y-2 mt-2">
                {previouslyIssuedRows.map((row) => {
                  const fs = fsItemsById.get(row.itemId);
                  if (!fs) return null;
                  return (
                    <OnboardingItemCard
                      key={`${row.itemId}::${row.size ?? "null"}`}
                      row={row}
                      fsItem={fs}
                      alreadyIssuedQty={alreadyIssued.get(row.itemId) ?? 0}
                      alreadyIssuedLastDate={alreadyIssuedDates.get(row.itemId)}
                      expanded={!collapsedIds.has(row.itemId)}
                      onExpand={() => toggleRowCollapsed(row.itemId)}
                      onSizeChange={(size) => handleSizeChange(row, fs, size)}
                      onQtyChange={(qty) =>
                        updateItemQty(row.itemId, row.size, qty)
                      }
                      onToggleBackorder={() =>
                        toggleBackorder(row.itemId, row.size)
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Sticky footer */}
      <footer className="sticky bottom-0 bg-white border-t border-slate-200">
        {notesOpen && (
          <div className="px-4 pt-3 pb-1">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Notes (optional)"
              className="w-full text-base border border-slate-200 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>
        )}
        <div className="px-4 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 truncate">
            {readyCount} item{readyCount === 1 ? "" : "s"} · {backorderCount}{" "}
            backorder
          </span>
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            aria-expanded={notesOpen}
            className="shrink-0 text-xs font-medium text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline"
          >
            {notesLabel}
          </button>
        </div>
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={handleCommit}
            disabled={!canCommit}
            className="w-full min-h-[48px] rounded-lg bg-slate-900 text-white font-medium text-base disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? "Processing..."
              : `Confirm issue · ${readyCount} item${readyCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ── Top header (non-sticky) ──────────────────────────────────────────────

function TopHeader({
  saveStatus,
  onBack,
}: {
  saveStatus: "idle" | "saving" | "saved";
  onBack: () => void;
}) {
  return (
    <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-10 h-10 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[15px] font-semibold text-slate-900">Onboarding</h1>
      </div>
      <AutosaveBadge status={saveStatus} />
    </header>
  );
}

function AutosaveBadge({
  status,
}: {
  status: "idle" | "saving" | "saved";
}) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 size={12} className="animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-600">
        <Cloud size={12} />
        Saved
      </span>
    );
  }
  return <span aria-hidden="true" />;
}

// ── Small labeled field (step 0) ────────────────────────────────────────

function Field({
  label,
  value,
  type,
  onChange,
}: {
  label: string;
  value: string;
  type: "text" | "email";
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
      />
    </div>
  );
}
