import { useState, useMemo } from "react";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Send,
  PackagePlus,
  Trash2,
} from "lucide-react";
import { getTotalStock, isLowStock, isOutOfStock } from "../../hooks/useInventory";
import { getCategoryLabel } from "../../constants/catalogCategories";
import type { Item } from "../../types";

interface Props {
  items: Item[];
  onSelectItem: (item: Item) => void;
  onReceive: (item: Item) => void;
  onAddToCart: (item: Item) => void;
  onDelete?: (item: Item) => void;
  canDelete?: boolean;
}

type SortColumn = "name" | "category" | "totalStock" | "status";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

function getStatusPriority(item: Item): number {
  if (isOutOfStock(item)) return 0;
  if (isLowStock(item)) return 1;
  return 2;
}

function getStatusLabel(item: Item): string {
  if (isOutOfStock(item)) return "Out of Stock";
  if (isLowStock(item)) return "Low Stock";
  return "In Stock";
}

function getStatusClasses(item: Item): string {
  if (isOutOfStock(item)) return "bg-red-100 text-red-700";
  if (isLowStock(item)) return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function getItemCategoryLabel(item: Item): string {
  return getCategoryLabel(item.catalogCategory ?? item.category);
}

export default function InventoryTable({
  items,
  onSelectItem,
  onReceive,
  onAddToCart,
  onDelete,
  canDelete,
}: Props) {
  const [sort, setSort] = useState<SortState>({
    column: "name",
    direction: "asc",
  });

  const handleSort = (column: SortColumn) => {
    setSort((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedItems = useMemo(() => {
    const multiplier = sort.direction === "asc" ? 1 : -1;

    return [...items].sort((a, b) => {
      switch (sort.column) {
        case "name":
          return multiplier * a.name.localeCompare(b.name);
        case "category":
          return multiplier * getItemCategoryLabel(a).localeCompare(getItemCategoryLabel(b));
        case "totalStock":
          return multiplier * (getTotalStock(a) - getTotalStock(b));
        case "status":
          return multiplier * (getStatusPriority(a) - getStatusPriority(b));
        default:
          return 0;
      }
    });
  }, [items, sort]);

  const renderSortIcon = (column: SortColumn) => {
    if (sort.column !== column) {
      return <ArrowUpDown className="inline-block ml-1 h-3 w-3 opacity-40" />;
    }
    return sort.direction === "asc" ? (
      <ChevronUp className="inline-block ml-1 h-3 w-3" />
    ) : (
      <ChevronDown className="inline-block ml-1 h-3 w-3" />
    );
  };

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No items found
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="sticky top-0 bg-gray-50 z-10">
          <tr>
            <th
              className="px-3 md:px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort("name")}
            >
              Name {renderSortIcon("name")}
            </th>
            <th
              className="hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort("category")}
            >
              Category {renderSortIcon("category")}
            </th>
            <th
              className="px-3 md:px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort("totalStock")}
            >
              Stock {renderSortIcon("totalStock")}
            </th>
            <th className="hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Sizes
            </th>
            <th
              className="px-3 md:px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
              onClick={() => handleSort("status")}
            >
              Status {renderSortIcon("status")}
            </th>
            <th className="px-3 md:px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => {
            const sizeCount = Object.keys(item.sizeMap || {}).length;

            return (
              <tr
                key={item.id}
                className="border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors even:bg-gray-50/50"
                onClick={() => onSelectItem(item)}
              >
                <td className="px-3 md:px-4 py-3">
                  <span className="font-medium text-gray-900 max-w-[180px] md:max-w-[250px] truncate block text-xs md:text-sm">
                    {item.name}
                  </span>
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-gray-500">
                  {getItemCategoryLabel(item)}
                </td>
                <td className="px-3 md:px-4 py-3 font-bold">
                  {getTotalStock(item)}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-gray-500">
                  {sizeCount > 0 ? `${sizeCount} sizes` : "\u2014"}
                </td>
                <td className="px-3 md:px-4 py-3">
                  <span
                    className={`inline-flex items-center px-1.5 md:px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium ${getStatusClasses(item)}`}
                  >
                    {getStatusLabel(item)}
                  </span>
                </td>
                <td className="px-3 md:px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center h-7 w-7 rounded text-blue-600 hover:bg-blue-100 transition-colors"
                      title="Add to Cart"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToCart(item);
                      }}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                    {item.isIssuedByTeam && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-7 w-7 rounded text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Receive Stock"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReceive(item);
                        }}
                      >
                        <PackagePlus className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && onDelete && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-7 w-7 rounded text-red-500 hover:bg-red-100 transition-colors"
                        title="Delete item"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(item);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
