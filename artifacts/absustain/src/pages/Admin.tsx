import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import type { LucideIcon } from "lucide-react";
import {
  LogOut,
  Filter,
  RefreshCw,
  Mail,
  User,
  Calendar,
  Tag,
  Plus,
  Trash2,
  Check,
  Clock,
  TrendingUp,
  Users,
  MessageSquare,
  Bell,
  ChevronRight,
  ExternalLink,
  Upload,
  FileText,
  Download,
  X,
  Layers,
  AlertCircle,
  Smartphone,
  BarChart3,
  KeyRound,
  Eye,
  EyeOff,
  Inbox,
  AtSign,
  Building2,
  Megaphone,
  Headphones,
  Shield,
  ShieldCheck,
  History,
  ChevronLeft,
  Globe,
  Power,
  BellOff,
  RotateCcw,
} from "lucide-react";

interface Lead {
  id: string;
  name: string;
  email: string;
  message?: string;
  type: string;
  source: string;
  createdAt: string;
}

interface Reminder {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

interface VentureFile {
  id: string;
  originalName: string;
  storedName: string;
  category: string;
  description: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

const VENTURE_CATEGORIES = [
  "Restaurant Proposals",
  "Menus",
  "Location Analysis",
  "Financial Projections",
  "Permits & Licenses",
  "Supplier Agreements",
  "Floor Plans",
  "Photos",
  "General",
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime === "application/pdf") return "🗒️";
  if (mime.startsWith("image/")) return "🖼️";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  )
    return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📄";
  if (mime === "application/zip") return "🗜️";
  return "📎";
}

