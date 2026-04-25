import { useState, useEffect, useCallback } from "react";
import type { User } from "firebase/auth";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { logLoginEvent, logLogoutEvent } from "../lib/authCommit";
import type { LogisticsUser, LogisticsRole } from "../types";

// Dedupe key for login audit events: we log at most one per browser session
// per UID so page reloads with a cached credential don't spam the audit log.
const LOGIN_LOG_KEY = "logisticsLoginLogged";

export interface AuthState {
  user: User | null;
  logisticsUser: LogisticsUser | null;
  isLogistics: boolean;
  /** Manager-tier access: manager or admin */
  isManager: boolean;
  /** Admin-only access (user management, seed page) */
  isAdmin: boolean;
  loading: boolean;
}

function normalizeRole(data: Record<string, unknown>): LogisticsRole {
  const raw = String(data.role ?? "").toLowerCase();
  if (raw === "admin") return "admin";
  // Legacy: existing "logistics_manager" users get promoted to admin for
  // backward compatibility (they previously had full privileges).
  if (raw === "logistics_manager") return "admin";
  if (raw === "manager") return "manager";
  if (raw === "staff" || raw === "logistics_staff") return "staff";
  const lvl = Number(data.permissionLevel);
  if (!Number.isNaN(lvl) && lvl >= 3) return "admin";
  return "staff";
}

export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [user, setUser] = useState<User | null>(null);
  const [logisticsUser, setLogisticsUser] = useState<LogisticsUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Listen to logistics user doc
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const unsubUser = onSnapshot(userDocRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            // Normalize from existing schema: legacy role "logistics_manager"
            // maps to runtime role "admin"; `status: "active"` maps to
            // `isActive: true`; display name falls back to firstName/lastName.
            const normalized: LogisticsUser = {
              id: snap.id,
              name: data.name || [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email || "Unknown",
              role: normalizeRole(data),
              email: data.email || "",
              // TODO: remove `data.status === "active"` after
              // scripts/migrateUsersIsActive.ts is run against prod.
              isActive: data.isActive === true || data.status === "active",
              createdAt: data.createdAt,
            };
            setLogisticsUser(normalized);
          } else {
            setLogisticsUser(null);
          }
          setLoading(false);
        });
        return () => unsubUser();
      } else {
        setLogisticsUser(null);
        setLoading(false);
      }
    });
    return () => unsubAuth();
  }, []);

  // Log a login audit event once per browser session per UID. `onAuthStateChanged`
  // fires on every page reload when a session cookie is cached, so we dedupe
  // via sessionStorage to avoid spamming the audit log. A real sign-in clears
  // the key (see signOut) so the next session produces a fresh event.
  useEffect(() => {
    if (!logisticsUser?.id) return;
    try {
      const logged = sessionStorage.getItem(LOGIN_LOG_KEY);
      if (logged === logisticsUser.id) return;
      sessionStorage.setItem(LOGIN_LOG_KEY, logisticsUser.id);
    } catch {
      // sessionStorage can throw in some sandboxed contexts — if so, we
      // tolerate an extra login event rather than blocking the app.
    }
    void logLoginEvent(logisticsUser);
  }, [logisticsUser?.id, logisticsUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signOut = useCallback(async () => {
    // Capture the current profile before firebaseSignOut tears down auth —
    // the audit write needs a valid token AND a non-null profile.
    const capturedUser = logisticsUser;
    if (capturedUser) {
      try {
        await logLogoutEvent(capturedUser);
      } catch (err) {
        // logLogoutEvent already catches internally; this is belt-and-suspenders
        // so a stray throw can't block signOut.
        console.error("Logout audit failed:", err);
      }
    }
    await firebaseSignOut(auth);
    setLogisticsUser(null);
    try {
      sessionStorage.removeItem(LOGIN_LOG_KEY);
    } catch {
      /* ignore */
    }
  }, [logisticsUser]);

  const isActive = logisticsUser?.isActive === true;
  const role = logisticsUser?.role;
  return {
    user,
    logisticsUser,
    isLogistics: isActive,
    isManager: isActive && (role === "manager" || role === "admin"),
    isAdmin: isActive && role === "admin",
    loading,
    signIn,
    signOut,
  };
}
