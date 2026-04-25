import { useCallback, useEffect, useRef, useState } from "react";
import {
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  getDocs,
  startAfter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { auditLogRef } from "../lib/firestore";
import type { AuditEvent, AuditEventType } from "../types";

/** Pseudo-type for the Audit page's "Access" tab. Not a real event type —
 *  resolves client-side to `login` OR `logout`. */
export type AuditFilterType = AuditEventType | "access";

export interface AuditFilters {
  type?: AuditFilterType;
  actorUid?: string;
  searchQuery?: string;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Live first page via onSnapshot + cursor-paginated history via getDocs.
 *
 * The most recent `pageSize` events are subscribed in real time so the UI
 * reflects new transactions instantly. Older pages are fetched on demand
 * with `loadMore()` using Firestore's `startAfter` cursor — these are NOT
 * live (that would balloon the snapshot payload indefinitely).
 *
 * `searchQuery` is applied client-side across loaded events only.
 */
export function useAuditLog(filters: AuditFilters = {}) {
  const { type, actorUid, searchQuery, pageSize = DEFAULT_PAGE_SIZE } = filters;

  const [liveEvents, setLiveEvents] = useState<AuditEvent[]>([]);
  const [olderEvents, setOlderEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Cursor for the next page: the last doc snapshot we've seen.
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Base constraints shared between live page and paginated fetches.
  // Two pseudo-types skip the server-side `where` clause and filter
  // client-side below:
  //   - `access` = login OR logout
  //   - `adjust` = adjust OR item_create/edit/delete (item lifecycle events
  //     fold into this tab because they're catalog changes rather than
  //     gear flow — closest semantic match among existing tabs).
  const baseConstraints = useCallback((): QueryConstraint[] => {
    const cs: QueryConstraint[] = [];
    if (type && type !== "access" && type !== "adjust") {
      cs.push(where("type", "==", type));
    }
    if (actorUid) cs.push(where("actorUid", "==", actorUid));
    cs.push(orderBy("timestamp", "desc"));
    return cs;
  }, [type, actorUid]);

  // Subscribe to the live first page. Reset pagination whenever filters change.
  useEffect(() => {
    setLoading(true);
    setOlderEvents([]);
    lastDocRef.current = null;

    const q = query(auditLogRef, ...baseConstraints(), limit(pageSize));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs;
        const events = docs.map(
          (d) => ({ ...d.data(), id: d.id }) as AuditEvent,
        );
        setLiveEvents(events);
        // Track cursor from the live page so loadMore starts after it.
        lastDocRef.current = docs[docs.length - 1] ?? null;
        setHasMore(docs.length === pageSize);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [baseConstraints, pageSize]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const cursor = lastDocRef.current;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const q = query(
        auditLogRef,
        ...baseConstraints(),
        startAfter(cursor),
        limit(pageSize),
      );
      const snap = await getDocs(q);
      const docs = snap.docs;
      const nextBatch = docs.map(
        (d) => ({ ...d.data(), id: d.id }) as AuditEvent,
      );
      setOlderEvents((prev) => [...prev, ...nextBatch]);
      lastDocRef.current = docs[docs.length - 1] ?? cursor;
      setHasMore(docs.length === pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [baseConstraints, hasMore, loadingMore, pageSize]);

  // Combine + dedupe by id (live page may overlap briefly with older on filter flip).
  const combined = [...liveEvents, ...olderEvents];
  const seen = new Set<string>();
  const events: AuditEvent[] = [];
  for (const e of combined) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push(e);
  }

  // Client-side pseudo-type filters. `access` matches login/logout;
  // `adjust` matches stock adjustments plus item-lifecycle events. Both
  // skip the server `where("type", "==", ...)` in baseConstraints above
  // so the client sees the full recent page and narrows here.
  const ADJUST_TAB_TYPES: readonly string[] = [
    "adjust",
    "item_create",
    "item_edit",
    "item_delete",
    "onboarding_template_edit",
  ];
  const typeFiltered =
    type === "access"
      ? events.filter((e) => e.type === "login" || e.type === "logout")
      : type === "adjust"
      ? events.filter((e) => ADJUST_TAB_TYPES.includes(e.type))
      : events;

  const filtered = searchQuery
    ? typeFiltered.filter((e) => {
        const sq = searchQuery.toLowerCase();
        return (
          e.action.toLowerCase().includes(sq) ||
          e.actorName.toLowerCase().includes(sq) ||
          (e.personnelName?.toLowerCase().includes(sq) ?? false) ||
          (e.items?.some((i) => i.itemName.toLowerCase().includes(sq)) ?? false)
        );
      })
    : typeFiltered;

  return {
    events: filtered,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  };
}
