"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteUser = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
if (admin.apps.length === 0) {
    admin.initializeApp();
}
exports.inviteUser = (0, firestore_1.onDocumentCreated)({ document: "user_invites/{inviteId}", maxInstances: 5 }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    // Idempotency guard
    if (data.status && data.status !== "pending")
        return;
    const fail = async (error) => {
        await snap.ref.update({ status: "failed", error, completedAt: admin.firestore.FieldValue.serverTimestamp() });
    };
    const { email, name, role, requestedBy } = data;
    // --- Validate input ---
    if (!email || typeof email !== "string" || !email.includes("@")) {
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
    const callerIsAdmin = (callerRole === "admin" || callerRole === "logistics_manager") &&
        (callerData.isActive === true || callerData.status === "active");
    if (!callerIsAdmin) {
        return fail("Only admins can invite users.");
    }
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    // --- Check if a user with this email already exists ---
    try {
        const existing = await admin.auth().getUserByEmail(normalizedEmail);
        return fail(`A user with email ${normalizedEmail} already exists (UID: ${existing.uid}).`);
    }
    catch (err) {
        const code = err?.code;
        if (code !== "auth/user-not-found") {
            return fail(`Auth lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // user-not-found — continue
    }
    // --- Create the Firebase Auth user ---
    let uid;
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
    }
    catch (err) {
        return fail(`Failed to create Auth user: ${err instanceof Error ? err.message : String(err)}`);
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
    }
    catch (err) {
        return fail(`Failed to create user doc: ${err instanceof Error ? err.message : String(err)}`);
    }
    // --- Generate reset link (Firebase also emails it automatically) ---
    let resetLink;
    try {
        resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);
    }
    catch (err) {
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
});
function generateRandomPassword() {
    const buf = Buffer.alloc(24);
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return buf.toString("base64url");
}
//# sourceMappingURL=inviteUser.js.map