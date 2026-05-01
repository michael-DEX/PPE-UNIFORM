import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { cachesRef, locationsRef } from "../lib/firestore";
import type { Cache, Location } from "../types";

export interface CachesAndLocationsState {
  caches: Cache[];
  locations: Location[];
  /** True until both initial snapshots have arrived. */
  loading: boolean;
  /** Both initial snapshots arrived AND both collections were empty. The
   *  cache page uses this to decide whether to surface the seed empty state. */
  isEmpty: boolean;
}

/**
 * Live subscription to the `caches` and `locations` collections. Returns
 * everything (active and inactive) sorted alphabetically by name; the
 * consumer decides what to filter.
 */
export function useCachesAndLocations(): CachesAndLocationsState {
  const [caches, setCaches] = useState<Cache[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [cachesLoaded, setCachesLoaded] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      cachesRef,
      (snap) => {
        const next: Cache[] = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Cache);
        next.sort((a, b) => a.name.localeCompare(b.name));
        setCaches(next);
        setCachesLoaded(true);
      },
      (err) => {
        console.error("[useCachesAndLocations] caches subscription failed:", err);
        setCachesLoaded(true);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      locationsRef,
      (snap) => {
        const next: Location[] = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Location);
        next.sort((a, b) => a.name.localeCompare(b.name));
        setLocations(next);
        setLocationsLoaded(true);
      },
      (err) => {
        console.error("[useCachesAndLocations] locations subscription failed:", err);
        setLocationsLoaded(true);
      },
    );
    return unsub;
  }, []);

  const loading = !cachesLoaded || !locationsLoaded;
  const isEmpty = !loading && caches.length === 0 && locations.length === 0;

  return useMemo(
    () => ({ caches, locations, loading, isEmpty }),
    [caches, locations, loading, isEmpty],
  );
}
