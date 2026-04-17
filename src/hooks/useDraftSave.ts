import { useState, useEffect, useCallback, useRef } from "react";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DraftEnvelope<T> {
  savedAt: number;
  data: T;
}

/**
 * Auto-saves state to localStorage and provides restore/clear.
 * Drafts expire after 24 hours.
 *
 * Usage:
 *   const { hasDraft, loadDraft, clearDraft, saveDraft } = useDraftSave<MyState>("ppe:onboarding");
 */
export function useDraftSave<T>(key: string) {
  const [hasDraft, setHasDraft] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const envelope: DraftEnvelope<T> = JSON.parse(raw);
      if (Date.now() - envelope.savedAt > DRAFT_EXPIRY_MS) {
        localStorage.removeItem(key);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });

  const loadDraft = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const envelope: DraftEnvelope<T> = JSON.parse(raw);
      if (Date.now() - envelope.savedAt > DRAFT_EXPIRY_MS) {
        localStorage.removeItem(key);
        setHasDraft(false);
        return null;
      }
      return envelope.data;
    } catch {
      return null;
    }
  }, [key]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
    setHasDraft(false);
  }, [key]);

  // Debounced save
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraft = useCallback(
    (data: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          const envelope: DraftEnvelope<T> = { savedAt: Date.now(), data };
          localStorage.setItem(key, JSON.stringify(envelope));
          setHasDraft(true);
        } catch {
          // localStorage full or unavailable — silently fail
        }
      }, 500);
    },
    [key]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { hasDraft, loadDraft, clearDraft, saveDraft };
}
