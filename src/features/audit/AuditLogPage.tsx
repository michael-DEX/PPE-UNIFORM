import { useState } from "react";
import {
  ClipboardList,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  User,
  Clock,
  Package,
} from "lucide-react";
import { useAuditLog } from "../../hooks/useAuditLog";
import SearchInput from "../../components/ui/SearchInput";
import Tabs from "../../components/ui/Tabs";
import Badge from "../../components/ui/Badge";
import Spinner from "../../components/ui/Spinner";
import EmptyState from "../../components/ui/EmptyState";
import type { AuditEvent, AuditEventType } from "../../types";

// ── Constants ──

const TYPE_TABS = [
  { id: "all", label: "All" },
  { id: "issue", label: "Issue" },
  { id: "receive", label: "Receive" },
  { id: "return", label: "Return" },
  { id: "adjust", label: "Adjust" },
  { id: "scan", label: "Scan" },
];

type BadgeVariant = "info" | "success" | "default" | "warning" | "backorder";

const TYPE_BADGE_MAP: Record<AuditEventType, { label: string; variant: BadgeVariant }> = {
  issue: { label: "Issue", variant: "info" },
  receive: { label: "Receive", variant: "success" },
  return: { label: "Return", variant: "default" },
  adjust: { label: "Adjust", variant: "warning" },
  scan: { label: "Scan", variant: "backorder" },
};

// ── Helpers ──

function formatTimestamp(ts: { seconds: number }): string {
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  return formatTimestamp(ts);
}

// ── Page ──

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { events, loading, error } = useAuditLog({
    type: typeFilter === "all" ? undefined : (typeFilter as AuditEventType),
    searchQuery: search || undefined,
    pageSize: 50,
  });

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
          Failed to load audit log: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Audit Log</h1>
        <span className="text-sm text-slate-500">{events.length} events</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by member, item, or officer..."
          className="sm:w-96"
        />
      </div>

      <Tabs
        tabs={TYPE_TABS}
        active={typeFilter}
        onChange={setTypeFilter}
      />

      {events.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={48} />}
          title="No audit events found"
          description={
            search
              ? "Try a different search term"
              : typeFilter !== "all"
              ? "No events for this type"
              : "Audit events will appear here as transactions occur"
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {events.map((event) => (
            <AuditRow
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              onToggle={() =>
                setExpandedId(expandedId === event.id ? null : event.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Event Row ──

function AuditRow({
  event,
  expanded,
  onToggle,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badgeInfo = TYPE_BADGE_MAP[event.type];

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
      >
        <span className="text-slate-400 flex-shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        <Badge variant={badgeInfo.variant} className="flex-shrink-0 w-16 justify-center">
          {badgeInfo.label}
        </Badge>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-900 truncate block">
            {event.action}
          </span>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
            {event.personnelName && (
              <span className="flex items-center gap-1">
                <User size={12} />
                {event.personnelName}
              </span>
            )}
            <span className="flex items-center gap-1">
              <ClipboardList size={12} />
              {event.actorName}
              {event.actorRole && (
                <span className="text-slate-400">({event.actorRole})</span>
              )}
            </span>
          </div>
        </div>

        <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
          {formatRelativeTime(event.timestamp)}
        </span>
      </button>

      {expanded && <AuditDetail event={event} />}
    </div>
  );
}

// ── Expanded Detail ──

function AuditDetail({ event }: { event: AuditEvent }) {
  return (
    <div className="px-4 pb-4 pl-12 space-y-3">
      {/* Who / What / When summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 rounded-lg p-3 text-sm">
        <div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            Who
          </div>
          <div className="text-slate-700 font-medium">{event.actorName}</div>
          <div className="text-xs text-slate-500">{event.actorRole}</div>
          {event.personnelName && (
            <div className="mt-1 text-xs text-slate-500">
              Member: <span className="text-slate-700">{event.personnelName}</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            What
          </div>
          <div className="text-slate-700">{event.action}</div>
          <div className="text-xs text-slate-500 mt-0.5 font-mono">
            TX: {event.transactionId.slice(0, 8)}...
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            When
          </div>
          <div className="flex items-center gap-1.5 text-slate-700">
            <Clock size={14} className="text-slate-400" />
            {formatTimestamp(event.timestamp)}
          </div>
        </div>
      </div>

      {/* Items table */}
      {event.items.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 font-medium text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Package size={14} />
                    Item
                  </div>
                </th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Size</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Before</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600">
                  <ArrowRightLeft size={14} className="inline" />
                </th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">After</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600">Delta</th>
              </tr>
            </thead>
            <tbody>
              {event.items.map((item, idx) => (
                <tr
                  key={`${item.itemId}-${idx}`}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2 text-slate-900 font-medium">
                    {item.itemName}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {item.size ?? "--"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                    {item.qtyBefore}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-300">
                    &rarr;
                  </td>
                  <td className="px-3 py-2 text-slate-700 tabular-nums">
                    {item.qtyAfter}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    <DeltaBadge delta={item.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Delta display ──

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="text-emerald-600">+{delta}</span>
    );
  }
  if (delta < 0) {
    return (
      <span className="text-red-600">{delta}</span>
    );
  }
  return <span className="text-slate-400">0</span>;
}
