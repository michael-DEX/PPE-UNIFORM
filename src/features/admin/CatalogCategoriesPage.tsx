import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import {
  ArrowDown,
  ArrowUp,
  ListTree,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/Toast";
import Spinner from "../../components/ui/Spinner";
import Button from "../../components/ui/Button";
import { addAuditEventToBatch } from "../../lib/audit";
import { seedCatalogCategories } from "../../lib/catalogCategoriesSeed";
import { useInventory } from "../../hooks/useInventory";
import type { Item } from "../../types";
import type { CategoryNode } from "../../constants/catalogCategories";

interface CategoriesDoc {
  tree: CategoryNode[];
  updatedBy?: string;
  updatedAt?: { toDate?: () => Date };
}

function slugifyId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function arraysEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildCountsByCategory(items: Item[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const id = it.catalogCategory;
    if (!id) continue;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

function sumChildCounts(node: CategoryNode, counts: Map<string, number>): number {
  if (!node.children || node.children.length === 0) return counts.get(node.id) ?? 0;
  return node.children.reduce((s, c) => s + sumChildCounts(c, counts), 0);
}

export default function CatalogCategoriesPage() {
  const { isManager, logisticsUser } = useAuthContext();
  const toast = useToast();
  const { items: inventoryItems, loading: inventoryLoading } = useInventory();

  const [docState, setDocState] = useState<CategoriesDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pendingTree, setPendingTree] = useState<CategoryNode[]>([]);
  const baselineRef = useRef<CategoryNode[]>([]);
  const dirtyRef = useRef(false);

  // Selected node (for label editing panel)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Subscribe to doc
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "app_config", "catalog_categories"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          const tree = Array.isArray(data.tree) ? (data.tree as CategoryNode[]) : [];
          const nextDoc: CategoriesDoc = {
            tree,
            updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
            updatedAt: data.updatedAt as CategoriesDoc["updatedAt"],
          };
          setDocState(nextDoc);
        } else {
          setDocState(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("[CatalogCategoriesPage] subscription failed:", err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  // Sync pending tree only when not dirty
  useEffect(() => {
    if (!docState) return;
    if (dirtyRef.current) return;
    setPendingTree(deepClone(docState.tree));
    baselineRef.current = deepClone(docState.tree);
    // Preserve selection if possible
    setSelectedId((prev) => (prev ? prev : docState.tree[0]?.id ?? null));
  }, [docState]);

  const countsById = useMemo(
    () => buildCountsByCategory(inventoryItems),
    [inventoryItems],
  );

  const isDirty = useMemo(() => {
    if (!docState) return false;
    return !arraysEqual(pendingTree, docState.tree);
  }, [pendingTree, docState]);

  const hasExternalUpdate = useMemo(() => {
    if (!docState) return false;
    return !arraysEqual(baselineRef.current, docState.tree);
  }, [docState]);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    const find = (nodes: CategoryNode[]): CategoryNode | null => {
      for (const n of nodes) {
        if (n.id === selectedId) return n;
        if (n.children) {
          const found = find(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    return find(pendingTree);
  }, [pendingTree, selectedId]);

  if (!isManager) {
    return (
      <div className="p-8 text-center text-red-600">
        Access denied. Manager role required.
      </div>
    );
  }

  if (loading || inventoryLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  async function handleSeed() {
    if (!logisticsUser) return;
    setSeeding(true);
    try {
      await seedCatalogCategories(logisticsUser);
      toast.success("Catalog categories seeded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seed failed.");
    } finally {
      setSeeding(false);
    }
  }

  function markDirty(updater: () => void) {
    dirtyRef.current = true;
    updater();
  }

  function updateLabel(id: string, nextLabel: string) {
    markDirty(() => {
      const update = (nodes: CategoryNode[]): CategoryNode[] =>
        nodes.map((n) => {
          if (n.id === id) return { ...n, label: nextLabel };
          if (n.children) return { ...n, children: update(n.children) };
          return n;
        });
      setPendingTree((prev) => update(prev));
    });
  }

  function moveSibling(id: string, dir: "up" | "down") {
    markDirty(() => {
      const moveIn = (nodes: CategoryNode[]): CategoryNode[] => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx >= 0) {
          const next = [...nodes];
          const swap = dir === "up" ? idx - 1 : idx + 1;
          if (swap < 0 || swap >= next.length) return nodes;
          [next[idx], next[swap]] = [next[swap], next[idx]];
          return next;
        }
        return nodes.map((n) =>
          n.children ? { ...n, children: moveIn(n.children) } : n,
        );
      };
      setPendingTree((prev) => moveIn(prev));
    });
  }

  function canDeleteNode(node: CategoryNode): boolean {
    return sumChildCounts(node, countsById) === 0;
  }

  function deleteNode(id: string) {
    const target = selectedNode;
    if (!target) return;
    if (!canDeleteNode(target)) {
      toast.error("Cannot delete: category is used by items.");
      return;
    }
    if (!window.confirm(`Delete "${target.label}"?`)) return;
    markDirty(() => {
      const remove = (nodes: CategoryNode[]): CategoryNode[] =>
        nodes
          .filter((n) => n.id !== id)
          .map((n) => (n.children ? { ...n, children: remove(n.children) } : n));
      setPendingTree((prev) => remove(prev));
      setSelectedId(null);
    });
  }

  function addCategory() {
    const label = window.prompt("New category name?");
    if (!label) return;
    const baseId = slugifyId(label);
    if (!baseId) {
      toast.error("Invalid name.");
      return;
    }
    const id = baseId.includes("|") ? baseId.replace(/\|+/g, "-") : baseId;
    const exists = JSON.stringify(pendingTree).includes(`"id":"${id}"`);
    if (exists) {
      toast.error("That ID already exists. Pick a different name.");
      return;
    }
    markDirty(() => {
      setPendingTree((prev) => [...prev, { id, label }]);
      setSelectedId(id);
    });
  }

  function addSubcategory(parentId: string) {
    const parent = pendingTree.find((n) => n.id === parentId) ?? null;
    if (!parent) return;
    const label = window.prompt(`New subcategory under "${parent.label}"?`);
    if (!label) return;
    const childSlug = slugifyId(label);
    if (!childSlug) {
      toast.error("Invalid name.");
      return;
    }
    // User-created child IDs use `|` to avoid collisions with built-in `-` ids.
    const id = `${parentId}|${childSlug}`;
    const exists = JSON.stringify(pendingTree).includes(`"id":"${id}"`);
    if (exists) {
      toast.error("That ID already exists.");
      return;
    }
    markDirty(() => {
      setPendingTree((prev) =>
        prev.map((n) =>
          n.id === parentId
            ? { ...n, children: [...(n.children ?? []), { id, label }] }
            : n,
        ),
      );
      setSelectedId(id);
    });
  }

  function discard() {
    if (!docState) return;
    dirtyRef.current = false;
    baselineRef.current = deepClone(docState.tree);
    setPendingTree(deepClone(docState.tree));
    setSelectedId(docState.tree[0]?.id ?? null);
  }

  async function save() {
    if (!logisticsUser) return;
    if (!docState) return;
    if (!isDirty) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "app_config", "catalog_categories"), {
        tree: pendingTree,
        updatedAt: serverTimestamp(),
        updatedBy: logisticsUser.id,
      });
      addAuditEventToBatch(batch, {
        type: "catalog_categories_edit",
        actorUid: logisticsUser.id,
        actorName: logisticsUser.name,
        actorRole: logisticsUser.role,
        action: "Updated catalog categories",
      });
      await batch.commit();
      dirtyRef.current = false;
      baselineRef.current = deepClone(pendingTree);
      toast.success("Categories saved.");
    } catch (err) {
      console.error("[CatalogCategoriesPage] save failed:", err);
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (docState === null) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <header className="flex items-center gap-3">
          <ListTree size={20} className="text-navy-700" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Catalog Categories</h1>
            <p className="text-sm text-slate-500">
              Configure the shared Category/Subcategory taxonomy used in inventory.
            </p>
          </div>
        </header>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
          <p className="text-sm text-slate-700">
            Categories haven’t been configured yet. Seed from the default category list to begin.
          </p>
          <Button onClick={handleSeed} disabled={seeding}>
            <Plus size={16} />
            {seeding ? "Seeding…" : "Seed from defaults"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ListTree size={20} className="text-navy-700" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate">
              Catalog Categories
            </h1>
            {docState.updatedAt?.toDate && (
              <p className="text-xs text-slate-500">
                Last updated {docState.updatedAt.toDate().toLocaleDateString("en-US")}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={addCategory}>
            <Plus size={16} />
            Add category
          </Button>
        </div>
      </header>

      {isDirty && hasExternalUpdate && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠ Another manager updated categories while you were editing. Saving will overwrite their changes.
        </div>
      )}

      {isDirty && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex items-center justify-between gap-3">
          <span>You have unsaved changes.</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save size={16} />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: tree */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Tree</span>
          </div>
          <div className="p-3 space-y-1">
            {pendingTree.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No categories.</p>
            ) : (
              pendingTree.map((node, idx) => {
                const count = sumChildCounts(node, countsById);
                const selected = selectedId === node.id;
                return (
                  <div key={node.id} className="rounded-lg border border-slate-200">
                    <div className={`flex items-center gap-2 px-3 py-2 ${selected ? "bg-navy-50" : "bg-white"}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-sm font-medium text-slate-900 truncate">{node.label}</p>
                        <p className="text-[11px] text-slate-500 font-mono truncate">{node.id}</p>
                      </button>
                      <span className="text-xs text-slate-400 tabular-nums">{count}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveSibling(node.id, "up")}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                          title="Move up"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSibling(node.id, "down")}
                          disabled={idx === pendingTree.length - 1}
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                          title="Move down"
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => addSubcategory(node.id)}
                          className="p-1 rounded hover:bg-slate-100"
                          title="Add subcategory"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    {node.children && node.children.length > 0 && (
                      <div className="border-t border-slate-200 p-2 space-y-1 bg-slate-50">
                        {node.children.map((c) => {
                          const cCount = sumChildCounts(c, countsById);
                          const cSelected = selectedId === c.id;
                          return (
                            <div
                              key={c.id}
                              className={`flex items-center gap-2 px-2 py-1 rounded ${cSelected ? "bg-white" : ""}`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedId(c.id)}
                                className="flex-1 text-left min-w-0"
                              >
                                <p className="text-sm text-slate-900 truncate">{c.label}</p>
                                <p className="text-[11px] text-slate-500 font-mono truncate">{c.id}</p>
                              </button>
                              <span className="text-xs text-slate-400 tabular-nums">{cCount}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: editor */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Edit</span>
          </div>
          {!selectedNode ? (
            <div className="p-6 text-sm text-slate-500">
              Select a category to edit.
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  ID (immutable)
                </label>
                <input
                  value={selectedNode.id}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Label
                </label>
                <input
                  value={selectedNode.label}
                  onChange={(e) => updateLabel(selectedNode.id, e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                />
              </div>

              {!canDeleteNode(selectedNode) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-900">
                    This category is currently used by items and can’t be deleted.
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <Button
                  variant="danger"
                  onClick={() => deleteNode(selectedNode.id)}
                  disabled={!canDeleteNode(selectedNode)}
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
                <Button onClick={save} disabled={!isDirty || saving}>
                  <Save size={16} />
                  Save
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Tip: IDs are stable and should be treated like database keys. To “rename” a category, edit the label.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

