import { useMemo, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import { db } from "../../lib/firebase";
import { addAuditEventToBatch } from "../../lib/audit";
import type { CategoryNode } from "../../constants/catalogCategories";
import type { LogisticsUser } from "../../types";

type Mode = "category" | "subcategory";

function slugifyId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function flattenIds(tree: CategoryNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: CategoryNode[]) => {
    for (const n of nodes) {
      ids.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return ids;
}

export default function CategoryInlineAddModal({
  open,
  mode,
  onClose,
  baseTree,
  actor,
  parentId,
  onCreated,
}: {
  open: boolean;
  mode: Mode;
  onClose: () => void;
  baseTree: CategoryNode[];
  actor: LogisticsUser;
  parentId?: string;
  onCreated: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedId = useMemo(() => {
    const slug = slugifyId(label);
    if (!slug) return "";
    if (mode === "category") return slug;
    if (!parentId) return "";
    return `${parentId}|${slug}`;
  }, [label, mode, parentId]);

  const idTaken = useMemo(() => {
    if (!computedId) return false;
    return flattenIds(baseTree).has(computedId);
  }, [baseTree, computedId]);

  function resetAndClose() {
    setLabel("");
    setError(null);
    setSaving(false);
    onClose();
  }

  async function handleCreate() {
    setError(null);
    if (!label.trim()) {
      setError("Name is required.");
      return;
    }
    if (!computedId) {
      setError("Invalid name.");
      return;
    }
    if (idTaken) {
      setError("That category ID already exists. Try a different name.");
      return;
    }
    if (mode === "subcategory" && !parentId) {
      setError("Pick a parent category first.");
      return;
    }

    setSaving(true);
    try {
      let nextTree: CategoryNode[];
      if (mode === "category") {
        nextTree = [...baseTree, { id: computedId, label: label.trim() }];
      } else {
        nextTree = baseTree.map((n) =>
          n.id === parentId
            ? {
                ...n,
                children: [
                  ...(n.children ?? []),
                  { id: computedId, label: label.trim() },
                ],
              }
            : n,
        );
      }

      const batch = writeBatch(db);
      batch.set(doc(db, "app_config", "catalog_categories"), {
        tree: nextTree,
        updatedAt: serverTimestamp(),
        updatedBy: actor.id,
      });
      addAuditEventToBatch(batch, {
        type: "catalog_categories_edit",
        actorUid: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action:
          mode === "category"
            ? `Added catalog category "${label.trim()}"`
            : `Added catalog subcategory "${label.trim()}"`,
      });
      await batch.commit();

      onCreated(computedId);
      resetAndClose();
    } catch (err) {
      console.error("[CategoryInlineAddModal] create failed:", err);
      setError(err instanceof Error ? err.message : "Failed to create category.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && resetAndClose()}
      title={mode === "category" ? "Add category" : "Add subcategory"}
      subtitle="Creates a shared category for everyone (IDs are stable)."
    >
      <div className="space-y-3">
        {mode === "subcategory" && parentId && (
          <p className="text-xs text-slate-500">
            Parent: <span className="font-mono">{parentId}</span>
          </p>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Name
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
            placeholder={mode === "category" ? "e.g. Comms" : "e.g. Radios"}
            autoFocus
            disabled={saving}
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] text-slate-500">ID (auto)</p>
          <p className="text-xs font-mono text-slate-700 break-all">
            {computedId || "—"}
          </p>
        </div>
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={resetAndClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !label.trim()}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

