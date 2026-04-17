import { useState, useEffect, useMemo } from "react";
import {
  Package,
  Check,
  ShoppingCart,
  Trash2,
  Clock,
} from "lucide-react";
import {
  onSnapshot,
  query,
  orderBy,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  limit as queryLimit,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { backorderedRef, orderListsRef } from "../../lib/firestore";
import { useAuthContext } from "../../app/AuthProvider";
import Spinner from "../../components/ui/Spinner";
import EmptyState from "../../components/ui/EmptyState";
import Modal from "../../components/ui/Modal";
import type { BackorderItem, OrderListItem } from "../../types";

// ── View mode ──

type ViewMode = "pending" | "fulfilled";

// ── Helpers ──

function formatRelativeTime(ts: { seconds: number }): string {
  const now = Date.now();
  const diff = now - ts.seconds * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(ts);
}

function formatDate(ts: { seconds: number }): string {
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(ts: { seconds: number }): string {
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Page ──

export default function BackorderQueuePage() {
  const { user } = useAuthContext();

  const [backorders, setBackorders] = useState<BackorderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("pending");

  // Modal state for fulfill confirmation
  const [fulfillTarget, setFulfillTarget] = useState<BackorderItem | null>(null);
  const [fulfilling, setFulfilling] = useState(false);

  // Modal state for cancel confirmation
  const [cancelTarget, setCancelTarget] = useState<BackorderItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Real-time listener ──

  useEffect(() => {
    const q = query(backorderedRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: BackorderItem[] = snapshot.docs.map((d) => ({
          ...d.data(),
          id: d.id,
        }));
        setBackorders(items);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  // ── Filtered lists ──

  const pending = useMemo(
    () => backorders.filter((b) => b.fulfilledAt === null),
    [backorders],
  );

  const fulfilled = useMemo(
    () => backorders.filter((b) => b.fulfilledAt !== null),
    [backorders],
  );

  const displayed = viewMode === "pending" ? pending : fulfilled;

  // ── Summary stats (always based on pending) ──

  const uniqueMembers = useMemo(
    () => new Set(pending.map((b) => b.personnelId)).size,
    [pending],
  );

  const uniqueItems = useMemo(
    () => new Set(pending.map((b) => b.itemId)).size,
    [pending],
  );

  // ── Actions ──

  async function handleFulfill() {
    if (!fulfillTarget || !user) return;
    setFulfilling(true);
    try {
      const ref = doc(db, "backordered", fulfillTarget.id);
      await updateDoc(ref, {
        fulfilledAt: serverTimestamp(),
        fulfilledBy: user.uid,
      });
      setFulfillTarget(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to fulfill backorder");
    } finally {
      setFulfilling(false);
    }
  }

  async function handleAddToOrderList(bo: BackorderItem) {
    try {
      // Find or create the most recent order list
      const listsSnap = await getDocs(query(orderListsRef, orderBy("createdAt", "desc"), queryLimit(1)));
      let listId: string;
      if (listsSnap.empty) {
        // Create a new order list
        const ref = await addDoc(orderListsRef, {
          name: `Order List — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
          createdBy: user?.uid ?? "",
          createdAt: serverTimestamp(),
          exportedAt: null,
          items: [],
        });
        listId = ref.id;
      } else {
        listId = listsSnap.docs[0].id;
      }

      // Aggregate into the order list
      const listSnap = await getDoc(doc(db, "order_lists", listId));
      const currentItems: OrderListItem[] = listSnap.data()?.items ?? [];
      const newItem: OrderListItem = {
        itemId: bo.itemId,
        itemName: bo.itemName,
        size: bo.size,
        qtyToOrder: bo.qtyNeeded,
        notes: `Backorder for ${bo.personnelName}`,
      };
      const existingIdx = currentItems.findIndex(
        (i) => i.itemId === newItem.itemId && i.size === newItem.size
      );
      let updatedItems: OrderListItem[];
      if (existingIdx >= 0) {
        updatedItems = currentItems.map((i, idx) =>
          idx === existingIdx
            ? { ...i, qtyToOrder: i.qtyToOrder + newItem.qtyToOrder, notes: i.notes ? `${i.notes}; ${newItem.notes}` : newItem.notes }
            : i
        );
      } else {
        updatedItems = [...currentItems, newItem];
      }
      await updateDoc(doc(db, "order_lists", listId), { items: updatedItems });
      // Mark backorder as added to order list
      await updateDoc(doc(db, "backordered", bo.id), { addedToOrderAt: serverTimestamp() });
    } catch (err) {
      console.error("Failed to add to order list:", err);
      alert("Failed to add to order list");
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const ref = doc(db, "backordered", cancelTarget.id);
      await deleteDoc(ref);
      setCancelTarget(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to cancel backorder");
    } finally {
      setCancelling(false);
    }
  }

  // ── Loading / Error states ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load backorders: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Backorder Queue</h1>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Pending Backorders
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {pending.length}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Members Waiting
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {uniqueMembers}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Items Needed
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {uniqueItems}
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setViewMode("pending")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            viewMode === "pending"
              ? "border-navy-600 text-navy-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Pending
          <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
            {pending.length}
          </span>
        </button>
        <button
          onClick={() => setViewMode("fulfilled")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            viewMode === "fulfilled"
              ? "border-navy-600 text-navy-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Fulfilled
          <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
            {fulfilled.length}
          </span>
        </button>
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        viewMode === "pending" ? (
          <EmptyState
            icon={<Package size={48} />}
            title="No pending backorders"
            description="All items are currently in stock"
          />
        ) : (
          <EmptyState
            icon={<Check size={48} />}
            title="No fulfilled backorders yet"
            description="Fulfilled backorders will appear here"
          />
        )
      ) : viewMode === "pending" ? (
        <PendingTable
          items={displayed}
          onFulfill={setFulfillTarget}
          onAddToOrder={handleAddToOrderList}
          onCancel={setCancelTarget}
        />
      ) : (
        <FulfilledTable items={displayed} />
      )}

      {/* Fulfill confirmation modal */}
      <Modal
        open={fulfillTarget !== null}
        onClose={() => setFulfillTarget(null)}
        title="Fulfill Backorder"
      >
        {fulfillTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Mark this backorder as fulfilled?
            </p>
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div>
                <span className="font-medium text-slate-700">Member:</span>{" "}
                {fulfillTarget.personnelName}
              </div>
              <div>
                <span className="font-medium text-slate-700">Item:</span>{" "}
                {fulfillTarget.itemName}
                {fulfillTarget.size && (
                  <span className="text-slate-500"> ({fulfillTarget.size})</span>
                )}
              </div>
              <div>
                <span className="font-medium text-slate-700">Qty:</span>{" "}
                {fulfillTarget.qtyNeeded}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFulfillTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFulfill}
                disabled={fulfilling}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {fulfilling ? "Fulfilling..." : "Confirm Fulfill"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel confirmation modal */}
      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel Backorder"
      >
        {cancelTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel this backorder? This will permanently
              remove it.
            </p>
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div>
                <span className="font-medium text-slate-700">Member:</span>{" "}
                {cancelTarget.personnelName}
              </div>
              <div>
                <span className="font-medium text-slate-700">Item:</span>{" "}
                {cancelTarget.itemName}
                {cancelTarget.size && (
                  <span className="text-slate-500"> ({cancelTarget.size})</span>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Keep It
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {cancelling ? "Cancelling..." : "Delete Backorder"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Pending Table ──

function PendingTable({
  items,
  onFulfill,
  onAddToOrder,
  onCancel,
}: {
  items: BackorderItem[];
  onFulfill: (item: BackorderItem) => void;
  onAddToOrder: (item: BackorderItem) => void;
  onCancel: (item: BackorderItem) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
      <table className="w-full text-sm text-left">
        <thead className="sticky top-0 bg-gray-50 z-10">
          <tr>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Member Name
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Item
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Size
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Qty Needed
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Requested
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors even:bg-gray-50/50"
            >
              <td className="px-4 py-3">
                <span className="font-medium text-gray-900">
                  {item.personnelName}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700">
                {item.itemName}
                {item.addedToOrderAt && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">
                    On Order
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {item.size ?? "\u2014"}
              </td>
              <td className="px-4 py-3 font-bold tabular-nums">
                {item.qtyNeeded}
              </td>
              <td className="px-4 py-3">
                <span
                  className="flex items-center gap-1 text-gray-500"
                  title={item.createdAt ? formatDateTime(item.createdAt) : ""}
                >
                  <Clock size={14} className="text-gray-400 flex-shrink-0" />
                  {item.createdAt ? formatRelativeTime(item.createdAt) : "\u2014"}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onFulfill(item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                    title="Fulfill"
                  >
                    <Check size={14} />
                    Fulfill
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToOrder(item)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      item.addedToOrderAt
                        ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                        : "text-white bg-blue-600 hover:bg-blue-700"
                    }`}
                    title={item.addedToOrderAt ? "Already on order list — click to add again" : "Add to Order List"}
                  >
                    <ShoppingCart size={14} />
                    {item.addedToOrderAt ? "Ordered" : "Order"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancel(item)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded text-red-500 hover:bg-red-50 transition-colors"
                    title="Cancel backorder"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Fulfilled Table ──

function FulfilledTable({ items }: { items: BackorderItem[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-auto">
      <table className="w-full text-sm text-left">
        <thead className="sticky top-0 bg-gray-50 z-10">
          <tr>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Member Name
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Item
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Size
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Qty
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Requested
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Fulfilled
            </th>
            <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Fulfilled By
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors even:bg-gray-50/50"
            >
              <td className="px-4 py-3">
                <span className="font-medium text-gray-900">
                  {item.personnelName}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700">
                {item.itemName}
                {item.addedToOrderAt && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">
                    On Order
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {item.size ?? "\u2014"}
              </td>
              <td className="px-4 py-3 font-bold tabular-nums">
                {item.qtyNeeded}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {item.createdAt ? formatDate(item.createdAt) : "\u2014"}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Check size={14} />
                  {item.fulfilledAt ? formatDate(item.fulfilledAt) : "\u2014"}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-500">
                {item.fulfilledBy ?? "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
