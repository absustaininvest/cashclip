// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── This suite targets the live, as-you-type PayPal-domain warning on the
// Profile screen (handlePaypalInputChange → paypalError). It mirrors the wallet
// modal's handlePaypalEmailChange behavior. The PayPal email is write-once, so
// the warning must surface BEFORE the user commits the address, not only after
// tapping Save. The real @workspace/validation isPlausiblePayPalDomain is used
// (never mocked) so the heuristic + disposable list are genuinely exercised.

// The exact message both the wallet modal and the profile screen show for an
// implausible/disposable domain. Asserting equality proves the profile warning
// matches the wallet reference behavior, not just "some error".
const WALLET_MATCHING_MESSAGE =
  "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account.";

// ── In-memory storage backing both AsyncStorage and secure-store ──────────────
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// ── React Native minimal stand-ins ───────────────────────────────────────────
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
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement("Pressable", { ...props, onPress }, children),
    TextInput: passthrough("TextInput"),
    RefreshControl: ({ onRefresh, refreshing }: any) =>
      React.createElement("RefreshControl", { onRefresh, refreshing }),
    ActivityIndicator: passthrough("ActivityIndicator"),
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
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
  notificationAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.1.0", ios: { buildNumber: "47" }, android: { versionCode: 44 } } },
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ── App-level dependencies ────────────────────────────────────────────────────
vi.mock("@/lib/AuthContext", () => ({
  // No paypalEmail set → the editable input (and its warning) is rendered.
  useAuth: () => ({
    user: { id: "u1", username: "tester", paypalEmail: null },
    isAdmin: false,
    logout: vi.fn(),
    token: "fake-token",
    refreshUser: vi.fn(async () => {}),
  }),
}));

// Proxy-based translation mock: any t.section.key returns the key name.
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

vi.mock("@/lib/storage", () => ({
  PAYPAL_EMAIL_CACHE_KEY: "cashclip_paypal_email",
  getUserStats: vi.fn(async () => ({ adsWatched: 0, streak: 0 })),
  getReferralEarnings: vi.fn(async () => 0),
  getTotalReferrals: vi.fn(async () => 0),
  getUnreadNotificationCount: vi.fn(async () => 0),
}));
vi.mock("@/lib/secure-store", () => ({
  secureGet: async (k: string) => (store.has(k) ? store.get(k)! : null),
  secureSet: async (k: string, v: string) => { store.set(k, v); },
}));
vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn(async () => ({})) }));
vi.mock("@/lib/points", () => ({ getDisplayPointsPerDollar: () => 10000 }));
vi.mock("@/lib/earn-client", () => ({
  fetchServerBalance: vi.fn(async () => ({ balance: 0, totalEarned: 0 })),
  fetchConversionRate: vi.fn(async () => 1000),
}));

// ── Imports (after all mocks) ──────────────────────────────────────────────────
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

function getPaypalInput(tr: TestRenderer.ReactTestRenderer) {
  const inputs = tr.root.findAll((n) => (n.type as unknown) === "TextInput");
  if (inputs.length === 0) throw new Error("PayPal TextInput not found");
  return inputs[0]!;
}

async function typeEmail(tr: TestRenderer.ReactTestRenderer, value: string) {
  const input = getPaypalInput(tr);
  await act(async () => {
    input.props.onChangeText(value);
  });
  await flush();
}

async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tr = TestRenderer.create(React.createElement(ProfileScreen));
  });
  await flush();
  return tr;
}

beforeEach(() => {
  store.clear();
});

// ── Warning appears for a complete email on an implausible/disposable domain ──
describe("Profile PayPal warning — appears as you type an implausible domain", () => {
  it("sets paypalError to the wallet-matching message for a disposable domain", async () => {
    const tr = await renderScreen();

    // No warning before the user types anything.
    expect(allText(tr.root)).not.toContain(WALLET_MATCHING_MESSAGE);

    await typeEmail(tr, "scammer@mailinator.com");

    // The exact wallet-matching warning is now shown.
    expect(allText(tr.root)).toContain(WALLET_MATCHING_MESSAGE);
  });

  it("flags an implausibly short domain that is not on the disposable list", async () => {
    // "ab.co": SLD ≤ 3 chars on an untrusted TLD → isPlausiblePayPalDomain false.
    // Proves the heuristic (not just the disposable Set) is exercised.
    const tr = await renderScreen();

    await typeEmail(tr, "user@ab.co");

    expect(allText(tr.root)).toContain(WALLET_MATCHING_MESSAGE);
  });
});

// ── Warning clears once the domain becomes plausible / input is empty ─────────
describe("Profile PayPal warning — clears for plausible and empty/incomplete input", () => {
  it("clears the warning once the domain becomes plausible", async () => {
    const tr = await renderScreen();

    // First type a disposable address to raise the warning.
    await typeEmail(tr, "scammer@mailinator.com");
    expect(allText(tr.root)).toContain(WALLET_MATCHING_MESSAGE);

    // Then correct it to a plausible address — the warning disappears.
    await typeEmail(tr, "real@gmail.com");
    expect(allText(tr.root)).not.toContain(WALLET_MATCHING_MESSAGE);
  });

  it("stays absent for empty input", async () => {
    const tr = await renderScreen();

    // Raise the warning, then clear the field entirely.
    await typeEmail(tr, "scammer@mailinator.com");
    expect(allText(tr.root)).toContain(WALLET_MATCHING_MESSAGE);

    await typeEmail(tr, "");
    expect(allText(tr.root)).not.toContain(WALLET_MATCHING_MESSAGE);
  });

  it("stays absent while the email is still being typed (incomplete)", async () => {
    const tr = await renderScreen();

    // A syntactically incomplete email must not warn mid-typing, even though
    // the partial domain would not be plausible on its own.
    await typeEmail(tr, "scammer@mailinator");
    expect(allText(tr.root)).not.toContain(WALLET_MATCHING_MESSAGE);
  });
});
