import type { CatalogCategory } from "../types";

export interface CategoryNode {
  id: CatalogCategory | "all" | string;
  label: string;
  icon?: string; // lucide icon name
  children?: CategoryNode[];
}

export const CATALOG_TREE: CategoryNode[] = [
  {
    id: "packs-bags",
    label: "Packs & Bags",
    icon: "Backpack",
  },
  {
    id: "patches",
    label: "Patches",
    icon: "Badge",
  },
  {
    id: "footwear",
    label: "Footwear",
    icon: "Footprints",
  },
  {
    id: "clothing",
    label: "Clothing",
    icon: "Shirt",
    children: [
      { id: "clothing-bdus", label: "BDUs" },
      { id: "clothing-shirts", label: "Shirts & Polos" },
      { id: "clothing-outerwear", label: "Outerwear & Layers" },
      { id: "clothing-headwear", label: "Headwear" },
      { id: "clothing-personal", label: "Personal Clothing" },
    ],
  },
  {
    id: "ppe-equipment",
    label: "PPE & Equipment",
    icon: "Shield",
  },
  {
    id: "head-protection",
    label: "Head Protection",
    icon: "HardHat",
  },
  {
    id: "sleep-system",
    label: "Sleep System",
    icon: "Moon",
  },
  {
    id: "personal-items",
    label: "Personal Items",
    icon: "User",
  },
];

/** Flatten the tree into a flat list of all category IDs */
export function getAllCategoryIds(): string[] {
  const ids: string[] = [];
  function walk(nodes: CategoryNode[]) {
    for (const n of nodes) {
      ids.push(n.id);
      if (n.children) walk(n.children);
    }
  }
  walk(CATALOG_TREE);
  return ids;
}

/** Get label for a category ID */
export function getCategoryLabel(
  id: string,
  tree: CategoryNode[] = CATALOG_TREE,
): string {
  function find(nodes: CategoryNode[]): string | null {
    for (const n of nodes) {
      if (n.id === id) return n.label;
      if (n.children) {
        const found = find(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  return find(tree) ?? id;
}

/** Check if a category ID matches a node or any of its children */
export function categoryMatches(
  nodeId: string,
  itemCategoryId: string,
  tree: CategoryNode[] = CATALOG_TREE,
): boolean {
  if (nodeId === "all") return true;
  if (nodeId === itemCategoryId) return true;
  // Check if nodeId is a parent (e.g., "clothing" matches "clothing-bdus")
  const node = findNode(tree, nodeId);
  if (node?.children) {
    return node.children.some((c) => c.id === itemCategoryId);
  }
  return false;
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}
