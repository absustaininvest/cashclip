import { useState, useEffect, lazy, Suspense } from "react";
import {
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Check,
  FileText,
  Download,
} from "lucide-react";

const AdminDashboard = lazy(() => import("./Admin"));

// Accept either a 6-digit authenticator code or a backup recovery code
// (10 base32 chars, optionally formatted with a hyphen e.g. "ABCDE-FGHIJ").
function isValidTwoFactorInput(value: string): boolean {
  if (/^\d{6}$/.test(value)) return true;
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  return normalized.length === 10;
}

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"password" | "otp" | "backupUsed">("password");
  const [totpSessionToken, setTotpSessionToken] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [backupRemaining, setBackupRemaining] = useState<number | null>(null);
  const [regenMode, setRegenMode] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [regenConfirmed, setRegenConfirmed] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

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
      if (data.usedBackupCode) {
        // Logged in with a single-use backup code — pause to remind the admin
        // how many remain before handing off to the dashboard.
        setPendingToken(data.token);
        setBackupRemaining(
          typeof data.backupCodesRemaining === "number"
            ? data.backupCodesRemaining
            : null,
        );
        setStep("backupUsed");
        return;
      }
      localStorage.setItem("admin_token", data.token);
      onLogin(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function continueAfterBackup() {
    localStorage.setItem("admin_token", pendingToken);
    onLogin(pendingToken);
  }

  async function handleRegenerate() {
    setRegenLoading(true);
    setRegenError("");
    try {
      const res = await fetch("/api/auth/totp/backup-codes/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({ code: regenCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error || "Failed to regenerate backup codes");
        return;
      }
      setNewBackupCodes(data.backupCodes ?? null);
      setRegenMode(false);
      setRegenCode("");
      setRegenConfirmed(false);
    } catch (err: any) {
      setRegenError(err.message || "Failed to regenerate backup codes");
    } finally {
      setRegenLoading(false);
    }
  }

  function copyNewBackupCodes() {
    if (!newBackupCodes) return;
    navigator.clipboard
      .writeText(newBackupCodes.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  function downloadNewBackupCodes() {
    if (!newBackupCodes) return;
    const body =
      "CashClip admin 2FA backup codes\n" +
      "Each code can be used once in place of your authenticator code.\n" +
      "Keep these somewhere safe.\n\n" +
      newBackupCodes.join("\n") +
      "\n";
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cashclip-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}logo-full.png`}
            alt="AB Sustainability"
            className="h-12 rounded mx-auto mb-4"
          />
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-gray-900">
            Admin Dashboard
          </h1>
          {step === "password" ? (
            <p className="text-gray-400 text-sm mt-2">
              Sign in to manage your business
            </p>
          ) : step === "backupUsed" ? (
            <p className="text-gray-400 text-sm mt-2">
              Backup code accepted
            </p>
          ) : (
            <p className="text-gray-400 text-sm mt-2">
              Enter your authenticator code or a backup code
            </p>
          )}
        </div>

        {step === "backupUsed" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3">
              <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-gray-700 text-sm font-medium">
                  You signed in with a backup code
                </p>
                <p className="text-gray-500 text-xs mt-1">
                  {backupRemaining === null
                    ? "That code has been used up and can't be reused."
                    : `That code is now used up. You have ${backupRemaining} backup code${backupRemaining === 1 ? "" : "s"} left.`}
                </p>
                {backupRemaining !== null && backupRemaining <= 2 && (
                  <p className="text-amber-400 text-xs mt-1.5">
                    You're running low — regenerate a fresh set now while it's
                    top of mind.
                  </p>
                )}
              </div>
            </div>

            {newBackupCodes ? (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-gray-900 font-medium text-sm">
                      Save your new backup codes
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      Each code works once in place of your authenticator code.
                      Store them somewhere safe — this is the only time they'll
                      be shown. All previous codes are now invalid.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 bg-gray-100 border border-gray-200 rounded-xl p-4">
                  {newBackupCodes.map((c) => (
                    <span
                      key={c}
                      className="font-mono text-sm text-gray-700 tracking-wider text-center select-all"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={copyNewBackupCodes}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
                  >
                    {copied ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={downloadNewBackupCodes}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </div>
                <button
                  type="button"
                  onClick={continueAfterBackup}
                  className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors text-sm"
                >
                  I've saved these — continue to dashboard
                </button>
              </div>
            ) : regenMode ? (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-3">
                <p className="text-gray-500 text-sm">
                  Enter a code from your authenticator app to generate a new set.
                  This invalidates all previous backup codes.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={regenCode}
                  onChange={(e) =>
                    setRegenCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  autoFocus
                  className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-center font-mono text-xl tracking-[0.3em] placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
                />
                {regenError && (
                  <p className="text-red-400 text-sm text-center">
                    {regenError}
                  </p>
                )}
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={regenConfirmed}
                    onChange={(e) => setRegenConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-emerald-500 cursor-pointer"
                  />
                  <span className="text-gray-500 text-xs">
                    I understand all of my current backup codes will stop working
                    immediately.
                  </span>
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRegenMode(false);
                      setRegenCode("");
                      setRegenConfirmed(false);
                      setRegenError("");
                    }}
                    className="flex-1 bg-gray-100 text-gray-500 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={regenCode.length !== 6 || !regenConfirmed || regenLoading}
                    className="flex-1 bg-[#00E676] text-[#f9fafb] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  >
                    {regenLoading ? "Generating..." : "Generate"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRegenMode(true);
                    setRegenCode("");
                    setRegenConfirmed(false);
                    setRegenError("");
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-600 font-medium py-3 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate backup codes now
                </button>
                <button
                  type="button"
                  onClick={continueAfterBackup}
                  className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors"
                >
                  Continue to dashboard
                </button>
              </>
            )}
          </div>
        ) : step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoComplete="username"
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              autoComplete="current-password"
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <p className="text-gray-500 text-sm">
                Two-factor authentication required
              </p>
            </div>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              maxLength={13}
              value={otp}
              onChange={(e) =>
                setOtp(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9-]/g, "")
                    .slice(0, 13),
                )
              }
              placeholder="000000"
              required
              autoFocus
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-center font-mono text-2xl tracking-[0.2em] placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
            />
            <p className="text-gray-400 text-xs text-center">
              Enter the code from your authenticator app, or one of your backup
              codes if you've lost it.
            </p>
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !isValidTwoFactorInput(otp)}
              className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50"
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
              className="w-full text-gray-400 hover:text-gray-500 text-sm transition-colors py-1"
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
    const prevTitle = document.title;
    document.title = "Operator Portal";
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const hadRobots = !!robots;
    const prevRobots = robots?.getAttribute("content") ?? null;
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, nofollow");
    const prevBg = document.body.style.background;
    document.body.style.background = "#f9fafb";
    return () => {
      document.title = prevTitle;
      document.body.style.background = prevBg;
      if (hadRobots && prevRobots !== null) {
        robots!.setAttribute("content", prevRobots);
      } else if (robots && robots.parentNode) {
        robots.parentNode.removeChild(robots);
      }
    };
  }, []);

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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-[#00E676] rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) return <LoginForm onLogin={setToken} />;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-[#00E676] rounded-full animate-spin" />
        </div>
      }
    >
      <AdminDashboard token={token} onLogout={handleLogout} />
    </Suspense>
  );
}