function TwoFactorPanel({ token }: { token: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const [regenMode, setRegenMode] = useState(false);
  const [regenConfirmed, setRegenConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/auth/totp/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.enabled ?? false);
        setBackupCount(d.backupCodesRemaining ?? 0);
      })
      .catch(() => setEnabled(false));
  }, [token]);

  function copyBackupCodes() {
    if (!backupCodes) return;
    navigator.clipboard
      .writeText(backupCodes.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  function downloadBackupCodes() {
    if (!backupCodes) return;
    const body =
      "CashClip admin 2FA backup codes\n" +
      "Each code can be used once in place of your authenticator code.\n" +
      "Keep these somewhere safe.\n\n" +
      backupCodes.join("\n") +
      "\n";
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cashclip-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRegenerate() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/auth/totp/backup-codes/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to regenerate backup codes");
        return;
      }
      setBackupCodes(data.backupCodes ?? null);
      setBackupCount(data.backupCodes?.length ?? 0);
      setRegenMode(false);
      setRegenConfirmed(false);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!setupData?.uri) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(setupData.uri, {
      margin: 2,
      width: 200,
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [setupData?.uri]);

  async function handleSetup() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSetupData(data);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    if (!setupData) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp/enable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ secret: setupData.secret, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to enable");
        return;
      }
      setEnabled(true);
      setSetupData(null);
      setCode("");
      setBackupCodes(data.backupCodes ?? null);
      setBackupCount(data.backupCodes?.length ?? 0);
      setSuccess(
        "Two-factor authentication is now enabled. You'll need your authenticator app on every login.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp/disable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to disable");
        return;
      }
      setEnabled(false);
      setCode("");
      setBackupCodes(null);
      setBackupCount(0);
      setRegenMode(false);
      setSuccess("Two-factor authentication has been disabled.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-[#00E676]/10">
          <Shield className="w-5 h-5 text-[#00E676]" />
        </div>
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
            Two-Factor Authentication
          </h2>
          <p className="text-white/40 text-sm">
            Add an extra layer of security to your admin account
          </p>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 text-[#00E676] text-sm bg-[#00E676]/10 border border-[#00E676]/20 rounded-xl px-4 py-3">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {enabled === null && <p className="text-white/30 text-sm">Loading...</p>}

      {backupCodes && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-medium text-sm">
                Save your backup codes
              </p>
              <p className="text-white/40 text-xs mt-1">
                Each code works once in place of your authenticator code. Store
                them somewhere safe — this is the only time they'll be shown.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-white/[0.05] border border-white/10 rounded-xl p-4">
            {backupCodes.map((c) => (
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
              onClick={copyBackupCodes}
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
              onClick={downloadBackupCodes}
              className="flex-1 flex items-center justify-center gap-2 bg-white/[0.05] text-white/70 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
          <button
            onClick={() => setBackupCodes(null)}
            className="w-full bg-[#00E676] text-[#06060E] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors text-sm"
          >
            I've saved these codes
          </button>
        </div>
      )}

      {enabled === true && !setupData && !backupCodes && (
        <div className="space-y-4">
          <div className="bg-[#00E676]/5 border border-[#00E676]/20 rounded-2xl p-5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#00E676]/10">
              <ShieldCheck className="w-5 h-5 text-[#00E676]" />
            </div>
            <div>
              <p className="text-white font-medium text-sm">2FA is active</p>
              <p className="text-white/40 text-xs mt-0.5">
                Your account requires an authenticator code on every login
              </p>
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <KeyRound className="w-5 h-5 text-white/40 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-medium text-sm">Backup codes</p>
                <p className="text-white/40 text-xs mt-0.5">
                  {backupCount === null
                    ? "—"
                    : `${backupCount} unused code${backupCount === 1 ? "" : "s"} remaining`}
                  . Use one to log in if you lose your authenticator.
                </p>
                {backupCount !== null && backupCount <= 2 && (
                  <p className="text-amber-400 text-xs mt-1">
                    You're running low — regenerate a fresh set soon.
                  </p>
                )}
              </div>
            </div>
            {!regenMode ? (
              <button
                onClick={() => {
                  setRegenMode(true);
                  setRegenConfirmed(false);
                  setCode("");
                  setError("");
                  setSuccess("");
                }}
                className="w-full flex items-center justify-center gap-2 bg-white/[0.05] text-white/70 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate backup codes
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-white/60 text-sm">
                  Enter a code from your authenticator app to generate a new set.
                  This invalidates all previous backup codes.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-xl tracking-[0.3em] placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
                />
                {error && (
                  <p className="text-red-400 text-sm text-center">{error}</p>
                )}
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={regenConfirmed}
                    onChange={(e) => setRegenConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#00E676] cursor-pointer"
                  />
                  <span className="text-white/60 text-xs">
                    I understand all of my current backup codes will stop working
                    immediately.
                  </span>
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setRegenMode(false);
                      setRegenConfirmed(false);
                      setCode("");
                      setError("");
                    }}
                    className="flex-1 bg-white/[0.05] text-white/60 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={code.length !== 6 || !regenConfirmed || loading}
                    className="flex-1 bg-[#00E676] text-[#06060E] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  >
                    {loading ? "Generating..." : "Generate"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <p className="text-white/60 text-sm">
              To disable 2FA, enter a valid code from your authenticator app:
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={regenMode ? "" : code}
              disabled={regenMode}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-xl tracking-[0.3em] placeholder-white/20 focus:outline-none focus:border-red-500/50 transition-colors disabled:opacity-40"
            />
            {error && !regenMode && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              onClick={handleDisable}
              disabled={code.length !== 6 || loading || regenMode}
              className="w-full bg-red-500/10 text-red-400 border border-red-500/20 font-bold py-2.5 rounded-xl hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              {loading ? "Disabling..." : "Disable 2FA"}
            </button>
          </div>
        </div>
      )}

      {enabled === false && !setupData && (
        <div className="space-y-4">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-medium text-sm">
                2FA is not enabled
              </p>
              <p className="text-white/40 text-xs mt-1">
                Your account is protected by password only. Enabling 2FA
                significantly reduces the risk of unauthorized access.
              </p>
            </div>
          </div>
          <button
            onClick={handleSetup}
            disabled={loading}
            className="w-full bg-[#00E676] text-[#06060E] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50 text-sm"
          >
            {loading ? "Generating..." : "Set Up Two-Factor Authentication"}
          </button>
        </div>
      )}

      {setupData && (
        <div className="space-y-4">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-white font-medium text-sm mb-1">
                1. Scan this QR code with your authenticator app
              </p>
              <p className="text-white/40 text-xs">
                Use Google Authenticator, Authy, or any TOTP-compatible app
              </p>
            </div>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="rounded-xl border border-white/10"
                  width={200}
                  height={200}
                />
              ) : (
                <div className="w-[200px] h-[200px] rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center">
                  <span className="text-white/30 text-xs">Generating…</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-white/40 text-xs mb-1.5">
                Can't scan? Enter this key manually in your app:
              </p>
              <div className="bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5 font-mono text-xs text-white/70 break-all select-all tracking-wider">
                {setupData.secret}
              </div>
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <p className="text-white font-medium text-sm">
              2. Enter the 6-digit code from your app to confirm setup
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              autoFocus
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-xl tracking-[0.3em] placeholder-white/20 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSetupData(null);
                  setCode("");
                  setError("");
                }}
                className="flex-1 bg-white/[0.05] text-white/60 font-medium py-2.5 rounded-xl hover:bg-white/[0.08] transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEnable}
                disabled={code.length !== 6 || loading}
                className="flex-1 bg-[#00E676] text-[#06060E] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                {loading ? "Enabling..." : "Enable 2FA"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 hover:border-white/[0.12] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="font-['Space_Grotesk'] text-3xl font-bold text-white">
        {value}
      </p>
      <p className="text-white/40 text-sm mt-1">{label}</p>
    </div>
  );
}

function MiniCalendar() {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const today = now.getDate();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-[#00E676]" />
        <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
          {month}
        </h3>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-white/30 font-medium py-1">
            {d}
          </div>
        ))}
        {days.map((d, i) => (
          <div
            key={i}
            className={`py-1.5 rounded-lg transition-colors ${
              d === today
                ? "bg-[#00E676] text-[#06060E] font-bold"
                : d
                  ? "text-white/60 hover:bg-white/[0.05] cursor-default"
                  : ""
            }`}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const saved = localStorage.getItem("admin_reminders");
    return saved ? JSON.parse(saved) : [];
  });
  const [newText, setNewText] = useState("");

  useEffect(() => {
    localStorage.setItem("admin_reminders", JSON.stringify(reminders));
  }, [reminders]);

  function addReminder() {
    if (!newText.trim()) return;
    setReminders([
      {
        id: Date.now().toString(),
        text: newText.trim(),
        done: false,
        createdAt: new Date().toISOString(),
      },
      ...reminders,
    ]);
    setNewText("");
  }

  function toggleReminder(id: string) {
    setReminders(
      reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)),
    );
  }

  function deleteReminder(id: string) {
    setReminders(reminders.filter((r) => r.id !== id));
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-amber-400" />
        <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
          Reminders
        </h3>
        <span className="ml-auto text-white/30 text-xs">
          {reminders.filter((r) => !r.done).length} active
        </span>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addReminder()}
          placeholder="Add a reminder..."
          className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
        />
        <button
          onClick={addReminder}
          className="p-2 bg-[#00E676]/10 text-[#00E676] rounded-lg hover:bg-[#00E676]/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {reminders.length === 0 ? (
          <p className="text-white/20 text-xs text-center py-4">
            No reminders yet
          </p>
        ) : (
          reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 group">
              <button
                onClick={() => toggleReminder(r.id)}
                className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-colors ${
                  r.done
                    ? "bg-[#00E676]/20 border-[#00E676]/40 text-[#00E676]"
                    : "border-white/20 hover:border-white/40"
                }`}
              >
                {r.done && <Check className="w-3 h-3" />}
              </button>
              <span
                className={`text-sm flex-1 ${r.done ? "text-white/30 line-through" : "text-white/70"}`}
              >
                {r.text}
              </span>
              <button
                onClick={() => deleteReminder(r.id)}
                className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function QuickActions() {
  const actions = [
    {
      label: "Email Support Inbox",
      href: "mailto:support@absustaininvest.com",
      icon: Mail,
      color: "text-blue-400",
    },
    {
      label: "CashClip Support",
      href: "mailto:support@absustaininvest.com",
      icon: Mail,
      color: "text-purple-400",
    },
    {
      label: "CashClip App",
      href: "https://cash-clip.app",
      icon: ExternalLink,
      color: "text-[#00E676]",
    },
    {
      label: "AB Sustainability Site",
      href: "https://absustaininvest.com",
      icon: ExternalLink,
      color: "text-amber-400",
    },
  ];
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-blue-400" />
        <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
          Quick Actions
        </h3>
      </div>
      <div className="space-y-1">
        {actions.map((a) => (
          <a
            key={a.label}
            href={a.href}
            target={a.href.startsWith("http") ? "_blank" : undefined}
            rel={a.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] transition-colors group"
          >
            <a.icon className={`w-4 h-4 ${a.color}`} />
            <span className="text-white/60 text-sm group-hover:text-white transition-colors flex-1">
              {a.label}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/40 transition-colors" />
          </a>
        ))}
      </div>
    </div>
  );
}

function VenturesPanel({ token }: { token: string }) {
  const [files, setFiles] = useState<VentureFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [category, setCategory] = useState("Restaurant Proposals");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchFiles() {
    setLoading(true);
    try {
      const res = await fetch("/api/ventures/files", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setFiles(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchFiles();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    setUploadError("");
    setUploadSuccess("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", category);
      formData.append("description", description);
      const res = await fetch("/api/ventures/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadSuccess(`"${selectedFile.name}" uploaded successfully.`);
      setSelectedFile(null);
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchFiles();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await fetch(`/api/ventures/files/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setFiles((f) => f.filter((x) => x.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  const byCategory = files.reduce<Record<string, VentureFile[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
            Solera — Food Service Files
          </h2>
          <p className="text-white/40 text-sm mt-1">
            Upload restaurant files, proposals, and resources for the Ventures
            page.
          </p>
        </div>
        <span className="text-white/30 text-sm">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

      {/* Upload form */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <Upload className="w-4 h-4 text-[#00E676]" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            Upload New File
          </h3>
        </div>
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-white/40 text-xs mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors"
              >
                {VENTURE_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-[#06060E]">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-white/40 text-xs mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..."
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-white/40 text-xs mb-1.5">
              File (PDF, images, Excel, Word, CSV — max 50 MB)
            </label>
            <div
              className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-[#00E676]/30 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl">
                    {fileIcon(selectedFile.type)}
                  </span>
                  <div className="text-left">
                    <p className="text-white text-sm font-medium">
                      {selectedFile.name}
                    </p>
                    <p className="text-white/40 text-xs">
                      {formatSize(selectedFile.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="ml-2 text-white/30 hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-white/20 mx-auto mb-2" />
                  <p className="text-white/40 text-sm">
                    Click to choose a file
                  </p>
                  <p className="text-white/20 text-xs mt-1">or drag and drop</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.doc,.docx,.csv,.txt,.zip"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          {uploadError && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="flex items-center gap-2 text-[#00E676] text-sm bg-[#00E676]/10 border border-[#00E676]/20 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 flex-shrink-0" />
              {uploadSuccess}
            </div>
          )}
          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="bg-[#00E676] text-[#06060E] font-bold px-6 py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {uploading ? "Uploading..." : "Upload File"}
          </button>
        </form>
      </div>

      {/* File list */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
          <FileText className="w-4 h-4 text-white/40" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            Uploaded Files
          </h3>
          <button
            onClick={fetchFiles}
            className="ml-auto text-white/30 hover:text-white transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {loading ? (
          <div className="text-center py-12 text-white/30 text-sm">
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">No files uploaded yet</p>
            <p className="text-white/20 text-xs mt-1">
              Use the form above to upload your first file
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(byCategory).map(([cat, catFiles]) => (
              <div key={cat}>
                <div className="px-5 py-2 bg-white/[0.02]">
                  <span className="text-white/40 text-xs font-semibold uppercase tracking-wider">
                    {cat}
                  </span>
                </div>
                {catFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors group"
                  >
                    <span className="text-xl flex-shrink-0">
                      {fileIcon(f.mimeType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">
                        {f.originalName}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-white/30 text-xs">
                          {formatSize(f.size)}
                        </span>
                        {f.description && (
                          <span className="text-white/30 text-xs truncate">
                            • {f.description}
                          </span>
                        )}
                        <span className="text-white/20 text-xs">
                          {new Date(f.uploadedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={async () => {
                          const res = await fetch(
                            `/api/ventures/files/${f.id}`,
                            {
                              headers: { Authorization: `Bearer ${token}` },
                            },
                          );
                          if (!res.ok) return;
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = f.originalName;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1.5 text-[#00E676]/60 hover:text-[#00E676] transition-colors text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:block">Download</span>
                      </button>
                      <button
                        onClick={() => handleDelete(f.id, f.originalName)}
                        disabled={deletingId === f.id}
                        className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangePasswordPanel({ token }: { token: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      setSuccess("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-[#00E676]/10">
          <KeyRound className="w-5 h-5 text-[#00E676]" />
        </div>
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
            Change Password
          </h2>
          <p className="text-white/40 text-sm">
            Update your admin account password
          </p>
        </div>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-white/60 text-xs font-medium mb-2 uppercase tracking-wider">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 pr-11 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showCurrent ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-white/60 text-xs font-medium mb-2 uppercase tracking-wider">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 pr-11 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showNew ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-white/60 text-xs font-medium mb-2 uppercase tracking-wider">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-[#00E676]/10 border border-[#00E676]/20 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 text-[#00E676] flex-shrink-0" />
              <p className="text-[#00E676] text-sm">{success}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={
              loading || !currentPassword || !newPassword || !confirmPassword
            }
            className="w-full bg-[#00E676] text-[#06060E] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40"
          >
            {loading ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

interface InboxMessage {
  uid: number;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  preview: string;
  body: string;
  seen: boolean;
  category: "corporate" | "app" | "pr" | "support" | "other";
}

const INBOX_CATEGORIES: {
  id: InboxMessage["category"] | "all";
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { id: "all", label: "All", icon: Inbox, color: "text-white" },
  {
    id: "corporate",
    label: "Corporate",
    icon: Building2,
    color: "text-blue-400",
  },
  { id: "app", label: "CashClip", icon: Smartphone, color: "text-[#00E676]" },
  { id: "pr", label: "PR", icon: Megaphone, color: "text-pink-400" },
  {
    id: "support",
    label: "Support",
    icon: Headphones,
    color: "text-amber-400",
  },
];

function timeAgoShort(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function InboxPanel({ token }: { token: string }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<
    InboxMessage["category"] | "all"
  >("all");
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/inbox", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Failed to fetch inbox");
      }
      const data = await res.json();
      setMessages(data.messages ?? []);
      setFetchedAt(data.fetchedAt);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const filtered =
    activeCategory === "all"
      ? messages
      : messages.filter((m) => m.category === activeCategory);

  const counts = INBOX_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.id] =
      cat.id === "all"
        ? messages.length
        : messages.filter((m) => m.category === cat.id).length;
    return acc;
  }, {});

  const catColor: Record<InboxMessage["category"], string> = {
    corporate: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    app: "text-[#00E676] bg-[#00E676]/10 border-[#00E676]/20",
    pr: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    support: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    other: "text-white/40 bg-white/5 border-white/10",
  };

  const catLabel: Record<InboxMessage["category"], string> = {
    corporate: "Corporate",
    app: "CashClip",
    pr: "PR",
    support: "Support",
    other: "Other",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
            Inbox
          </h2>
          <p className="text-white/40 text-sm mt-0.5">
            Submissions — one view.
            {fetchedAt && (
              <span className="ml-2 text-white/20">
                Last synced {timeAgoShort(fetchedAt)} ago
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchMessages}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-sm disabled:opacity-40"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          {loading ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-1.5 overflow-x-auto">
        {INBOX_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                setSelected(null);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                active
                  ? "bg-white/[0.08] text-white"
                  : "text-white/40 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? cat.color : ""}`} />
              {cat.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  active
                    ? "bg-white/10 text-white"
                    : "bg-white/[0.05] text-white/30"
                }`}
              >
                {counts[cat.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading && messages.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-12 text-center">
          <RefreshCw className="w-8 h-8 text-white/20 animate-spin mx-auto mb-3" />
          <p className="text-white/40 text-sm">Connecting to mail server…</p>
        </div>
      ) : (
        <div
          className={`grid gap-4 ${selected ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}
        >
          {/* Message list */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Inbox className="w-10 h-10 text-white/10 mx-auto mb-3" />
                <p className="text-white/30 text-sm">
                  No messages in this inbox
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04] max-h-[600px] overflow-y-auto">
                {filtered.map((msg) => (
                  <button
                    key={msg.uid}
                    onClick={() => {
                      setSelected(selected?.uid === msg.uid ? null : msg);
                      setTick(t => t + 1);
                    }}
                    className={`w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-white/[0.04] transition-colors ${
                      selected?.uid === msg.uid ? "bg-white/[0.06]" : ""
                    }`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          msg.category === "corporate"
                            ? "bg-blue-500/15 text-blue-400"
                            : msg.category === "app"
                              ? "bg-[#00E676]/15 text-[#00E676]"
                              : msg.category === "pr"
                                ? "bg-pink-500/15 text-pink-400"
                                : msg.category === "support"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-white/10 text-white/40"
                        }`}
                      >
                        {(msg.from[0] ?? "?").toUpperCase()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-sm font-semibold truncate ${msg.seen ? "text-white/60" : "text-white"}`}
                        >
                          {msg.from}
                        </span>
                        {!msg.seen && (
                          <span className="w-2 h-2 rounded-full bg-[#00E676] flex-shrink-0" />
                        )}
                        <span className="text-white/20 text-xs flex-shrink-0 ml-auto">
                          {timeAgoShort(msg.date)}
                        </span>
                      </div>
                      <p
                        className={`text-sm truncate mb-1 ${msg.seen ? "text-white/40" : "text-white/80 font-medium"}`}
                      >
                        {msg.subject}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-white/25 text-xs truncate">
                          {msg.preview}
                        </p>
                        <span
                          className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${catColor[msg.category]}`}
                        >
                          {catLabel[msg.category]}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Message detail pane */}
          {selected && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${catColor[selected.category]}`}
                  >
                    {catLabel[selected.category]}
                  </span>
                  <span className="text-white/30 text-xs">
                    {new Date(selected.date).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {timeAgoShort(selected.date)} ago
                  </span>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-white/30 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 border-b border-white/[0.06] space-y-2">
                <h3 className="font-['Space_Grotesk'] font-bold text-white text-base leading-snug">
                  {selected.subject}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-white/40 text-xs">
                    <AtSign className="w-3 h-3" />
                    <span className="font-medium">{selected.fromEmail}</span>
                  </div>
                  <span className="text-white/20 text-xs">→</span>
                  <div className="flex items-center gap-1.5 text-white/30 text-xs">
                    <span>{selected.toEmail}</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 max-h-[480px]">
                <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">
                  {selected.body || selected.preview || "(No body content)"}
                </p>
              </div>
              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center gap-3">
                <a
                  href={`mailto:${encodeURIComponent(selected.fromEmail)}?subject=Re: ${encodeURIComponent(selected.subject)}`}
                  className="flex items-center gap-2 px-4 py-2 bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] rounded-xl text-xs font-medium hover:bg-[#00E676]/20 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Reply via Email
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CashClipUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  balance: string;
  totalEarned: string;
  pending?: number;
  createdAt: string;
  profileComplete: boolean;
  country: string | null;
  zipCode: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  employmentStatus: string | null;
  householdIncome: string | null;
  educationLevel: string | null;
  ethnicity: string | null;
  referredBy: string | null;
}

interface PayPalWebhookHealth {
  checked: boolean;
  message?: string;
  ok?: boolean;
  checkedAt?: string;
  webhookId?: string | null;
  urlMatch?: boolean | null;
  registeredUrl?: string | null;
  missingEvents?: string[];
  warnings?: string[];
  error?: string;
}

interface SponsoredVisitHealth {
  generatedAt: string;
  alertLastSent: string | null;
  window24h: { successCount: number; totalRewardUsd: string };
  window7d: { successCount: number; totalRewardUsd: string };
  activeCampaigns: number;
  expiredAttempts24h: {
    total: number;
    notRedirected: number;
    redirectedNotWitnessed: number;
    witnessedNotSettled: number;
  };
  recentSettlements: {
    id: string;
    campaignId: string;
    campaignTitle: string;
    rewardGranted: string;
    createdAt: string;
  }[];
}

function SponsoredVisitHealthPanel({ token }: { token: string }) {
  const [data, setData] = useState<SponsoredVisitHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monitorRunning, setMonitorRunning] = useState<boolean | null>(null);
  const [monitorToggling, setMonitorToggling] = useState(false);
  const [monitorError, setMonitorError] = useState("");
  const [alertResetting, setAlertResetting] = useState(false);
  const [alertResetMsg, setAlertResetMsg] = useState("");
  const [recentResets, setRecentResets] = useState<{ id: string; actorUsername: string | null; ip: string | null; createdAt: string }[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/health/sponsored-visits", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentResets() {
    try {
      const res = await fetch("/api/admin/security-audit?event=sponsored_visit_alert_reset&limit=5", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setRecentResets(json.entries ?? []);
    } catch {
    }
  }

  async function loadMonitorStatus() {
    try {
      const res = await fetch("/api/admin/monitor/sponsored-visit", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setMonitorRunning(json.running);
    } catch {
    }
  }

  async function toggleMonitor() {
    if (monitorRunning === null || monitorToggling) return;
    setMonitorToggling(true);
    setMonitorError("");
    const action = monitorRunning ? "stop" : "start";
    try {
      const res = await fetch("/api/admin/monitor/sponsored-visit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setMonitorRunning(json.running);
    } catch (e: any) {
      setMonitorError(e.message ?? "Failed to toggle monitor");
    } finally {
      setMonitorToggling(false);
    }
  }

  async function resetAlertDebounce() {
    if (alertResetting) return;
    setAlertResetting(true);
    setAlertResetMsg("");
    try {
      const res = await fetch("/api/admin/health/sponsored-visits/reset-alert", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setAlertResetMsg("Debounce cleared — next check can send a fresh alert.");
      await Promise.all([load(), loadRecentResets()]);
    } catch (e: any) {
      setAlertResetMsg(`Failed: ${e.message ?? "unknown error"}`);
    } finally {
      setAlertResetting(false);
    }
  }

  useEffect(() => {
    load();
    loadMonitorStatus();
    loadRecentResets();
    const interval = setInterval(load, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  function fmt(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  const statusColor = !data
    ? "text-white/30"
    : data.window24h.successCount > 0
      ? "text-[#00E676]"
      : data.activeCampaigns === 0
        ? "text-amber-400"
        : "text-red-400";

  const statusLabel = !data
    ? "Unknown"
    : data.window24h.successCount > 0
      ? "Settling normally"
      : data.activeCampaigns === 0
        ? "No active campaigns"
        : "No settlements in 24 h";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#00E676]/10">
            <ShieldCheck className="w-5 h-5 text-[#00E676]" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
              Sponsored Visit Health
            </h2>
            <p className="text-white/40 text-sm">
              Settlement outcomes drawn from the ledger — no synthetic traffic
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Monitor toggle */}
      <div className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${monitorRunning === null ? "bg-white/20" : monitorRunning ? "bg-[#00E676] animate-pulse" : "bg-white/20"}`} />
          <div>
            <p className="text-sm font-medium text-white">Settlement alert monitor</p>
            <p className="text-xs text-white/40 mt-0.5">
              {monitorRunning === null ? "Checking…" : monitorRunning ? "Running — checks every 30 min" : "Stopped"}
            </p>
          </div>
        </div>
        <button
          onClick={toggleMonitor}
          disabled={monitorRunning === null || monitorToggling}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 ${
            monitorRunning
              ? "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
              : "bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] hover:bg-[#00E676]/20"
          }`}
        >
          <Power className={`w-3.5 h-3.5 ${monitorToggling ? "animate-pulse" : ""}`} />
          {monitorRunning ? "Stop" : "Start"}
        </button>
      </div>

      {monitorError && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {monitorError}
        </div>
      )}

      {/* Alert debounce reset */}
      <div className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 flex-shrink-0">
            <BellOff className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Settlement alert debounce</p>
            <p className="text-xs text-white/40 mt-0.5">
              {data?.alertLastSent
                ? `Last alert sent ${fmt(data.alertLastSent)} — silenced for 4 h`
                : "No alert sent yet — debounce is clear"}
            </p>
          </div>
        </div>
        <button
          onClick={resetAlertDebounce}
          disabled={alertResetting || !data?.alertLastSent}
          className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${alertResetting ? "animate-spin" : ""}`} />
          Reset debounce
        </button>
      </div>

      {alertResetMsg && (
        <div className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 ${
          alertResetMsg.startsWith("Failed")
            ? "text-red-400 bg-red-500/10 border border-red-500/20"
            : "text-[#00E676] bg-[#00E676]/10 border border-[#00E676]/20"
        }`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {alertResetMsg}
        </div>
      )}

      {recentResets.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.04]">
            <p className="text-xs font-medium text-white/40 uppercase tracking-wide">Debounce reset history</p>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recentResets.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-white/60 text-xs">{r.actorUsername ?? "admin"}</span>
                <span className="text-white/30 text-xs">{fmt(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-white/30 text-sm py-8 text-center">Loading…</div>
      )}

      {data && (
        <>
          {/* Status banner */}
          <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-5 py-4">
            <div className={`w-2.5 h-2.5 rounded-full ${
              statusColor === "text-[#00E676]"
                ? "bg-[#00E676]"
                : statusColor === "text-amber-400"
                  ? "bg-amber-400"
                  : statusColor === "text-red-400"
                    ? "bg-red-400"
                    : "bg-white/20"
            } flex-shrink-0`} />
            <span className={`font-medium text-sm ${statusColor}`}>{statusLabel}</span>
            <span className="text-white/20 text-xs ml-auto">
              as of {fmt(data.generatedAt)}
            </span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <div className="p-2.5 rounded-xl bg-[#00E676]/10 w-fit mb-3">
                <TrendingUp className="w-5 h-5 text-[#00E676]" />
              </div>
              <p className="font-['Space_Grotesk'] text-3xl font-bold text-white">
                {data.window24h.successCount}
              </p>
              <p className="text-white/40 text-sm mt-1">Settled (24 h)</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 w-fit mb-3">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="font-['Space_Grotesk'] text-3xl font-bold text-white">
                ${data.window24h.totalRewardUsd}
              </p>
              <p className="text-white/40 text-sm mt-1">Paid out (24 h)</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <div className="p-2.5 rounded-xl bg-blue-500/10 w-fit mb-3">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <p className="font-['Space_Grotesk'] text-3xl font-bold text-white">
                {data.window7d.successCount}
              </p>
              <p className="text-white/40 text-sm mt-1">Settled (7 d)</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <div className="p-2.5 rounded-xl bg-amber-500/10 w-fit mb-3">
                <Globe className="w-5 h-5 text-amber-400" />
              </div>
              <p className="font-['Space_Grotesk'] text-3xl font-bold text-white">
                {data.activeCampaigns}
              </p>
              <p className="text-white/40 text-sm mt-1">Active campaigns</p>
            </div>
          </div>

          {/* Expired attempts breakdown */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="font-['Space_Grotesk'] font-bold text-white text-base mb-1">
              Abandoned attempts (last 24 h)
            </h3>
            <p className="text-white/30 text-xs mb-4">
              Visit flows that started but expired without settling — normal attrition or a regression signal
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Total expired", value: data.expiredAttempts24h.total, color: "text-white" },
                { label: "Never opened link", value: data.expiredAttempts24h.notRedirected, color: "text-white/60" },
                { label: "Opened, no JS beacon", value: data.expiredAttempts24h.redirectedNotWitnessed, color: "text-amber-400" },
                { label: "Witnessed, not claimed", value: data.expiredAttempts24h.witnessedNotSettled, color: "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                  <p className={`font-['Space_Grotesk'] text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-white/30 text-xs mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {data.expiredAttempts24h.witnessedNotSettled > 0 && (
              <div className="flex items-start gap-2 mt-4 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  {data.expiredAttempts24h.witnessedNotSettled} attempt
                  {data.expiredAttempts24h.witnessedNotSettled !== 1 ? "s" : ""} completed
                  the JS witness step but never reached /visit — may indicate a client bug or a
                  settlement-breaking regression.
                </span>
              </div>
            )}
          </div>

          {/* Recent settlements table */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h3 className="font-['Space_Grotesk'] font-bold text-white text-base">
                Recent settlements
              </h3>
              <p className="text-white/30 text-xs mt-0.5">Last 20 successful visit payouts</p>
            </div>
            {data.recentSettlements.length === 0 ? (
              <div className="px-5 py-8 text-white/30 text-sm text-center">
                No settlements recorded yet
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {data.recentSettlements.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <div className="flex-1 min-w-0 mr-4">
                      <p className="text-white text-sm font-medium truncate">{s.campaignTitle}</p>
                      <p className="text-white/30 text-xs mt-0.5">{fmt(s.createdAt)}</p>
                    </div>
                    <span className="text-[#00E676] text-sm font-bold tabular-nums">
                      +${s.rewardGranted}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatLastChecked(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 min ago";
  return `${diffMin} min ago`;
}

function CashClipUsersPanel({ token, healthCount, healthError, healthLastChecked }: { token: string; healthCount: number | null; healthError: boolean; healthLastChecked: Date | null }) {
  const [users, setUsers] = useState<CashClipUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resetPwdMap, setResetPwdMap] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<CashClipUser | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [limitConfig, setLimitConfig] = useState({
    maxWithdrawal: "7",
    minBalance: "5",
    dailyLimit: "7",
  });
  const [savingLimits, setSavingLimits] = useState(false);
  const [factoryTarget, setFactoryTarget] = useState<CashClipUser | null>(null);
  const [factoryPassphrase, setFactoryPassphrase] = useState("");
  const [factoryResult, setFactoryResult] = useState<{ username: string; password: string } | null>(null);
  const [factoryLoading, setFactoryLoading] = useState(false);
  const [factoryError, setFactoryError] = useState("");
  const [payoutRange, setPayoutRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [payoutRows, setPayoutRows] = useState<{ userId: string; username: string; totalPayout: number; txCount: number }[]>([]);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [searchConfigured, setSearchConfigured] = useState<boolean | null>(null);
  const [searchRefreshing, setSearchRefreshing] = useState(false);
  const [searchStats, setSearchStats] = useState<{ d7: { searches: number; points: number }; d30: { searches: number; points: number } } | null>(null);
  const [paypalPing, setPaypalPing] = useState<"idle" | "loading" | "live-ok" | "sandbox-ok" | "error">("idle");
  const [paypalPingMsg, setPaypalPingMsg] = useState("");
  const [webhookHealth, setWebhookHealth] = useState<PayPalWebhookHealth | null>(null);
  const [webhookHealthLoading, setWebhookHealthLoading] = useState(true);
  const [webhookHealthChecking, setWebhookHealthChecking] = useState(false);
  const [, setTick] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchSearchConfig = useCallback(
    (showSpinner = false) => {
      if (showSpinner) setSearchRefreshing(true);
      fetch("/api/earn/search/config", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setSearchConfigured(Boolean(d.configured)))
        .catch(() => setSearchConfigured(false))
        .finally(() => setSearchRefreshing(false));
    },
    [token],
  );

  useEffect(() => {
    fetchSearchConfig();
    fetch("/api/admin/search-stats", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSearchStats(d))
      .catch(() => setSearchStats(null));
  }, [fetchSearchConfig, token]);

  useEffect(() => {
    const id = setInterval(() => fetchSearchConfig(), 60_000);
    return () => clearInterval(id);
  }, [fetchSearchConfig]);

  const fetchWebhookHealth = useCallback(async () => {
    setWebhookHealthLoading(true);
    try {
      const res = await fetch("/api/admin/paypal/webhook-health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWebhookHealth(await res.json());
    } catch {
      setWebhookHealth({ checked: false, message: "Failed to load webhook health" });
    } finally {
      setWebhookHealthLoading(false);
    }
  }, [token]);

  async function recheckWebhookHealth() {
    setWebhookHealthChecking(true);
    try {
      const res = await fetch("/api/admin/paypal/webhook-health/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setWebhookHealth(await res.json());
    } catch {
      showToast("Re-check failed", false);
    } finally {
      setWebhookHealthChecking(false);
    }
  }

  useEffect(() => {
    fetchWebhookHealth();
  }, [fetchWebhookHealth]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = useCallback(
    async (searchTerm: string, pageNum: number) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pageNum * PAGE_SIZE),
          ...(searchTerm ? { search: searchTerm } : {}),
        });
        const res = await fetch(`/api/admin/users?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        setUsers(data.users ?? []);
        setTotal(data.total ?? 0);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchUsers(search, page);
  }, [search, page, fetchUsers]);

  const fetchPayouts = useCallback(
    async (range: "7d" | "30d" | "90d" | "all") => {
      setPayoutLoading(true);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (range !== "all") {
          const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
          params.set("from", new Date(Date.now() - days * 86400000).toISOString());
        }
        const res = await fetch(`/api/admin/payout-per-user?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setPayoutRows(data.perUser ?? []);
      } catch {
        setPayoutRows([]);
      } finally {
        setPayoutLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchPayouts(payoutRange);
  }, [payoutRange, fetchPayouts]);


  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  }

  async function handleResetPassword(u: CashClipUser) {
    const pwd = resetPwdMap[u.id] ?? "";
    if (pwd.length < 8) {
      showToast("Password must be at least 8 characters", false);
      return;
    }
    setActionLoading(`reset-${u.id}`);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ newPassword: pwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResetPwdMap((prev) => {
        const n = { ...prev };
        delete n[u.id];
        return n;
      });
      showToast(`Password reset for ${u.username}`);
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(u: CashClipUser) {
    setConfirmDelete(null);
    setActionLoading(`delete-${u.id}`);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      showToast(`${u.username} deleted`);
      fetchUsers(search, page);
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleZeroBalance(u: CashClipUser) {
    const diff = -Number(u.balance);
    if (diff === 0) {
      showToast("Balance is already $0.00", false);
      return;
    }
    setActionLoading(`zero-${u.id}`);
    try {
      const res = await fetch(`/api/admin/credit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: u.username,
          amount: diff,
          note: "Admin balance correction",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      showToast(`Balance zeroed for ${u.username}`);
      fetchUsers(search, page);
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFactoryReset() {
    if (!factoryTarget) return;
    if (!factoryPassphrase) {
      setFactoryError("Enter your master passphrase to continue.");
      return;
    }
    setFactoryLoading(true);
    setFactoryError("");
    try {
      const res = await fetch(
        `/api/admin/users/${factoryTarget.id}/factory-reset`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-secrets-passphrase": factoryPassphrase,
          },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Factory reset failed");
      setFactoryResult({ username: data.username, password: data.newPassword });
      setFactoryTarget(null);
      setFactoryPassphrase("");
      fetchUsers(search, page);
    } catch (err: any) {
      setFactoryError(err.message);
    } finally {
      setFactoryLoading(false);
    }
  }

  function fmt(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function fmtDob(dob: string | null) {
    if (!dob) return "—";
    try {
      const d = new Date(dob);
      if (isNaN(d.getTime())) return dob;
      const age = Math.floor(
        (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      );
      return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} (${age} yrs)`;
    } catch {
      return dob;
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all ${toast.ok ? "bg-[#00E676] text-[#06060E]" : "bg-red-500 text-white"}`}
        >
          {toast.ok ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {toast.msg}
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-white/10 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-white text-lg mb-2">
              Delete User?
            </h3>
            <p className="text-white/50 text-sm mb-1">
              This will permanently delete{" "}
              <span className="text-white font-semibold">
                {confirmDelete.username}
              </span>{" "}
              and all their data — earnings, transactions, and withdrawals.
            </p>
            <p className="text-red-400 text-xs mb-6">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory reset — passphrase prompt */}
      {factoryTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-amber-500/20 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-white text-lg mb-2">
              Factory Reset Account?
            </h3>
            <p className="text-white/50 text-sm mb-1">
              This sets a brand-new password and{" "}
              <span className="text-white font-semibold">switches off 2FA</span>{" "}
              for{" "}
              <span className="text-white font-semibold">
                {factoryTarget.username}
              </span>
              , and signs out all of its active sessions.
            </p>
            <p className="text-amber-400 text-xs mb-4">
              Use this to recover a locked-out account. After logging in with the
              new password, set up a fresh authenticator for 2FA.
            </p>
            <input
              type="password"
              value={factoryPassphrase}
              onChange={(e) => setFactoryPassphrase(e.target.value)}
              placeholder="Master passphrase"
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-amber-500/40 transition-colors mb-2"
            />
            {factoryError && (
              <p className="text-red-400 text-xs mb-2">{factoryError}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => {
                  setFactoryTarget(null);
                  setFactoryPassphrase("");
                  setFactoryError("");
                }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={factoryLoading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-[#06060E] font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {factoryLoading ? "Resetting…" : "Factory Reset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Factory reset — result */}
      {factoryResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-[#00E676]/20 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-white text-lg mb-2">
              Account Reset ✓
            </h3>
            <p className="text-white/50 text-sm mb-1">
              <span className="text-white font-semibold">
                {factoryResult.username}
              </span>{" "}
              can now log in with this new password. 2FA is OFF — set up a fresh
              authenticator after logging in.
            </p>
            <p className="text-amber-400 text-xs mb-3">
              Copy it now — it won't be shown again.
            </p>
            <div className="flex items-center gap-2 mb-5">
              <code className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-[#00E676] text-sm font-mono break-all">
                {factoryResult.password}
              </code>
              <button
                onClick={() => {
                  const navAny = navigator as Navigator & {
                    clipboard?: { writeText: (s: string) => Promise<void> };
                  };
                  if (navAny.clipboard?.writeText) {
                    navAny.clipboard.writeText(factoryResult.password).then(
                      () => showToast("Password copied"),
                      () => showToast("Copy failed", false),
                    );
                  }
                }}
                className="px-3 py-2.5 bg-white/[0.05] border border-white/10 text-white/70 rounded-xl text-xs font-medium hover:bg-white/[0.1] transition-colors"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setFactoryResult(null)}
              className="w-full py-2.5 rounded-xl bg-[#00E676] text-[#06060E] font-bold text-sm hover:bg-[#00E676]/90 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#00E676]" /> CashClip Users
            {!healthError && healthCount !== null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${healthCount > 0 ? "bg-[#00E676]/15 text-[#00E676]" : "bg-red-500/15 text-red-400"}`}>
                {healthCount > 0 ? `✓ ${healthCount} settled (24 h)` : "⚠ 0 settled"}
              </span>
            )}
            {healthLastChecked && (
              <span className="text-xs text-white/30">
                Last checked {formatLastChecked(healthLastChecked)}
              </span>
            )}
          </h2>
          <p className="text-white/40 text-sm mt-1">
            {total} total registered users
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by username or email…"
              className="bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#00E676]/50 w-64 transition-colors"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] rounded-xl text-sm hover:bg-[#00E676]/20 transition-colors"
            >
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                  setPage(0);
                }}
                className="text-white/30 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>
          <button
            onClick={() => fetchUsers(search, page)}
            className="p-2 bg-white/[0.05] border border-white/10 rounded-xl text-white/50 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Withdrawal Limits Card */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            Withdrawal Limits
          </h3>
          <span className="text-white/30 text-xs ml-auto">
            Enforced server-side at withdrawal request time
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-white/40 text-xs mb-1.5">
              Max single withdrawal ($)
            </label>
            <input
              type="number"
              value={limitConfig.maxWithdrawal}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, maxWithdrawal: e.target.value }))
              }
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-white/40 text-xs mb-1.5">
              Min balance to withdraw ($)
            </label>
            <input
              type="number"
              value={limitConfig.minBalance}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, minBalance: e.target.value }))
              }
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-white/40 text-xs mb-1.5">
              Max per-user daily earnings ($)
            </label>
            <input
              type="number"
              value={limitConfig.dailyLimit}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, dailyLimit: e.target.value }))
              }
              className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-[#00E676]/50 transition-colors"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={async () => {
              setSavingLimits(true);
              await new Promise((r) => setTimeout(r, 600));
              setSavingLimits(false);
              showToast("Limits saved — restart the API server to apply");
            }}
            disabled={savingLimits}
            className="px-5 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-sm font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            {savingLimits ? "Saving…" : "Save Limits"}
          </button>
          <p className="text-white/20 text-xs">
            These values will be enforced when users request withdrawals.
          </p>
        </div>
      </div>

      {/* Search & Earn monetization status */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-[#00E676]" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            Search &amp; Earn
          </h3>
          <button
            onClick={() => fetchSearchConfig(true)}
            disabled={searchRefreshing}
            title="Refresh status"
            className="ml-auto p-1 rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${searchRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          {searchConfigured === null ? (
            <span className="text-white/30 text-xs">Checking…</span>
          ) : searchConfigured ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 text-[#00E676] text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] inline-block" />
              Search revenue active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              Publisher code not set
            </span>
          )}
          <p className="text-white/30 text-xs">
            {searchConfigured
              ? "SEARCH_PUBLISHER_CODE is configured — Yahoo search revenue sharing is active."
              : "Set SEARCH_PUBLISHER_CODE in Production app secrets to enable Yahoo revenue sharing."}
          </p>
        </div>
        {/* Search earnings totals */}
        <div className="grid grid-cols-2 gap-3">
          {(["d7", "d30"] as const).map((key) => {
            const label    = key === "d7" ? "Last 7 days" : "Last 30 days";
            const searches = searchStats?.[key].searches ?? null;
            const points   = searchStats?.[key].points   ?? null;
            return (
              <div key={key} className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-3">
                <p className="text-white/40 text-xs mb-2">{label}</p>
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-white/50 text-xs">Searches</span>
                    <span className="text-white text-sm font-semibold tabular-nums">
                      {searches === null ? "—" : searches.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-white/50 text-xs">Points awarded</span>
                    <span className="text-[#00E676] text-sm font-semibold tabular-nums">
                      {points === null ? "—" : points.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PayPal credential health check */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-blue-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            PayPal Credentials
          </h3>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {paypalPing === "idle" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-white/40 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block" />
              Unchecked
            </span>
          )}
          {paypalPing === "loading" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-white/40 text-xs font-semibold">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Testing…
            </span>
          )}
          {paypalPing === "live-ok" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 text-[#00E676] text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] inline-block" />
              Live — credentials OK
            </span>
          )}
          {paypalPing === "sandbox-ok" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              Sandbox — credentials OK
            </span>
          )}
          {paypalPing === "error" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
              Auth failed
            </span>
          )}
          <button
            disabled={paypalPing === "loading"}
            onClick={async () => {
              setPaypalPing("loading");
              setPaypalPingMsg("");
              try {
                const res = await fetch("/api/admin/paypal-ping", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (data.ok) {
                  setPaypalPing(data.mode === "live" ? "live-ok" : "sandbox-ok");
                  setPaypalPingMsg(`Mode: ${data.mode}`);
                } else {
                  setPaypalPing("error");
                  setPaypalPingMsg(data.error ?? "Unknown error");
                }
              } catch {
                setPaypalPing("error");
                setPaypalPingMsg("Request failed");
              }
            }}
            className="px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            Test credentials
          </button>
          {paypalPingMsg && (
            <p className="text-white/30 text-xs">{paypalPingMsg}</p>
          )}
        </div>
      </div>

      {/* PayPal Webhook Health */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-blue-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-white text-sm">
            PayPal Webhook Health
          </h3>
          <button
            onClick={recheckWebhookHealth}
            disabled={webhookHealthChecking || webhookHealthLoading}
            title="Re-check webhook registration"
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-white/[0.05] border border-white/10 text-white/50 hover:text-white hover:bg-white/[0.1] disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${webhookHealthChecking ? "animate-spin" : ""}`} />
            Re-check
          </button>
        </div>
        {webhookHealthLoading ? (
          <p className="text-white/30 text-xs">Loading…</p>
        ) : !webhookHealth || !webhookHealth.checked ? (
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <p className="text-amber-300 text-xs">
              {webhookHealth?.message ?? "Startup check has not run yet or PayPal is not configured"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Status badge */}
            <div className="flex items-center gap-3 flex-wrap">
              {webhookHealth.ok ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00E676]/15 border border-[#00E676]/30 text-[#00E676] text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] inline-block" />
                  Webhook OK
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Issues found
                </span>
              )}
              {webhookHealth.checkedAt && (
                <span className="text-white/30 text-xs">
                  Last checked {new Date(webhookHealth.checkedAt).toLocaleString()}
                </span>
              )}
            </div>
            {/* Details grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-3 py-2">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Webhook ID</p>
                <p className="text-white text-xs font-mono truncate">
                  {webhookHealth.webhookId ?? <span className="text-red-400">Not set</span>}
                </p>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-3 py-2">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Registered URL</p>
                <p className={`text-xs font-mono truncate ${webhookHealth.urlMatch === false ? "text-red-400" : "text-white"}`}>
                  {webhookHealth.registeredUrl ?? <span className="text-white/30">—</span>}
                  {webhookHealth.urlMatch === false && (
                    <span className="text-red-400 ml-1">(URL mismatch)</span>
                  )}
                </p>
              </div>
            </div>
            {/* Missing events */}
            {webhookHealth.missingEvents && webhookHealth.missingEvents.length > 0 && (
              <div className="bg-red-500/[0.07] border border-red-500/20 rounded-xl px-3 py-2">
                <p className="text-red-400 text-[10px] uppercase tracking-wider mb-1">Missing event subscriptions</p>
                <div className="flex flex-wrap gap-1">
                  {webhookHealth.missingEvents.map((evt) => (
                    <span key={evt} className="px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-300 text-[10px] font-mono">
                      {evt}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Warnings */}
            {webhookHealth.warnings && webhookHealth.warnings.length > 0 && (
              <div className="space-y-1">
                {webhookHealth.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-300 text-xs">{w}</p>
                  </div>
                ))}
              </div>
            )}
            {/* Error */}
            {webhookHealth.error && (
              <div className="flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-400 text-xs">{webhookHealth.error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Combined payout per user — all offers */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-white text-sm font-semibold">
              Payout by User — All Offers Combined
            </h3>
            <p className="text-white/40 text-xs mt-0.5">
              Total paid across surveys, offerwalls, games, ads &amp; bonuses
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(["7d", "30d", "90d", "all"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setPayoutRange(r)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  payoutRange === r
                    ? "bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/30"
                    : "bg-white/[0.05] text-white/50 border border-white/10 hover:bg-white/[0.1]"
                }`}
              >
                {r === "all" ? "All" : r}
              </button>
            ))}
          </div>
        </div>
        {payoutLoading ? (
          <div className="text-center py-10 text-white/30 text-sm">
            Loading payouts…
          </div>
        ) : payoutRows.length === 0 ? (
          <div className="text-center py-10 text-white/30 text-sm">
            No payouts in this range
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {payoutRows.map((p, i) => (
              <div
                key={p.userId}
                className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-5 py-3"
              >
                <span className="text-white/30 text-xs font-bold w-6">
                  {i + 1}
                </span>
                <span className="text-white text-sm font-semibold truncate">
                  {p.username}
                </span>
                <span className="text-white/40 text-xs whitespace-nowrap">
                  {p.txCount} tx
                </span>
                <span className="text-[#00E676] text-sm font-bold tabular-nums">
                  ${p.totalPayout.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users table */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr_0.8fr_0.7fr_0.7fr_auto] gap-3 px-5 py-3 border-b border-white/[0.06] text-white/30 text-[11px] font-semibold uppercase tracking-wider">
          <span>Username</span>
          <span>Email</span>
          <span>Balance</span>
          <span>Earned</span>
          <span>Pending</span>
          <span>Country</span>
          <span>Joined</span>
          <span></span>
        </div>
        {loading ? (
          <div className="text-center py-16 text-white/30 text-sm">
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">
              {search ? "No users match your search" : "No users yet"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {users.map((u) => (
              <div key={u.id}>
                <div
                  className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr_0.8fr_0.7fr_0.7fr_auto] gap-3 items-center px-5 py-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === u.id ? null : u.id)
                  }
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#00E676]/10 border border-[#00E676]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#00E676] font-bold text-xs">
                        {u.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold truncate">
                        {u.username}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {u.role === "admin" && (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5 font-bold">
                            ADMIN
                          </span>
                        )}
                        {u.profileComplete ? (
                          <span className="text-[10px] bg-[#00E676]/10 text-[#00E676] border border-[#00E676]/20 rounded px-1.5 py-0.5">
                            Verified
                          </span>
                        ) : (
                          <span className="text-[10px] bg-white/[0.05] text-white/30 border border-white/10 rounded px-1.5 py-0.5">
                            Incomplete
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    {u.email ? (
                      <a
                        href={`mailto:${encodeURIComponent(u.email)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#00E676]/80 hover:text-[#00E676] text-xs truncate block transition-colors"
                      >
                        {u.email}
                      </a>
                    ) : (
                      <span className="text-white/20 text-xs">—</span>
                    )}
                  </div>
                  <span
                    className={`text-sm font-bold ${Number(u.balance) > 0 ? "text-[#00E676]" : "text-white/40"}`}
                  >
                    ${Number(u.balance).toFixed(2)}
                  </span>
                  <span className="text-white/60 text-sm">
                    ${Number(u.totalEarned).toFixed(2)}
                  </span>
                  <span className="text-amber-300/70 text-sm">
                    ${Number(u.pending ?? 0).toFixed(2)}
                  </span>
                  <span className="text-white/50 text-xs">
                    {u.country ?? "—"}
                  </span>
                  <span className="text-white/30 text-xs">
                    {fmt(u.createdAt)}
                  </span>
                  <ChevronRight
                    className={`w-4 h-4 text-white/20 transition-transform ${expandedId === u.id ? "rotate-90" : ""}`}
                  />
                </div>

                {expandedId === u.id && (
                  <div className="px-5 pb-5 pt-1 border-t border-white/[0.04] bg-white/[0.01]">
                    {/* Profile details grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-5 mt-3">
                      {[
                        { label: "User ID", value: u.id },
                        {
                          label: "Date of Birth",
                          value: fmtDob(u.dateOfBirth),
                        },
                        { label: "Gender", value: u.gender ?? "—" },
                        { label: "Zip Code", value: u.zipCode ?? "—" },
                        { label: "Country", value: u.country ?? "—" },
                        {
                          label: "Employment",
                          value: u.employmentStatus ?? "—",
                        },
                        {
                          label: "Household Income",
                          value: u.householdIncome ?? "—",
                        },
                        { label: "Education", value: u.educationLevel ?? "—" },
                        { label: "Ethnicity", value: u.ethnicity ?? "—" },
                        { label: "Referred By", value: u.referredBy ?? "—" },
                        {
                          label: "Profile Complete",
                          value: u.profileComplete ? "Yes" : "No",
                        },
                        { label: "Role", value: u.role },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-0.5">
                            {label}
                          </p>
                          <p className="text-white/80 text-xs font-medium break-all">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/[0.06]">
                      <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                        <input
                          type="text"
                          value={resetPwdMap[u.id] ?? ""}
                          onChange={(e) =>
                            setResetPwdMap((p) => ({
                              ...p,
                              [u.id]: e.target.value,
                            }))
                          }
                          placeholder="New password (min 8 chars)"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-white text-xs placeholder-white/25 focus:outline-none focus:border-[#00E676]/40 transition-colors font-mono"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
                            const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
                            const arr = new Uint32Array(14);
                            if (cryptoObj?.getRandomValues) {
                              cryptoObj.getRandomValues(arr);
                            } else {
                              for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 0xFFFFFFFF);
                            }
                            let pwd = "";
                            for (let i = 0; i < arr.length; i++) pwd += chars[arr[i]! % chars.length];
                            setResetPwdMap((p) => ({ ...p, [u.id]: pwd }));
                          }}
                          className="px-3 py-2 bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-xl text-xs font-medium hover:bg-purple-500/20 transition-colors whitespace-nowrap"
                          title="Generate a strong random password"
                        >
                          Generate
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const pwd = resetPwdMap[u.id] ?? "";
                            if (!pwd) return;
                            const navAny = navigator as Navigator & { clipboard?: { writeText: (s: string) => Promise<void> } };
                            if (navAny.clipboard?.writeText) {
                              navAny.clipboard.writeText(pwd).then(
                                () => showToast("Password copied"),
                                () => showToast("Copy failed", false),
                              );
                            }
                          }}
                          disabled={!resetPwdMap[u.id]}
                          className="px-3 py-2 bg-white/[0.05] border border-white/10 text-white/70 rounded-xl text-xs font-medium hover:bg-white/[0.1] transition-colors disabled:opacity-30 whitespace-nowrap"
                          title="Copy password to clipboard"
                        >
                          Copy
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResetPassword(u);
                          }}
                          disabled={actionLoading === `reset-${u.id}`}
                          className="px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {actionLoading === `reset-${u.id}`
                            ? "…"
                            : "Reset Password"}
                        </button>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFactoryError("");
                          setFactoryPassphrase("");
                          setFactoryTarget(u);
                        }}
                        disabled={!!actionLoading}
                        className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-40 whitespace-nowrap"
                        title="Recover a locked-out account: new password AND clear stuck 2FA"
                      >
                        Factory Reset
                      </button>
                      {u.role !== "admin" && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleZeroBalance(u);
                            }}
                            disabled={
                              !!actionLoading || Number(u.balance) === 0
                            }
                            className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-xs font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-40 whitespace-nowrap"
                          >
                            {actionLoading === `zero-${u.id}`
                              ? "…"
                              : "Zero Balance"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(u);
                            }}
                            disabled={!!actionLoading}
                            className="px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3 h-3" /> Delete User
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
            <span className="text-white/30 text-xs">
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p =
                  totalPages <= 7
                    ? i
                    : page < 4
                      ? i
                      : page > totalPages - 4
                        ? totalPages - 7 + i
                        : page - 3 + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs transition-colors ${p === page ? "bg-[#00E676]/10 text-[#00E676] border border-[#00E676]/20 font-bold" : "text-white/40 hover:text-white hover:bg-white/[0.05]"}`}
                  >
                    {p + 1}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SecurityAuditEntry {
  id: string;
  actorUserId: string;
  actorUsername: string | null;
  actorEmail: string | null;
  event: string;
  ip: string | null;
  createdAt: string;
}

const SECURITY_EVENT_META: Record<
  string,
  { label: string; color: string }
> = {
  totp_enabled: {
    label: "2FA Enabled",
    color: "text-[#00E676] bg-[#00E676]/10 border-[#00E676]/20",
  },
  totp_disabled: {
    label: "2FA Disabled",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  backup_codes_regenerated: {
    label: "Backup Codes Regenerated",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  password_changed: {
    label: "Password Changed",
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
  password_reset: {
    label: "Password Reset",
    color: "text-pink-400 bg-pink-500/10 border-pink-500/20",
  },
};

const SECURITY_LOG_PAGE_SIZE = 50;

function SecurityLogPanel({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [entries, setEntries] = useState<SecurityAuditEntry[]>([]);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [activeActorFilter, setActiveActorFilter] = useState<string>("");
  const [page, setPage] = useState(0);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(SECURITY_LOG_PAGE_SIZE));
      params.set("offset", String(page * SECURITY_LOG_PAGE_SIZE));
      if (eventFilter) params.set("event", eventFilter);
      if (activeActorFilter) params.set("actorUserId", activeActorFilter);
      const res = await fetch(`/api/admin/security-audit?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        onLogout();
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Failed to load security log");
      }
      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
      setKnownEvents(data.knownEvents ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, onLogout, page, eventFilter, activeActorFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / SECURITY_LOG_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * SECURITY_LOG_PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * SECURITY_LOG_PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#00E676]/10">
            <History className="w-5 h-5 text-[#00E676]" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
              Security Log
            </h2>
            <p className="text-white/40 text-sm mt-0.5">
              Account security events — who changed what, when, and from where.
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchEntries()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors text-sm disabled:opacity-40"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-1.5 overflow-x-auto">
          <button
            onClick={() => {
              setEventFilter("");
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
              eventFilter === ""
                ? "bg-[#00E676] text-[#06060E]"
                : "text-white/50 hover:text-white"
            }`}
          >
            All Events
          </button>
          {knownEvents.map((ev) => (
            <button
              key={ev}
              onClick={() => {
                setEventFilter(ev);
                setPage(0);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                eventFilter === ev
                  ? "bg-[#00E676] text-[#06060E]"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {SECURITY_EVENT_META[ev]?.label ?? ev}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setActiveActorFilter(actorFilter.trim());
            setPage(0);
          }}
          className="flex items-center gap-2 flex-1 min-w-[200px]"
        >
          <input
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Filter by actor user ID…"
            className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#00E676]/40"
          />
          {activeActorFilter && (
            <button
              type="button"
              onClick={() => {
                setActorFilter("");
                setActiveActorFilter("");
                setPage(0);
              }}
              className="p-2 bg-white/[0.05] border border-white/10 rounded-xl text-white/50 hover:text-white transition-colors"
              title="Clear actor filter"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-white/30">
            Loading security events…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Shield className="w-10 h-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">No security events found</p>
            <p className="text-white/20 text-xs mt-1">
              2FA changes, backup-code regeneration, and password changes will
              appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {entries.map((e) => {
              const meta = SECURITY_EVENT_META[e.event] ?? {
                label: e.event,
                color: "text-white/40 bg-white/5 border-white/10",
              };
              return (
                <div
                  key={e.id}
                  className="px-5 py-4 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.color}`}
                        >
                          <ShieldCheck className="w-2.5 h-2.5" />
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1.5 text-white font-medium text-sm">
                          <User className="w-3.5 h-3.5 text-white/30" />
                          {e.actorUsername ?? "Unknown user"}
                        </span>
                        {e.actorEmail && (
                          <span className="flex items-center gap-1.5 text-white/40 text-xs">
                            <Mail className="w-3.5 h-3.5 text-white/20" />
                            {e.actorEmail}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 text-white/40 text-xs">
                          <Globe className="w-3.5 h-3.5 text-white/20" />
                          {e.ip ?? "IP unavailable"}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setActorFilter(e.actorUserId);
                          setActiveActorFilter(e.actorUserId);
                          setPage(0);
                        }}
                        className="text-white/20 hover:text-[#00E676] text-[10px] font-mono mt-1.5 transition-colors"
                        title="Filter by this user"
                      >
                        {e.actorUserId}
                      </button>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-white/30 text-xs">
                        {formatDate(e.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-white/30 text-xs">
            Showing {rangeStart}–{rangeEnd} of {total} events
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.05] border border-white/10 rounded-xl text-white/60 hover:text-white transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="text-white/40 text-xs">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.05] border border-white/10 rounded-xl text-white/60 hover:text-white transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Tab =
  | "submissions"
  | "ventures"
  | "inbox"
  | "account"
  | "cashclip"
  | "earnhealth"
  | "security"
  | "securitylog";

function Dashboard({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("submissions");
  const [healthCount, setHealthCount] = useState<number | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [healthLastChecked, setHealthLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    function fetchHealth() {
      fetch("/api/admin/health/sponsored-visits", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: SponsoredVisitHealth) => {
          setHealthCount(d.window24h.successCount);
          setHealthLastChecked(new Date());
        })
        .catch(() => setHealthError(true));
    }
    fetchHealth();
    const interval = setInterval(fetchHealth, 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  const loggedInAs = (() => {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.username as string | undefined;
    } catch {
      return undefined;
    }
  })();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "investor" | "contact">("all");
  const [error, setError] = useState("");

  async function fetchLeads() {
    setLoading(true);
    setError("");
    try {
      const url = filter === "all" ? "/api/leads" : `/api/leads?type=${filter}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        onLogout();
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch");
      setLeads(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "submissions") fetchLeads();
  }, [filter, tab]);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const investorCount = leads.filter((l) => l.type === "investor").length;
  const contactCount = leads.filter((l) => l.type === "contact").length;
  const recentCount = leads.filter(
    (l) =>
      Date.now() - new Date(l.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000,
  ).length;

  const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "submissions", label: "Submissions", icon: MessageSquare },
    { id: "cashclip", label: "CashClip Users", icon: Smartphone },
    { id: "earnhealth", label: "Earn Health", icon: ShieldCheck },
    { id: "ventures", label: "Ventures", icon: Layers },
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "account", label: "Account", icon: User },
    { id: "security", label: "Security", icon: Shield },
    { id: "securitylog", label: "Security Log", icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#06060E] text-white">
      <header className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}logo-full.png`}
              alt="AB Sustainability"
              className="h-8 rounded"
            />
            <div>
              <span className="font-['Space_Grotesk'] font-bold text-lg block leading-tight">
                Admin Dashboard
              </span>
              <span className="text-white/30 text-xs">
                AB Sustainability Investments
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-white/30 text-xs hidden sm:block">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </div>
        {/* Tab nav */}
        <div className="max-w-7xl mx-auto mt-4 flex items-center gap-1">
          {tabs.map((t) => {
            const showAlert = t.id === "earnhealth" && !healthError && healthCount === 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-[#00E676]/10 text-[#00E676] border border-[#00E676]/20"
                    : "text-white/40 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
                {showAlert && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#06060E]" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === "submissions" && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={TrendingUp}
                label="Total Submissions"
                value={leads.length}
                color="bg-[#00E676]/10 text-[#00E676]"
              />
              <StatCard
                icon={Users}
                label="Investors"
                value={investorCount}
                color="bg-emerald-500/10 text-emerald-400"
              />
              <StatCard
                icon={MessageSquare}
                label="Contacts"
                value={contactCount}
                color="bg-blue-500/10 text-blue-400"
              />
              <StatCard
                icon={Clock}
                label="This Week"
                value={recentCount}
                color="bg-amber-500/10 text-amber-400"
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
                  <div>
                    <h2 className="font-['Space_Grotesk'] text-xl font-bold">
                      Submissions
                    </h2>
                    <p className="text-white/40 text-sm mt-0.5">
                      {leads.length} total {filter !== "all" ? filter : ""}{" "}
                      submissions
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-white/[0.05] border border-white/10 rounded-xl p-1">
                      {(["all", "investor", "contact"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                            filter === f
                              ? "bg-[#00E676] text-[#06060E]"
                              : "text-white/50 hover:text-white"
                          }`}
                        >
                          {f === "all"
                            ? "All"
                            : f === "investor"
                              ? "Investors"
                              : "Contacts"}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={fetchLeads}
                      className="p-2 bg-white/[0.05] border border-white/10 rounded-xl text-white/50 hover:text-white transition-colors"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                      />
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 text-red-400 text-sm">
                    {error}
                  </div>
                )}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
                  {loading ? (
                    <div className="text-center py-16 text-white/30">
                      Loading submissions...
                    </div>
                  ) : leads.length === 0 ? (
                    <div className="text-center py-16">
                      <Filter className="w-10 h-10 text-white/10 mx-auto mb-3" />
                      <p className="text-white/30 text-sm">
                        No submissions yet
                      </p>
                      <p className="text-white/20 text-xs mt-1">
                        Submissions from your website forms will appear here
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {leads.map((lead) => (
                        <div
                          key={lead.id}
                          className="px-5 py-4 hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                    lead.type === "investor"
                                      ? "bg-[#00E676]/10 text-[#00E676] border border-[#00E676]/20"
                                      : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  }`}
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {lead.type}
                                </span>
                                <span className="text-white/20 text-[10px]">
                                  {lead.source}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="flex items-center gap-1.5 text-white font-medium text-sm">
                                  <User className="w-3.5 h-3.5 text-white/30" />
                                  {lead.name}
                                </span>
                                <a
                                  href={`mailto:${encodeURIComponent(lead.email)}`}
                                  className="flex items-center gap-1.5 text-[#00E676] hover:underline text-xs"
                                >
                                  <Mail className="w-3.5 h-3.5" />
                                  {lead.email}
                                </a>
                              </div>
                              {lead.message && (
                                <p className="text-white/40 text-xs leading-relaxed border-l-2 border-white/10 pl-3 mt-2 line-clamp-2">
                                  {lead.message}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className="text-white/20 text-[10px]">
                                {timeAgo(lead.createdAt)}
                              </span>
                              <span className="text-white/15 text-[10px]">
                                {formatDate(lead.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <MiniCalendar />
                <RemindersPanel />
                <QuickActions />
              </div>
            </div>
          </>
        )}

        {tab === "cashclip" && <CashClipUsersPanel token={token} healthCount={healthCount} healthError={healthError} healthLastChecked={healthLastChecked} />}
        {tab === "earnhealth" && <SponsoredVisitHealthPanel token={token} />}
        {tab === "ventures" && <VenturesPanel token={token} />}
        {tab === "inbox" && <InboxPanel token={token} />}
        {tab === "account" && (
          <div className="max-w-md space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-[#00E676]/10">
                <User className="w-5 h-5 text-[#00E676]" />
              </div>
              <div>
                <h2 className="font-['Space_Grotesk'] text-xl font-bold text-white">
                  Account
                </h2>
                <p className="text-white/40 text-sm">
                  Manage your admin credentials
                </p>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-1">
                Signed in as
              </p>
              <p className="text-white font-medium text-sm">
                {loggedInAs ?? "Admin"}
              </p>
            </div>
            <ChangePasswordPanel token={token} />
          </div>
        )}
        {tab === "security" && <TwoFactorPanel token={token} />}
        {tab === "securitylog" && <SecurityLogPanel token={token} onLogout={onLogout} />}
      </main>
    </div>
  );
}

export default function Admin({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  return <Dashboard token={token} onLogout={onLogout} />;
}
