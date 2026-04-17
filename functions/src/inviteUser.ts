/**
 * Firestore-triggered user invitation.
 *
 * Workflow:
 *   1. Admin on the Users page writes a doc to `user_invites/{id}` with
 *      { email, name, role, requestedBy, status: "pending" }.
 *   2. This trigger fires, verifies `requestedBy` is an active admin,
 *      creates a Firebase Auth user, creates the `/users/{uid}` doc, and
 *      generates a password-reset link.
 *   3. Trigger updates the invite doc with { status: "success", uid, resetLink }.
 *   4. Client watches the invite doc via onSnapshot and shows the success
 *      banner when status transitions.
 *
 * This avoids the Cloud Run `allUsers` invoker permission issue (blocked by
 * Domain Restricted Sharing org policy) because Firestore triggers run as
 * the project's service account, not as the invoking end user.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

type Role = "admin" | "manager" | "staff";

interface InviteDoc {
  email?: string;
  name?: string;
  role?: Role;
  requestedBy?: string;
  status?: "pending" | "success" | "failed";
}

export const inviteUser = onDocumentCreated(
  { document: "user_invites/{inviteId}", maxInstances: 5 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as InviteDoc;

    // Idempotency guard
    if (data.status && data.status !== "pending") return;

    const fail = async (error: string) => {
      await snap.ref.update({ status: "failed", error, completedAt: admin.firestore.FieldValue.serverTimestamp() });
    };

    const { email, name, role, requestedBy } = data;

    // --- Validate input ---
    // RFC 5322-ish email regex: sufficient for invite flow, real verification
    // happens when the user clicks the password-reset link.
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return fail("Valid email is required.");
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return fail("Name is required.");
    }
    if (!role || !["admin", "manager", "staff"].includes(role)) {
      return fail("Role must be admin, manager, or staff.");
    }
    if (!requestedBy) {
      return fail("requestedBy is required.");
    }

    // --- Verify requester is an active admin ---
    const callerSnap = await admin.firestore().doc(`users/${requestedBy}`).get();
    if (!callerSnap.exists) {
      return fail("Requesting user has no record.");
    }
    const callerData = callerSnap.data() ?? {};
    const callerRole = String(callerData.role ?? "").toLowerCase();
    const callerIsAdmin =
      (callerRole === "admin" || callerRole === "logistics_manager") &&
      (callerData.isActive === true || callerData.status === "active");
    if (!callerIsAdmin) {
      return fail("Only admins can invite users.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    // --- Check if a user with this email already exists ---
    try {
      const existing = await admin.auth().getUserByEmail(normalizedEmail);
      return fail(
        `A user with email ${normalizedEmail} already exists (UID: ${existing.uid}).`,
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "auth/user-not-found") {
        return fail(
          `Auth lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // user-not-found — continue
    }

    // --- Create the Firebase Auth user ---
    let uid: string;
    try {
      const tempPassword = generateRandomPassword();
      const newUser = await admin.auth().createUser({
        email: normalizedEmail,
        emailVerified: false,
        password: tempPassword,
        displayName: trimmedName,
        disabled: false,
      });
      uid = newUser.uid;
    } catch (err) {
      return fail(
        `Failed to create Auth user: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // --- Create /users/{uid} doc ---
    try {
      await admin.firestore().doc(`users/${uid}`).set({
        email: normalizedEmail,
        name: trimmedName,
        role,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: requestedBy,
      });
    } catch (err) {
      return fail(
        `Failed to create user doc: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // --- Generate reset link (Firebase also emails it automatically) ---
    let resetLink: string;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);
    } catch (err) {
      // Auth user and doc exist; just log and return partial success
      resetLink = "";
      console.warn("Failed to generate reset link:", err);
    }

    await snap.ref.update({
      status: "success",
      uid,
      resetLink,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  },
);

function generateRandomPassword(): string {
  // 24 bytes of CSPRNG entropy -> 32-char base64url string.
  return randomBytes(24).toString("base64url");
}
