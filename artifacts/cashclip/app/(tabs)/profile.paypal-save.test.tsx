// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── This suite targets the *Save* path on the Profile screen
// (handleSavePaypal). The PayPal payout email is write-once, so the save
// handler has its own independent guards beyond the as-you-type warning
// (covered in profile.paypal-warning.test.tsx) and the disposable/implausible
// block (covered in profile.paypal.test.tsx):
//   • empty input  → "Please enter your PayPal email." and NO POST
//   • bad format   → "Enter a valid email address." and NO POST
//   • happy path   → POST /api/profile/paypal-email + a success Alert
//   • CONFLICT     → "already linked to another account." message
//   • ALREADY_SET  → "PayPal email has already been set." + refreshUser
// These branches keep a refactor from letting a user lock in an un-payable
// (or duplicate) write-once PayPal email.

// ── In-memory storage shared by secure-store + AsyncStorage stubs ──────────────
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// ── React Native minimal stand-ins. Alert.alert is captured so the happy-path
// success Alert can be asserted. ───────────────────────────────────────────────
const alertMock = vi.fn();
vi.mock("react-native", () => {
  const React = require("react");
  const passthrough = (name: string) =>
    Object.assign(
      ({ children, ...props }: any) => React.createElement(name, props, children),
      { displayName: name },
    );
  return {
    View: passthrough("View"),
    Text: passthrough("Text"),
    ScrollView: passthrough("ScrollView"),
    TextInput: ({ children, ...props }: any) =>
      React.createElement("TextInput", props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement("Pressable", { ...props, onPress }, children),
    RefreshControl: ({ onRefresh, refreshing }: any) =>
      React.createElement("RefreshControl", { onRefresh, refreshing }),
    ActivityIndicator: passthrough("ActivityIndicator"),
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
    Alert: { alert: (...args: any[]) => alertMock(...args) },
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@expo/vector-icons", () => {
  const React = require("react");
  const Icon = ({ name }: any) => React.createElement("Icon", { name });
  return { Feather: Icon, Ionicons: Icon, MaterialCommunityIcons: Icon };
});
vi.mock("expo-linear-gradient", () => {
  const React = require("react");
  return {
    LinearGradient: ({ children, ...props }: any) =>
      React.createElement("LinearGradient", props, children),
  };
});
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.1.0", ios: { buildNumber: "47" } } },
}));
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/constants/colors", () => ({
  default: new Proxy({}, { get: () => "#000000" }),
}));

vi.mock("@/lib/storage", () => ({
  PAYPAL_EMAIL_CACHE_KEY: "cashclip_paypal_email_v1",
  getUserStats: vi.fn(async () => ({ adsWatched: 0, streak: 0 })),
  getReferralEarnings: vi.fn(async () => 0),
  getTotalReferrals: vi.fn(async () => 0),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));
vi.mock("@/lib/secure-store", () => ({
  secureGet: async (k: string) => (store.has(k) ? store.get(k)! : null),
  secureSet: async (k: string, v: string) => { store.set(k, v); },
  secureDelete: async (k: string) => { store.delete(k); },
}));

// apiRequest is the server lever: it must NOT fire for the local-guard
// rejections, and its rejection messages drive the CONFLICT/ALREADY_SET copy.
const apiRequestMock = vi.fn(async () => ({}));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: any[]) => apiRequestMock(...args),
}));

vi.mock("@/lib/points", () => ({ getDisplayPointsPerDollar: () => 10000 }));
vi.mock("@/lib/earn-client", () => ({
  fetchServerBalance: vi.fn(async () => ({ balance: 0, totalEarned: 0 })),
  fetchConversionRate: vi.fn(async () => ({})),
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({
    lang: "en",
    setLang: vi.fn(),
    t: new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: (_s, key) =>
                key === "invalidPaypalEmail"
                  ? "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account."
                  : typeof key === "string"
                    ? key
                    : "",
            },
          ),
      },
    ),
  }),
}));

const refreshUserMock = vi.fn(async () => {});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "tester", paypalEmail: null },
    isAdmin: false,
    logout: vi.fn(),
    token: "fake-token",
    refreshUser: refreshUserMock,
  }),
}));

// ── Imports (after all mocks) ──────────────────────────────────────────────────
// @workspace/validation (isPlausiblePayPalDomain) is intentionally NOT mocked.
import ProfileScreen from "./profile";

