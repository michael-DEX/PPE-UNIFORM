import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import type { LogisticsUser } from "../types";

/**
 * Write a login/logout event to /audit_log.
 *
 * These events are observability-only — they MUST NOT throw. Sign-in and
 * sign-out are critical paths; a failed audit write should not block the user.
 * All errors are caught and console.error'd so they're visible in DevTools
 * but invisible to the caller.
 *
 * The Firestore rule on /audit_log requires `actorUid == request.auth.uid`,
 * which `user.id` satisfies (it equals the Firebase Auth UID by construction —
 * the /users/{uid} doc's ID is the Auth UID).
 */
async function writeAccessEvent(
  user: LogisticsUser,
  type: "login" | "logout",
  action: string,
): Promise<void> {
  try {
    await addDoc(collection(db, "audit_log"), {
      type,
      actorUid: user.id,
      actorName: user.name,
      actorRole: user.role,
      personnelId: null,
      personnelName: null,
      action,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error(`Failed to write ${type} audit event:`, err);
  }
}

export function logLoginEvent(user: LogisticsUser): Promise<void> {
  return writeAccessEvent(user, "login", "Logged in");
}

export function logLogoutEvent(user: LogisticsUser): Promise<void> {
  return writeAccessEvent(user, "logout", "Logged out");
}
