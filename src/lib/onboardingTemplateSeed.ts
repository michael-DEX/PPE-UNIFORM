import { writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import { ONBOARDING_TEMPLATE_ITEM_NAMES } from "../constants/onboardingTemplate";
import type { Item, LogisticsUser } from "../types";

export interface SeedOnboardingTemplateResult {
  success: boolean;
  /** Template itemIds successfully resolved + written to Firestore, in template order. */
  seededItemIds: string[];
  /**
   * Names from `ONBOARDING_TEMPLATE_ITEM_NAMES` that did NOT match any live
   * Firestore item by exact name. Surfaced to the admin as a "⚠ N items
   * couldn't be resolved" banner so rename drift doesn't silently drop
   * during migration.
   */
  unresolvedNames: string[];
}

/**
 * One-shot migration: seeds `/app_config/onboarding_template` from the
 * current hardcoded `ONBOARDING_TEMPLATE_ITEM_NAMES` array, resolving
 * names to live Firestore item IDs. Writes an `onboarding_template_edit`
 * audit event (before: [], after: seededItemIds) in the same batch so
 * the seed + its audit trail commit atomically.
 *
 * Intended to be invoked ONCE on initial Settings-page load when the
 * template doc doesn't exist yet. The caller is responsible for the
 * "doc exists? skip seed" idempotency guard — this function does not
 * check; it just writes.
 *
 * Returns both the successful itemIds AND any names that failed to
 * resolve, so the UI can render a one-time reconciliation warning.
 * Throws on Firestore write errors (caller handles).
 *
 * NOTE: Phase 2A defines this helper but does NOT invoke it. Phase 2B
 * wires it into the Settings page's initial-load handler.
 *
 * Signature note: takes `actor: LogisticsUser` (not just `actorUid`) so
 * the audit event can be stamped with name + role via the existing
 * `addAuditEventToBatch` contract. Matches the pattern of the other
 * commit helpers (commitIssue, commitItemEdit, etc.).
 */
export async function seedOnboardingTemplate(
  firestoreItems: Item[],
  actor: LogisticsUser,
): Promise<SeedOnboardingTemplateResult> {
  const nameToId = new Map<string, string>();
  for (const item of firestoreItems) {
    nameToId.set(item.name, item.id);
  }

  const seededItemIds: string[] = [];
  const unresolvedNames: string[] = [];

  for (const name of ONBOARDING_TEMPLATE_ITEM_NAMES) {
    const id = nameToId.get(name);
    if (id) seededItemIds.push(id);
    else unresolvedNames.push(name);
  }

  const batch = writeBatch(db);

  // Template doc.
  batch.set(doc(db, "app_config", "onboarding_template"), {
    itemIds: seededItemIds,
    updatedAt: serverTimestamp(),
    updatedBy: actor.id,
  });

  // Audit event — before is empty array (no prior state at first seed),
  // after is what we just wrote. `addAuditEventToBatch` will deep-strip
  // undefined and stamp the server timestamp.
  addAuditEventToBatch(batch, {
    type: "onboarding_template_edit",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Seeded onboarding template (${seededItemIds.length} items${
      unresolvedNames.length > 0
        ? `, ${unresolvedNames.length} unresolved`
        : ""
    })`,
    templateChange: {
      before: [],
      after: seededItemIds,
    },
  });

  await batch.commit();

  return {
    success: true,
    seededItemIds,
    unresolvedNames,
  };
}