// ── Helpers ────────────────────────────────────────────────────────────────────
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function allText(node: TestRenderer.ReactTestInstance): string[] {
  const out: string[] = [];
  const visit = (n: TestRenderer.ReactTestInstance | string | null) => {
    if (n == null) return;
    if (typeof n === "string") { out.push(n); return; }
    (n.children ?? []).forEach(visit);
  };
  node.children.forEach(visit);
  return out;
}

async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tr = TestRenderer.create(React.createElement(ProfileScreen));
  });
  await flush();
  return tr;
}

function getInput(tr: TestRenderer.ReactTestRenderer) {
  return tr.root.find((n) => (n.type as unknown) === "TextInput");
}

async function typeEmail(tr: TestRenderer.ReactTestRenderer, email: string) {
  await act(async () => {
    getInput(tr).props.onChangeText(email);
  });
  await flush();
}

// Presses Save by invoking the handler directly. The Save Pressable is disabled
// (and skipped by onPress) when the trimmed input is empty, so for the empty
// case we call handleSavePaypal via the always-present onPress regardless of the
// disabled styling — onPress still runs in the test renderer.
async function pressSave(tr: TestRenderer.ReactTestRenderer) {
  const saveBtn = tr.root.find(
    (n) =>
      (n.type as unknown) === "Pressable" &&
      allText(n).some((t) => t === "Save"),
  );
  await act(async () => {
    await saveBtn.props.onPress();
  });
  await flush();
}

beforeEach(() => {
  store.clear();
  apiRequestMock.mockReset().mockResolvedValue({});
  refreshUserMock.mockReset().mockResolvedValue(undefined);
  alertMock.mockReset();
});

// ── Local guards run before any network call ──────────────────────────────────
describe("Profile save — local guards block the request", () => {
  it("empty input shows 'Please enter your PayPal email.' and never POSTs", async () => {
    const tr = await renderScreen();

    // No typing — the input is empty. Drive the save handler directly.
    await pressSave(tr);

    expect(allText(tr.root)).toContain("Please enter your PayPal email.");
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("a malformed email shows 'Enter a valid email address.' and never POSTs", async () => {
    const tr = await renderScreen();

    await typeEmail(tr, "not-an-email");
    await pressSave(tr);

    expect(allText(tr.root)).toContain("Enter a valid email address.");
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

// ── Happy path: POST + success Alert ──────────────────────────────────────────
describe("Profile save — plausible email is saved", () => {
  it("POSTs the lowercased email and shows the success Alert", async () => {
    const tr = await renderScreen();

    // Mixed case proves the handler normalizes before sending.
    await typeEmail(tr, "Real.User@Gmail.com");
    await pressSave(tr);

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/profile/paypal-email",
      { email: "real.user@gmail.com" },
    );

    // Success Alert fired with the lowercased address in the body.
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [title, body] = alertMock.mock.calls[0]!;
    expect(title).toBe("PayPal email saved");
    expect(String(body)).toContain("real.user@gmail.com");

    // No error copy is rendered on success.
    expect(allText(tr.root).some((t) => t.includes("isn't accepted"))).toBe(false);
  });
});

// ── Server-error branches ─────────────────────────────────────────────────────
describe("Profile save — server-error branches", () => {
  it("CONFLICT shows the 'already linked to another account' message and no success Alert", async () => {
    apiRequestMock.mockRejectedValueOnce(new Error("409: CONFLICT"));
    const tr = await renderScreen();

    await typeEmail(tr, "taken@gmail.com");
    await pressSave(tr);

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(allText(tr.root)).toContain(
      "This PayPal email is already linked to another account.",
    );
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("ALREADY_SET shows the 'already been set' message and refreshes the user", async () => {
    apiRequestMock.mockRejectedValueOnce(new Error("409: ALREADY_SET"));
    const tr = await renderScreen();
    // Ignore the refreshUser call fired by the initial mount/loadStats.
    refreshUserMock.mockClear();

    await typeEmail(tr, "mine@gmail.com");
    await pressSave(tr);

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(allText(tr.root)).toContain("PayPal email has already been set.");
    // The ALREADY_SET branch re-syncs the locked email from the server.
    expect(refreshUserMock).toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});
