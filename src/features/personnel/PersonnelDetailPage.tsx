import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { doc, onSnapshot, updateDoc, deleteDoc, query, where } from "firebase/firestore";
import { ArrowLeft, Printer, ShoppingCart, UserPlus, UserX, Trash2, RotateCcw } from "lucide-react";
import { db } from "../../lib/firebase";
import { onboardingDraftsRef } from "../../lib/firestore";
import { useGearLocker } from "../../hooks/useGearLocker";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import type { Personnel, OnboardingDraft } from "../../types";

const ROLE_LABELS: Record<string, string> = {
  rescue_specialist: "Rescue Specialist",
  search_specialist: "Search Specialist",
  medical_specialist: "Medical Specialist",
  logistics_specialist: "Logistics Specialist",
  task_force_leader: "Task Force Leader",
  k9_specialist: "K9 Specialist",
};

export default function PersonnelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<Personnel | null>(null);
  const [loading, setLoading] = useState(true);
  const { gearLocker, transactions, loading: gearLoading } = useGearLocker(id);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft | null>(null);

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

  // Check for in-progress onboarding draft
  useEffect(() => {
    if (!id) return;
    const q = query(onboardingDraftsRef, where("memberId", "==", id), where("completedAt", "==", null));
    return onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0];
        setOnboardingDraft({ ...d.data(), id: d.id } as OnboardingDraft);
      } else {
        setOnboardingDraft(null);
      }
    }, () => {});
  }, [id]);

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/logistics/personnel")}
          className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            {member.lastName}, {member.firstName}
          </h1>
          <p className="text-sm text-slate-500">
            {member.email}
            {member.role && <> &middot; {ROLE_LABELS[member.role] || member.role}</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!onboardingDraft && member.isActive && (
            <Button onClick={() => navigate(`/logistics/onboarding?member=${member.id}`)}>
              <UserPlus size={16} />
              {gearLocker.length === 0 ? "Initial Equipment Issue" : "Continue Equipment Issue"}
            </Button>
          )}
          {member.isActive && (
            <Button variant="secondary" onClick={() => navigate("/logistics/inventory")}>
              <ShoppingCart size={16} />
              Issue Gear
            </Button>
          )}
          {member.isActive ? (
            <Button
              variant="secondary"
              onClick={async () => {
                if (!confirm(`Deactivate ${member.firstName} ${member.lastName}? They will be removed from active lists but their records will be preserved.`)) return;
                await updateDoc(doc(db, "personnel", member.id), { isActive: false });
              }}
            >
              <UserX size={16} />
              Deactivate
            </Button>
          ) : (
            <>
              <Button
                onClick={async () => {
                  await updateDoc(doc(db, "personnel", member.id), { isActive: true });
                }}
              >
                <RotateCcw size={16} />
                Reactivate
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Permanently delete ${member.firstName} ${member.lastName}? This cannot be undone. Their transaction history will be preserved but the member record will be removed.`)) return;
                  await deleteDoc(doc(db, "personnel", member.id));
                  navigate("/logistics/personnel");
                }}
              >
                <Trash2 size={16} />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Onboarding in progress */}
      {onboardingDraft && (() => {
        const filled = onboardingDraft.cartItems?.filter((i) => i.qty > 0).length ?? 0;
        const total = onboardingDraft.cartItems?.length ?? 0;
        const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus size={18} className="text-amber-600" />
                <p className="text-sm font-medium text-amber-900">Onboarding in progress</p>
              </div>
              <Button size="sm" onClick={() => navigate(`/logistics/onboarding/${onboardingDraft.id}`)}>
                Resume
              </Button>
            </div>
            <div className="w-full bg-amber-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-amber-700">{filled} of {total} items filled ({pct}%)</p>
          </div>
        );
      })()}

      {/* Profile & Sizes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Profile</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-900">{member.email}</dd>
            </div>
            {member.phone && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900">{member.phone}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Rank</dt>
              <dd className="text-slate-900">{member.rank || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge variant={member.isActive ? "success" : "default"}>
                  {member.isActive ? "Active" : "Inactive"}
                </Badge>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Sizes</h2>
          <dl className="space-y-2 text-sm">
            {Object.entries(member.sizes || {}).map(([key, val]) => (
              <div key={key} className="flex justify-between">
                <dt className="text-slate-500 capitalize">{key}</dt>
                <dd className="text-slate-900">{val || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Gear Locker */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">
            Gear Locker ({gearLocker.length} items)
          </h2>
        </div>
        {gearLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : gearLocker.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No gear currently issued</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-2 text-slate-600 font-medium">Item</th>
                <th className="text-left px-5 py-2 text-slate-600 font-medium">Size</th>
                <th className="text-left px-5 py-2 text-slate-600 font-medium">Qty</th>
                <th className="text-left px-5 py-2 text-slate-600 font-medium">Last Issued</th>
              </tr>
            </thead>
            <tbody>
              {gearLocker.map((g, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-900">{g.itemName}</td>
                  <td className="px-5 py-2 text-slate-600">{g.size || "—"}</td>
                  <td className="px-5 py-2 text-slate-600">{g.qty}</td>
                  <td className="px-5 py-2 text-slate-500 text-xs">
                    {g.lastIssuedAt?.toLocaleDateString() ?? "—"}
                    {g.lastIssuedBy && ` by ${g.lastIssuedBy}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">
            Transaction History ({transactions.length})
          </h2>
        </div>
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No transactions yet</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.slice(0, 20).map((tx) => (
              <div key={tx.id} className="px-5 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={tx.type === "return" ? "info" : tx.status === "partial" ? "warning" : "success"}>
                    {tx.type.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    {tx.timestamp?.toDate?.()?.toLocaleString() ?? "—"}
                  </span>
                  <span className="text-xs text-slate-400">by {tx.issuedByName}</span>
                  <button
                    onClick={() => navigate(`/logistics/print/${tx.id}`)}
                    className="ml-auto p-1 text-slate-400 hover:text-navy-700 transition-colors"
                    title="Print gear issue form"
                  >
                    <Printer size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  {tx.items.map((i) => `${i.itemName}${i.size ? ` (${i.size})` : ""} x${i.qtyIssued}`).join(", ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
