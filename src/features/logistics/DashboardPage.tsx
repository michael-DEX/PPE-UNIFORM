import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Users,
  ShoppingCart,
  PackagePlus,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { useInventory, isLowStock, isOutOfStock } from "../../hooks/useInventory";
import { usePersonnel } from "../../hooks/usePersonnel";
import { useAuthContext } from "../../app/AuthProvider";
import Badge from "../../components/ui/Badge";
import Spinner from "../../components/ui/Spinner";
import ItemDetailModal from "../inventory/ItemDetailModal";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import type { Item } from "../../types";

export default function DashboardPage() {
  const { logisticsUser } = useAuthContext();
  const { items, loading: itemsLoading } = useInventory();
  const { members, loading: membersLoading } = usePersonnel();
  const navigate = useNavigate();
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  const loading = itemsLoading || membersLoading;

  const lowStockItems = items.filter((i) => i.isIssuedByTeam && isLowStock(i));
  const outOfStockItems = items.filter((i) => i.isIssuedByTeam && isOutOfStock(i));
  const activeMembers = members.filter((m) => m.isActive);
  const teamItemCount = items.filter((i) => i.isIssuedByTeam).length;
  const alertCount = outOfStockItems.length + lowStockItems.length;
  const alertsActive = outOfStockItems.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-navy-900">
          Welcome back{logisticsUser ? `, ${logisticsUser.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-slate-500 mt-1">CA-TF2 / USA-02 PPE Logistics</p>
      </div>

      {/* Quick actions strip */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden grid grid-cols-4">
        <QuickAction
          icon={<ShoppingCart size={20} />}
          label="Issue"
          onClick={() => navigate("/logistics/inventory")}
        />
        <QuickAction
          icon={<Package size={20} />}
          label="Inventory"
          onClick={() => navigate("/logistics/inventory")}
        />
        <QuickAction
          icon={<Users size={20} />}
          label="People"
          onClick={() => navigate("/logistics/personnel")}
        />
        <QuickAction
          icon={<PackagePlus size={20} />}
          label="Receive"
          onClick={() => navigate("/logistics/inventory/scan")}
          last
        />
      </div>

      {/* Stats strip */}
      <div className="bg-white rounded-xl border border-slate-200 grid grid-cols-3 px-2 py-3">
        <StatCell label="Items" value={teamItemCount} />
        <StatCell label="Members" value={activeMembers.length} />
        <StatCell label="Alerts" value={alertCount} alert={alertsActive} last />
      </div>

      {/* Stock Alerts — clicking a row opens the full ItemDetailModal
          (stock table, adjust, issue). Quick-add-to-cart is reachable from
          the inventory list itself. */}
      {alertCount > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-700">Stock Alerts</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {[...outOfStockItems, ...lowStockItems].slice(0, 10).map((item) => {
              const out = isOutOfStock(item);
              const subtitle = subtitleFromItem(item);
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 text-left transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {item.name}
                    </p>
                    {subtitle && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {subtitle}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={out ? "danger" : "warning"}
                    className="whitespace-nowrap"
                  >
                    {out ? "Out of Stock" : "Low Stock"}
                  </Badge>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <ItemDetailModal
        item={selectedItem}
        open={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
        startInAdjust={true}
      />
    </div>
  );
}

// ── Stats strip cell ──────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  alert,
  last,
}: {
  label: string;
  value: number;
  alert?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-1 ${
        last ? "" : "border-r border-slate-200"
      }`}
    >
      <span
        className={`text-2xl font-bold leading-tight ${
          alert ? "text-amber-600" : "text-navy-900"
        }`}
      >
        {value}
      </span>
      <span
        className={`text-[10px] font-medium uppercase tracking-wider mt-0.5 ${
          alert ? "text-amber-600" : "text-slate-500"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ── Quick action button ──────────────────────────────────────────────────

function QuickAction({
  icon,
  label,
  onClick,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-3 px-1 min-h-[56px] hover:bg-slate-50 active:bg-slate-100 transition-colors ${
        last ? "" : "border-r border-slate-100"
      }`}
    >
      <span className="text-navy-600">{icon}</span>
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </button>
  );
}
