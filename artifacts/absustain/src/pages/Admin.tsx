import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import QRCode from "qrcode";
import type { LucideIcon } from "lucide-react";
import {
  LogOut,
  Filter,
  RefreshCw,
  Mail,
  Send,
  User,
  Calendar,
  Tag,
  Plus,
  Trash2,
  Check,
  Clock,
  TrendingUp,
  DollarSign,
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
  Search,
  Activity,
  Server,
  Wifi,
  Rocket,
  Gift,
  UserMinus,
  UserPlus,
  Play,
  Pause,
  Ban,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";

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
        <div className="p-2.5 rounded-xl bg-emerald-100">
          <Shield className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
            Two-Factor Authentication
          </h2>
          <p className="text-gray-400 text-sm">
            Add an extra layer of security to your admin account
          </p>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 text-emerald-600 text-sm bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-3">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {enabled === null && <p className="text-gray-400 text-sm">Loading...</p>}

      {backupCodes && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-gray-900 font-medium text-sm">
                Save your backup codes
              </p>
              <p className="text-gray-400 text-xs mt-1">
                Each code works once in place of your authenticator code. Store
                them somewhere safe — this is the only time they'll be shown.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-gray-100 border border-gray-200 rounded-xl p-4">
            {backupCodes.map((c) => (
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
              onClick={copyBackupCodes}
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
              onClick={downloadBackupCodes}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
          <button
            onClick={() => setBackupCodes(null)}
            className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors text-sm"
          >
            I've saved these codes
          </button>
        </div>
      )}

      {enabled === true && !setupData && !backupCodes && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-100">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-gray-900 font-medium text-sm">2FA is active</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Your account requires an authenticator code on every login
              </p>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <KeyRound className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-gray-900 font-medium text-sm">Backup codes</p>
                <p className="text-gray-400 text-xs mt-0.5">
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
                className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate backup codes
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-gray-500 text-sm">
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
                  className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-center font-mono text-xl tracking-[0.3em] placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
                />
                {error && (
                  <p className="text-red-400 text-sm text-center">{error}</p>
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
                    onClick={() => {
                      setRegenMode(false);
                      setRegenConfirmed(false);
                      setCode("");
                      setError("");
                    }}
                    className="flex-1 bg-gray-100 text-gray-500 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={code.length !== 6 || !regenConfirmed || loading}
                    className="flex-1 bg-[#00E676] text-[#f9fafb] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  >
                    {loading ? "Generating..." : "Generate"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
            <p className="text-gray-500 text-sm">
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
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-center font-mono text-xl tracking-[0.3em] placeholder-gray-400 focus:outline-none focus:border-red-500/50 transition-colors disabled:opacity-40"
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
              <p className="text-gray-900 font-medium text-sm">
                2FA is not enabled
              </p>
              <p className="text-gray-400 text-xs mt-1">
                Your account is protected by password only. Enabling 2FA
                significantly reduces the risk of unauthorized access.
              </p>
            </div>
          </div>
          <button
            onClick={handleSetup}
            disabled={loading}
            className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-50 text-sm"
          >
            {loading ? "Generating..." : "Set Up Two-Factor Authentication"}
          </button>
        </div>
      )}

      {setupData && (
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-gray-900 font-medium text-sm mb-1">
                1. Scan this QR code with your authenticator app
              </p>
              <p className="text-gray-400 text-xs">
                Use Google Authenticator, Authy, or any TOTP-compatible app
              </p>
            </div>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="rounded-xl border border-gray-200"
                  width={200}
                  height={200}
                />
              ) : (
                <div className="w-[200px] h-[200px] rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
                  <span className="text-gray-400 text-xs">Generating…</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1.5">
                Can't scan? Enter this key manually in your app:
              </p>
              <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs text-gray-600 break-all select-all tracking-wider">
                {setupData.secret}
              </div>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
            <p className="text-gray-900 font-medium text-sm">
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
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-center font-mono text-xl tracking-[0.3em] placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
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
                className="flex-1 bg-gray-100 text-gray-500 font-medium py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEnable}
                disabled={code.length !== 6 || loading}
                className="flex-1 bg-[#00E676] text-[#f9fafb] font-bold py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
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
  value: number | string;
  color: string;
}) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="font-['Space_Grotesk'] text-3xl font-bold text-gray-900">
        {value}
      </p>
      <p className="text-gray-400 text-sm mt-1">{label}</p>
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
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-emerald-600" />
        <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
          {month}
        </h3>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-gray-400 font-medium py-1">
            {d}
          </div>
        ))}
        {days.map((d, i) => (
          <div
            key={i}
            className={`py-1.5 rounded-lg transition-colors ${
              d === today
                ? "bg-[#00E676] text-[#f9fafb] font-bold"
                : d
                  ? "text-gray-500 hover:bg-gray-100 cursor-default"
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
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-amber-400" />
        <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
          Reminders
        </h3>
        <span className="ml-auto text-gray-400 text-xs">
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
          className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
        />
        <button
          onClick={addReminder}
          className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {reminders.length === 0 ? (
          <p className="text-gray-300 text-xs text-center py-4">
            No reminders yet
          </p>
        ) : (
          reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 group">
              <button
                onClick={() => toggleReminder(r.id)}
                className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-colors ${
                  r.done
                    ? "bg-emerald-100 border-emerald-300 text-emerald-600"
                    : "border-gray-300 hover:border-white/40"
                }`}
              >
                {r.done && <Check className="w-3 h-3" />}
              </button>
              <span
                className={`text-sm flex-1 ${r.done ? "text-gray-400 line-through" : "text-gray-600"}`}
              >
                {r.text}
              </span>
              <button
                onClick={() => deleteReminder(r.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
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
      color: "text-emerald-600",
    },
    {
      label: "AB Sustainability Site",
      href: "https://absustaininvest.com",
      icon: ExternalLink,
      color: "text-amber-400",
    },
  ];
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-blue-400" />
        <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors group"
          >
            <a.icon className={`w-4 h-4 ${a.color}`} />
            <span className="text-gray-500 text-sm group-hover:text-gray-900 transition-colors flex-1">
              {a.label}
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 transition-colors" />
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
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
            Solera — Food Service Files
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Upload restaurant files, proposals, and resources for the Ventures
            page.
          </p>
        </div>
        <span className="text-gray-400 text-sm">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

      {/* Upload form */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <Upload className="w-4 h-4 text-emerald-600" />
          <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
            Upload New File
          </h3>
        </div>
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 transition-colors"
              >
                {VENTURE_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-gray-50">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..."
                className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">
              File (PDF, images, Excel, Word, CSV — max 50 MB)
            </label>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-[#00E676]/30 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl">
                    {fileIcon(selectedFile.type)}
                  </span>
                  <div className="text-left">
                    <p className="text-gray-900 text-sm font-medium">
                      {selectedFile.name}
                    </p>
                    <p className="text-gray-400 text-xs">
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
                    className="ml-2 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">
                    Click to choose a file
                  </p>
                  <p className="text-gray-300 text-xs mt-1">or drag and drop</p>
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
            <div className="flex items-center gap-2 text-emerald-600 text-sm bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 flex-shrink-0" />
              {uploadSuccess}
            </div>
          )}
          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="bg-[#00E676] text-[#f9fafb] font-bold px-6 py-2.5 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {uploading ? "Uploading..." : "Upload File"}
          </button>
        </form>
      </div>

      {/* File list */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
          <FileText className="w-4 h-4 text-gray-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
            Uploaded Files
          </h3>
          <button
            onClick={fetchFiles}
            className="ml-auto text-gray-400 hover:text-gray-900 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No files uploaded yet</p>
            <p className="text-gray-300 text-xs mt-1">
              Use the form above to upload your first file
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(byCategory).map(([cat, catFiles]) => (
              <div key={cat}>
                <div className="px-5 py-2 bg-white/[0.02]">
                  <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
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
                      <p className="text-gray-900 text-sm font-medium truncate">
                        {f.originalName}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-gray-400 text-xs">
                          {formatSize(f.size)}
                        </span>
                        {f.description && (
                          <span className="text-gray-400 text-xs truncate">
                            • {f.description}
                          </span>
                        )}
                        <span className="text-gray-300 text-xs">
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
                        className="flex items-center gap-1.5 text-emerald-600/60 hover:text-emerald-600 transition-colors text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:block">Download</span>
                      </button>
                      <button
                        onClick={() => handleDelete(f.id, f.originalName)}
                        disabled={deletingId === f.id}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all disabled:opacity-50"
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
        <div className="p-2.5 rounded-xl bg-emerald-100">
          <KeyRound className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
            Change Password
          </h2>
          <p className="text-gray-400 text-sm">
            Update your admin account password
          </p>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-500 text-xs font-medium mb-2 uppercase tracking-wider">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 pr-11 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-500 transition-colors"
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
            <label className="block text-gray-500 text-xs font-medium mb-2 uppercase tracking-wider">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 pr-11 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-500 transition-colors"
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
            <label className="block text-gray-500 text-xs font-medium mb-2 uppercase tracking-wider">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-400 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <p className="text-emerald-600 text-sm">{success}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={
              loading || !currentPassword || !newPassword || !confirmPassword
            }
            className="w-full bg-[#00E676] text-[#f9fafb] font-bold py-3 rounded-xl hover:bg-[#00E676]/90 transition-colors disabled:opacity-40"
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
  messageId: string;
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

interface SupportReplyRecord {
  id: string;
  adminUserId: string;
  adminUsername: string | null;
  adminEmail: string | null;
  recipient: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  createdAt: string;
}

const INBOX_CATEGORIES: {
  id: InboxMessage["category"] | "all";
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { id: "all", label: "All", icon: Inbox, color: "text-gray-900" },
  {
    id: "corporate",
    label: "Corporate",
    icon: Building2,
    color: "text-blue-400",
  },
  { id: "app", label: "CashClip", icon: Smartphone, color: "text-emerald-600" },
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

export function InboxPanel({ token }: { token: string }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<
    InboxMessage["category"] | "all"
  >("all");
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySent, setReplySent] = useState(false);
  const [replyHistory, setReplyHistory] = useState<SupportReplyRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [view, setView] = useState<"inbox" | "sent">("inbox");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [sentReplies, setSentReplies] = useState<SupportReplyRecord[]>([]);
  const [sentTotal, setSentTotal] = useState(0);
  const [sentLoading, setSentLoading] = useState(false);
  const [sentError, setSentError] = useState("");
  const [sentPage, setSentPage] = useState(0);
  const [sentRecipientInput, setSentRecipientInput] = useState("");
  const [sentRecipient, setSentRecipient] = useState("");
  const [sentAdminId, setSentAdminId] = useState("");
  const [sentAdmins, setSentAdmins] = useState<{ id: string; username: string; email: string | null }[]>([]);
  const [sentAdminsLoading, setSentAdminsLoading] = useState(false);
  const SENT_PAGE_SIZE = 25;

  const openReply = useCallback(() => {
    setReplyOpen(true);
    setReplyBody("");
    setReplyError("");
    setReplySent(false);
    setDraftError("");
  }, []);

  const draftReply = useCallback(async () => {
    if (!selected || drafting) return;
    setDrafting(true);
    setDraftError("");
    try {
      const res = await fetch("/api/admin/inbox/draft", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromEmail: selected.fromEmail,
          subject: selected.subject,
          body: selected.body ?? "",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Failed to generate draft");
      }
      const data = await res.json();
      setReplyBody(data.draft ?? "");
      setReplyOpen(true);
      setReplyError("");
      setReplySent(false);
    } catch (err: any) {
      setDraftError(err.message ?? "Draft failed");
    } finally {
      setDrafting(false);
    }
  }, [selected, drafting, token]);

  const fetchReplyHistory = useCallback(
    async (messageId: string) => {
      if (!messageId) {
        setReplyHistory([]);
        setHistoryError("");
        setHistoryLoaded(true);
        return;
      }
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const res = await fetch(
          `/api/admin/inbox/replies?inReplyTo=${encodeURIComponent(messageId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error("Failed to load reply history");
        const data = await res.json();
        setReplyHistory(data.replies ?? []);
        setHistoryLoaded(true);
      } catch {
        setReplyHistory([]);
        setHistoryError("Couldn't load prior replies for this thread.");
      } finally {
        setHistoryLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    setHistoryLoaded(false);
    if (selected?.messageId) {
      fetchReplyHistory(selected.messageId);
    } else {
      setReplyHistory([]);
      setHistoryError("");
    }
  }, [selected?.messageId, fetchReplyHistory]);

  const fetchSentAdmins = useCallback(async () => {
    if (!token) return;
    setSentAdminsLoading(true);
    try {
      const res = await fetch("/api/admin/users?limit=200", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const admins = (data.users ?? []).filter((u: any) => u.role === "admin");
      setSentAdmins(admins.map((u: any) => ({ id: u.id, username: u.username, email: u.email ?? null })));
    } catch {
    } finally {
      setSentAdminsLoading(false);
    }
  }, [token]);

  const fetchSentReplies = useCallback(async () => {
    setSentLoading(true);
    setSentError("");
    try {
      const params = new URLSearchParams({
        limit: String(SENT_PAGE_SIZE),
        offset: String(sentPage * SENT_PAGE_SIZE),
      });
      if (sentRecipient) params.set("recipient", sentRecipient);
      if (sentAdminId) params.set("adminUserId", sentAdminId);
      const res = await fetch(
        `/api/admin/inbox/replies/all?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Failed to load sent replies");
      }
      const data = await res.json();
      setSentReplies(data.replies ?? []);
      setSentTotal(data.total ?? 0);
    } catch (err: any) {
      setSentError(err.message);
      setSentReplies([]);
    } finally {
      setSentLoading(false);
    }
  }, [token, sentPage, sentRecipient, sentAdminId]);

  useEffect(() => {
    if (view === "sent") {
      fetchSentReplies();
      fetchSentAdmins();
    }
  }, [view, fetchSentReplies, fetchSentAdmins]);

  const sendReply = useCallback(async () => {
    if (!selected) return;
    if (replySending) return;
    if (!replyBody.trim()) {
      setReplyError("Reply message cannot be empty.");
      return;
    }
    setReplySending(true);
    setReplyError("");
    try {
      const subject = selected.subject.toLowerCase().startsWith("re:")
        ? selected.subject
        : `Re: ${selected.subject}`;
      const res = await fetch("/api/admin/inbox/reply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: selected.fromEmail,
          subject,
          body: replyBody,
          inReplyTo: selected.messageId || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Failed to send reply");
      }
      setReplySent(true);
      setReplyOpen(false);
      setReplyBody("");
      if (selected.messageId) fetchReplyHistory(selected.messageId);
    } catch (err: any) {
      setReplyError(err.message);
    } finally {
      setReplySending(false);
    }
  }, [selected, replyBody, replySending, token, fetchReplyHistory]);

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
    app: "text-emerald-600 bg-emerald-100 border-emerald-200",
    pr: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    support: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    other: "text-gray-400 bg-white/5 border-gray-200",
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
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
            Inbox
          </h2>
          <p className="text-gray-400 text-sm mt-0.5">
            {view === "inbox" ? (
              <>
                Submissions — one view.
                {fetchedAt && (
                  <span className="ml-2 text-gray-300">
                    Last synced {timeAgoShort(fetchedAt)} ago
                  </span>
                )}
              </>
            ) : (
              <>Every reply the team has sent — full audit trail.</>
            )}
          </p>
        </div>
        {view === "inbox" ? (
          <button
            onClick={fetchMessages}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-sm disabled:opacity-40"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Syncing…" : "Sync Now"}
          </button>
        ) : (
          <button
            onClick={fetchSentReplies}
            disabled={sentLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-sm disabled:opacity-40"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${sentLoading ? "animate-spin" : ""}`}
            />
            {sentLoading ? "Loading…" : "Refresh"}
          </button>
        )}
      </div>

      {/* View switcher: Inbox vs Sent Replies */}
      <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-2xl p-1.5 w-fit">
        <button
          onClick={() => setView("inbox")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            view === "inbox"
              ? "bg-gray-100 text-gray-900"
              : "text-gray-400 hover:text-gray-900 hover:bg-white/[0.04]"
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          Inbox
        </button>
        <button
          onClick={() => setView("sent")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            view === "sent"
              ? "bg-gray-100 text-gray-900"
              : "text-gray-400 hover:text-gray-900 hover:bg-white/[0.04]"
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          Sent Replies
        </button>
      </div>

      {view === "inbox" && (
      <>
      {/* Category tabs */}
      <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-2xl p-1.5 overflow-x-auto">
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
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-400 hover:text-gray-900 hover:bg-white/[0.04]"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? cat.color : ""}`} />
              {cat.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  active
                    ? "bg-white/10 text-gray-900"
                    : "bg-gray-100 text-gray-400"
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
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
          <RefreshCw className="w-8 h-8 text-gray-300 animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Connecting to mail server…</p>
        </div>
      ) : (
        <div
          className={`grid gap-4 ${selected ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}
        >
          {/* Message list */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Inbox className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">
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
                      setReplyOpen(false);
                      setReplyBody("");
                      setReplyError("");
                      setReplySent(false);
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
                              ? "bg-[#00E676]/15 text-emerald-600"
                              : msg.category === "pr"
                                ? "bg-pink-500/15 text-pink-400"
                                : msg.category === "support"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-white/10 text-gray-400"
                        }`}
                      >
                        {(msg.from[0] ?? "?").toUpperCase()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-sm font-semibold truncate ${msg.seen ? "text-gray-500" : "text-gray-900"}`}
                        >
                          {msg.from}
                        </span>
                        {!msg.seen && (
                          <span className="w-2 h-2 rounded-full bg-[#00E676] flex-shrink-0" />
                        )}
                        <span className="text-gray-300 text-xs flex-shrink-0 ml-auto">
                          {timeAgoShort(msg.date)}
                        </span>
                      </div>
                      <p
                        className={`text-sm truncate mb-1 ${msg.seen ? "text-gray-400" : "text-gray-700 font-medium"}`}
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
            <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${catColor[selected.category]}`}
                  >
                    {catLabel[selected.category]}
                  </span>
                  <span className="text-gray-400 text-xs">
                    {new Date(selected.date).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 border-b border-gray-200 space-y-2">
                <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-base leading-snug">
                  {selected.subject}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                    <AtSign className="w-3 h-3" />
                    <span className="font-medium">{selected.fromEmail}</span>
                  </div>
                  <span className="text-gray-300 text-xs">→</span>
                  <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                    <span>{selected.toEmail}</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 max-h-[480px]">
                <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">
                  {selected.body || selected.preview || "(No body content)"}
                </p>
                <div className="mt-6 pt-5 border-t border-gray-200 space-y-3">
                    <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wide">
                      <Mail className="w-3.5 h-3.5" />
                      Reply History
                      {replyHistory.length > 0 && (
                        <span className="text-white/25 normal-case font-normal">
                          ({replyHistory.length})
                        </span>
                      )}
                    </div>
                    {historyLoading && replyHistory.length === 0 ? (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Loading prior replies…
                      </div>
                    ) : historyError ? (
                      <div className="flex items-start gap-2 text-amber-400/80 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>{historyError}</span>
                      </div>
                    ) : historyLoaded && replyHistory.length === 0 ? (
                      <div className="text-gray-400 text-xs">
                        No prior replies to this thread yet.
                      </div>
                    ) : (
                      replyHistory.map((r) => (
                        <div
                          key={r.id}
                          className="bg-[#00E676]/[0.04] border border-[#00E676]/15 rounded-xl px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-emerald-600/90 text-xs font-semibold truncate">
                              {r.adminUsername || r.adminEmail || "Admin"}
                            </span>
                            <span className="text-white/25 text-[11px] flex-shrink-0">
                              {new Date(r.createdAt).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-wrap">
                            {r.body}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-200 space-y-3">
                {replySent && !replyOpen && (
                  <div className="flex items-center gap-2 text-emerald-600 text-xs">
                    <Check className="w-3.5 h-3.5" />
                    Reply sent to {selected.fromEmail}
                  </div>
                )}
                {!replyOpen ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={openReply}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-100 border border-emerald-200 text-emerald-600 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {replySent ? "Reply Again" : "Reply"}
                      </button>
                      <button
                        onClick={draftReply}
                        disabled={drafting}
                        title="OWL: auto-draft a reply using real account data"
                        className="flex items-center gap-2 px-4 py-2 bg-violet-50 border border-violet-200 text-violet-600 rounded-xl text-xs font-medium hover:bg-violet-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
                      >
                        {drafting ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {drafting ? "Drafting…" : "OWL Draft"}
                      </button>
                      <a
                        href={`mailto:${encodeURIComponent(selected.fromEmail)}?subject=Re: ${encodeURIComponent(selected.subject)}`}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 text-gray-500 rounded-xl text-xs font-medium hover:text-gray-900 hover:bg-gray-100 transition-colors"
                      >
                        Open in Webmail
                      </a>
                    </div>
                    {draftError && (
                      <div className="flex items-center gap-1.5 text-red-400 text-xs">
                        <AlertCircle className="w-3 h-3" />
                        {draftError}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                      <span>Replying to</span>
                      <span className="text-gray-600 font-medium">{selected.fromEmail}</span>
                    </div>
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder="Write your reply…"
                      rows={6}
                      autoFocus
                      disabled={replySending}
                      className="w-full bg-white/[0.04] border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder:text-white/25 focus:outline-none focus:border-emerald-300 resize-y disabled:opacity-50"
                    />
                    {replyError && (
                      <div className="flex items-start gap-2 text-red-400 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>{replyError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={sendReply}
                        disabled={replySending || !replyBody.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-100 border border-emerald-200 text-emerald-600 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {replySending ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        {replySending ? "Sending…" : "Send Reply"}
                      </button>
                      <button
                        onClick={() => {
                          setReplyOpen(false);
                          setReplyError("");
                        }}
                        disabled={replySending}
                        className="px-4 py-2 text-gray-400 hover:text-gray-900 transition-colors text-xs disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {view === "sent" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={sentRecipientInput}
                onChange={(e) => setSentRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSentPage(0);
                    setSentRecipient(sentRecipientInput.trim());
                  }
                }}
                placeholder="Filter by recipient email…"
                className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-300"
              />
            </div>
            <button
              onClick={() => {
                setSentPage(0);
                setSentRecipient(sentRecipientInput.trim());
              }}
              className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-sm"
            >
              Search
            </button>
            <select
              value={sentAdminId}
              onChange={(e) => {
                setSentAdminId(e.target.value);
                setSentPage(0);
              }}
              disabled={sentAdminsLoading}
              className="bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:border-gray-300 disabled:opacity-40 min-w-[160px]"
            >
              <option value="">All admins</option>
              {sentAdmins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username || a.email || a.id}
                </option>
              ))}
            </select>
            {(sentRecipient || sentAdminId) && (
              <button
                onClick={() => {
                  setSentRecipientInput("");
                  setSentRecipient("");
                  setSentAdminId("");
                  setSentPage(0);
                }}
                className="px-3 py-2 text-gray-400 hover:text-gray-900 transition-colors text-sm"
              >
                Clear
              </button>
            )}
          </div>

          {sentError && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm">{sentError}</p>
            </div>
          )}

          {sentLoading && sentReplies.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
              <RefreshCw className="w-8 h-8 text-gray-300 animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Loading sent replies…</p>
            </div>
          ) : !sentError && sentReplies.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl py-16 text-center">
              <Mail className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">
                {sentRecipient || sentAdminId
                  ? "No replies match the selected filters"
                  : "No replies have been sent yet"}
              </p>
            </div>
          ) : sentReplies.length > 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              {sentReplies.map((r) => (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-emerald-600/90 text-xs font-semibold truncate">
                        {r.adminUsername || r.adminEmail || "Admin"}
                      </span>
                      <span className="text-gray-300 text-xs">→</span>
                      <span className="text-gray-500 text-xs truncate">
                        {r.recipient}
                      </span>
                    </div>
                    <span className="text-white/25 text-[11px] flex-shrink-0">
                      {new Date(r.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm font-medium truncate mb-1">
                    {r.subject}
                  </p>
                  <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-wrap line-clamp-3">
                    {r.body}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Pagination */}
          {sentTotal > SENT_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-gray-400 text-xs">
                Showing {sentPage * SENT_PAGE_SIZE + 1}–
                {Math.min((sentPage + 1) * SENT_PAGE_SIZE, sentTotal)} of{" "}
                {sentTotal}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSentPage((p) => Math.max(0, p - 1))}
                  disabled={sentPage === 0 || sentLoading}
                  className="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-xs disabled:opacity-30"
                >
                  Previous
                </button>
                <button
                  onClick={() => setSentPage((p) => p + 1)}
                  disabled={
                    (sentPage + 1) * SENT_PAGE_SIZE >= sentTotal || sentLoading
                  }
                  className="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-xs disabled:opacity-30"
                >
                  Next
                </button>
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
  isPublisher?: boolean;
}

export type CreditAuditRow = {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  amount: string;
  description: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  createdAt: string;
};

export type PublisherAuditRow = {
  id: string;
  actorUserId: string;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  campaignId: string | null;
  campaignTitle: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export function CreditAuditTable({ rows }: { rows: CreditAuditRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-gray-400 text-[10px] uppercase tracking-wider">
          <th className="text-left font-medium px-5 py-2">User</th>
          <th className="text-right font-medium px-3 py-2">Amount</th>
          <th className="text-left font-medium px-3 py-2">Reason</th>
          <th className="text-left font-medium px-3 py-2">Issued by</th>
          <th className="text-right font-medium px-5 py-2">When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const amt = Number(r.amount);
          const positive = amt >= 0;
          return (
            <tr
              key={r.id}
              className="border-t border-white/[0.04] align-top"
            >
              <td className="px-5 py-2.5">
                <p className="text-gray-700 text-xs font-medium break-all">
                  {r.username}
                </p>
                <p className="text-white/25 text-[10px] break-all">
                  {r.email ?? "—"}
                </p>
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                <span
                  className={`text-xs font-semibold ${positive ? "text-emerald-600" : "text-amber-400"}`}
                >
                  {positive ? "+" : "-"}${Math.abs(amt).toFixed(2)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[280px] break-words">
                {r.description ?? "—"}
              </td>
              <td className="px-3 py-2.5 text-gray-500 text-xs break-all">
                {r.actorUsername ?? r.actorUserId ?? "—"}
              </td>
              <td className="px-5 py-2.5 text-right text-gray-400 text-[10px] whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CashClipUsersPanel({ token, onNavigateToPublishers }: { token: string; onNavigateToPublishers?: () => void }) {
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
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillPassphrase, setBackfillPassphrase] = useState("");
  const [backfillLoading, setBackfillLoading] = useState<"preview" | "run" | null>(null);
  const [backfillError, setBackfillError] = useState("");
  const [backfillPreview, setBackfillPreview] = useState<{
    candidates: number;
    qualifyAmount: number;
    bonusPerReferral: number;
  } | null>(null);
  const [backfillResult, setBackfillResult] = useState<{
    candidates: number;
    credited: number;
    skipped: number;
    failed: number;
    bonusPerReferral: number;
    creditedReferrers: { referrer: string; referredFriend: string; amount: number }[];
    skippedReferrals: { referrer: string; referredFriend: string }[];
    failedReferrals: { referrer: string; referredFriend: string; error?: string }[];
  } | null>(null);
  function downloadBackfillCsv() {
    if (!backfillResult) return;
    const rows: string[][] = [["status", "referrer", "referred_friend", "amount", "error"]];
    for (const r of backfillResult.creditedReferrers) {
      rows.push(["credited", r.referrer, r.referredFriend, String(r.amount), ""]);
    }
    for (const r of backfillResult.skippedReferrals) {
      rows.push(["skipped", r.referrer, r.referredFriend, "", ""]);
    }
    for (const r of backfillResult.failedReferrals) {
      rows.push(["failed", r.referrer, r.referredFriend, "", r.error ?? ""]);
    }
    const csv = rows
      .map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-backfill-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [payoutRange, setPayoutRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [payoutRows, setPayoutRows] = useState<{ userId: string; username: string; totalPayout: number; txCount: number }[]>([]);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [creditAmountMap, setCreditAmountMap] = useState<Record<string, string>>({});
  const [creditNoteMap, setCreditNoteMap] = useState<Record<string, string>>({});
  const [auditRows, setAuditRows] = useState<
    { id: string; userId: string; username: string; email: string | null; amount: string; description: string | null; actorUserId: string | null; actorUsername: string | null; createdAt: string }[]
  >([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [showAudit, setShowAudit] = useState(true);
  const [auditActorFilter, setAuditActorFilter] = useState("");
  const [auditActors, setAuditActors] = useState<string[]>([]);
  const [searchPerUserRows, setSearchPerUserRows] = useState<
    { userId: string; username: string; queryCount: number }[]
  >([]);
  const [searchPerUserLoading, setSearchPerUserLoading] = useState(true);

  const PAGE_SIZE = 25;

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

  const fetchAdjustmentActors = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/adjustments/actors", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const actors: Array<{ actorUserId: string; actorUsername: string | null }> = data.actors ?? [];
      const names = actors
        .map((a) => a.actorUsername ?? a.actorUserId)
        .filter((n): n is string => !!n)
        .sort((a, b) => a.localeCompare(b));
      setAuditActors(names);
    } catch {
    }
  }, [token]);

  const fetchAdjustments = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (auditActorFilter) params.set("actor", auditActorFilter);
      const res = await fetch(`/api/admin/adjustments?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const rows = data.adjustments ?? [];
      setAuditRows(rows);
    } catch {
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, [token, auditActorFilter]);

  useEffect(() => {
    fetchAdjustmentActors();
  }, [fetchAdjustmentActors]);

  useEffect(() => {
    fetchAdjustments();
  }, [fetchAdjustments]);

  const fetchSearchPerUser = useCallback(async () => {
    setSearchPerUserLoading(true);
    try {
      const res = await fetch("/api/admin/search-per-user?limit=10", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSearchPerUserRows(data.rows ?? []);
    } catch {
      setSearchPerUserRows([]);
    } finally {
      setSearchPerUserLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSearchPerUser();
    const id = setInterval(fetchSearchPerUser, 60_000);
    return () => clearInterval(id);
  }, [fetchSearchPerUser]);

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
      fetchAdjustments();
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCredit(u: CashClipUser) {
    const raw = creditAmountMap[u.id] ?? "";
    const amt = Number(raw);
    if (!Number.isFinite(amt) || amt === 0) {
      showToast("Enter a non-zero amount (use a minus sign to correct down)", false);
      return;
    }
    if (Math.abs(amt) > 1000) {
      showToast("Amount must be between -1000 and 1000", false);
      return;
    }
    const note = (creditNoteMap[u.id] ?? "").trim();
    if (!note) {
      showToast("Add a reason — it's recorded in the audit log", false);
      return;
    }
    setActionLoading(`credit-${u.id}`);
    try {
      const res = await fetch(`/api/admin/credit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: u.username, amount: amt, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      showToast(
        `${amt > 0 ? "Credited" : "Corrected"} ${u.username} — new balance $${Number(data.balance).toFixed(2)}`,
      );
      setCreditAmountMap((p) => {
        const n = { ...p };
        delete n[u.id];
        return n;
      });
      setCreditNoteMap((p) => {
        const n = { ...p };
        delete n[u.id];
        return n;
      });
      fetchUsers(search, page);
      fetchAdjustments();
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

  async function runBackfill(dryRun: boolean) {
    if (!backfillPassphrase) {
      setBackfillError("Enter your master passphrase to continue.");
      return;
    }
    setBackfillLoading(dryRun ? "preview" : "run");
    setBackfillError("");
    try {
      const res = await fetch("/api/admin/referrals/backfill", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-secrets-passphrase": backfillPassphrase,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Referral backfill failed");
      if (dryRun) {
        setBackfillPreview({
          candidates: data.candidates ?? 0,
          qualifyAmount: data.qualifyAmount ?? 0,
          bonusPerReferral: data.bonusPerReferral ?? 0,
        });
      } else {
        setBackfillResult({
          candidates: data.candidates ?? 0,
          credited: data.credited ?? 0,
          skipped: data.skipped ?? 0,
          failed: data.failed ?? 0,
          bonusPerReferral: data.bonusPerReferral ?? 0,
          creditedReferrers: data.creditedReferrers ?? [],
          skippedReferrals: data.skippedReferrals ?? [],
          failedReferrals: data.failedReferrals ?? [],
        });
        setBackfillPreview(null);
        fetchUsers(search, page);
        fetchAdjustments();
      }
    } catch (err: any) {
      setBackfillError(err.message);
    } finally {
      setBackfillLoading(null);
    }
  }

  function closeBackfill() {
    setBackfillOpen(false);
    setBackfillPassphrase("");
    setBackfillError("");
    setBackfillPreview(null);
    setBackfillResult(null);
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
          className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all ${toast.ok ? "bg-[#00E676] text-[#f9fafb]" : "bg-red-500 text-gray-900"}`}
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
          <div className="bg-[#111118] border border-gray-200 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Delete User?
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              This will permanently delete{" "}
              <span className="text-gray-900 font-semibold">
                {confirmDelete.username}
              </span>{" "}
              and all their data — earnings, transactions, and withdrawals.
            </p>
            <p className="text-red-400 text-xs mb-6">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-gray-900 font-bold text-sm hover:bg-red-600 transition-colors"
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
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Factory Reset Account?
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              This sets a brand-new password and{" "}
              <span className="text-gray-900 font-semibold">switches off 2FA</span>{" "}
              for{" "}
              <span className="text-gray-900 font-semibold">
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
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-amber-500/40 transition-colors mb-2"
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
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={factoryLoading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-[#f9fafb] font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
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
          <div className="bg-[#111118] border border-emerald-200 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Account Reset ✓
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              <span className="text-gray-900 font-semibold">
                {factoryResult.username}
              </span>{" "}
              can now log in with this new password. 2FA is OFF — set up a fresh
              authenticator after logging in.
            </p>
            <p className="text-amber-400 text-xs mb-3">
              Copy it now — it won't be shown again.
            </p>
            <div className="flex items-center gap-2 mb-5">
              <code className="flex-1 bg-black/40 border border-gray-200 rounded-xl px-3 py-2.5 text-emerald-600 text-sm font-mono break-all">
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
                className="px-3 py-2.5 bg-gray-100 border border-gray-200 text-gray-600 rounded-xl text-xs font-medium hover:bg-white/[0.1] transition-colors"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setFactoryResult(null)}
              className="w-full py-2.5 rounded-xl bg-[#00E676] text-[#f9fafb] font-bold text-sm hover:bg-[#00E676]/90 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Referral backfill — passphrase prompt + preview/run */}
      {backfillOpen && !backfillResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-amber-500/20 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Credit Past Referrers
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              This pays the referral bonus to referrers whose friend cashed out the
              qualifying amount before the feature went live. It's{" "}
              <span className="text-gray-900 font-semibold">safe to re-run</span> —
              anyone already credited is skipped.
            </p>
            <p className="text-amber-400 text-xs mb-4">
              Preview first to see how many referrers would be credited. Nothing is
              paid until you press Run.
            </p>
            <input
              type="password"
              value={backfillPassphrase}
              onChange={(e) => setBackfillPassphrase(e.target.value)}
              placeholder="Master passphrase"
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-amber-500/40 transition-colors mb-2"
            />
            {backfillPreview && (
              <div className="bg-white/[0.04] border border-gray-200 rounded-xl px-3 py-2.5 mb-2 text-sm">
                <p className="text-gray-700">
                  <span className="text-amber-400 font-bold">
                    {backfillPreview.candidates}
                  </span>{" "}
                  referrer{backfillPreview.candidates === 1 ? "" : "s"} would be
                  credited{" "}
                  <span className="text-gray-900 font-semibold">
                    ${backfillPreview.bonusPerReferral}
                  </span>{" "}
                  each.
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  Based on referred users who cashed out $
                  {backfillPreview.qualifyAmount}+ before the feature shipped.
                </p>
              </div>
            )}
            {backfillError && (
              <p className="text-red-400 text-xs mb-2">{backfillError}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={closeBackfill}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => runBackfill(true)}
                disabled={backfillLoading !== null}
                className="flex-1 py-2.5 rounded-xl border border-amber-500/30 text-amber-400 font-bold text-sm hover:bg-amber-500/10 transition-colors disabled:opacity-50"
              >
                {backfillLoading === "preview" ? "Checking…" : "Preview"}
              </button>
              <button
                onClick={() => runBackfill(false)}
                disabled={backfillLoading !== null || !backfillPreview}
                title={
                  backfillPreview
                    ? undefined
                    : "Preview first to enable Run"
                }
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-[#f9fafb] font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {backfillLoading === "run" ? "Running…" : "Run"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Referral backfill — result */}
      {backfillResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-emerald-200 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Backfill Complete ✓
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              Credited{" "}
              <span className="text-emerald-600 font-bold">
                {backfillResult.credited}
              </span>{" "}
              referrer{backfillResult.credited === 1 ? "" : "s"}{" "}
              <span className="text-gray-900 font-semibold">
                ${backfillResult.bonusPerReferral}
              </span>{" "}
              each.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-5 text-sm">
              <div className="bg-white/[0.04] border border-gray-200 rounded-xl px-3 py-2.5">
                <p className="text-gray-400 text-xs">Candidates</p>
                <p className="text-gray-900 font-bold">{backfillResult.candidates}</p>
              </div>
              <div className="bg-white/[0.04] border border-gray-200 rounded-xl px-3 py-2.5">
                <p className="text-gray-400 text-xs">Credited</p>
                <p className="text-emerald-600 font-bold">{backfillResult.credited}</p>
              </div>
              <div className="bg-white/[0.04] border border-gray-200 rounded-xl px-3 py-2.5">
                <p className="text-gray-400 text-xs">Skipped</p>
                <p className="text-gray-600 font-bold">{backfillResult.skipped}</p>
              </div>
              <div className="bg-white/[0.04] border border-gray-200 rounded-xl px-3 py-2.5">
                <p className="text-gray-400 text-xs">Failed</p>
                <p
                  className={`font-bold ${backfillResult.failed > 0 ? "text-red-400" : "text-gray-600"}`}
                >
                  {backfillResult.failed}
                </p>
              </div>
            </div>
            {(backfillResult.creditedReferrers.length > 0 ||
              backfillResult.skippedReferrals.length > 0 ||
              backfillResult.failedReferrals.length > 0) && (
              <div className="mb-5 max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white/[0.02] divide-y divide-white/[0.06]">
                {backfillResult.creditedReferrers.map((r, i) => (
                  <div
                    key={`credited-${i}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-gray-900 font-medium truncate">{r.referrer}</p>
                      <p className="text-gray-400 text-xs truncate">
                        for {r.referredFriend}
                      </p>
                    </div>
                    <span className="shrink-0 text-emerald-600 font-bold">
                      +${r.amount}
                    </span>
                  </div>
                ))}
                {backfillResult.skippedReferrals.map((r, i) => (
                  <div
                    key={`skipped-${i}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-gray-600 font-medium truncate">{r.referrer}</p>
                      <p className="text-gray-400 text-xs truncate">
                        for {r.referredFriend}
                      </p>
                    </div>
                    <span className="shrink-0 text-gray-400 text-xs font-semibold uppercase tracking-wide">
                      Skipped
                    </span>
                  </div>
                ))}
                {backfillResult.failedReferrals.map((r, i) => (
                  <div
                    key={`failed-${i}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-red-400 font-medium truncate">{r.referrer}</p>
                      <p className="text-gray-400 text-xs truncate">
                        for {r.referredFriend}
                        {r.error ? ` — ${r.error}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-red-400 text-xs font-semibold uppercase tracking-wide">
                      Failed
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={downloadBackfillCsv}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/15 text-gray-600 font-semibold text-sm hover:border-white/30 hover:text-gray-900 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </button>
              <button
                onClick={closeBackfill}
                className="flex-1 py-2.5 rounded-xl bg-[#00E676] text-[#f9fafb] font-bold text-sm hover:bg-[#00E676]/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-600" /> CashClip Users
          </h2>
          <p className="text-gray-400 text-sm mt-1">
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
              className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-400 w-64 transition-colors"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-100 border border-emerald-200 text-emerald-600 rounded-xl text-sm hover:bg-emerald-100 transition-colors"
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
                className="text-gray-400 hover:text-gray-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>
          <button
            onClick={() => fetchUsers(search, page)}
            className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Withdrawal Limits Card */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
            Withdrawal Limits
          </h3>
          <span className="text-gray-400 text-xs ml-auto">
            Enforced server-side at withdrawal request time
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">
              Max single withdrawal ($)
            </label>
            <input
              type="number"
              value={limitConfig.maxWithdrawal}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, maxWithdrawal: e.target.value }))
              }
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 transition-colors"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">
              Min balance to withdraw ($)
            </label>
            <input
              type="number"
              value={limitConfig.minBalance}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, minBalance: e.target.value }))
              }
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 transition-colors"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">
              Max per-user daily earnings ($)
            </label>
            <input
              type="number"
              value={limitConfig.dailyLimit}
              onChange={(e) =>
                setLimitConfig((p) => ({ ...p, dailyLimit: e.target.value }))
              }
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-400 transition-colors"
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
          <p className="text-gray-300 text-xs">
            These values will be enforced when users request withdrawals.
          </p>
        </div>
      </div>

      {/* Referral Backfill Card */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-amber-400" />
          <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-sm">
            Credit Past Referrers
          </h3>
          <span className="text-gray-400 text-xs ml-auto">
            One-time, safe to re-run
          </span>
        </div>
        <p className="text-gray-400 text-xs mb-4 max-w-2xl">
          Referral bonuses only started paying out automatically when the feature
          shipped. This finds users who were referred and already cashed out the
          qualifying amount <span className="text-gray-500">before</span> then, and
          pays their referrer the bonus they missed. Preview first to see how many
          referrers would be credited — nothing is paid until you run it.
        </p>
        <button
          onClick={() => {
            setBackfillOpen(true);
            setBackfillPassphrase("");
            setBackfillError("");
            setBackfillPreview(null);
            setBackfillResult(null);
          }}
          className="px-5 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-sm font-medium hover:bg-amber-500/20 transition-colors"
        >
          Credit Past Referrers…
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Manual credit audit log — every admin credit & correction */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden mb-6">
        <div className="border-b border-gray-200">
          <button
            onClick={() => setShowAudit((s) => !s)}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div>
              <h3 className="text-gray-900 text-sm font-semibold">
                Manual Credit Audit Log
              </h3>
              <p className="text-gray-400 text-xs mt-0.5">
                Every admin credit &amp; correction — who, how much, why, and when. A receipt is emailed to the user and support@absustaininvest.com on each one.
              </p>
            </div>
            <span className="text-gray-400 text-xs whitespace-nowrap">
              {showAudit ? "Hide" : "Show"} ({auditRows.length})
            </span>
          </button>
          {showAudit && (
            <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
              <label className="text-gray-400 text-xs">Issued by</label>
              <select
                value={auditActorFilter}
                onChange={(e) => setAuditActorFilter(e.target.value)}
                className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-gray-700 text-xs focus:outline-none focus:border-gray-300"
              >
                <option value="">All admins</option>
                {auditActors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              {auditActorFilter && (
                <button
                  onClick={() => setAuditActorFilter("")}
                  className="text-gray-400 hover:text-gray-600 text-xs underline underline-offset-2 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        {showAudit && (
          <div className="max-h-80 overflow-y-auto">
            {auditLoading ? (
              <div className="px-5 py-6 text-gray-400 text-sm">Loading audit log…</div>
            ) : auditRows.length === 0 ? (
              <div className="px-5 py-6 text-gray-400 text-sm">
                {auditActorFilter
                  ? `No manual credits or corrections issued by ${auditActorFilter}.`
                  : "No manual credits or corrections recorded yet."}
              </div>
            ) : (
              <CreditAuditTable rows={auditRows} />
            )}
          </div>
        )}
      </div>

      {/* Combined payout per user — all offers */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-gray-900 text-sm font-semibold">
              Payout by User — All Offers Combined
            </h3>
            <p className="text-gray-400 text-xs mt-0.5">
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
                    ? "bg-[#00E676]/15 text-emerald-600 border border-[#00E676]/30"
                    : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-white/[0.1]"
                }`}
              >
                {r === "all" ? "All" : r}
              </button>
            ))}
          </div>
        </div>
        {payoutLoading ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            Loading payouts…
          </div>
        ) : payoutRows.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No payouts in this range
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {payoutRows.map((p, i) => (
              <div
                key={p.userId}
                className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-5 py-3"
              >
                <span className="text-gray-400 text-xs font-bold w-6">
                  {i + 1}
                </span>
                <span className="text-gray-900 text-sm font-semibold truncate">
                  {p.username}
                </span>
                <span className="text-gray-400 text-xs whitespace-nowrap">
                  {p.txCount} tx
                </span>
                <span className="text-emerald-600 text-sm font-bold tabular-nums">
                  ${p.totalPayout.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Searchers */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-gray-900 text-sm font-semibold">Top Searchers</h3>
            <p className="text-gray-400 text-xs mt-0.5">
              Users by in-app search query count — auto-refreshes every 60s
            </p>
          </div>
        </div>
        {searchPerUserLoading ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            Loading…
          </div>
        ) : searchPerUserRows.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No search data yet
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {searchPerUserRows.map((r, i) => (
              <div
                key={r.userId}
                className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-5 py-3"
              >
                <span className="text-gray-400 text-xs font-bold w-6">{i + 1}</span>
                <span className="text-gray-900 text-sm font-semibold truncate">{r.username}</span>
                <span className="text-gray-500 text-xs tabular-nums whitespace-nowrap">
                  {r.queryCount} {r.queryCount === 1 ? "search" : "searches"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users table */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr_0.8fr_0.7fr_0.7fr_auto] gap-3 px-5 py-3 border-b border-gray-200 text-gray-400 text-[11px] font-semibold uppercase tracking-wider">
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
          <div className="text-center py-16 text-gray-400 text-sm">
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">
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
                    <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-emerald-600 font-bold text-xs">
                        {u.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-gray-900 text-sm font-semibold truncate">
                        {u.username}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {u.role === "admin" && (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5 font-bold">
                            ADMIN
                          </span>
                        )}
                        {u.isPublisher && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToPublishers?.();
                            }}
                            title="Go to Publisher Program tab"
                            className="text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded px-1.5 py-0.5 font-bold hover:bg-purple-500/20 hover:text-purple-200 transition-colors cursor-pointer"
                          >
                            Publisher
                          </button>
                        )}
                        {u.profileComplete ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-600 border border-emerald-200 rounded px-1.5 py-0.5">
                            Verified
                          </span>
                        ) : (
                          <span className="text-[10px] bg-gray-100 text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
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
                        className="text-emerald-600/80 hover:text-emerald-600 text-xs truncate block transition-colors"
                      >
                        {u.email}
                      </a>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </div>
                  <span
                    className={`text-sm font-bold ${Number(u.balance) > 0 ? "text-emerald-600" : "text-gray-400"}`}
                  >
                    ${Number(u.balance).toFixed(2)}
                  </span>
                  <span className="text-gray-500 text-sm">
                    ${Number(u.totalEarned).toFixed(2)}
                  </span>
                  <span className="text-amber-300/70 text-sm">
                    ${Number(u.pending ?? 0).toFixed(2)}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {u.country ?? "—"}
                  </span>
                  <span className="text-gray-400 text-xs">
                    {fmt(u.createdAt)}
                  </span>
                  <ChevronRight
                    className={`w-4 h-4 text-gray-300 transition-transform ${expandedId === u.id ? "rotate-90" : ""}`}
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
                          <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-0.5">
                            {label}
                          </p>
                          <p className="text-gray-700 text-xs font-medium break-all">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-200">
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
                          className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-xs placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors font-mono"
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
                          className="px-3 py-2 bg-gray-100 border border-gray-200 text-gray-600 rounded-xl text-xs font-medium hover:bg-white/[0.1] transition-colors disabled:opacity-30 whitespace-nowrap"
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
                          <div
                            className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:min-w-[320px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-col gap-0.5">
                              <input
                                type="number"
                                step="0.01"
                                min="-1000"
                                max="1000"
                                value={creditAmountMap[u.id] ?? ""}
                                onChange={(e) =>
                                  setCreditAmountMap((p) => ({
                                    ...p,
                                    [u.id]: e.target.value,
                                  }))
                                }
                                placeholder="$ (e.g. 5 or -2.50)"
                                className="w-28 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-xs placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors"
                              />
                              <span className="text-[10px] text-gray-400 pl-1">Max ±$1,000</span>
                            </div>
                            <input
                              type="text"
                              value={creditNoteMap[u.id] ?? ""}
                              onChange={(e) =>
                                setCreditNoteMap((p) => ({
                                  ...p,
                                  [u.id]: e.target.value,
                                }))
                              }
                              placeholder="Reason (required for audit log)"
                              className="flex-1 min-w-[120px] bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-xs placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCredit(u);
                              }}
                              disabled={actionLoading === `credit-${u.id}`}
                              className="px-3 py-2 bg-emerald-100 border border-emerald-200 text-emerald-600 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-40 whitespace-nowrap"
                              title="Positive amount credits, negative amount corrects down. Recorded in the audit log + emailed."
                            >
                              {actionLoading === `credit-${u.id}`
                                ? "…"
                                : "Apply Credit / Correction"}
                            </button>
                          </div>
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
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200">
            <span className="text-gray-400 text-xs">
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                    className={`w-8 h-8 rounded-lg text-xs transition-colors ${p === page ? "bg-emerald-100 text-emerald-600 border border-emerald-200 font-bold" : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"}`}
                  >
                    {p + 1}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
    color: "text-emerald-600 bg-emerald-100 border-emerald-200",
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
          <div className="p-2.5 rounded-xl bg-emerald-100">
            <History className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
              Security Log
            </h2>
            <p className="text-gray-400 text-sm mt-0.5">
              Account security events — who changed what, when, and from where.
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchEntries()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-sm disabled:opacity-40"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-2xl p-1.5 overflow-x-auto">
          <button
            onClick={() => {
              setEventFilter("");
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
              eventFilter === ""
                ? "bg-[#00E676] text-[#f9fafb]"
                : "text-gray-500 hover:text-gray-900"
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
                  ? "bg-[#00E676] text-[#f9fafb]"
                  : "text-gray-500 hover:text-gray-900"
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
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder:text-white/25 focus:outline-none focus:border-emerald-300"
          />
          {activeActorFilter && (
            <button
              type="button"
              onClick={() => {
                setActorFilter("");
                setActiveActorFilter("");
                setPage(0);
              }}
              className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
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

      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400">
            Loading security events…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Shield className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No security events found</p>
            <p className="text-gray-300 text-xs mt-1">
              2FA changes, backup-code regeneration, and password changes will
              appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {entries.map((e) => {
              const meta = SECURITY_EVENT_META[e.event] ?? {
                label: e.event,
                color: "text-gray-400 bg-white/5 border-gray-200",
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
                        <span className="flex items-center gap-1.5 text-gray-900 font-medium text-sm">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          {e.actorUsername ?? "Unknown user"}
                        </span>
                        {e.actorEmail && (
                          <span className="flex items-center gap-1.5 text-gray-400 text-xs">
                            <Mail className="w-3.5 h-3.5 text-gray-300" />
                            {e.actorEmail}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 text-gray-400 text-xs">
                          <Globe className="w-3.5 h-3.5 text-gray-300" />
                          {e.ip ?? "IP unavailable"}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setActorFilter(e.actorUserId);
                          setActiveActorFilter(e.actorUserId);
                          setPage(0);
                        }}
                        className="text-gray-300 hover:text-emerald-600 text-[10px] font-mono mt-1.5 transition-colors"
                        title="Filter by this user"
                      >
                        {e.actorUserId}
                      </button>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-gray-400 text-xs">
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
          <p className="text-gray-400 text-xs">
            Showing {rangeStart}–{rangeEnd} of {total} events
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="text-gray-400 text-xs">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors text-xs disabled:opacity-30 disabled:cursor-not-allowed"
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

interface HubIntegration {
  id: string;
  name: string;
  category: string;
  configured: boolean;
  reachable: boolean | null;
  httpStatus: number | null;
  latencyMs: number | null;
  status: "green" | "amber" | "red";
  lastCheckedAt: string;
  adUnavailReason?: string | null;
}

interface HubService {
  id: string;
  name: string;
  up: boolean;
  url?: string;
  httpStatus?: number | null;
  detail?: string;
}

interface HubData {
  checkedAt: string;
  onlineWindowMinutes: number;
  usersOnline: number | null;
  version: { current: string; lastDeployedAt: string | null };
  services: HubService[];
  integrations: { total: number; green: number; items: HubIntegration[] };
}

interface AdStatus {
  lpNative: boolean;
  unityNative: boolean;
  adSystemActive: boolean;
  rewardedFillAvailable: boolean | null;
  fillReportedAt: number | null;
}

interface AdmobAlert {
  id: string;
  condition: "stale_sync" | "revenue_divergence";
  status: "firing" | "resolved";
  message: string;
  firstSeenAt: string;
  firedAt: string;
  cooldownMs: number;
  threshold: number;
  detail: Record<string, unknown>;
  notifyDelivered?: boolean;
  notifyError?: string;
}

const ADMOB_ALERT_LABELS: Record<AdmobAlert["condition"], string> = {
  stale_sync: "Reporting sync stale",
  revenue_divergence: "Revenue divergence",
};

interface AlertEmailSettings {
  enabled: boolean;
  recipient: string;
  persistedRecipient: string | null;
  recipientSource: "setting" | "env" | "default";
  enabledSource: "setting" | "env";
  defaultRecipient: string;
}

function admobAlertDetail(alert: AdmobAlert): string {
  if (alert.condition === "stale_sync") {
    const ageMs = alert.detail?.ageMs;
    const lastSyncedAt = alert.detail?.lastSyncedAt;
    if (typeof ageMs === "number" && Number.isFinite(ageMs)) {
      return `Last sync ~${(ageMs / 3_600_000).toFixed(1)}h ago`;
    }
    if (typeof lastSyncedAt === "string") {
      return `Last sync ${hubTimeAgo(lastSyncedAt)}`;
    }
    return "Reporting has never synced";
  }
  const pct = alert.detail?.differencePct;
  const official = alert.detail?.officialEarnings;
  const app = alert.detail?.appReportedEarnings;
  const currency = typeof alert.detail?.currency === "string" ? alert.detail.currency : "USD";
  const fmt = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${v.toLocaleString("en-US", { style: "currency", currency })}`
      : "—";
  if (typeof pct === "number" && Number.isFinite(pct)) {
    return `Diverged ${pct}% · official ${fmt(official)} vs app ${fmt(app)}`;
  }
  return `official ${fmt(official)} vs app ${fmt(app)}`;
}

const HUB_REFRESH_MS = 45_000;

function StatusDot({ status }: { status: "green" | "amber" | "red" }) {
  const color =
    status === "green"
      ? "bg-[#00E676]"
      : status === "amber"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      {status === "green" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00E676]/60" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

function hubTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const HUB_CATEGORY_LABELS: Record<string, string> = {
  ads: "Ad Networks",
  surveys: "Surveys",
  affiliates: "Offerwalls & Affiliates",
  payments: "Payments",
  investments: "Investments",
};

function DisplayRateCard({
  token,
  current,
  onSaved,
}: {
  token: string;
  current: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (current != null) setValue(String(current));
  }, [current]);

  if (current == null) return null;

  const parsed = parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 100 && parsed <= 1_000_000;
  const dirty = valid && parsed !== current;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/economy/display-rate", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayPointsPerDollar: parsed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to save");
      }
      setSavedAt(Date.now());
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-xl bg-emerald-100">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-['Space_Grotesk'] text-lg font-bold text-gray-900">
            Display Points Multiplier
          </h3>
          <p className="text-gray-400 text-sm">
            How many on-screen points equal $1 in the app UI. Cosmetic only — never
            affects real cash owed. Takes effect on next app hydrate, no redeploy needed.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Points per $1
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={100}
              max={1000000}
              step={100}
              value={value}
              onChange={(e) => { setValue(e.target.value); setErr(""); setSavedAt(null); }}
              className="flex-1 bg-white/[0.04] border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-emerald-300 transition-colors"
              placeholder="e.g. 10000"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                dirty && !saving
                  ? "bg-[#00E676] text-black hover:bg-[#00E676]/90"
                  : "bg-white/10 text-gray-400 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {!valid && value !== "" && (
            <p className="text-red-400 text-xs mt-1.5">
              Enter a whole number between 100 and 1,000,000
            </p>
          )}
        </div>

        {err && (
          <p className="text-red-400 text-sm">{err}</p>
        )}
        {savedAt && !err && (
          <p className="text-emerald-600 text-sm">
            ✓ Saved — new value is live on the next app refresh
          </p>
        )}
        <p className="text-white/25 text-xs">
          Current active value: <span className="text-gray-500 font-mono">{current.toLocaleString()} pts = $1</span>
        </p>
      </div>
    </div>
  );
}

function AdmobAlertEmailCard({
  token,
  settings,
  onSaved,
}: {
  token: string;
  settings: AlertEmailSettings | null;
  onSaved: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // Sync the form with the server values whenever they load/refresh, but only
  // the persisted recipient (so an env/default value shows as a placeholder the
  // operator can override, not as pre-filled text that looks already-saved).
  useEffect(() => {
    if (!settings) return;
    setRecipient(settings.persistedRecipient ?? "");
    setEnabled(settings.enabled);
  }, [settings]);

  if (!settings) return null;

  const dirty =
    recipient.trim() !== (settings.persistedRecipient ?? "") ||
    enabled !== settings.enabled;

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/admob/alert-email", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled, recipient: recipient.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to save");
      }
      setSavedAt(Date.now());
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-xl bg-emerald-100">
          <Mail className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-['Space_Grotesk'] text-lg font-bold text-gray-900">
            AdMob Alert Email
          </h3>
          <p className="text-gray-400 text-sm">
            Where AdMob staleness / revenue-divergence alerts are emailed. Saved
            instantly — no redeploy needed.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* On/off toggle */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-gray-500" />
            <div>
              <p className="text-gray-900 text-sm font-medium">Email alerts</p>
              <p className="text-gray-400 text-xs">
                {enabled ? "Alerts will be emailed" : "Email alerts are muted"}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              enabled ? "bg-[#00E676]" : "bg-white/15"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Recipient */}
        <div>
          <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Recipient email
          </label>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={settings.defaultRecipient}
            className="w-full bg-white/[0.04] border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-300"
          />
          <p className="text-gray-400 text-xs mt-2">
            Currently sending to{" "}
            <span className="text-gray-500">{settings.recipient}</span>
            {settings.recipientSource === "default" && " (default)"}
            {settings.recipientSource === "env" && " (from environment)"}
            . Leave blank to use the default ({settings.defaultRecipient}).
          </p>
        </div>

        {err && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {err}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 bg-[#00E676] text-black font-semibold text-sm px-4 py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00E676]/90 transition-colors"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {saving ? "Saving…" : "Save changes"}
          </button>
          {savedAt && !dirty && (
            <span className="text-emerald-600 text-xs flex items-center gap-1">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface SponsoredVisitSnoozeState {
  snoozed: boolean;
  snoozedUntil: string | null;
  lastAlertedAt: string | null;
}

const SNOOZE_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "2h", hours: 2 },
  { label: "4h", hours: 4 },
  { label: "8h", hours: 8 },
  { label: "Clear", hours: null },
];

function SponsoredVisitHealthPanel({ token }: { token: string }) {
  const [state, setState] = useState<SponsoredVisitSnoozeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function fetchState() {
    try {
      const res = await fetch("/api/admin/health/sponsored-visits", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setState(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchState();
  }, [token]);

  async function applyAction(hours: number | null) {
    setActing(true);
    setError("");
    setSuccess("");
    try {
      const body: Record<string, unknown> = {};
      if (hours !== null) body.snoozeHours = hours;
      const res = await fetch("/api/admin/health/sponsored-visits/reset-alert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to update");
        return;
      }
      if (json.action === "snoozed") {
        setSuccess(`Alert snoozed for ${hours}h`);
      } else {
        setSuccess("Debounce cleared — monitor can fire on next tick");
      }
      await fetchState();
    } catch {
      setError("Request failed");
    } finally {
      setActing(false);
      setTimeout(() => setSuccess(""), 4000);
    }
  }

  function formatUntil(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-gray-400" />
          <p className="text-gray-900 text-sm font-medium">Settlement Alert Snooze</p>
        </div>
        {loading ? (
          <RefreshCw className="w-3.5 h-3.5 text-gray-300 animate-spin" />
        ) : state?.snoozed ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
            Snoozed
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-600 border border-emerald-200">
            Active
          </span>
        )}
      </div>

      {!loading && state && (
        <p className="text-gray-400 text-xs leading-relaxed">
          {state.snoozed && state.snoozedUntil
            ? `Alert suppressed until ${formatUntil(state.snoozedUntil)}. The monitor will resume sending after this window.`
            : state.lastAlertedAt
              ? `Last alert sent ${formatUntil(state.lastAlertedAt)}. Monitor is active.`
              : "No debounce set. Monitor will fire when conditions are met."}
        </p>
      )}

      {error && (
        <p className="text-red-400 text-xs flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </p>
      )}
      {success && (
        <p className="text-emerald-600 text-xs flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          {success}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-400 text-xs">Snooze for:</span>
        {SNOOZE_OPTIONS.map((opt) => {
          const isClear = opt.hours === null;
          return (
            <button
              key={opt.label}
              disabled={acting || loading}
              onClick={() => applyAction(opt.hours)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                isClear
                  ? "bg-white/[0.06] hover:bg-white/[0.10] text-gray-500 hover:text-gray-900"
                  : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function IntegrationHubPanel({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [data, setData] = useState<HubData | null>(null);
  const [admobAlerts, setAdmobAlerts] = useState<AdmobAlert[]>([]);
  const [adStatus, setAdStatus] = useState<AdStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [alertEmail, setAlertEmail] = useState<AlertEmailSettings | null>(null);
  const [displayRate, setDisplayRate] = useState<number | null>(null);

  const fetchHub = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [hubRes, alertsRes, alertEmailRes, adStatusRes, economyRes] = await Promise.all([
        fetch("/api/admin/integration-hub", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/webhook-alerts?limit=20&rejectionLimit=1", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/admob/alert-email", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/ad-status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/economy/rate", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (
        hubRes.status === 401 ||
        hubRes.status === 403 ||
        alertsRes.status === 401 ||
        alertsRes.status === 403
      ) {
        onLogout();
        return;
      }
      if (!hubRes.ok) throw new Error("Failed to load status");
      const json = (await hubRes.json()) as HubData;
      setData(json);
      if (alertsRes.ok) {
        const alertsJson = (await alertsRes.json()) as { admobAlerts?: AdmobAlert[] };
        setAdmobAlerts(alertsJson.admobAlerts ?? []);
      }
      if (alertEmailRes.ok) {
        setAlertEmail((await alertEmailRes.json()) as AlertEmailSettings);
      }
      if (adStatusRes.ok) {
        setAdStatus((await adStatusRes.json()) as AdStatus);
      }
      if (economyRes.ok) {
        const eco = (await economyRes.json()) as { displayPointsPerDollar?: number };
        if (typeof eco.displayPointsPerDollar === "number") {
          setDisplayRate(eco.displayPointsPerDollar);
        }
      }
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchHub();
    const interval = setInterval(fetchHub, HUB_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchHub]);

  const grouped = (data?.integrations.items ?? []).reduce<
    Record<string, HubIntegration[]>
  >((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const usersOnline = data?.usersOnline ?? null;
  const allServicesUp = (data?.services ?? []).every((s) => s.up);

  // The endpoint returns a reverse-chronological log of fire/resolve events.
  // The latest event per condition is its CURRENT state, so a resolved
  // condition quiets down instead of lingering as an active alert.
  const admobCurrent: AdmobAlert[] = (() => {
    const seen = new Map<AdmobAlert["condition"], AdmobAlert>();
    for (const a of admobAlerts) {
      if (!seen.has(a.condition)) seen.set(a.condition, a);
    }
    return Array.from(seen.values());
  })();
  const admobFiring = admobCurrent.filter((a) => a.status === "firing");

  return (
    <div className="space-y-6">
      <DisplayRateCard token={token} current={displayRate} onSaved={fetchHub} />
      <AdmobAlertEmailCard token={token} settings={alertEmail} onSaved={fetchHub} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100">
            <Activity className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
              Integration Hub
            </h2>
            <p className="text-gray-400 text-sm">
              Live health of every service, integration, and user session
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-xs">
            {lastRefreshed
              ? `Last refreshed ${lastRefreshed.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : "Loading…"}
          </span>
          <button
            onClick={fetchHub}
            disabled={loading}
            className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error} — showing the last known values where available.
        </div>
      )}

      {/* Top status row: services + users online + last deploy */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Users online */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-4 h-4 text-emerald-600" />
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
              Users Online
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <StatusDot status={usersOnline && usersOnline > 0 ? "green" : "amber"} />
            <span className="text-3xl font-bold text-gray-900 tabular-nums">
              {usersOnline == null ? "—" : usersOnline}
            </span>
          </div>
          <p className="text-gray-400 text-xs mt-2">
            Active in the last {data?.onlineWindowMinutes ?? 5} minutes
          </p>
        </div>

        {/* Services */}
        {(data?.services ?? []).map((svc) => (
          <div
            key={svc.id}
            className="bg-gray-50 border border-gray-200 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              {svc.id === "website" ? (
                <Globe className="w-4 h-4 text-gray-500" />
              ) : (
                <Server className="w-4 h-4 text-gray-500" />
              )}
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
                {svc.name}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <StatusDot status={svc.up ? "green" : "red"} />
              <span
                className={`text-lg font-bold ${svc.up ? "text-emerald-600" : "text-red-400"}`}
              >
                {svc.up ? "Operational" : "Down"}
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2 truncate">
              {svc.detail ?? (svc.up ? "Reachable" : "Unreachable")}
            </p>
          </div>
        ))}

        {/* Last deployed */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="w-4 h-4 text-gray-500" />
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
              Last Deployed
            </span>
          </div>
          <div className="text-lg font-bold text-gray-900">
            {data?.version.lastDeployedAt
              ? hubTimeAgo(data.version.lastDeployedAt)
              : "Unknown"}
          </div>
          <p className="text-gray-400 text-xs mt-2">
            App v{data?.version.current ?? "—"}
            {data?.version.lastDeployedAt && (
              <>
                {" · "}
                {new Date(data.version.lastDeployedAt).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Ad adapter status card */}
      {(() => {
        // dot color is determined solely by native module presence, not by
        // whether the app key is configured — the task spec requires:
        //   green = both LP + Unity native modules detected
        //   amber = LevelPlay present but Unity absent
        //   grey  = OTA build (no native modules)
        const dotStatus: "green" | "amber" | "grey" =
          adStatus === null
            ? "grey"
            : adStatus.lpNative && adStatus.unityNative
              ? "green"
              : adStatus.lpNative && !adStatus.unityNative
                ? "amber"
                : "grey";
        const label =
          adStatus === null
            ? "Loading…"
            : adStatus.lpNative && adStatus.unityNative
              ? adStatus.adSystemActive
                ? "Ad system active"
                : "Native adapters present — key not configured"
              : adStatus.lpNative && !adStatus.unityNative
                ? "Unity native module absent"
                : "OTA build — no native adapters";
        const detail =
          adStatus === null
            ? null
            : adStatus.lpNative && adStatus.unityNative
              ? adStatus.adSystemActive
                ? "LevelPlay + Unity compiled into live build · ads are serving"
                : "Both native modules are present but IRONSOURCE_APP_KEY is not configured — ads won't initialize until the key is added and the API is re-published"
              : adStatus.lpNative && !adStatus.unityNative
                ? "LevelPlay is present but Unity Ads adapter is missing — ad revenue is $0 until a native build with the Unity pod/AAR ships"
                : "Neither LevelPlay nor Unity native modules are in the live build — running on OTA update or an old binary";
        const dotColor =
          dotStatus === "green"
            ? "bg-[#00E676]"
            : dotStatus === "amber"
              ? "bg-amber-400"
              : "bg-white/20";
        const pingColor =
          dotStatus === "green"
            ? "bg-[#00E676]/60"
            : dotStatus === "amber"
              ? "bg-amber-400/60"
              : "";
        const textColor =
          dotStatus === "green"
            ? "text-emerald-600"
            : dotStatus === "amber"
              ? "text-amber-400"
              : "text-gray-400";
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5 flex-shrink-0 mt-1">
                  {dotStatus !== "grey" && (
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingColor}`} />
                  )}
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
                </span>
                <div>
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">
                    Ad Adapter Status
                  </p>
                  <p className={`text-base font-bold ${textColor}`}>{label}</p>
                  {detail && (
                    <p className="text-gray-400 text-xs mt-1 leading-relaxed max-w-xl">
                      {detail}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-gray-300 text-[10px]">LevelPlay</p>
                <p className={`text-sm font-semibold ${adStatus?.lpNative ? "text-emerald-600" : "text-gray-300"}`}>
                  {adStatus === null ? "—" : adStatus.lpNative ? "Present" : "Absent"}
                </p>
                <p className="text-gray-300 text-[10px] mt-1.5">Unity Ads</p>
                <p className={`text-sm font-semibold ${adStatus?.unityNative ? "text-emerald-600" : "text-gray-300"}`}>
                  {adStatus === null ? "—" : adStatus.unityNative ? "Present" : "Absent"}
                </p>
                <p className="text-gray-300 text-[10px] mt-1.5">Rewarded Fill</p>
                <p className={`text-sm font-semibold ${
                  adStatus === null || adStatus.rewardedFillAvailable === null
                    ? "text-gray-300"
                    : adStatus.rewardedFillAvailable
                      ? "text-emerald-600"
                      : "text-amber-400"
                }`}>
                  {adStatus === null
                    ? "—"
                    : adStatus.rewardedFillAvailable === null
                      ? "No report"
                      : adStatus.rewardedFillAvailable
                        ? "Fill"
                        : "No fill"}
                </p>
                {adStatus !== null && adStatus.fillReportedAt !== null && (() => {
                  const diffMs = Date.now() - adStatus.fillReportedAt;
                  const stale = diffMs > 2 * 60 * 60 * 1000;
                  const label = hubTimeAgo(new Date(adStatus.fillReportedAt).toISOString());
                  return (
                    <p className={`text-[10px] mt-0.5 ${stale ? "text-amber-400" : "text-gray-300"}`}>
                      reported {label}
                    </p>
                  );
                })()}
              </div>
            </div>
            {dotStatus !== "green" && adStatus !== null && (
              <p className="text-gray-300 text-[10px] mt-3 border-t border-white/[0.05] pt-3">
                To mark a native build as live: set{" "}
                <span className="font-mono text-gray-400">AD_LP_NATIVE=true</span>
                {" and "}
                <span className="font-mono text-gray-400">AD_UNITY_NATIVE=true</span>
                {" in production secrets, then re-publish the API."}
              </p>
            )}
          </div>
        );
      })()}

      {/* Integrations grid */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <h3 className="font-['Space_Grotesk'] text-lg font-bold text-gray-900">
              Integrations
            </h3>
            {data && (
              <span className="text-gray-400 text-sm">
                {data.integrations.green}/{data.integrations.total} healthy
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <StatusDot status="green" /> Connected
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot status="amber" /> Unreachable
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot status="red" /> Not set up
            </span>
          </div>
        </div>

        {loading && !data ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            Loading integration status…
          </div>
        ) : !data || data.integrations.items.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No integrations to display.
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2.5">
                  {HUB_CATEGORY_LABELS[category] ?? category}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between gap-3 bg-white/[0.02] border border-gray-200 rounded-xl px-4 py-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <StatusDot status={it.status} />
                        <div className="min-w-0">
                          <p className="text-gray-900 text-sm font-medium truncate">
                            {it.name}
                          </p>
                          <p className="text-gray-400 text-[11px]">
                            {it.configured
                              ? it.status === "amber"
                                ? "Configured · provider unreachable"
                                : "Connected"
                              : "Credentials missing"}
                          </p>
                          {it.adUnavailReason && (
                            <p className="text-amber-400/70 text-[10px] mt-0.5 leading-tight">
                              {it.adUnavailReason}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-300 text-[10px] flex-shrink-0">
                        {hubTimeAgo(it.lastCheckedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AdMob reporting alerts */}
      {admobCurrent.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="font-['Space_Grotesk'] text-lg font-bold text-gray-900">
                AdMob Reporting Alerts
              </h3>
              <span className="text-gray-400 text-sm">
                {admobFiring.length > 0
                  ? `${admobFiring.length} active`
                  : "All clear"}
              </span>
            </div>
            <StatusDot status={admobFiring.length > 0 ? "red" : "green"} />
          </div>

          <div className="space-y-2.5">
            {admobCurrent.map((alert) => {
              const firing = alert.status === "firing";
              return (
                <div
                  key={alert.condition}
                  className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 ${
                    firing
                      ? "bg-red-500/[0.07] border-red-500/20"
                      : "bg-[#00E676]/[0.05] border-[#00E676]/15"
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {firing ? (
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-gray-900 text-sm font-medium">
                          {ADMOB_ALERT_LABELS[alert.condition]}
                        </p>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            firing
                              ? "bg-red-500/15 text-red-400"
                              : "bg-[#00E676]/15 text-emerald-600"
                          }`}
                        >
                          {firing ? "Firing" : "Resolved"}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs mt-1">
                        {admobAlertDetail(alert)}
                      </p>
                      <p className="text-gray-400 text-[11px] mt-1">
                        {alert.message}
                      </p>
                    </div>
                  </div>
                  <span className="text-gray-300 text-[10px] flex-shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {hubTimeAgo(alert.firedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SponsoredVisitHealthPanel token={token} />

      <p className="text-gray-300 text-xs text-center">
        Auto-refreshes every {HUB_REFRESH_MS / 1000}s ·{" "}
        {allServicesUp ? "All core services operational" : "Service issue detected"}
      </p>
    </div>
  );
}

interface PublisherRow {
  id: string;
  username: string;
  email: string | null;
  balance: string;
  adCredits: string;
  publisherGrantedAt: string | null;
  createdAt: string;
  campaignCount: number;
  totalBudget: string;
  totalSpent: string;
  totalClicks: number;
}

interface AdminCampaign {
  id: string;
  title: string;
  description: string;
  targetUrl: string;
  rewardPerVisit: string;
  totalBudget: string;
  spent: string;
  clicks: number;
  status: string;
  adminNote: string | null;
  createdAt: string;
  userId: string;
  username: string | null;
}

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-600 border-emerald-200",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  paused: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  ended: "bg-white/[0.06] text-gray-400 border-gray-200",
};

export function PublisherProgramPanel({ token }: { token: string }) {
  const [publishers, setPublishers] = useState<PublisherRow[]>([]);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState<PublisherRow | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditError, setCreditError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<PublisherRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminCampaign | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSearchInput, setGrantSearchInput] = useState("");
  const [grantResults, setGrantResults] = useState<CashClipUser[]>([]);
  const [grantSearchLoading, setGrantSearchLoading] = useState(false);
  const [grantSearched, setGrantSearched] = useState(false);
  const [grantGiftCredits, setGrantGiftCredits] = useState("");
  const [auditRows, setAuditRows] = useState<PublisherAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditTotal, setAuditTotal] = useState(0);
  const [showAudit, setShowAudit] = useState(true);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pubRes, campRes] = await Promise.all([
        fetch("/api/admin/publishers", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/campaigns", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!pubRes.ok) throw new Error("Failed to load publishers");
      const pubData = await pubRes.json();
      setPublishers(pubData.publishers ?? []);
      if (campRes.ok) {
        const campData = await campRes.json();
        setCampaigns(campData.campaigns ?? []);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/admin/publisher-audit?limit=200", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setAuditRows(data.entries ?? []);
      setAuditTotal(data.total ?? 0);
    } catch {
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
    fetchAuditLog();
  }, [fetchData, fetchAuditLog]);

  async function handleAddCredits() {
    if (!creditTarget) return;
    const amt = Number(creditAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setCreditError("Enter an amount greater than 0");
      return;
    }
    if (amt > 500) {
      setCreditError("Amount must be 500 or less");
      return;
    }
    setActionLoading(`credit-${creditTarget.id}`);
    setCreditError("");
    try {
      const res = await fetch(
        `/api/admin/users/${creditTarget.id}/add-credits`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: amt }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      showToast(`Added ${money(amt)} in ad credits to ${creditTarget.username}`);
      setCreditTarget(null);
      setCreditAmount("");
      fetchData();
      fetchAuditLog();
    } catch (err: any) {
      setCreditError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setActionLoading(`revoke-${revokeTarget.id}`);
    try {
      const res = await fetch(
        `/api/admin/users/${revokeTarget.id}/publisher`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ grant: false }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      showToast(`Publisher access revoked for ${revokeTarget.username}`);
      setRevokeTarget(null);
      fetchData();
      fetchAuditLog();
    } catch (err: any) {
      showToast(err.message, false);
      setRevokeTarget(null);
    } finally {
      setActionLoading(null);
    }
  }

  async function searchGrantUsers() {
    const term = grantSearchInput.trim();
    if (!term) {
      setGrantResults([]);
      setGrantSearched(false);
      return;
    }
    setGrantSearchLoading(true);
    setGrantSearched(true);
    try {
      const params = new URLSearchParams({ limit: "10", search: term });
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setGrantResults(data.users ?? []);
    } catch (err: any) {
      showToast(err.message ?? "Search failed", false);
      setGrantResults([]);
    } finally {
      setGrantSearchLoading(false);
    }
  }

  async function handleGrant(u: CashClipUser) {
    setActionLoading(`grant-${u.id}`);
    try {
      const gift = grantGiftCredits.trim();
      const giftNum = Number(gift);
      const body: { grant: boolean; giftCredits?: number } = { grant: true };
      if (gift && Number.isFinite(giftNum) && giftNum >= 0) {
        body.giftCredits = giftNum;
      }
      const res = await fetch(`/api/admin/users/${u.id}/publisher`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const added = Number(data.creditsAdded ?? 0);
      showToast(
        `${u.username} is now a publisher${added > 0 ? ` — gifted ${money(added)} in credits` : ""}`,
      );
      closeGrant();
      fetchData();
      fetchAuditLog();
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  function closeGrant() {
    setGrantOpen(false);
    setGrantSearchInput("");
    setGrantResults([]);
    setGrantSearched(false);
    setGrantGiftCredits("");
  }

  async function handleCampaignStatus(
    c: AdminCampaign,
    status: string,
    adminNote?: string,
  ) {
    setActionLoading(`camp-${c.id}`);
    try {
      const res = await fetch(`/api/admin/campaigns/${c.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          ...(adminNote ? { adminNote } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const verb =
        status === "active"
          ? "approved"
          : status === "paused"
            ? "paused"
            : status === "rejected"
              ? "rejected"
              : "updated";
      showToast(`Campaign "${c.title}" ${verb}`);
      fetchData();
      fetchAuditLog();
    } catch (err: any) {
      showToast(err.message, false);
    } finally {
      setActionLoading(null);
    }
  }

  function confirmReject() {
    if (!rejectTarget) return;
    const c = rejectTarget;
    const note = rejectNote.trim();
    setRejectTarget(null);
    setRejectNote("");
    handleCampaignStatus(c, "rejected", note || undefined);
  }

  const money = (v: string | number) => `$${Number(v ?? 0).toFixed(2)}`;
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const totalCredits = publishers.reduce((s, p) => s + Number(p.adCredits ?? 0), 0);
  const totalCampaigns = publishers.reduce((s, p) => s + Number(p.campaignCount ?? 0), 0);
  const totalClicks = publishers.reduce((s, p) => s + Number(p.totalClicks ?? 0), 0);
  const campaignsByUser = (userId: string) =>
    campaigns.filter((c) => c.userId === userId);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all ${toast.ok ? "bg-[#00E676] text-[#f9fafb]" : "bg-red-500 text-gray-900"}`}
        >
          {toast.ok ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {toast.msg}
        </div>
      )}

      {/* Grant publisher access modal */}
      {grantOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-emerald-200 rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Grant Publisher Access
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              Find a CashClip user and grant them publisher status so they can
              create and run ad campaigns.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                searchGrantUsers();
              }}
              className="flex items-center gap-2 mb-3"
            >
              <input
                type="text"
                value={grantSearchInput}
                onChange={(e) => setGrantSearchInput(e.target.value)}
                placeholder="Search by username or email"
                className="flex-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors"
              />
              <button
                type="submit"
                disabled={grantSearchLoading}
                className="px-4 py-2.5 rounded-xl bg-gray-100 border border-gray-200 text-gray-600 text-sm font-medium hover:bg-white/[0.1] transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
              </button>
            </form>
            <div className="mb-3">
              <label className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">
                Gift ad credits (optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={grantGiftCredits}
                onChange={(e) => setGrantGiftCredits(e.target.value)}
                placeholder="Defaults to $5.00 starter credits"
                className="w-full mt-1 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {grantSearchLoading ? (
                <p className="text-gray-400 text-sm text-center py-6">
                  Searching…
                </p>
              ) : grantSearched && grantResults.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">
                  No users found.
                </p>
              ) : (
                grantResults.map((u) => {
                  const already = publishers.some((p) => p.id === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-gray-900 text-sm font-medium truncate">
                          {u.username}
                        </div>
                        <div className="text-gray-400 text-xs truncate">
                          {u.email ?? "—"}
                        </div>
                      </div>
                      {already ? (
                        <span className="text-gray-400 text-xs whitespace-nowrap">
                          Already a publisher
                        </span>
                      ) : (
                        <button
                          onClick={() => handleGrant(u)}
                          disabled={actionLoading === `grant-${u.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-600 text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          {actionLoading === `grant-${u.id}`
                            ? "Granting…"
                            : "Grant"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <button
              onClick={closeGrant}
              className="w-full mt-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add ad credits modal */}
      {creditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-emerald-200 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Add Ad Credits
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              Top up the ad-credit balance for{" "}
              <span className="text-gray-900 font-semibold">
                {creditTarget.username}
              </span>
              . Current balance{" "}
              <span className="text-emerald-600 font-semibold">
                {money(creditTarget.adCredits)}
              </span>
              .
            </p>
            <p className="text-gray-400 text-xs mb-4">
              Credits fund their campaigns. Max $500 per top-up.
            </p>
            <input
              type="number"
              min="0"
              max="500"
              step="0.01"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              placeholder="Amount in USD"
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-emerald-300 transition-colors mb-2"
            />
            {creditError && (
              <p className="text-red-400 text-xs mb-2">{creditError}</p>
            )}
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => {
                  setCreditTarget(null);
                  setCreditAmount("");
                  setCreditError("");
                }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCredits}
                disabled={actionLoading === `credit-${creditTarget.id}`}
                className="flex-1 py-2.5 rounded-xl bg-[#00E676] text-[#f9fafb] font-bold text-sm hover:bg-[#00E676]/90 transition-colors disabled:opacity-50"
              >
                {actionLoading === `credit-${creditTarget.id}`
                  ? "Adding…"
                  : "Add Credits"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke publisher confirm modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-gray-200 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Revoke Publisher Access?
            </h3>
            <p className="text-gray-500 text-sm mb-1">
              This removes publisher status from{" "}
              <span className="text-gray-900 font-semibold">
                {revokeTarget.username}
              </span>
              . They will no longer be able to create or run campaigns.
            </p>
            <p className="text-gray-400 text-xs mb-6">
              Their existing ad credits stay on the account and you can grant
              access again later.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setRevokeTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={actionLoading === `revoke-${revokeTarget.id}`}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-gray-900 font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {actionLoading === `revoke-${revokeTarget.id}`
                  ? "Revoking…"
                  : "Revoke"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject campaign confirm modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="bg-[#111118] border border-red-500/20 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="font-['Space_Grotesk'] font-bold text-gray-900 text-lg mb-2">
              Reject Campaign?
            </h3>
            <p className="text-gray-500 text-sm mb-3">
              Reject{" "}
              <span className="text-gray-900 font-semibold">
                {rejectTarget.title}
              </span>
              . You can add an optional note explaining why — the publisher sees
              it on their campaign.
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 text-sm placeholder-white/25 focus:outline-none focus:border-red-500/40 transition-colors mb-2 resize-none"
            />
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => {
                  setRejectTarget(null);
                  setRejectNote("");
                }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmReject}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-gray-900 font-bold text-sm hover:bg-red-600 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100">
            <Megaphone className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
              Publisher Program
            </h2>
            <p className="text-gray-400 text-sm">
              Publishers, their ad credits, and campaign performance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGrantOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-100 border border-emerald-200 rounded-xl text-emerald-600 text-sm font-medium hover:bg-emerald-100 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Grant Publisher
          </button>
          <button
            onClick={fetchData}
            className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="Publishers"
          value={publishers.length}
          color="bg-emerald-100 text-emerald-600"
        />
        <StatCard
          icon={Megaphone}
          label="Ad Credits Outstanding"
          value={money(totalCredits)}
          color="bg-emerald-500/10 text-emerald-400"
        />
        <StatCard
          icon={Layers}
          label="Total Campaigns"
          value={totalCampaigns}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Clicks"
          value={totalClicks}
          color="bg-amber-500/10 text-amber-400"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400">
            Loading publishers...
          </div>
        ) : publishers.length === 0 ? (
          <div className="text-center py-16">
            <Megaphone className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No publishers yet</p>
            <p className="text-gray-300 text-xs mt-1">
              Users granted publisher access will appear here
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-[10px] uppercase tracking-wider border-b border-gray-200">
                <th className="text-left font-medium px-5 py-3">Publisher</th>
                <th className="text-right font-medium px-3 py-3">Ad Credits</th>
                <th className="text-right font-medium px-3 py-3">Campaigns</th>
                <th className="text-right font-medium px-3 py-3">Budget</th>
                <th className="text-right font-medium px-3 py-3">Spent</th>
                <th className="text-right font-medium px-3 py-3">Clicks</th>
                <th className="text-right font-medium px-3 py-3">Joined Program</th>
                <th className="text-right font-medium px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {publishers.map((p) => {
                const open = expandedId === p.id;
                const userCampaigns = campaignsByUser(p.id);
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setExpandedId(open ? null : p.id)}
                      className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
                          />
                          <div>
                            <div className="text-gray-900 font-medium">
                              {p.username}
                            </div>
                            <div className="text-gray-400 text-xs">
                              {p.email ?? "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-emerald-600">
                        {money(p.adCredits)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {Number(p.campaignCount ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {money(p.totalBudget)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {money(p.totalSpent)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {Number(p.totalClicks ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-400 text-xs">
                        {p.publisherGrantedAt
                          ? fmtDate(p.publisherGrantedAt)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCreditTarget(p);
                              setCreditAmount("");
                              setCreditError("");
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-600 text-xs font-medium hover:bg-emerald-100 transition-colors whitespace-nowrap"
                          >
                            <Gift className="w-3.5 h-3.5" /> Credits
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevokeTarget(p);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors whitespace-nowrap"
                          >
                            <UserMinus className="w-3.5 h-3.5" /> Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-white/[0.015]">
                        <td colSpan={8} className="px-5 py-4">
                          {userCampaigns.length === 0 ? (
                            <p className="text-gray-400 text-xs py-2">
                              No campaigns created yet.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">
                                Campaigns ({userCampaigns.length})
                              </p>
                              {userCampaigns.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-900 text-sm font-medium truncate">
                                        {c.title}
                                      </span>
                                      <span
                                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${CAMPAIGN_STATUS_STYLES[c.status] ?? CAMPAIGN_STATUS_STYLES["ended"]}`}
                                      >
                                        {c.status}
                                      </span>
                                    </div>
                                    <a
                                      href={c.targetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-emerald-600/70 hover:text-emerald-600 text-xs flex items-center gap-1 mt-0.5 truncate"
                                    >
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                      <span className="truncate">{c.targetUrl}</span>
                                    </a>
                                  </div>
                                  <div className="flex items-center gap-5 flex-shrink-0 text-right">
                                    <div>
                                      <div className="text-gray-400 text-[9px] uppercase">Budget</div>
                                      <div className="text-gray-600 text-xs">{money(c.totalBudget)}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-400 text-[9px] uppercase">Spent</div>
                                      <div className="text-gray-600 text-xs">{money(c.spent)}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-400 text-[9px] uppercase">Clicks</div>
                                      <div className="text-gray-600 text-xs">{Number(c.clicks ?? 0)}</div>
                                    </div>
                                    <div
                                      className="flex items-center gap-1.5 border-l border-gray-200 pl-4"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {c.status !== "active" && (
                                        <button
                                          onClick={() =>
                                            handleCampaignStatus(c, "active")
                                          }
                                          disabled={actionLoading === `camp-${c.id}`}
                                          title="Approve / activate"
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-600 text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                                        >
                                          <Play className="w-3.5 h-3.5" /> Approve
                                        </button>
                                      )}
                                      {c.status === "active" && (
                                        <button
                                          onClick={() =>
                                            handleCampaignStatus(c, "paused")
                                          }
                                          disabled={actionLoading === `camp-${c.id}`}
                                          title="Pause"
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                                        >
                                          <Pause className="w-3.5 h-3.5" /> Pause
                                        </button>
                                      )}
                                      {c.status !== "rejected" && (
                                        <button
                                          onClick={() => {
                                            setRejectTarget(c);
                                            setRejectNote(c.adminNote ?? "");
                                          }}
                                          disabled={actionLoading === `camp-${c.id}`}
                                          title="Reject"
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                                        >
                                          <Ban className="w-3.5 h-3.5" /> Reject
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Publisher program audit log */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
        <div className="border-b border-gray-200">
          <button
            onClick={() => setShowAudit((s) => !s)}
            className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div>
              <h3 className="text-gray-900 text-sm font-semibold">Publisher Audit Log</h3>
              <p className="text-gray-400 text-xs mt-0.5">
                Every grant, revoke, ad-credit addition, and campaign status change — who did it and when.
              </p>
            </div>
            <span className="text-gray-400 text-xs whitespace-nowrap">
              {showAudit ? "Hide" : "Show"} ({auditTotal > 0 ? auditTotal : auditRows.length})
            </span>
          </button>
        </div>
        {showAudit && (
          <div className="max-h-80 overflow-y-auto">
            {auditLoading ? (
              <div className="px-5 py-6 text-gray-400 text-sm">Loading audit log…</div>
            ) : auditRows.length === 0 ? (
              <div className="px-5 py-6 text-gray-400 text-sm">No publisher actions recorded yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-[10px] uppercase tracking-wider border-b border-gray-200">
                    <th className="text-left font-medium px-5 py-2">Action</th>
                    <th className="text-left font-medium px-3 py-2">Target</th>
                    <th className="text-left font-medium px-3 py-2">Detail</th>
                    <th className="text-left font-medium px-3 py-2">By</th>
                    <th className="text-right font-medium px-5 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((r) => {
                    const actionLabel =
                      r.action === "grant_publisher" ? "Grant publisher"
                      : r.action === "revoke_publisher" ? "Revoke publisher"
                      : r.action === "add_credits" ? "Add credits"
                      : r.action === "campaign_status" ? "Campaign status"
                      : r.action;
                    const actionColor =
                      r.action === "grant_publisher" ? "text-emerald-600"
                      : r.action === "revoke_publisher" ? "text-red-400"
                      : r.action === "add_credits" ? "text-amber-400"
                      : "text-blue-400";
                    const detailText =
                      r.action === "add_credits" && r.detail?.creditsAdded != null
                        ? `+$${Number(r.detail.creditsAdded).toFixed(2)}`
                      : r.action === "grant_publisher" && r.detail?.creditsAdded != null
                        ? `gifted $${Number(r.detail.creditsAdded).toFixed(2)}`
                      : r.action === "campaign_status" && r.detail?.status
                        ? `→ ${r.detail.status}${r.detail.adminNote ? ` (${r.detail.adminNote})` : ""}`
                      : "—";
                    const target =
                      r.action === "campaign_status"
                        ? r.campaignTitle ?? r.campaignId ?? "—"
                        : r.targetUsername ?? r.targetUserId ?? "—";
                    return (
                      <tr key={r.id} className="border-t border-white/[0.04] align-top">
                        <td className="px-5 py-2.5">
                          <span className={`text-xs font-semibold ${actionColor}`}>{actionLabel}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs break-all max-w-[140px]">
                          {target}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[180px] break-words">
                          {detailText}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs break-all">
                          {r.actorUsername ?? r.actorUserId ?? "—"}
                        </td>
                        <td className="px-5 py-2.5 text-right text-gray-400 text-[10px] whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface AdMobDailyRow {
  date: string;
  earnings: number;
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
  ctr: number;
  ecpm: number;
  matchRate: number;
  showRate: number;
}

interface AdMobRevenueData {
  ok: boolean;
  configured: boolean;
  error?: string;
  missing?: string[];
  publisherId?: string;
  currency?: string;
  range?: { startDate: string; endDate: string; days: number };
  totals?: {
    earnings: number;
    impressions: number;
    clicks: number;
    adRequests: number | null;
    matchedRequests: number | null;
    ctr: number;
    ecpm: number;
    matchRate: number | null;
    showRate: number | null;
  } | null;
  daily?: AdMobDailyRow[];
  byFormat?: AdMobFormatBreakdown[];
  lastSyncedAt?: string | null;
  stale?: boolean;
  noData?: boolean;
  source?: string;
  reconciliation?: {
    officialEarnings: number;
    appReportedEarnings: number;
    differenceAbs: number;
    differencePct: number | null;
    currency: string;
  };
  fetchedAt?: string;
}

interface AdMobFormatBreakdown {
  adFormat: string;
  earnings: number;
  impressions: number;
  clicks: number;
  ecpm: number;
}

interface LevelPlayReconData {
  days: number;
  dbRevenue: number;
  dbImpressionCount: number;
  lpRevenue: number | null;
  lpConfigured: boolean;
  lpError: string | null;
  discrepancyPct: number | null;
  alert: boolean;
}

function LevelPlayReconciliationWidget({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LevelPlayReconData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/levelplay/revenue?days=7", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (err: any) {
        setError(err?.message || "Failed to load LevelPlay revenue");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;

  const inSync =
    !data?.alert &&
    (data?.discrepancyPct === null || (data?.discrepancyPct ?? 0) <= 10);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-gray-500 text-sm font-semibold">
          LevelPlay vs DB reconciliation · last 7d
        </p>
        {!loading && data && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              data.lpRevenue === null
                ? "bg-gray-100 text-gray-400"
                : inSync
                  ? "bg-[#00E676]/15 text-emerald-600"
                  : "bg-red-500/15 text-red-400"
            }`}
          >
            {data.lpRevenue === null
              ? "LP not configured"
              : inSync
                ? "In sync"
                : `Alert: ${fmtPct(data.discrepancyPct!)} gap`}
          </span>
        )}
      </div>

      {loading && (
        <p className="text-gray-400 text-sm">Loading…</p>
      )}

      {!loading && error && (
        <p className="text-red-400/80 text-sm">{error}</p>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
                DB revenue (ad_events)
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {fmtMoney(data.dbRevenue)}
              </p>
              <p className="text-gray-400 text-xs mt-1">
                {data.dbImpressionCount} rows with revenue_micros
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
                LevelPlay reported
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {data.lpRevenue !== null ? fmtMoney(data.lpRevenue) : "—"}
              </p>
              <p className="text-gray-400 text-xs mt-1">
                {data.lpConfigured
                  ? data.lpRevenue !== null
                    ? "from LevelPlay stats API"
                    : data.lpError || "fetch failed"
                  : "set IRONSOURCE_SECRET_KEY to enable"}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
                Discrepancy
              </p>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  data.alert ? "text-red-400" : "text-gray-900"
                }`}
              >
                {data.discrepancyPct !== null ? fmtPct(data.discrepancyPct) : "—"}
              </p>
              <p className="text-gray-400 text-xs mt-1">
                {data.alert
                  ? "⚠ exceeds 10% — investigate"
                  : data.discrepancyPct !== null
                    ? "within tolerance"
                    : "need LevelPlay API key"}
              </p>
            </div>
          </div>

          {data.alert && (
            <div className="mt-4 flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Revenue mismatch exceeds 10%. DB reports{" "}
                <strong>{fmtMoney(data.dbRevenue)}</strong> but LevelPlay reports{" "}
                <strong>{fmtMoney(data.lpRevenue!)}</strong> for the last 7 days.
                Check for missed ARM postback events or precision loss in revenue_micros ingestion.
              </span>
            </div>
          )}

          <p className="text-gray-400 text-xs mt-3">
            DB revenue = SUM(ad_events.revenue_micros) ÷ 1,000,000 from ARM impression-level postbacks.
            LevelPlay reported = publisher stats from the IronSource Reporting API for the same window.
            A gap under 10% is normal (reporting latency and finalization).
          </p>
        </>
      )}
    </div>
  );
}

function RevenueStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {hint && <p className="text-gray-400 text-xs mt-1">{hint}</p>}
    </div>
  );
}

function RevenuePanel({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdMobRevenueData | null>(null);
  const [periods, setPeriods] = useState<{
    today: number;
    last7d: number;
    last30d: number;
    currency: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchRevenue = useCallback(async () => {
    setLoading(true);
    setError("");
    // Pull the today / 7d / 30d earnings trio from the same persisted store the
    // phone admin uses (/api/admin/stats), so both surfaces show identical
    // figures for the same periods. Best-effort: a failure here never blocks the
    // windowed report below.
    void (async () => {
      try {
        const sres = await fetch(`/api/admin/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!sres.ok) {
          setPeriods(null);
          return;
        }
        const sjson = await sres.json();
        if (sjson?.admob) {
          setPeriods({
            today: sjson.admob.today ?? 0,
            last7d: sjson.admob.last7d ?? 0,
            last30d: sjson.admob.last30d ?? 0,
            currency: sjson.admob.currency || "USD",
          });
        } else {
          setPeriods(null);
        }
      } catch {
        setPeriods(null);
      }
    })();
    try {
      const res = await fetch(`/api/admin/admob/revenue?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        onLogout();
        return;
      }
      const raw = await res.text();
      let json: AdMobRevenueData | null = null;
      try {
        json = raw ? (JSON.parse(raw) as AdMobRevenueData) : null;
      } catch {
        json = null;
      }
      if (!json) {
        setData(null);
        setError(
          `AdMob revenue request failed (HTTP ${res.status}). The server returned an unexpected response.`,
        );
        return;
      }
      setData(json);
      setLastRefreshed(new Date());
      if (!res.ok && json.error) setError(json.error);
    } catch (err: any) {
      setData(null);
      setError(err?.message || "Failed to load AdMob revenue");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout, days]);

  useEffect(() => {
    fetchRevenue();
  }, [fetchRevenue]);

  const currency = data?.currency || "USD";
  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(n || 0);
  const fmtNum = (n: number) =>
    new Intl.NumberFormat("en-US").format(Math.round(n || 0));
  const fmtPct = (n: number) => `${((n || 0) * 100).toFixed(2)}%`;

  const totals = data?.totals;
  const chartData = (data?.daily ?? []).map((r) => ({
    label: r.date ? r.date.slice(5) : "",
    earnings: Number((r.earnings || 0).toFixed(2)),
    impressions: Math.round(r.impressions || 0),
  }));

  const configured = data?.configured !== false;
  const showData = !!data?.ok && !!totals;
  const byFormat = data?.byFormat ?? [];
  const recon = data?.reconciliation;
  const isStale = !!data?.ok && data?.stale === true && data?.noData !== true;
  const lastSynced = data?.lastSyncedAt ? new Date(data.lastSyncedAt) : null;
  const fmtSynced = (d: Date) =>
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const prettyFormat = (f: string) =>
    f
      .toLowerCase()
      .split("_")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  // "In sync" when official and app-reported agree within 5%.
  const reconInSync =
    !!recon && (recon.differencePct === null || Math.abs(recon.differencePct) <= 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100">
            <DollarSign className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
              AdMob Revenue
            </h2>
            <p className="text-gray-400 text-sm">
              Official AdMob earnings, synced and reconciled against the app's
              reported revenue
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  days === d
                    ? "bg-emerald-100 text-emerald-600"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={fetchRevenue}
            disabled={loading}
            className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {(lastSynced || isStale) && (
        <div
          className={`flex items-center gap-2 text-xs rounded-xl px-4 py-2.5 border ${
            isStale
              ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
              : "bg-gray-50 border-gray-200 text-gray-500"
          }`}
        >
          {isStale ? (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>
            {isStale
              ? `Showing last-known data — AdMob hasn't synced recently${
                  lastSynced ? ` (last synced ${fmtSynced(lastSynced)})` : ""
                }.`
              : `Last synced ${lastSynced ? fmtSynced(lastSynced) : "—"} · auto-updates from AdMob`}
          </span>
        </div>
      )}

      {periods && (
        <div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Earnings · matches the CashClip phone admin
          </p>
          <div className="grid grid-cols-3 gap-4">
            <RevenueStat
              label="Today"
              value={new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: periods.currency || "USD",
              }).format(periods.today || 0)}
            />
            <RevenueStat
              label="Last 7 days"
              value={new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: periods.currency || "USD",
              }).format(periods.last7d || 0)}
            />
            <RevenueStat
              label="Last 30 days"
              value={new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: periods.currency || "USD",
              }).format(periods.last30d || 0)}
            />
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-10 text-center text-gray-400 text-sm">
          Loading live AdMob data…
        </div>
      )}

      {!loading && !data && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-red-400 text-sm">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <AlertCircle className="w-4 h-4" /> Could not reach AdMob revenue
          </div>
          <p className="text-red-400/80 break-words">{error}</p>
        </div>
      )}

      {!loading && data && !configured && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-amber-300 text-sm">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <AlertCircle className="w-4 h-4" /> AdMob is not fully configured
          </div>
          <p className="text-amber-300/80">
            Missing secret{(data.missing?.length ?? 0) > 1 ? "s" : ""}:{" "}
            {(data.missing ?? []).join(", ") || "unknown"}
          </p>
        </div>
      )}

      {!loading && data && configured && !showData && (data.noData || data.ok) && !data.error && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.04] mb-3">
            <RefreshCw className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-gray-600 text-sm font-semibold mb-1">No AdMob data synced yet</p>
          <p className="text-gray-400 text-xs max-w-sm mx-auto">
            We haven't pulled any figures from AdMob for this period yet. Once the
            AdMob connection syncs, today / 7-day / 30-day earnings and the
            per-format breakdown will appear here. Nothing is assumed to be $0.
          </p>
        </div>
      )}

      {!loading && data && configured && !showData && !data.noData && !data.ok && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-red-400 text-sm">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <AlertCircle className="w-4 h-4" /> Could not load AdMob revenue
          </div>
          <p className="text-red-400/80 break-words">
            {error || data.error || "AdMob returned an error."}
          </p>
        </div>
      )}

      {showData && totals && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <RevenueStat
              label={`Earnings (${days}d)`}
              value={fmtMoney(totals.earnings)}
            />
            <RevenueStat label="Impressions" value={fmtNum(totals.impressions)} />
            <RevenueStat label="Clicks" value={fmtNum(totals.clicks)} />
            <RevenueStat
              label="eCPM"
              value={fmtMoney(totals.ecpm)}
              hint="per 1,000 impressions"
            />
          </div>

          {byFormat.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-gray-500 text-sm font-semibold mb-4">
                Earnings by ad format
              </p>
              <div className="space-y-3">
                {byFormat.map((f) => {
                  const pct =
                    totals.earnings > 0
                      ? Math.round((f.earnings / totals.earnings) * 100)
                      : 0;
                  return (
                    <div key={f.adFormat}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">
                          {prettyFormat(f.adFormat)}
                        </span>
                        <span className="text-gray-900 tabular-nums">
                          {fmtMoney(f.earnings)}{" "}
                          <span className="text-gray-400 text-xs">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-[#00E676]/70 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex gap-4 text-gray-400 text-xs mt-1">
                        <span>{fmtNum(f.impressions)} impressions</span>
                        <span>eCPM {fmtMoney(f.ecpm)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {recon && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-gray-500 text-sm font-semibold">
                  Reconciliation · official vs app-reported
                </p>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    reconInSync
                      ? "bg-[#00E676]/15 text-emerald-600"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {reconInSync ? "In sync" : "Diverging"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <RevenueStat
                  label="AdMob (official)"
                  value={fmtMoney(recon.officialEarnings)}
                  hint={`last ${days}d`}
                />
                <RevenueStat
                  label="App-reported"
                  value={fmtMoney(recon.appReportedEarnings)}
                  hint="from ad events"
                />
                <RevenueStat
                  label="Difference"
                  value={`${fmtMoney(recon.differenceAbs)}${
                    recon.differencePct !== null
                      ? ` (${recon.differencePct > 0 ? "+" : ""}${recon.differencePct}%)`
                      : ""
                  }`}
                />
              </div>
              <p className="text-gray-400 text-xs mt-3">
                Official AdMob estimated earnings compared with the revenue the app
                reports per impression for the same period. Small gaps are normal
                (AdMob figures are estimates and finalize later).
              </p>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <p className="text-gray-500 text-sm font-semibold mb-4">
              Daily earnings
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="earnFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00E676" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#00E676" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "#0B0B16",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    color: "#fff",
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [fmtMoney(Number(v)), "Earnings"]}
                />
                <Area
                  type="monotone"
                  dataKey="earnings"
                  stroke="#00E676"
                  strokeWidth={2}
                  fill="url(#earnFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <p className="text-gray-500 text-sm font-semibold mb-4">
              Daily impressions
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: "#0B0B16",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    color: "#fff",
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [fmtNum(Number(v)), "Impressions"]}
                />
                <Line
                  type="monotone"
                  dataKey="impressions"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-gray-400 text-xs">
            {data?.publisherId && <span>Account: {data.publisherId}</span>}
            {data?.range && (
              <span>
                Range: {data.range.startDate} → {data.range.endDate}
              </span>
            )}
            {lastRefreshed && (
              <span>
                Refreshed{" "}
                {lastRefreshed.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </>
      )}

      <LevelPlayReconciliationWidget token={token} />
    </div>
  );
}

// ─── App Config Panel ────────────────────────────────────────────────────────
// Static build-configuration snapshot for version reconciliation.
// No user or admin-sensitive data — only public app.json fields.

const APP_CONFIG = {
  identity: {
    name: "CashClip",
    slug: "cashclip",
    owner: "absustainabilityinvestments-owner",
    easProjectId: "aac2a3d9-56b6-49ab-b254-9b80e98bab2f",
    bundleId: "app.replit.cashclip",
    scheme: "cashclip",
    updatesUrl: "https://u.expo.dev/aac2a3d9-56b6-49ab-b254-9b80e98bab2f",
  },
  versions: {
    appVersion: "1.1.0",
    runtimeVersion: "1.0.0",
    iosBuildNumber: "41",
    androidVersionCode: 42,
    expoSdkVersion: "54",
    newArchEnabled: true,
  },
  ios: {
    deploymentTarget: "15.1",
    supportsTablet: false,
    encryptionExempt: true,
    pushEnvironment: "production",
    userInterfaceStyle: "automatic",
    admobAppId: "ca-app-pub-8679658921848348~6212139107",
    skAdNetworkCount: 76,
  },
  android: {
    minSdkVersion: 25,
    compileSdkVersion: 36,
    targetSdkVersion: 36,
    buildToolsVersion: "36.0.0",
    kotlinVersion: "2.1.20",
    admobAppId: "ca-app-pub-8679658921848348~6212139107",
  },
  plugins: [
    "@logrocket/react-native",
    "expo-notifications",
    "@sentry/react-native/expo",
    "expo-router",
    "expo-font",
    "expo-web-browser",
    "expo-tracking-transparency",
    "expo-build-properties",
    "withAndroidManifestFix",
  ],
  adNetworks: {
    ironsourceAppKey: "2690d87e5",
    platform: "LevelPlay (ironSource mediation)",
    demandSources: ["Unity Ads", "Pangle"],
    admobSdkPresent: true,
  },
  sentry: {
    organization: "ab-sustainability-investments",
    project: "cash-clip",
  },
  features: {
    typedRoutes: true,
    reactCompiler: false,
    orientation: "portrait",
    privacyTracking: true,
  },
} as const;

function ConfigRow({
  label,
  value,
  mono = false,
  badge,
}: {
  label: string;
  value: string | number | boolean;
  mono?: boolean;
  badge?: "green" | "blue" | "gray";
}) {
  const display =
    typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  const badgeColor =
    badge === "green"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : badge === "blue"
        ? "bg-blue-100 text-blue-700 border-blue-200"
        : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-500 text-sm">{label}</span>
      {badge ? (
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badgeColor}`}
        >
          {display}
        </span>
      ) : (
        <span
          className={`text-sm font-medium text-gray-900 ${mono ? "font-mono text-xs bg-gray-100 px-2 py-0.5 rounded" : ""}`}
        >
          {display}
        </span>
      )}
    </div>
  );
}

function ConfigSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-emerald-500" />
        <h3 className="font-['Space_Grotesk'] font-semibold text-gray-900 text-sm uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function AppConfigPanel() {
  const cfg = APP_CONFIG;
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-emerald-100">
          <Server className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
            App Configuration
          </h2>
          <p className="text-gray-400 text-sm">
            Current build snapshot — for version reconciliation only. No user
            data.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Identity */}
        <ConfigSection title="Identity" icon={Smartphone}>
          <ConfigRow label="App Name" value={cfg.identity.name} />
          <ConfigRow label="Slug" value={cfg.identity.slug} mono />
          <ConfigRow label="Bundle ID" value={cfg.identity.bundleId} mono />
          <ConfigRow label="Scheme" value={cfg.identity.scheme} mono />
          <ConfigRow label="EAS Project ID" value={cfg.identity.easProjectId} mono />
          <ConfigRow label="Owner" value={cfg.identity.owner} mono />
        </ConfigSection>

        {/* Versions */}
        <ConfigSection title="Versions" icon={Rocket}>
          <ConfigRow label="App Version" value={cfg.versions.appVersion} badge="green" />
          <ConfigRow label="Runtime Version" value={cfg.versions.runtimeVersion} badge="blue" />
          <ConfigRow label="iOS Build #" value={cfg.versions.iosBuildNumber} badge="blue" />
          <ConfigRow label="Android versionCode" value={cfg.versions.androidVersionCode} badge="blue" />
          <ConfigRow label="Expo SDK" value={cfg.versions.expoSdkVersion} />
          <ConfigRow label="New Architecture" value={cfg.versions.newArchEnabled} badge="green" />
        </ConfigSection>

        {/* iOS */}
        <ConfigSection title="iOS" icon={Smartphone}>
          <ConfigRow label="Deployment Target" value={cfg.ios.deploymentTarget} />
          <ConfigRow label="Supports Tablet" value={cfg.ios.supportsTablet} badge="gray" />
          <ConfigRow label="Encryption Exempt" value={cfg.ios.encryptionExempt} badge="green" />
          <ConfigRow label="Push Environment" value={cfg.ios.pushEnvironment} badge="blue" />
          <ConfigRow label="UI Style" value={cfg.ios.userInterfaceStyle} />
          <ConfigRow label="AdMob App ID" value={cfg.ios.admobAppId} mono />
          <ConfigRow label="SKAdNetwork IDs" value={`${cfg.ios.skAdNetworkCount} entries`} />
        </ConfigSection>

        {/* Android */}
        <ConfigSection title="Android" icon={Smartphone}>
          <ConfigRow label="Min SDK" value={cfg.android.minSdkVersion} />
          <ConfigRow label="Compile SDK" value={cfg.android.compileSdkVersion} />
          <ConfigRow label="Target SDK" value={cfg.android.targetSdkVersion} />
          <ConfigRow label="Build Tools" value={cfg.android.buildToolsVersion} mono />
          <ConfigRow label="Kotlin" value={cfg.android.kotlinVersion} mono />
          <ConfigRow label="AdMob App ID" value={cfg.android.admobAppId} mono />
        </ConfigSection>

        {/* Ad Networks */}
        <ConfigSection title="Ad Networks" icon={DollarSign}>
          <ConfigRow label="Platform" value={cfg.adNetworks.platform} />
          <ConfigRow label="App Key" value={cfg.adNetworks.ironsourceAppKey} mono />
          <ConfigRow label="Demand Sources" value={cfg.adNetworks.demandSources.join(", ")} />
          <ConfigRow label="AdMob SDK" value={cfg.adNetworks.admobSdkPresent} badge="green" />
        </ConfigSection>

        {/* Plugins & Features */}
        <ConfigSection title="Plugins & Features" icon={Layers}>
          <ConfigRow label="Typed Routes" value={cfg.features.typedRoutes} badge="green" />
          <ConfigRow label="React Compiler" value={cfg.features.reactCompiler} badge="gray" />
          <ConfigRow label="Privacy Tracking" value={cfg.features.privacyTracking} badge="green" />
          <ConfigRow label="Orientation" value={cfg.features.orientation} />
          <ConfigRow label="Sentry Org" value={cfg.sentry.organization} mono />
          <ConfigRow label="Sentry Project" value={cfg.sentry.project} mono />
          <div className="pt-2">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Plugins ({cfg.plugins.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {cfg.plugins.map((p) => (
                <span
                  key={p}
                  className="text-xs bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded font-mono"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </ConfigSection>
      </div>

      {/* Updates URL */}
      <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
        <Wifi className="w-4 h-4 text-emerald-500 shrink-0" />
        <div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
            OTA Updates URL
          </p>
          <p className="text-gray-900 text-sm font-mono mt-0.5">
            {cfg.identity.updatesUrl}
          </p>
        </div>
      </div>

      <p className="text-gray-400 text-xs mt-4 text-center">
        This data is extracted from{" "}
        <span className="font-mono">artifacts/cashclip/app.json</span> at build
        time. Update this panel whenever app.json changes.
      </p>
    </div>
  );
}

type Tab =
  | "submissions"
  | "hub"
  | "revenue"
  | "ventures"
  | "inbox"
  | "account"
  | "cashclip"
  | "publishers"
  | "security"
  | "securitylog"
  | "withdrawals"
  | "appconfig";

interface WithdrawalRow {
  id: string;
  userId: string;
  username: string;
  amount: string;
  bonusPercent: string;
  bonusAmount: string;
  totalPayout: string;
  paypalEmail: string;
  status: string;
  adminNote: string | null;
  paypalBatchId: string | null;
  createdAt: string;
  processedAt: string | null;
}

function WithdrawalsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all" | "paid" | "rejected">("pending");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const url = statusFilter === "all"
        ? "/api/admin/withdrawals"
        : `/api/admin/withdrawals?status=${statusFilter}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setRows(data.withdrawals ?? []);
    } catch {
      setActionError("Failed to load withdrawals.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handlePayout(id: string) {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}/payout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payout failed");
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id: string) {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", adminNote: rejectNote[id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reject failed");
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActingId(null);
      setShowRejectInput((p) => ({ ...p, [id]: false }));
    }
  }

  const statusBadge: Record<string, string> = {
    pending:  "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    paying:   "bg-blue-100 text-blue-800",
    paid:     "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
  };

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100">
            <ArrowUpRight className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">Withdrawal Queue</h2>
            <p className="text-gray-400 text-sm">Review and pay out user withdrawal requests</p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["pending", "all", "paid", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              statusFilter === f
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {f}{f === "pending" && pendingCount > 0 && statusFilter !== "pending" ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{actionError}</div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <ArrowUpRight className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No {statusFilter === "all" ? "" : statusFilter} withdrawals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((w) => (
            <div key={w.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-['Space_Grotesk'] font-bold text-gray-900">{w.username}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusBadge[w.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {w.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{w.paypalEmail}</p>
                  <p className="text-xs text-gray-300">{new Date(w.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-['Space_Grotesk'] font-bold text-2xl text-emerald-600">${w.totalPayout}</p>
                  {parseFloat(w.bonusPercent) > 0 && (
                    <p className="text-xs text-gray-400">${w.amount} + {w.bonusPercent}% bonus</p>
                  )}
                </div>
              </div>

              {w.adminNote && (
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">Note: {w.adminNote}</p>
              )}
              {w.paypalBatchId && (
                <p className="text-xs text-gray-300">Batch ID: {w.paypalBatchId}</p>
              )}

              {w.status === "pending" && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handlePayout(w.id)}
                    disabled={actingId === w.id}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    {actingId === w.id ? "Processing…" : "Pay via PayPal"}
                  </button>
                  {!showRejectInput[w.id] ? (
                    <button
                      onClick={() => setShowRejectInput((p) => ({ ...p, [w.id]: true }))}
                      disabled={actingId === w.id}
                      className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  ) : (
                    <div className="flex gap-2 flex-1 min-w-[200px]">
                      <input
                        type="text"
                        placeholder="Reason (optional)"
                        value={rejectNote[w.id] ?? ""}
                        onChange={(e) => setRejectNote((p) => ({ ...p, [w.id]: e.target.value }))}
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                      />
                      <button
                        onClick={() => handleReject(w.id)}
                        disabled={actingId === w.id}
                        className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowRejectInput((p) => ({ ...p, [w.id]: false }))}
                        className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("submissions");

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
    { id: "hub", label: "Integration Hub", icon: Activity },
    { id: "revenue", label: "AdMob Revenue", icon: DollarSign },
    { id: "cashclip", label: "CashClip Users", icon: Smartphone },
    { id: "withdrawals", label: "Withdrawals", icon: ArrowUpRight },
    { id: "publishers", label: "Publisher Program", icon: Megaphone },
    { id: "ventures", label: "Ventures", icon: Layers },
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "appconfig", label: "App Config", icon: Server },
    { id: "account", label: "Account", icon: User },
    { id: "security", label: "Security", icon: Shield },
    { id: "securitylog", label: "Security Log", icon: History },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 px-6 py-4">
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
              <span className="text-gray-400 text-xs">
                AB Sustainability Investments
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-400 text-xs hidden sm:block">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-gray-400 hover:text-gray-900 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </div>
        {/* Tab nav */}
        <div className="max-w-7xl mx-auto mt-4 flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-emerald-100 text-emerald-600 border border-emerald-200"
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
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
                color="bg-emerald-100 text-emerald-600"
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
                    <p className="text-gray-400 text-sm mt-0.5">
                      {leads.length} total {filter !== "all" ? filter : ""}{" "}
                      submissions
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-xl p-1">
                      {(["all", "investor", "contact"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                            filter === f
                              ? "bg-[#00E676] text-[#f9fafb]"
                              : "text-gray-500 hover:text-gray-900"
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
                      className="p-2 bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-gray-900 transition-colors"
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
                <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
                  {loading ? (
                    <div className="text-center py-16 text-gray-400">
                      Loading submissions...
                    </div>
                  ) : leads.length === 0 ? (
                    <div className="text-center py-16">
                      <Filter className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-gray-400 text-sm">
                        No submissions yet
                      </p>
                      <p className="text-gray-300 text-xs mt-1">
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
                                      ? "bg-emerald-100 text-emerald-600 border border-emerald-200"
                                      : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  }`}
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {lead.type}
                                </span>
                                <span className="text-gray-300 text-[10px]">
                                  {lead.source}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="flex items-center gap-1.5 text-gray-900 font-medium text-sm">
                                  <User className="w-3.5 h-3.5 text-gray-400" />
                                  {lead.name}
                                </span>
                                <a
                                  href={`mailto:${encodeURIComponent(lead.email)}`}
                                  className="flex items-center gap-1.5 text-emerald-600 hover:underline text-xs"
                                >
                                  <Mail className="w-3.5 h-3.5" />
                                  {lead.email}
                                </a>
                              </div>
                              {lead.message && (
                                <p className="text-gray-400 text-xs leading-relaxed border-l-2 border-gray-200 pl-3 mt-2 line-clamp-2">
                                  {lead.message}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className="text-gray-300 text-[10px]">
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

        {tab === "hub" && <IntegrationHubPanel token={token} onLogout={onLogout} />}
        {tab === "revenue" && <RevenuePanel token={token} onLogout={onLogout} />}
        {tab === "cashclip" && <CashClipUsersPanel token={token} onNavigateToPublishers={() => setTab("publishers")} />}
        {tab === "withdrawals" && <WithdrawalsPanel token={token} />}
        {tab === "publishers" && <PublisherProgramPanel token={token} />}
        {tab === "ventures" && <VenturesPanel token={token} />}
        {tab === "inbox" && <InboxPanel token={token} />}
        {tab === "account" && (
          <div className="max-w-md space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-emerald-100">
                <User className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="font-['Space_Grotesk'] text-xl font-bold text-gray-900">
                  Account
                </h2>
                <p className="text-gray-400 text-sm">
                  Manage your admin credentials
                </p>
              </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">
                Signed in as
              </p>
              <p className="text-gray-900 font-medium text-sm">
                {loggedInAs ?? "Admin"}
              </p>
            </div>
            <ChangePasswordPanel token={token} />
          </div>
        )}
        {tab === "appconfig" && <AppConfigPanel />}
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
