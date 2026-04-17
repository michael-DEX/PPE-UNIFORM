import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Users, ShoppingCart, UserPlus, AlertTriangle } from "lucide-react";
import { useInventory, isLowStock, isOutOfStock } from "../../hooks/useInventory";
import { usePersonnel } from "../../hooks/usePersonnel";
import { useAuthContext } from "../../app/AuthProvider";
import Badge from "../../components/ui/Badge";
import Spinner from "../../components/ui/Spinner";
import ItemDetailModal from "../inventory/ItemDetailModal";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">
          Welcome back{logisticsUser ? `, ${logisticsUser.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-slate-500 mt-1">CA-TF2 / USA-02 PPE Logistics</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickAction icon={<ShoppingCart size={20} />} label="Issue Gear" onClick={() => navigate("/logistics/inventory")} />
        <QuickAction icon={<UserPlus size={20} />} label="Onboarding" onClick={() => navigate("/logistics/onboarding")} />
        <QuickAction icon={<Package size={20} />} label="Inventory" onClick={() => navigate("/logistics/inventory")} />
        <QuickAction icon={<Users size={20} />} label="Personnel" onClick={() => navigate("/logistics/personnel")} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Items"
          value={items.filter((i) => i.isIssuedByTeam).length}
          sub={`${items.filter((i) => i.isIssuedByTeam).length} item types tracked`}
        />
        <StatCard label="Active Members" value={activeMembers.length} sub={`${members.length} total`} />
        <StatCard
          label="Alerts"
          value={lowStockItems.length + outOfStockItems.length}
          sub={`${outOfStockItems.length} out of stock, ${lowStockItems.length} low stock`}
          alert={outOfStockItems.length > 0}
        />
      </div>

      {/* Low Stock Alerts */}
      {(outOfStockItems.length > 0 || lowStockItems.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-700">Stock Alerts</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {[...outOfStockItems, ...lowStockItems].slice(0, 10).map((item) => {
              const out = isOutOfStock(item);
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="w-full px-5 py-3 flex items-center justify-between hover:bg-blue-50/50 text-left transition-colors"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-900">{item.name}</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {Object.entries(item.sizeMap || {}).filter(([_, s]) => s.qty <= (s.lowStockThreshold ?? item.lowStockThreshold ?? 5)).map(([size, s]) => (
                        <span key={size} className={`text-xs px-1.5 py-0.5 rounded ${s.qty <= 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                          {size}: {s.qty}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Badge variant={out ? "danger" : "warning"}>
                    {out ? "Out of Stock" : "Low Stock"}
                  </Badge>
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

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-slate-200 hover:border-navy-300 hover:shadow-sm transition-all"
    >
      <div className="text-navy-600">{icon}</div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </button>
  );
}

function StatCard({ label, value, sub, alert }: { label: string; value: number; sub?: string; alert?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${alert ? "border-amber-200" : "border-slate-200"}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${alert ? "text-amber-600" : "text-navy-900"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}
