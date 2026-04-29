import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CATALOG_TREE, type CategoryNode } from "../constants/catalogCategories";

export interface CatalogCategoriesState {
  /** Live category tree (Firestore-backed when configured; defaults otherwise). */
  tree: CategoryNode[];
  /** True while the Firestore subscription is establishing. */
  loading: boolean;
  /** Whether the Firestore config doc exists (seeded). */
  isConfigured: boolean;
}

function normalizeTree(raw: unknown): CategoryNode[] | null {
  if (!Array.isArray(raw)) return null;
  // Best-effort structural validation: ensure id/label strings, children arrays.
  const normalizeNode = (n: unknown): CategoryNode | null => {
    if (!n || typeof n !== "object") return null;
    const obj = n as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!id || !label) return null;
    const icon = typeof obj.icon === "string" ? obj.icon : undefined;
    const childrenRaw = obj.children;
    const children = Array.isArray(childrenRaw)
      ? (childrenRaw.map(normalizeNode).filter(Boolean) as CategoryNode[])
      : undefined;
    return {
      id,
      label,
      ...(icon ? { icon } : {}),
      ...(children && children.length > 0 ? { children } : {}),
    };
  };
  const nodes = raw.map(normalizeNode).filter(Boolean) as CategoryNode[];
  if (nodes.length === 0) return null;

  // Ensure IDs are unique across the whole tree; if not, treat as invalid.
  const ids = new Set<string>();
  const hasDupes = (list: CategoryNode[]): boolean => {
    for (const node of list) {
      if (ids.has(node.id)) return true;
      ids.add(node.id);
      if (node.children && hasDupes(node.children)) return true;
    }
    return false;
  };
  if (hasDupes(nodes)) return null;

  return nodes;
}

export function useCatalogCategories(): CatalogCategoriesState {
  const [tree, setTree] = useState<CategoryNode[]>(CATALOG_TREE);
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "app_config", "catalog_categories"),
      (snap) => {
        if (!snap.exists()) {
          setTree(CATALOG_TREE);
          setIsConfigured(false);
          setLoading(false);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const normalized = normalizeTree(data.tree);
        setTree(normalized ?? CATALOG_TREE);
        setIsConfigured(normalized !== null);
        setLoading(false);
      },
      (err) => {
        console.error("[useCatalogCategories] subscription failed:", err);
        setTree(CATALOG_TREE);
        setIsConfigured(false);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return useMemo(() => ({ tree, loading, isConfigured }), [tree, loading, isConfigured]);
}

