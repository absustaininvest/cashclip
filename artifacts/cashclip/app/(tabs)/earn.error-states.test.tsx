// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── Native module + side-effecting dependency stubs ──────────────────────────
// This suite targets the sad-Chipley error states in EarnScreen:
//   1. spinRetryNotice — shown when beginSpin returns { ok: false, retryable: true }
//   2. checkinSyncError — shown when recordCheckin returns null after a check-in

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

vi.mock("react-native", () => {
  const React = require("react");
  const passthrough = (name: string) =>
    Object.assign(
      ({ children, ...props }: any) => React.createElement(name, props, children),
      { displayName: name },
    );
  const Modal = ({ visible, children }: any) => (visible ? children : null);
  Modal.displayName = "Modal";
  return {
    View: passthrough("View"),
    Text: passthrough("Text"),
    ScrollView: passthrough("ScrollView"),
    Pressable: passthrough("Pressable"),
    Modal,
    ActivityIndicator: passthrough("ActivityIndicator"),
    Image: passthrough("Image"),
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
    Alert: { alert: vi.fn() },
    Linking: { openURL: vi.fn(async () => {}) },
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("react-native-reanimated", () => {
  const React = require("react");
  const View = ({ children, ...props }: any) => React.createElement("View", props, children);
  return {
    default: { View },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: any) => v,
    withSpring: (v: any) => v,
    withSequence: (...v: any[]) => v[v.length - 1],
    withRepeat: (v: any) => v,
    Easing: {
      linear: (x: number) => x,
      inOut: () => (x: number) => x,
      out: () => (x: number) => x,
      ease: (x: number) => x,
      cubic: (x: number) => x,
    },
  };
});

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
  ImpactFeedbackStyle: { Medium: "medium", Heavy: "heavy", Light: "light" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useFocusEffect: vi.fn(),
}));

vi.mock("@/components/SponsoredSection", () => ({ default: () => null }));
vi.mock("@/components/Chipley", () => {
  const React = require("react");
  return { default: ({ pose }: any) => React.createElement("Chipley", { pose }) };
});
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", username: "tester" } }) }));
vi.mock("@/lib/CelebrationContext", () => ({ useCelebration: () => ({ celebrate: vi.fn() }) }));
vi.mock("@/lib/LanguageContext", async () => {
  const i18n: any = await vi.importActual("@/lib/i18n");
  return { useLanguage: () => ({ t: i18n.getTranslations("en"), language: "en", setLanguage: vi.fn() }) };
});
vi.mock("@/lib/admob", () => ({
  isAdMobReady: () => false,
  showRewardedAd: vi.fn(async () => null),
  preloadRewardedAd: vi.fn(async () => {}),
  isRewardedAdPreloaded: () => false,
}));
vi.mock("@/lib/ad-analytics", () => ({
  trackAdImpression: vi.fn(async () => {}),
  trackAdCompletion: vi.fn(async () => {}),
  trackAdRewardEarned: vi.fn(async () => {}),
}));

vi.mock("@/lib/storage", () => ({
  recordAdWatch: vi.fn(async () => {}),
  getUserStats: vi.fn(async () => ({ balance: 0, totalEarned: 0, streak: 0, dailyAdsWatched: 0 })),
  performDailyCheckin: vi.fn(async () => {}),
  getDailyCheckinInfo: vi.fn(async () => ({ checkedInToday: false, checkinStreak: 0 })),
  getDailyMissions: vi.fn(async () => []),
  getWeeklyMissions: vi.fn(async () => []),
  markMissionClaimed: vi.fn(async () => 0),
}));

// Hoisted holders let individual tests swap the earn-client mock return values.
const hoisted = vi.hoisted(() => ({
  beginSpinResult: { ok: false, retryable: true } as any,
  recordCheckinResult: null as any,
}));

const beginSpinMock = vi.fn();
const recordCheckinMock = vi.fn();

vi.mock("@/lib/earn-client", () => ({
  recordEarnAction: vi.fn(async () => null),
  claimMission: vi.fn(async () => ({ ok: true })),
  recordCheckin: (...args: any[]) => recordCheckinMock(...args),
  fetchCheckinStatus: vi.fn(async () => ({
    checkinStreak: 0,
    checkedInToday: false,
    ladder: [100, 120, 140],
    milestoneEvery: 7,
    milestoneBonus: 0,
    nextReward: 100,
    nextIsMilestone: false,
  })),
  beginSpin: (...args: any[]) => beginSpinMock(...args),
  completeSpin: vi.fn(async () => ({ ok: false, retryable: false })),
  claimAllReady: vi.fn(async () => null),
  refreshPendingFromServer: vi.fn(async () => ({
    pending: [], claimable: [], pendingPoints: 0, claimablePoints: 0, pendingUsd: 0, claimableUsd: 0,
  })),
  canSpinNow: vi.fn(async () => true),
  recordSpinTimestamp: vi.fn(async () => {}),
  getNextSpinTime: vi.fn(async () => null),
  formatPoints: (n: number) => String(n),
  formatCountdown: () => "Ready!",
  pointsToUsd: (n: number) => n / 1000,
}));

import EarnScreen from "./earn";

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

function findChipley(root: TestRenderer.ReactTestInstance, pose: string) {
  return root.findAll((n: any) => (n.type as string) === "Chipley" && n.props.pose === pose);
}

