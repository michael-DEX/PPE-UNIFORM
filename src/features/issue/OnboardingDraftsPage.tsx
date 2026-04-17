import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { Trash2, FileText } from "lucide-react";
import { db } from "../../lib/firebase";
import { onboardingDraftsRef } from "../../lib/firestore";
import Spinner from "../../components/ui/Spinner";
import Button from "../../components/ui/Button";
import type { OnboardingDraft } from "../../types";

function formatRelativeTime(ts: { seconds: number }): string {
  const now = Date.now();
  const diff = now - ts.seconds * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function OnboardingDraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<OnboardingDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      onboardingDraftsRef,
      where("completedAt", "==", null),
      orderBy("updatedAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      setDrafts(docs);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleDelete(draftId: string) {
    if (!window.confirm("Delete this onboarding draft? This cannot be undone.")) return;
    setDeleting(draftId);
    try {
      await deleteDoc(doc(db, "onboarding_drafts", draftId));
    } catch (err) {
      console.error("Failed to delete draft:", err);
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">
        In-Progress Onboardings
      </h1>

      {drafts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileText className="mx-auto h-10 w-10 mb-3 text-slate-300" />
          <p>No in-progress onboardings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="bg-white border border-slate-200 rounded-lg p-4 hover:border-navy-300 hover:shadow-sm transition-all cursor-pointer flex items-center justify-between gap-4"
              onClick={() => navigate(`/logistics/onboarding/${draft.id}`)}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800 truncate">
                  {draft.memberName || "Unnamed Member"}
                </p>
                <p className="text-sm text-slate-500 truncate">
                  {draft.form.email || "No email"}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                  <span>Step {draft.step + 1}/2</span>
                  <span>{draft.cartItems.length} item{draft.cartItems.length !== 1 ? "s" : ""}</span>
                  {draft.updatedAt && (
                    <span>Updated {formatRelativeTime(draft.updatedAt as unknown as { seconds: number })}</span>
                  )}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                disabled={deleting === draft.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(draft.id);
                }}
              >
                {deleting === draft.id ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Trash2 className="h-4 w-4 text-red-500" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
