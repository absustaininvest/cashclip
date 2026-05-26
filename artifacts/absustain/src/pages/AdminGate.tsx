import { useState, useEffect, lazy, Suspense } from "react";
import { ShieldCheck } from "lucide-react";

const AdminDashboard = lazy(() => import("./Admin"));

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"password" | "otp">("password");
  const [totpSessionToken, setTotpSessionToken] = useState("");
  const [otp, setOtp] = useState("");

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      if (data.requiresTotp) {
        setTotpSessionToken(data.totpSessionToken);
        setStep("otp");
        return;
      }
      if (data.user.role !== "admin") throw new Error("Admin access required");
      localStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totpSessionToken, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      if (data.user.role !== "admin") throw new Error("Admin access required");
      localStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#06060E] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}logo-full.png`}
            alt="AB Sustainability"
            className="h-12 rounded mx-auto mb-4"
          />
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-white">
            Admin Dashboard
          </h1>
          {step === "password" ? (
            <p className="text-white/40 text-sm mt-2">
              Sign in to manage your business
            </p>
          ) : (
            <p className="text-white/40 text-sm mt-2">
              Enter the code from your authenticator app
            </p>
          )}
        </div>

        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoComplete="username"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              autoComplete="current-password"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00E676] text-[#06060E] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="flex items-center gap-2 bg-[#00E676]/5 border border-[#00E676]/20 rounded-xl px-4 py-3">
              <ShieldCheck className="w-4 h-4 text-[#00E676] flex-shrink-0" />
              <p className="text-white/60 text-sm">
                Two-factor authentication required
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              required
              autoFocus
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-2xl tracking-[0.4em] placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-[#00E676] text-[#06060E] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("password");
                setError("");
                setOtp("");
              }}
              className="w-full text-white/30 hover:text-white/60 text-sm transition-colors py-1"
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminGate() {
  const [token, setToken] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("admin_token");
    if (!stored) {
      setValidating(false);
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${stored}` } })
      .then((r) => {
        if (r.ok) setToken(stored);
        else localStorage.removeItem("admin_token");
      })
      .catch(() => localStorage.removeItem("admin_token"))
      .finally(() => setValidating(false));
  }, []);

  function handleLogout() {
    localStorage.removeItem("admin_token");
    setToken(null);
  }

  if (validating) {
    return (
      <div className="min-h-screen bg-[#06060E] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/20 border-t-[#00E676] rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) return <LoginForm onLogin={setToken} />;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#06060E] flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/20 border-t-[#00E676] rounded-full animate-spin" />
        </div>
      }
    >
      <AdminDashboard token={token} onLogout={handleLogout} />
    </Suspense>
  );
}
