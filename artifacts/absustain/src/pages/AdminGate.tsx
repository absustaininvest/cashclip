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
          ) : step === "backupUsed" ? (
            <p className="text-white/40 text-sm mt-2">
              Backup code accepted
            </p>
          ) : (
            <p className="text-white/40 text-sm mt-2">
              Enter your authenticator code or a backup code
            </p>
          )}
        </div>

        {step === "backupUsed" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3">
              <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-white/80 text-sm font-medium">
                  You signed in with a backup code
                </p>
                <p className="text-white/50 text-xs mt-1">
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
                    <p className="text-white font-medium text-sm">
                      Save your new backup codes
                    </p>
                    <p className="text-white/40 text-xs mt-1">
                      Each code works once in place of your authenticator code.
                      Store them somewhere safe — this is the only time they'll
                      be shown. All previous codes are now invalid.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 bg-white/[0.05] border border-white/10 rounded-xl p-4">
                  {newBackupCodes.map((c) => (
                    <span
                      key={c}
                      className="font-mono text-sm text-white/80 tracking-wider text-center select-all"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={copyNewBackupCodes}
                    className="flex-1 flex items-center justify-center gap-2 bg-white/[0.05] text-white/70 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
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
                    className="flex-1 flex items-center justify-center gap-2 bg-white/[0.05] text-white/70 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </div>
                <button
                  type="button"
                  onClick={continueAfterBackup}
                  className="w-full bg-[#00E676] text-[#06060E] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors text-sm"
                >
                  I've saved these — continue to dashboard
                </button>
              </div>
            ) : regenMode ? (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-3">
                <p className="text-white/60 text-sm">
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
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-xl tracking-[0.3em] placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
                />
                {regenError && (
                  <p className="text-red-400 text-sm text-center">
                    {regenError}
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRegenMode(false);
                      setRegenCode("");
                      setRegenError("");
                    }}
                    className="flex-1 bg-white/[0.05] text-white/60 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={regenCode.length !== 6 || regenLoading}
                    className="flex-1 bg-[#00E676] text-[#06060E] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
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
                    setRegenError("");
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-white/[0.05] text-white/70 font-medium py-3 rounded-xl hover:bg-white/[0.08] transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate backup codes now
                </button>
                <button
                  type="button"
                  onClick={continueAfterBackup}
                  className="w-full bg-[#00E676] text-[#06060E] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors"
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
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-2xl tracking-[0.2em] placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
            <p className="text-white/30 text-xs text-center">
              Enter the code from your authenticator app, or one of your backup
              codes if you've lost it.
            </p>
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !isValidTwoFactorInput(otp)}
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
