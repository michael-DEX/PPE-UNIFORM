import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Backpack,
  BadgeCheck,
  Footprints,
  Shirt,
  Shield,
  HardHat,
  Moon,
  User,
  LayoutGrid,
} from "lucide-react";

interface CategoryNode {
  id: string;
  label: string;
  icon?: string;
  children?: CategoryNode[];
}

interface CategorySidebarProps {
  tree: CategoryNode[];
  activeId: string;
  onSelect: (id: string) => void;
  itemCounts: Record<string, number>;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Backpack,
  Badge: BadgeCheck,
  Footprints,
  Shirt,
  Shield,
  HardHat,
  Moon,
  User,
};

export default function CategorySidebar({ tree, activeId, onSelect, itemCounts }: CategorySidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["clothing"]));
  const totalCount = Object.values(itemCounts).reduce((s, c) => s + c, 0);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <nav className="w-56 shrink-0 bg-white border-r border-slate-200 overflow-y-auto">
      <div className="p-3">
        {/* All Items */}
        <button
          onClick={() => onSelect("all")}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            activeId === "all"
              ? "bg-navy-50 text-navy-800 font-medium"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <LayoutGrid size={16} />
          <span className="flex-1 text-left">All Items</span>
          <span className="text-xs text-slate-400">{totalCount}</span>
        </button>

        {/* Category tree */}
        <div className="mt-2 space-y-0.5">
          {tree.map((node) => (
            <CategoryItem
              key={node.id}
              node={node}
              activeId={activeId}
              onSelect={onSelect}
              expanded={expanded}
              toggleExpand={toggleExpand}
              itemCounts={itemCounts}
              depth={0}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

function CategoryItem({
  node,
  activeId,
  onSelect,
  expanded,
  toggleExpand,
  itemCounts,
  depth,
}: {
  node: CategoryNode;
  activeId: string;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  itemCounts: Record<string, number>;
  depth: number;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isActive = activeId === node.id;
  const Icon = node.icon ? ICON_MAP[node.icon] : null;

  // Count: for parents, sum children counts
  const count = hasChildren
    ? node.children!.reduce((s, c) => s + (itemCounts[c.id] ?? 0), 0)
    : (itemCounts[node.id] ?? 0);

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            toggleExpand(node.id);
            onSelect(node.id);
          } else {
            onSelect(node.id);
          }
        }}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-navy-50 text-navy-800 font-medium"
            : "text-slate-600 hover:bg-slate-50"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {Icon && <Icon size={16} className="shrink-0" />}
        <span className="flex-1 text-left truncate">{node.label}</span>
        {count > 0 && (
          <span className="text-xs text-slate-400">{count}</span>
        )}
      </button>
      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {node.children!.map((child) => (
            <CategoryItem
              key={child.id}
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              expanded={expanded}
              toggleExpand={toggleExpand}
              itemCounts={itemCounts}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