// Find a Pressable whose rendered text contains the given label.
function findPressableByLabel(root: TestRenderer.ReactTestInstance, label: string) {
  const nodes = root.findAll((n: any) => {
    if (typeof n.props?.onPress !== "function") return false;
    const texts: string[] = [];
    const collect = (x: any) => {
      if (x == null) return;
      if (typeof x === "string") { texts.push(x); return; }
      (x.children ?? []).forEach(collect);
    };
    (n.children ?? []).forEach(collect);
    return texts.includes(label);
  });
  return nodes[0] ?? null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderEarn() {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => { tr = TestRenderer.create(React.createElement(EarnScreen)); });
  await flush();
  return tr;
}

beforeEach(() => {
  store.clear();
  beginSpinMock.mockReset();
  recordCheckinMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Spin retry error card
// ─────────────────────────────────────────────────────────────────────────────
describe("Earn screen spin retry error card", () => {
  it("shows sad Chipley and 'Try Again' when beginSpin returns retryable failure", async () => {
    beginSpinMock.mockResolvedValue({ ok: false, retryable: true });

    const tr = await renderEarn();

    // Error card is absent before any spin attempt.
    expect(allText(tr.root)).not.toContain("Try Again");
    expect(findChipley(tr.root, "sad")).toHaveLength(0);

    // Press the spin button to trigger handleSpin → beginSpin failure.
    const spinBtn = findPressableByLabel(tr.root, "SPIN");
    expect(spinBtn).not.toBeNull();
    await act(async () => { await spinBtn!.props.onPress(); });
    await flush();

    // Sad Chipley and retry button now appear.
    expect(findChipley(tr.root, "sad").length).toBeGreaterThan(0);
    expect(allText(tr.root)).toContain("Try Again");
    expect(allText(tr.root)).toContain("Spin is taking a moment — tap to try again.");
    expect(beginSpinMock).toHaveBeenCalledTimes(1);
  });

  it("calls beginSpin again when the 'Try Again' button is pressed", async () => {
    beginSpinMock.mockResolvedValue({ ok: false, retryable: true });

    const tr = await renderEarn();

    const spinBtn = findPressableByLabel(tr.root, "SPIN");
    await act(async () => { await spinBtn!.props.onPress(); });
    await flush();

    // First call opened the error card; now press "Try Again".
    const retryBtn = findPressableByLabel(tr.root, "Try Again");
    expect(retryBtn).not.toBeNull();
    await act(async () => { await retryBtn!.props.onPress(); });
    await flush();

    // beginSpin was called a second time (once initial + once retry).
    expect(beginSpinMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check-in sync error card
// ─────────────────────────────────────────────────────────────────────────────
describe("Earn screen check-in sync error card", () => {
  it("shows sad Chipley and 'Retry Sync' when recordCheckin returns null", async () => {
    beginSpinMock.mockResolvedValue({ ok: false, retryable: false });
    recordCheckinMock.mockResolvedValue(null);

    const tr = await renderEarn();

    // Error card absent before any check-in.
    expect(allText(tr.root)).not.toContain("Retry Sync");
    expect(findChipley(tr.root, "sad")).toHaveLength(0);

    // Press the Check In button.
    const checkinBtn = findPressableByLabel(tr.root, "Check In");
    expect(checkinBtn).not.toBeNull();
    await act(async () => { await checkinBtn!.props.onPress(); });
    await flush();

    // Sad Chipley and retry-sync card now appear.
    expect(findChipley(tr.root, "sad").length).toBeGreaterThan(0);
    expect(allText(tr.root)).toContain("Retry Sync");
    expect(allText(tr.root)).toContain(
      "Couldn't sync your check-in. Your streak is saved locally — tap to retry.",
    );
    expect(recordCheckinMock).toHaveBeenCalledTimes(1);
  });

  it("calls recordCheckin again when 'Retry Sync' is pressed", async () => {
    beginSpinMock.mockResolvedValue({ ok: false, retryable: false });
    recordCheckinMock.mockResolvedValue(null);

    const tr = await renderEarn();

    const checkinBtn = findPressableByLabel(tr.root, "Check In");
    await act(async () => { await checkinBtn!.props.onPress(); });
    await flush();

    const retryBtn = findPressableByLabel(tr.root, "Retry Sync");
    expect(retryBtn).not.toBeNull();
    await act(async () => { await retryBtn!.props.onPress(); });
    await flush();

    // syncCheckin re-calls recordCheckin.
    expect(recordCheckinMock).toHaveBeenCalledTimes(2);
  });

  it("clears the sync error card when 'Retry Sync' succeeds", async () => {
    beginSpinMock.mockResolvedValue({ ok: false, retryable: false });
    // First call fails; second call (from Retry Sync) succeeds.
    recordCheckinMock
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ points: 100, checkinStreak: 1, milestoneBonus: 0 });

    const tr = await renderEarn();

    const checkinBtn = findPressableByLabel(tr.root, "Check In");
    await act(async () => { await checkinBtn!.props.onPress(); });
    await flush();

    expect(allText(tr.root)).toContain("Retry Sync");

    const retryBtn = findPressableByLabel(tr.root, "Retry Sync");
    await act(async () => { await retryBtn!.props.onPress(); });
    await flush();

    // Error card dismissed after a successful sync.
    expect(allText(tr.root)).not.toContain("Retry Sync");
    expect(allText(tr.root)).not.toContain(
      "Couldn't sync your check-in. Your streak is saved locally — tap to retry.",
    );
  });
});
