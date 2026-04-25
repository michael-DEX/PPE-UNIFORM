import type { OnboardingDraft } from "../../types";
import { isRowReady } from "../issue/onboardingRowState";

/**
 * Discriminator for a member's onboarding status, driven off the single
 * most-recent `onboarding_drafts` doc for that member.
 *
 *   - "not_started" — member has never had a draft
 *   - "in_progress" — a draft exists and has NOT been committed yet
 *                     (completedAt is still null); carries a 0-100 pct
 *   - "complete"    — a draft exists with completedAt stamped; carries the
 *                     parsed Date
 *
 * Shape is a discriminated union so callers get exhaustive type narrowing
 * (e.g. `state.progressPct` is only available in the `"in_progress"` arm).
 */
export type OnboardingState =
  | { status: "not_started" }
  | {
      status: "in_progress";
      draft: OnboardingDraft;
      /** 0–100, rounded. 0 when the draft has no cart rows yet. */
      progressPct: number;
    }
  | {
      status: "complete";
      draft: OnboardingDraft;
      /** Parsed from draft.completedAt so callers don't touch Timestamp. */
      completedAt: Date;
    };

/**
 * Fold the most-recent draft for a member into an `OnboardingState`.
 *
 * Intended wiring: the page runs a single `onSnapshot` query —
 *   `where("memberId", "==", id), orderBy("updatedAt", "desc"), limit(1)`
 * — without filtering on `completedAt`, and hands the resulting doc (or
 * `null` when the query returns empty) to this helper. Ordering by
 * `updatedAt` means a fresh draft supersedes an older completed one, which
 * matches user intent: a member who starts a second onboarding should be
 * shown as "in_progress", not "complete".
 *
 * The spec's alternative — two queries (one for `completedAt == null`, one
 * without) — works, but a single query is one snapshot listener instead of
 * two and one set of reads instead of two, for identical output.
 */
export function getOnboardingState(
  draft: OnboardingDraft | null,
): OnboardingState {
  if (!draft) return { status: "not_started" };

  // `completedAt` is stamped by OnboardingPage's commit flow via
  // serverTimestamp(); absence (null) means the wizard hasn't been
  // submitted yet.
  if (draft.completedAt) {
    return {
      status: "complete",
      draft,
      completedAt: draft.completedAt.toDate(),
    };
  }

  return {
    status: "in_progress",
    draft,
    progressPct: computeProgressPct(draft),
  };
}

/**
 * % of draft cart rows that are "ready" — qty > 0 AND (!needsSize OR size
 * set). Reuses `isRowReady` from the issue feature so the page status and
 * the onboarding wizard itself agree on what "done" means for a row.
 *
 * Returns 0 (not 100) for an empty cart so a brand-new draft with no rows
 * loaded doesn't read as "complete". Rounded to the nearest integer.
 *
 * Note: this is stricter than the ad-hoc inline calc in the current page
 * (which only checks `qty > 0`). Drafts with unfilled sizes will show a
 * lower pct under this helper — that's the correct behavior: an unsized
 * row isn't actually ready to commit.
 */
function computeProgressPct(draft: OnboardingDraft): number {
  const rows = draft.cartItems ?? [];
  if (rows.length === 0) return 0;
  const ready = rows.filter(isRowReady).length;
  return Math.round((ready / rows.length) * 100);
}
