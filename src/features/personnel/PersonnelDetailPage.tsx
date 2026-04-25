import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  doc,
  onSnapshot,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreVertical,
  PlayCircle,
  Printer,
  Ruler,
  ShoppingCart,
  User,
  UserPlus,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { onboardingDraftsRef } from "../../lib/firestore";
import { useGearLocker, type GearLockerItem } from "../../hooks/useGearLocker";
import { useInventory } from "../../hooks/useInventory";
import { useAuth } from "../../hooks/useAuth";
import Badge from "../../components/ui/Badge";
import Spinner from "../../components/ui/Spinner";
import GearLockerCard from "./GearLockerCard";
import ReturnItemSheet from "./ReturnItemSheet";
import { getOnboardingState } from "./onboardingState";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import type {
  Item,
  MemberSizes,
  OnboardingDraft,
  Personnel,
} from "../../types";

const ROLE_LABELS: Record<string, string> = {
  rescue_specialist: "Rescue Specialist",
  search_specialist: "Search Specialist",
  medical_specialist: "Medical Specialist",
  logistics_specialist: "Logistics Specialist",
  task_force_leader: "Task Force Leader",
  k9_specialist: "K9 Specialist",
};

// Static list so the Sizes section renders in a deterministic order
// regardless of which fields are set on a given member's sizes doc.
// Labels map to keys in `MemberSizes` (src/types/index.ts). The phase-3
// spec requested "Shirt, Pants, Boots, Jacket, Hat" but the schema only
// models shirt/pants/boots/helmet/gloves — we keep the schema keys
// (Helmet + Gloves) since changing the type is out of scope.
const SIZE_ROWS: Array<{ key: keyof MemberSizes; label: string }> = [
  { key: "shirt", label: "Shirt" },
  { key: "pants", label: "Pants" },
  { key: "boots", label: "Boots" },
  { key: "helmet", label: "Helmet" },
  { key: "gloves", label: "Gloves" },
];

/**
 * Look up the current inventory qty for an item at a specific size.
 * Non-sized items live under the synthetic "one-size" key — mirrors the
 * storage contract in returnCommit. Returns 0 if the item or size slot
 * isn't in the live inventory snapshot; the audit stamp just records 0
 * as qtyBefore in that edge case rather than blocking the return.
 */
function getStockForItemSize(
  items: Item[],
  itemId: string,
  size: string | null,
): number {
  const it = items.find((i) => i.id === itemId);
  if (!it) return 0;
  const key = size ?? "one-size";
  return it.sizeMap?.[key]?.qty ?? 0;
}

type SectionKey = "profile" | "sizes" | "history";

