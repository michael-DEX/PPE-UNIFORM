import type { Item } from "../../../types";

export default function SettingsSection({
  item,
  canDelete,
  onRequestDelete,
}: {
  item: Item;
  canDelete?: boolean;
  onRequestDelete?: () => void;
}) {
  const formatDate = (ts: { toDate?: () => Date } | null | undefined) => {
    if (!ts || !ts.toDate) return "—";
    return ts.toDate().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3 pt-3">
      <Row label="Manufacturer" value={item.manufacturer || "—"} />
      <Row label="Model" value={item.model || "—"} />
      <Row label="Description" value={item.description || "—"} />
      <Row label="Notes" value={item.notes || "—"} />
      <Row label="Low Stock Threshold" value={String(item.lowStockThreshold)} />
      <Row label="Unit of Issue" value={item.unitOfIssue || "each"} />
      <Row label="Status" value={item.isActive ? "Active" : "Inactive"} />
      <Row label="Last Updated" value={formatDate(item.updatedAt)} />
      <Row label="Created" value={formatDate(item.createdAt)} />

      {canDelete && onRequestDelete && (
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Danger zone</p>
          <button
            type="button"
            onClick={onRequestDelete}
            className="w-full min-h-[44px] rounded-lg border border-red-300 bg-red-50 text-red-700 font-medium hover:bg-red-100 transition-colors"
          >
            Delete item
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between text-sm py-1 border-b border-gray-50">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right max-w-[60%]">{value}</span>
    </div>
  );
}
