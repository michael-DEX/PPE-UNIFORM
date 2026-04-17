/**
 * Admin-only page for managing logistics users.
 *
 * Route: /logistics/admin/users
 *
 * - Lists all users in the `users` Firestore collection
 * - Lets admins change a user's role (admin / manager / staff)
 * - Toggle active/inactive
 * - Remove user (deletes the users/{uid} doc)
 *
 * NOTE: This page only manages the Firestore `users` documents — it does NOT
 * create Firebase Auth accounts. To add a new user:
 *   1. Admin creates the Firebase Auth account (via Firebase Console or CLI)
 *    2. Admin adds a doc in this page with that user's Firebase UID as the ID,
 *      their email, name, and role
 *   3. User signs in with their Firebase Auth credentials
 */

import { useState, useEffect } from "react";
import { onSnapshot, doc, setDoc, deleteDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { db, auth } from "../../lib/firebase";
import { usersRef } from "../../lib/firestore";
import { useAuthContext } from "../../app/AuthProvider";
import type { LogisticsUser, LogisticsRole } from "../../types";
import { Trash2, Plus, Check, Mail, KeyRound } from "lucide-react";

const ROLE_LABELS: Record<LogisticsRole, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

const ROLE_DESCRIPTIONS: Record<LogisticsRole, string> = {
  admin: "Full access — user management, seed/wipe items, edit/delete items, issue/adjust stock",
  manager: "Create/edit/delete items, issue/adjust stock. No user management or bulk seed.",
  staff: "Issue equipment, adjust/receive stock. Cannot edit or delete items.",
};

interface NewUserForm {
  email: string;
  name: string;
  role: LogisticsRole;
}

const emptyNewUser: NewUserForm = { email: "", name: "", role: "staff" };

export default function UsersPage() {
  const { isAdmin, logisticsUser } = useAuthContext();
  const [users, setUsers] = useState<LogisticsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>(emptyNewUser);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<{ email: string; resetLink: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      usersRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as LogisticsUser);
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load users:", err);
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  async function updateRole(userId: string, role: LogisticsRole) {
    setSavingId(userId);
    setError(null);
    try {
      await setDoc(doc(db, "users", userId), { role }, { merge: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(userId: string, nextActive: boolean) {
    setSavingId(userId);
    setError(null);
    try {
      await setDoc(doc(db, "users", userId), { isActive: nextActive }, { merge: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle active");
    } finally {
      setSavingId(null);
    }
  }

  async function sendReset(userId: string, email: string) {
    if (!email) {
      setError("This user has no email on record — can't send a reset.");
      return;
    }
    setSavingId(userId);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setInviteSuccess({ email, resetLink: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setSavingId(null);
    }
  }

  async function removeUser(userId: string, name: string) {
    if (userId === logisticsUser?.id) {
      alert("You cannot remove your own account.");
      return;
    }
    if (!window.confirm(`Remove user "${name}"? This deletes their access doc. Their Firebase Auth account stays — you'll need to delete that separately if desired.`)) {
      return;
    }
    setSavingId(userId);
    setError(null);
    try {
      await deleteDoc(doc(db, "users", userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddUser() {
    setError(null);
    if (!logisticsUser) {
      setError("Not signed in.");
      return;
    }
    if (!newUser.email.trim() || !newUser.name.trim()) {
      setError("Email and name are both required.");
      return;
    }
    setInviting(true);
    const email = newUser.email.trim();
    const name = newUser.name.trim();
    const role = newUser.role;
    try {
      const inviteRef = await addDoc(collection(db, "user_invites"), {
        email,
        name,
        role,
        requestedBy: logisticsUser.id,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      // Watch the invite doc for completion
      const timeout = setTimeout(() => {
        unsub();
        setInviting(false);
        setError("Invite is taking longer than expected. Check Firebase Auth console manually.");
      }, 30000);

      const unsub = onSnapshot(inviteRef, (snap) => {
        const d = snap.data();
        if (!d) return;
        if (d.status === "success") {
          clearTimeout(timeout);
          unsub();
          setInviteSuccess({ email, resetLink: d.resetLink ?? "" });
          setNewUser(emptyNewUser);
          setAdding(false);
          setInviting(false);
        } else if (d.status === "failed") {
          clearTimeout(timeout);
          unsub();
          setError(d.error ?? "Invite failed.");
          setInviting(false);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to invite user";
      setError(msg);
      setInviting(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-red-600">
        Access denied. Only admins can manage users.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage logistics users and their access levels.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add User
          </button>
        )}
      </div>

      {/* Role legend */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
        {(Object.keys(ROLE_LABELS) as LogisticsRole[]).map((r) => (
          <div key={r} className="flex items-start gap-3">
            <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              r === "admin" ? "bg-purple-100 text-purple-700"
              : r === "manager" ? "bg-blue-100 text-blue-700"
              : "bg-emerald-100 text-emerald-700"
            }`}>
              {ROLE_LABELS[r]}
            </span>
            <span className="text-xs text-slate-600">{ROLE_DESCRIPTIONS[r]}</span>
          </div>
        ))}
      </div>

      {/* Email sent banner (works for both invite and reset) */}
      {inviteSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <Mail size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-900">
                {inviteSuccess.resetLink ? "Invitation sent to" : "Password reset email sent to"} {inviteSuccess.email}
              </p>
              <p className="text-xs text-emerald-700 mt-1">
                Firebase emailed a password-reset link. The user clicks it, sets their password, and signs in.
              </p>
              {inviteSuccess.resetLink && (
                <details className="mt-2">
                  <summary className="text-xs text-emerald-700 cursor-pointer hover:underline">
                    Copy the reset link manually (fallback if email doesn't arrive)
                  </summary>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 text-[10px] bg-white border border-emerald-200 rounded px-2 py-1 break-all font-mono">
                      {inviteSuccess.resetLink}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteSuccess.resetLink)}
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-2 py-1"
                    >
                      Copy
                    </button>
                  </div>
                </details>
              )}
            </div>
            <button
              onClick={() => setInviteSuccess(null)}
              className="text-emerald-500 hover:text-emerald-700 text-sm px-1"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Add user form */}
      {adding && (
        <div className="rounded-lg border border-navy-200 bg-navy-50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-navy-900">Invite New User</h2>
          <p className="text-xs text-navy-700">
            Enter the user's email, name, and role. Firebase will email them a link to set their password and sign in.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input
                type="text"
                value={newUser.name}
                onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
                placeholder="Firstname Lastname"
                disabled={inviting}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                placeholder="user@example.com"
                disabled={inviting}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as LogisticsRole }))}
                disabled={inviting}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 disabled:bg-slate-50"
              >
                {(Object.keys(ROLE_LABELS) as LogisticsRole[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAddUser}
              disabled={inviting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <Check size={14} />
              {inviting ? "Sending invite…" : "Send Invite"}
            </button>
            <button
              onClick={() => { setAdding(false); setNewUser(emptyNewUser); setError(null); }}
              disabled={inviting}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* Users table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <p className="text-center py-8 text-sm text-slate-400">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-center py-8 text-sm text-slate-400">No users found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = u.id === logisticsUser?.id;
                const saving = savingId === u.id;
                return (
                  <tr key={u.id} className={saving ? "opacity-50" : ""}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-900">{u.name}</span>
                      {isSelf && <span className="ml-2 text-[10px] text-slate-400">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={u.role}
                        onChange={(e) => updateRole(u.id, e.target.value as LogisticsRole)}
                        disabled={saving || isSelf}
                        className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-navy-500 disabled:bg-slate-50"
                      >
                        {(Object.keys(ROLE_LABELS) as LogisticsRole[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleActive(u.id, !u.isActive)}
                        disabled={saving || isSelf}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                          u.isActive
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => sendReset(u.id, u.email)}
                          disabled={saving}
                          className="p-1 text-slate-500 hover:text-navy-700 hover:bg-navy-50 rounded transition-colors disabled:opacity-50"
                          title="Send password reset email"
                        >
                          <KeyRound size={14} />
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => removeUser(u.id, u.name)}
                            disabled={saving}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="Remove user"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