export default function PersonnelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<Personnel | null>(null);
  const [loading, setLoading] = useState(true);
  const { gearLocker, transactions, loading: gearLoading } = useGearLocker(id);
  const { items: inventoryItems } = useInventory();
  const { logisticsUser } = useAuth();
  const [onboardingDraft, setOnboardingDraft] =
    useState<OnboardingDraft | null>(null);

  // Return sheet — null means closed; a row means open for that row.
  const [returnSheetRow, setReturnSheetRow] = useState<GearLockerItem | null>(
    null,
  );

  // Overflow menu + collapsible sections. Set<SectionKey> keeps "which
  // sections are open" compact; empty = everything collapsed by default.
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<SectionKey>>(new Set());

  // Member doc subscription.
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "personnel", id), (snap) => {
      if (snap.exists()) {
        setMember({ id: snap.id, ...snap.data() } as Personnel);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  // Onboarding draft subscription. Single query without a `completedAt`
  // filter — the most-recent draft wins, and `getOnboardingState` derives
  // not_started / in_progress / complete client-side. This saves one
  // listener compared to filtering server-side for each status.
  useEffect(() => {
    if (!id) return;
    const q = query(
      onboardingDraftsRef,
      where("memberId", "==", id),
      orderBy("updatedAt", "desc"),
      limit(1),
    );
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setOnboardingDraft(null);
        } else {
          const d = snap.docs[0];
          // ID is NOT in doc data; merge from snapshot so the
          // "Resume onboarding" deep-link has a valid draft id to
          // route to.
          setOnboardingDraft({ ...d.data(), id: d.id } as OnboardingDraft);
        }
      },
      () => {},
    );
  }, [id]);

  // ESC closes the overflow menu. Scoped: only attached while open so we
  // don't intercept ESC for other components (e.g. the ReturnItemSheet,
  // which has its own ESC handler).
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Member not found.</p>
      </div>
    );
  }

  const onboardingState = getOnboardingState(onboardingDraft);
  const isActive = member.isActive;

  function toggleSection(key: SectionKey) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleDeactivate() {
    if (!member) return;
    if (
      !confirm(
        `Deactivate ${member.firstName} ${member.lastName}? They will be removed from active lists but their records will be preserved.`,
      )
    ) {
      return;
    }
    await updateDoc(doc(db, "personnel", member.id), { isActive: false });
  }

  async function handleReactivate() {
    if (!member) return;
    await updateDoc(doc(db, "personnel", member.id), { isActive: true });
  }

  // ── Derived strings ──────────────────────────────────────────────────

  // Status strip copy varies with onboarding state.
  const statusText =
    onboardingState.status === "not_started"
      ? "Not onboarded yet"
      : onboardingState.status === "in_progress"
      ? `Onboarding in progress · ${onboardingState.progressPct}%`
      : `Onboarded ${onboardingState.completedAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`;

  // Profile subtitle: compact "{rank} · {role}" when at least one is set,
  // else the placeholder "Email, rank, role" hint.
  const profileSubtitle = (() => {
    const rank = member.rank?.trim();
    const roleLabel = member.role
      ? ROLE_LABELS[member.role] ?? member.role
      : undefined;
    if (rank || roleLabel) {
      return `${rank ?? "—"} · ${roleLabel ?? "—"}`;
    }
    return "Email, rank, role";
  })();

  // Sizes subtitle: "N sizes set" when any are populated, else "Not set".
  const sizesCount = Object.values(member.sizes ?? {}).filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  ).length;
  const sizesSubtitle =
    sizesCount > 0
      ? `${sizesCount} size${sizesCount === 1 ? "" : "s"} set`
      : "Not set";

  // Gear locker + history counts. Pluralize only when appropriate.
  const gearLabel = `Gear locker · ${gearLocker.length} ${
    gearLocker.length === 1 ? "item" : "items"
  }`;
  const historySubtitle = `${transactions.length} event${
    transactions.length === 1 ? "" : "s"
  }`;

  const profileExpanded = expanded.has("profile");
  const sizesExpanded = expanded.has("sizes");
  const historyExpanded = expanded.has("history");

  return (
    // `max-w-2xl mx-auto` keeps the mobile-shaped layout from stretching
    // absurdly wide on desktop. `bg-slate-50` fills the viewport between
    // the bg-white section blocks.
    <div className="max-w-2xl mx-auto bg-slate-50 min-h-screen pb-8">
      {/* ── Compact header ──────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate("/logistics/personnel")}
            aria-label="Back to personnel list"
            className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 flex-shrink-0 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-medium text-slate-900 truncate">
              {member.lastName}, {member.firstName}
            </p>
            <p className="text-xs text-slate-500 truncate">{member.email}</p>
          </div>
        </div>

        {/* Overflow menu — inline, one call site. No reusable <Menu>
            primitive exists in the app per tonight's earlier audit. */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Member actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <MoreVertical size={20} />
          </button>
          {menuOpen && (
            <>
              {/* Invisible outside-click catcher. Needs z-40 so it sits
                  above page content but below the menu (z-50). */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div
                role="menu"
                className="absolute right-0 top-11 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    if (isActive) void handleDeactivate();
                    else void handleReactivate();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-900 hover:bg-slate-50"
                >
                  {isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Status strip ────────────────────────────────────────────── */}
      <div className="bg-white px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <Badge variant={isActive ? "success" : "default"}>
          {isActive ? "Active" : "Inactive"}
        </Badge>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span className="text-sm text-slate-500">{statusText}</span>
      </div>

      {/* ── Primary actions ────────────────────────────────────────── */}
      <div className="bg-white px-4 py-3.5 border-b border-slate-200">
        <button
          type="button"
          onClick={() => navigate("/logistics/inventory")}
          className="w-full min-h-12 bg-slate-900 text-white rounded-md font-medium text-[15px] flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
        >
          <ShoppingCart size={18} />
          Issue Equipment
        </button>
        {onboardingState.status === "not_started" && (
          <button
            type="button"
            onClick={() =>
              navigate(`/logistics/onboarding?member=${member.id}`)
            }
            className="mt-2 w-full min-h-10 bg-white border border-slate-300 rounded-md font-medium text-sm text-slate-900 flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
          >
            <UserPlus size={16} />
            Initial Equipment Issue
          </button>
        )}
        {onboardingState.status === "in_progress" && (
          <button
            type="button"
            onClick={() =>
              navigate(`/logistics/onboarding/${onboardingState.draft.id}`)
            }
            className="mt-2 w-full min-h-10 bg-white border border-slate-300 rounded-md font-medium text-sm text-slate-900 flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
          >
            <PlayCircle size={16} />
            Resume onboarding · {onboardingState.progressPct}%
          </button>
        )}
        {/* onboardingState.status === "complete" renders no secondary
            button, by spec. */}
      </div>

      {/* ── Profile + Sizes collapsibles ───────────────────────────── */}
      <div className="bg-slate-50 px-3 py-3 space-y-2.5">
        {/* Profile */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("profile")}
            aria-expanded={profileExpanded}
            className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <User
                size={18}
                className="text-slate-500 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Profile</p>
                <p className="text-xs text-slate-500 truncate">
                  {profileSubtitle}
                </p>
              </div>
            </div>
            <ChevronRight
              size={18}
              className={`text-slate-400 flex-shrink-0 transition-transform ${
                profileExpanded ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
          </button>
          {profileExpanded && (
            <div className="border-t border-slate-100 px-3.5 py-3">
              <dl className="text-sm space-y-2">
                <ProfileRow label="Email" value={member.email} />
                <ProfileRow label="Rank" value={member.rank} />
                <ProfileRow
                  label="Role"
                  value={
                    member.role
                      ? ROLE_LABELS[member.role] ?? member.role
                      : undefined
                  }
                />
                <ProfileRow label="Phone" value={member.phone} />
              </dl>
            </div>
          )}
        </section>

        {/* Sizes */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("sizes")}
            aria-expanded={sizesExpanded}
            className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Ruler
                size={18}
                className="text-slate-500 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Sizes</p>
                <p className="text-xs text-slate-500 truncate">
                  {sizesSubtitle}
                </p>
              </div>
            </div>
            <ChevronRight
              size={18}
              className={`text-slate-400 flex-shrink-0 transition-transform ${
                sizesExpanded ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
          </button>
          {sizesExpanded && (
            <div className="border-t border-slate-100 px-3.5 py-3">
              <dl className="text-sm space-y-2">
                {SIZE_ROWS.map(({ key, label }) => (
                  <ProfileRow
                    key={key}
                    label={label}
                    value={(member.sizes ?? {})[key]}
                  />
                ))}
              </dl>
            </div>
          )}
        </section>
      </div>

      {/* ── Gear Locker ────────────────────────────────────────────── */}
      <div className="px-3">
        <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium px-1 mt-3 mb-2">
          {gearLabel}
        </p>
        {gearLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : gearLocker.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl text-center py-8">
            <p className="text-sm text-slate-400">No gear currently issued</p>
          </div>
        ) : (
          <div className="space-y-2">
            {gearLocker.map((g) => {
              // Lookup the full catalog item for mfr/model subtitle.
              // Pre-computing here (parent has inventoryItems) avoids
              // spawning a useInventory subscription per GearLockerCard.
              const catalogItem = inventoryItems.find(
                (i) => i.id === g.itemId,
              );
              return (
                <GearLockerCard
                  key={`${g.itemId}::${g.size ?? "one-size"}`}
                  row={g}
                  subtitle={subtitleFromItem(catalogItem)}
                  onReturnClick={setReturnSheetRow}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Transaction History (collapsible) ──────────────────────── */}
      <div className="bg-slate-50 px-3 py-3">
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("history")}
            aria-expanded={historyExpanded}
            className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Clock
                size={18}
                className="text-slate-500 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  Transaction history
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {historySubtitle}
                </p>
              </div>
            </div>
            <ChevronRight
              size={18}
              className={`text-slate-400 flex-shrink-0 transition-transform ${
                historyExpanded ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
          </button>
          {historyExpanded && (
            <div className="border-t border-slate-100">
              {transactions.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">
                  No transactions yet
                </p>
              ) : (
                // Existing transaction render — untouched visual pattern
                // from the prior page. Redesigning this list is explicitly
                // out of scope per the phase-3 spec ("scope discipline").
                <div className="divide-y divide-slate-100">
                  {transactions.slice(0, 20).map((tx) => (
                    <div key={tx.id} className="px-5 py-3">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant={
                            tx.type === "return"
                              ? "info"
                              : tx.status === "partial"
                              ? "warning"
                              : "success"
                          }
                        >
                          {tx.type.replace("_", " ")}
                        </Badge>
                        <span className="text-xs text-slate-400">
                          {tx.timestamp?.toDate?.()?.toLocaleString() ?? "—"}
                        </span>
                        <span className="text-xs text-slate-400">
                          by {tx.issuedByName}
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate(`/logistics/print/${tx.id}`)}
                          className="ml-auto p-1 text-slate-400 hover:text-navy-700 transition-colors"
                          title="Print gear issue form"
                        >
                          <Printer size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        {tx.items
                          .map(
                            (i) =>
                              `${i.itemName}${
                                i.size ? ` (${i.size})` : ""
                              } x${i.qtyIssued}`,
                          )
                          .join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Return sheet — unchanged from prior version ────────────── */}
      {logisticsUser && returnSheetRow && (
        <ReturnItemSheet
          open
          row={returnSheetRow}
          member={member}
          actor={logisticsUser}
          currentStockForSize={getStockForItemSize(
            inventoryItems,
            returnSheetRow.itemId,
            returnSheetRow.size,
          )}
          subtitle={subtitleFromItem(
            inventoryItems.find((i) => i.id === returnSheetRow.itemId),
          )}
          onClose={() => setReturnSheetRow(null)}
          onSubmitted={() => setReturnSheetRow(null)}
        />
      )}
    </div>
  );
}

// ── Small presentational helper ─────────────────────────────────────────

/**
 * One row of the Profile / Sizes expanded content. Empty values render
 * as an em dash so the layout stays stable across members with sparse
 * data. Used inline rather than split to its own file because it's only
 * referenced here and the body is three lines.
 */
function ProfileRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const display =
    typeof value === "string" && value.trim().length > 0 ? value : "—";
  return (
    <div className="flex justify-between gap-3 min-w-0">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className="text-slate-900 truncate text-right min-w-0">{display}</dd>
    </div>
  );
}
