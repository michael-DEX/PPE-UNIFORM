import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";

export default function LoginPage() {
  const { signIn, isLogistics, user } = useAuthContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [resetMode, setResetMode] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  // Redirect if already logged in
  if (user && isLogistics) {
    navigate("/logistics", { replace: true });
    return null;
  }
  if (user && !isLogistics) {
    navigate("/store", { replace: true });
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      navigate("/logistics");
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    setError("");
    setResetInfo(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Enter your email above, then click the reset link again.");
      return;
    }
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      // Always show the same message regardless of whether the email exists
      // (Firebase Auth's email enumeration protection doesn't reveal existence).
      setResetInfo("If an account exists for that email, a reset link has been sent.");
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "auth/invalid-email") {
        setError("That email address isn't valid.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many requests. Try again later.");
      } else {
        setError("Couldn't send reset email. Please try again.");
      }
    } finally {
      setResetSending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">CA-TF2</h1>
          <p className="text-navy-300 mt-1">PPE Logistics System</p>
        </div>

        {resetMode ? (
          <form
            onSubmit={handleSendReset}
            className="bg-white rounded-xl shadow-lg p-6 space-y-4"
          >
            <h2 className="text-lg font-semibold text-slate-900">Reset Password</h2>
            <p className="text-xs text-slate-500">
              Enter your email address. If an account exists, Firebase will email you a link to set a new password.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-transparent"
                placeholder="you@catf2.org"
              />
            </div>

            {resetInfo && (
              <p className="text-sm text-emerald-700 bg-emerald-50 p-2 rounded">{resetInfo}</p>
            )}
            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
            )}

            <button
              type="submit"
              disabled={resetSending}
              className="w-full py-2.5 bg-navy-700 hover:bg-navy-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetSending ? "Sending…" : "Send Reset Email"}
            </button>
            <button
              type="button"
              onClick={() => { setResetMode(false); setResetInfo(null); setError(""); }}
              className="w-full py-2 text-sm text-navy-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Back to Sign In
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-xl shadow-lg p-6 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-transparent"
                placeholder="you@catf2.org"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { setResetMode(true); setError(""); setResetInfo(null); }}
                  className="text-xs text-navy-700 hover:text-navy-900 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-transparent"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-navy-700 hover:bg-navy-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        <p className="text-center text-navy-400 text-xs mt-6">
          CA-TF2 / USA-02 USAR Team
        </p>
      </div>
    </div>
  );
}
