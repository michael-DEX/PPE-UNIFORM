import { useState } from "react";
import { Package, ArrowDownToLine, ShoppingCart, ChevronDown, ChevronUp } from "lucide-react";
import { getTotalStock, isLowStock, isOutOfStock, getStockStatus } from "../../hooks/useInventory";
import Badge from "../../components/ui/Badge";
import type { Item } from "../../types";

interface ItemCardProps {
  item: Item;
  onIssue: (item: Item) => void;
  onReceive: (item: Item) => void;
  onAddToCart?: (item: Item) => void;
  cartMode?: boolean;
}

export default function ItemCard({ item, onIssue, onReceive, onAddToCart, cartMode }: ItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const total = getTotalStock(item);
  const low = isLowStock(item);
  const out = isOutOfStock(item);
  const sizeEntries = Object.entries(item.sizeMap || {}).sort(([a], [b]) => a.localeCompare(b));
  const sizeCount = sizeEntries.length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all overflow-hidden">
      {/* Card body */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-900 leading-tight">{item.name}</h3>
          {out ? (
            <Badge variant="danger">Out</Badge>
          ) : low ? (
            <Badge variant="warning">Low</Badge>
          ) : (
            <Badge variant="success">In Stock</Badge>
          )}
        </div>

        {item.notes && (
          <p className="text-xs text-slate-400 mb-2 line-clamp-1">{item.notes}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
          <span className="font-medium text-lg text-slate-800">{total}</span>
          <span>units</span>
          {sizeCount > 0 && <span className="text-slate-400">· {sizeCount} sizes</span>}
        </div>

        {/* Size breakdown (expandable) */}
        {sizeCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 mb-3"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "Hide sizes" : "Show sizes"}
          </button>
        )}

        {expanded && (
          <div className="flex flex-wrap gap-1 mb-3">
            {sizeEntries.map(([size, stock]) => {
              const status = getStockStatus(stock.qty, stock.lowStockThreshold ?? item.lowStockThreshold ?? 5);
              const colorClass =
                status === "out-of-stock"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : status === "low-stock"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-700 border-slate-200";
              return (
                <span key={size} className={`inline-flex items-center px-2 py-0.5 text-xs rounded border ${colorClass}`}>
                  {size}: {stock.qty}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="border-t border-slate-100 px-4 py-2.5 flex gap-2">
        {cartMode && onAddToCart ? (
          <button
            onClick={() => onAddToCart(item)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors"
          >
            <ShoppingCart size={13} />
            Add to Cart
          </button>
        ) : (
          <button
            onClick={() => onIssue(item)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors"
          >
            <Package size={13} />
            Issue
          </button>
        )}
        {item.isIssuedByTeam && (
          <button
            onClick={() => onReceive(item)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <ArrowDownToLine size={13} />
            Receive
          </button>
        )}
      </div>
    </div>
  );
}
