import { useState, useEffect } from "react";
import { query, orderBy, limit, where, onSnapshot, type QueryConstraint } from "firebase/firestore";
import { auditLogRef } from "../lib/firestore";
import type { AuditEvent, AuditEventType } from "../types";

export interface AuditFilters {
  type?: AuditEventType;
  actorUid?: string;
  searchQuery?: string;
  pageSize?: number;
}

export function useAuditLog(filters: AuditFilters = {}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const constraints: QueryConstraint[] = [];

    if (filters.type) {
      constraints.push(where("type", "==", filters.type));
    }
    if (filters.actorUid) {
      constraints.push(where("actorUid", "==", filters.actorUid));
    }

    constraints.push(orderBy("timestamp", "desc"));
    constraints.push(limit(filters.pageSize ?? 50));

    const q = query(auditLogRef, ...constraints);
    const unsub = onSnapshot(
      q,
      (snap) => {
        let results = snap.docs.map(
          (d) => ({ ...d.data(), id: d.id }) as AuditEvent
        );

        // Client-side text search
        if (filters.searchQuery) {
          const sq = filters.searchQuery.toLowerCase();
          results = results.filter(
            (e) =>
              e.action.toLowerCase().includes(sq) ||
              e.actorName.toLowerCase().includes(sq) ||
              (e.personnelName?.toLowerCase().includes(sq) ?? false) ||
              e.items.some((i) => i.itemName.toLowerCase().includes(sq))
          );
        }

        setEvents(results);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return unsub;
  }, [filters.type, filters.actorUid, filters.searchQuery, filters.pageSize]);

  return { events, loading, error };
}
