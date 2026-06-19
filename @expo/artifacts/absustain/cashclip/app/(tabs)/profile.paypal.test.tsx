// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── In-memory storage shared by secure-store + AsyncStorage stubs ──────────────
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
    multiRemove: async (keys: string[]) => {
      keys.forEach((k) => store.delete(k));
    },
  },
}));

// ── React Native minimal stand-ins ─────────────────────────────────────────────
vi.mock("react-native", () => {
  const React = require("react");
  const passthrough = (name: string) =>
    Object.assign(
      ({ children, ...props }: any) =>
        React.createElement(name, props, children),
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
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      hairlineWidth: 1,
    },
    Alert: { alert: vi.fn() },
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

// ── storage: PAYPAL_EMAIL_CACHE_KEY + the loadStats helpers ────────────────────
vi.mock("@/lib/storage", () => ({
  PAYPAL_EMAIL_CACHE_KEY: "cashclip_paypal_email_v1",
  getUserStats: vi.fn(async () => ({ adsWatched: 0, streak: 0 })),
  getReferralEarnings: vi.fn(async () => 0),
  getTotalReferrals: vi.fn(async () => 0),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));

// secure-store proxies to expo-secure-store on native; back it with the same map.
vi.mock("@/lib/secure-store", () => ({
  secureGet: async (k: string) => (store.has(k) ? store.get(k)! : null),
  secureSet: async (k: string, v: string) => {
    store.set(k, v);
  },
  secureDelete: async (k: string) => {
    store.delete(k);
  },
}));

// apiRequest is the lever we assert on: it must NOT be called for an
// implausible/disposable domain and MUST be called for a plausible one.
const apiRequestMock = vi.fn(async () => ({}));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: any[]) => apiRequestMock(...args),
}));

vi.mock("@/lib/points", () => ({
  getDisplayPointsPerDollar: () => 10000,
}));

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
        get: (_obj, section) =>
          new Proxy(
            {},
            { get: (_s, key) => (typeof key === "string" ? key : "") },
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
// @workspace/validation (isPlausiblePayPalDomain) is intentionally NOT mocked so
// the test exercises the real plausibility heuristic, exactly as the screen does.
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
    if (typeof n === "string") {
      out.push(n);
      return;
    }
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

// Types the email into the only TextInput, then presses the "Save" Pressable.
async function typeAndSave(
  tr: TestRenderer.ReactTestRenderer,
  email: string,
): Promise<void> {
  const input = tr.root.find((n) => (n.type as unknown) === "TextInput");
  await act(async () => {
    input.props.onChangeText(email);
  });
  await flush();

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
});

// ── Profile screen blocks unusable write-once PayPal emails before saving ──────
//
// The PayPal payout email is write-once, so handleSavePaypal runs the trimmed
// address through isPlausiblePayPalDomain (the same check the wallet uses at
// withdrawal time) BEFORE hitting POST /api/profile/paypal-email. A
// disposable/implausible domain must surface the warning and never reach the
// server; a plausible domain must proceed to the save request.
describe("Profile screen — PayPal email plausibility gate on save", () => {
  it("blocks a disposable domain: shows the warning and does NOT call the save endpoint", async () => {
    const tr = await renderScreen();

    await typeAndSave(tr, "user@mailinator.com");

    expect(
      allText(tr.root).some((t) => t.includes("isn't accepted for PayPal payouts")),
    ).toBe(true);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("blocks an implausibly short domain (heuristic, not just the disposable list)", async () => {
    const tr = await renderScreen();

    // "ab.co": SLD ≤ 3 chars on an untrusted TLD → isPlausiblePayPalDomain false.
    await typeAndSave(tr, "user@ab.co");

    expect(
      allText(tr.root).some((t) => t.includes("isn't accepted for PayPal payouts")),
    ).toBe(true);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("allows a plausible domain: proceeds to POST /api/profile/paypal-email", async () => {
    const tr = await renderScreen();

    await typeAndSave(tr, "user@gmail.com");

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/profile/paypal-email",
      { email: "user@gmail.com" },
    );
    // No plausibility warning is shown for an accepted domain.
    expect(
      allText(tr.root).some((t) => t.includes("isn't accepted for PayPal payouts")),
    ).toBe(false);
  });
});

// ── Profile screen — server-side error paths after the save request ────────────
//
// handleSavePaypal maps two specific server error codes onto distinct user-facing
// messages. These tests exercise those post-request branches by making apiRequest
// reject with an Error whose message contains the relevant code word.
describe("Profile screen — PayPal save: server-side CONFLICT and ALREADY_SET errors", () => {
  it("CONFLICT: shows 'already linked to another account' and does not call refreshUser", async () => {
    apiRequestMock.mockRejectedValueOnce(
      new Error("CONFLICT: email already linked to another account"),
    );

    const tr = await renderScreen();
    await typeAndSave(tr, "user@gmail.com");

    expect(
      allText(tr.root).some((t) =>
        t.includes("already linked to another account"),
      ),
    ).toBe(true);
    // CONFLICT does not trigger a user refresh — only ALREADY_SET does.
    expect(refreshUserMock).not.toHaveBeenCalled();
  });

  it("ALREADY_SET: shows 'already been set' and calls refreshUser to sync server state", async () => {
    apiRequestMock.mockRejectedValueOnce(
      new Error("ALREADY_SET: paypal email already set"),
    );

    const tr = await renderScreen();
    await typeAndSave(tr, "user@gmail.com");

    expect(
      allText(tr.root).some((t) => t.includes("already been set")),
    ).toBe(true);
    // ALREADY_SET re-fetches the user so the UI can show the now-locked email.
    expect(refreshUserMock).toHaveBeenCalledTimes(1);
  });
});
