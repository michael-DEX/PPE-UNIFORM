/**
 * One-time migration: normalize /users/* documents onto the `isActive` field.
 *
 * Background:
 *   Older user docs used `status: "active" | "inactive"`. New docs use
 *   `isActive: boolean`. Runtime code + firestore.rules currently accept
 *   EITHER field for backward compatibility. Once this migration has run,
 *   the legacy `status` fallback can be removed from:
 *     - firestore.rules (function isLogistics)
 *     - src/hooks/useAuth.ts (the `|| data.status === "active"` branch)
 *     - functions/src/inviteUser.ts (the `|| callerData.status === "active"` branch)
 *
 * What this does:
 *   For every doc in /users:
 *     - If `isActive` is already a boolean → leave alone.
 *     - Else if `status === "active"` → set isActive: true, delete status.
 *     - Else if `status` exists (any other value) → set isActive: false, delete status.
 *     - Else → set isActive: false (safe default; admin can re-enable).
 *
 * How to run:
 *   1. Save a Firebase Admin service-account JSON and export its path:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   2. From the repo root:
 *        npx tsx scripts/migrateUsersIsActive.ts             # dry run
 *        npx tsx scripts/migrateUsersIsActive.ts --apply     # actually write
 *
 * After it succeeds cleanly, remove the legacy fallbacks in the files listed
 * above and redeploy rules + functions.
 */

import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

async function main() {
  console.log(`[migrate] mode: ${APPLY ? "APPLY (writes enabled)" : "DRY RUN"}`);

  const snap = await db.collection("users").get();
  console.log(`[migrate] found ${snap.size} user docs`);

  let alreadyOk = 0;
  let migratedActive = 0;
  let migratedInactive = 0;
  let needsWrite = 0;

  const batch = db.batch();

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasIsActive = typeof data.isActive === "boolean";
    const legacyStatus = typeof data.status === "string" ? data.status : null;

    if (hasIsActive && legacyStatus == null) {
      alreadyOk++;
      continue;
    }

    let nextIsActive: boolean;
    if (hasIsActive) {
      nextIsActive = data.isActive === true;
    } else if (legacyStatus === "active") {
      nextIsActive = true;
    } else {
      nextIsActive = false;
    }

    const update: Record<string, unknown> = {
      isActive: nextIsActive,
    };
    if (legacyStatus != null) {
      update.status = admin.firestore.FieldValue.delete();
    }

    console.log(
      `  • ${doc.id}: ${JSON.stringify({
        before: { isActive: data.isActive, status: legacyStatus },
        after: { isActive: nextIsActive, status: "(deleted)" },
      })}`,
    );

    if (nextIsActive) migratedActive++;
    else migratedInactive++;
    needsWrite++;

    if (APPLY) {
      batch.update(doc.ref, update);
    }
  }

  console.log(
    `[migrate] summary: ok=${alreadyOk} activate=${migratedActive} deactivate=${migratedInactive} totalWrites=${needsWrite}`,
  );

  if (APPLY && needsWrite > 0) {
    await batch.commit();
    console.log("[migrate] ✓ committed");
  } else if (!APPLY) {
    console.log("[migrate] dry run — rerun with --apply to write changes");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
