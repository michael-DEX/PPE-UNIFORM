import { useState, useEffect } from "react";
import { useAuthContext } from "../../app/AuthProvider";
import { commitStockAdjust } from "../../lib/stockCommit";
import Drawer from "../../components/ui/Drawer";
import Button from "../../components/ui/Button";
import type { Item } from "../../types";

interface Props {
  item: Item | null;
  open: boolean;
  onClose: () => void;
}

export default function ReceiveStockDrawer({ item, open, onClose }: Props) {
  const { logisticsUser } = useAuthContext();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (item) {
      setQuantities({});
      setNotes("");
      setSuccess(false);
    }
  }, [item]);

  if (!item) return null;

  const sizeEntries = Object.entries(item.sizeMap || {}).sort(([a], [b]) => a.localeCompare(b));
  const hasQty = Object.values(quantities).some((q) => q > 0);

  async function handleSubmit() {
    if (!logisticsUser || !item || !hasQty) return;
    setSubmitting(true);
    try {
      const stockItems = Object.entries(quantities)
        .filter(([_, qty]) => qty > 0)
        .map(([size, qty]) => ({
          itemId: item.id,
          itemName: item.name,
          size,
          qtyChange: qty,
          qtyBefore: item.sizeMap[size]?.qty ?? 0,
        }));

      await commitStockAdjust({
        actor: logisticsUser,
        type: "receive",
        items: stockItems,
        notes: notes || undefined,
      });

      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      console.error("Failed to receive stock:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={`Receive Stock: ${item.name}`}>
      {success ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">&#10003;</div>
          <p className="text-lg font-medium text-emerald-700">Stock Updated</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter the quantity received for each size.
          </p>

          <div className="space-y-3">
            {sizeEntries.map(([size, stock]) => (
              <div key={size} className="flex items-center gap-3">
                <div className="w-24">
                  <span className="text-sm font-medium text-slate-700">{size}</span>
                  <span className="text-xs text-slate-400 block">
                    Current: {stock.qty}
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  value={quantities[size] || ""}
                  onChange={(e) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [size]: parseInt(e.target.value) || 0,
                    }))
                  }
                  placeholder="0"
                  className="w-24 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                />
                {(quantities[size] ?? 0) > 0 && (
                  <span className="text-xs text-emerald-600">
                    &rarr; {stock.qty + (quantities[size] ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
              placeholder="e.g., PO #1234, vendor shipment"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!hasQty || submitting}
            className="w-full"
          >
            {submitting ? "Saving..." : "Receive Stock"}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
