import { useState, useEffect, useCallback } from "react";
import type { User } from "firebase/auth";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import type { LogisticsUser, LogisticsRole } from "../types";

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
            // Normalize from existing schema: role "admin" → logistics_manager,
            // status "active" → isActive true, name from firstName/lastName
            const normalized: LogisticsUser = {
              id: snap.id,
              name: data.name || [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email || "Unknown",
              role: normalizeRole(data),
              email: data.email || "",
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

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setLogisticsUser(null);
  }, []);

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
