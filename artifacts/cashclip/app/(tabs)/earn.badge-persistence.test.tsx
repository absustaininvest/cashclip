// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── Native module + side-effecting dependency stubs ───────────────────────────
// This suite proves that the ad earned-pts badge (powered by the module-level
// _lastWatchedAdId / _lastWatchedAdPts store) survives a tab switch, i.e. the
// EarnScreen component unmounting and remounting.

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

// Prevents expo-notifications → expo (winter runtime) from loading.
vi.mock("expo", () => ({
  isRunningInExpoGo: () => false,
  reloadAppAsync: vi.fn(async () => {}),
}));
vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: vi.fn(async () => {}),
  cancelScheduledNotificationAsync: vi.fn(async () => {}),
  setNotificationHandler: vi.fn(),
}));
vi.mock("@/lib/streak-notifications", () => ({
  scheduleStreakReminder: vi.fn(async () => {}),
  cancelStreakReminder: vi.fn(async () => {}),
}));

vi.mock("@/components/SponsoredSection", () => ({ default: () => null }));
vi.mock("@/components/Chipley", () => {
  const React = require("react");
  return { default: ({ pose }: any) => React.createElement("Chipley", { pose }) };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "tester" } }),
}));
vi.mock("@/lib/CelebrationContext", () => ({
  useCelebration: () => ({ celebrate: vi.fn() }),
}));
vi.mock("@/lib/LanguageContext", async () => {
  const i18n: any = await vi.importActual("@/lib/i18n");
  return {
    useLanguage: () => ({
      t: i18n.getTranslations("en"),
      language: "en",
      setLanguage: vi.fn(),
    }),
  };
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

vi.mock("@/lib/earn-client", () => ({
  recordEarnAction: vi.fn(async () => null),
  claimMission: vi.fn(async () => ({ ok: true })),
  recordCheckin: vi.fn(async () => null),
  fetchCheckinStatus: vi.fn(async () => ({
    checkinStreak: 0,
    checkedInToday: false,
    ladder: [100, 120, 140],
    milestoneEvery: 7,
    milestoneBonus: 0,
    nextReward: 100,
    nextIsMilestone: false,
  })),
  beginAdView: vi.fn(async () => ({ ok: true, challengeToken: "test-challenge-token" })),
  completeAdView: vi.fn(async () => ({ ok: true })),
  beginSpin: vi.fn(async () => ({ ok: false, retryable: false })),
  completeSpin: vi.fn(async () => ({ ok: false, retryable: false })),
  claimAllReady: vi.fn(async () => null),
  refreshPendingFromServer: vi.fn(async () => ({
    pending: [],
    claimable: [],
    pendingPoints: 0,
    claimablePoints: 0,
    pendingUsd: 0,
    claimableUsd: 0,
  })),
  canSpinNow: vi.fn(async () => false),
  recordSpinTimestamp: vi.fn(async () => {}),
  getNextSpinTime: vi.fn(async () => null),
  formatPoints: (n: number) => String(n),
  formatCountdown: () => "Ready!",
  pointsToUsd: (n: number) => n / 1000,
}));

import EarnScreen from "./earn";

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectText(node: TestRenderer.ReactTestInstance | string | null): string[] {
  const out: string[] = [];
  const visit = (n: TestRenderer.ReactTestInstance | string | null) => {
    if (n == null) return;
    if (typeof n === "string") { out.push(n); return; }
    (n.children ?? []).forEach(visit);
  };
  visit(node);
  return out;
}

function findPressableByText(
  root: TestRenderer.ReactTestInstance,
  label: string,
): TestRenderer.ReactTestInstance | null {
  const nodes = root.findAll((n: any) => {
    if (typeof n.props?.onPress !== "function") return false;
    return collectText(n).includes(label);
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

async function renderEarn(): Promise<TestRenderer.ReactTestRenderer> {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => { tr = TestRenderer.create(React.createElement(EarnScreen)); });
  await flush();
  return tr;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Ad earned-pts badge — tab-switch persistence", () => {
  it("badge reappears on the correct ad card after unmount/remount", async () => {
    // ── Phase 1: initial render ────────────────────────────────────────────
    const tr = await renderEarn();

    // Badge absent before any ad is watched.
    expect(collectText(tr.root)).not.toContain("🎉 Check your Wallet!");

    // ── Phase 2: press the first ad card (HomeStyle, id "ad_1", duration 15s)
    // isAdMobReady() is mocked false → handleWatchAd opens WatchingModal directly.
    const homeStyleBtn = findPressableByText(tr.root, "HomeStyle");
    expect(homeStyleBtn).not.toBeNull();
    await act(async () => { await homeStyleBtn!.props.onPress(); });
    await flush();

    // Modal is now open; WatchingModal countdown runs for 15 s.
    // Advance fake timers past the ad duration so `completed` flips to true.
    await act(async () => { vi.advanceTimersByTime(16_000); });
    await flush();

    // "Claim Reward" button is now visible (WatchingModal completed state).
    const claimBtn = findPressableByText(tr.root, "Claim Reward");
    expect(claimBtn).not.toBeNull();

    // Press it → handleComplete() → sets _lastWatchedAdId = "ad_1".
    await act(async () => { await claimBtn!.props.onPress(); });
    await flush();

    // Badge is visible on the first ad card immediately after claiming.
    expect(collectText(tr.root)).toContain("🎉 Check your Wallet!");

    // ── Phase 3: simulate tab switch by unmounting the component ──────────
    act(() => { tr.unmount(); });

    // ── Phase 4: remount — state must re-hydrate from the module-level store
    const tr2 = await renderEarn();

    // Badge must still be present on the same ad card after remount.
    expect(collectText(tr2.root)).toContain("🎉 Check your Wallet!");

    act(() => { tr2.unmount(); });
  });

  it("badge does NOT appear on a different ad card after remount", async () => {
    // Verifies the badge is scoped to the correct ad (ad_1), not a different one.
    const tr = await renderEarn();

    // Watch the first ad (HomeStyle, id "ad_1").
    const homeStyleBtn = findPressableByText(tr.root, "HomeStyle");
    expect(homeStyleBtn).not.toBeNull();
    await act(async () => { await homeStyleBtn!.props.onPress(); });
    await flush();

    await act(async () => { vi.advanceTimersByTime(16_000); });
    await flush();

    const claimBtn = findPressableByText(tr.root, "Claim Reward");
    expect(claimBtn).not.toBeNull();
    await act(async () => { await claimBtn!.props.onPress(); });
    await flush();

    act(() => { tr.unmount(); });

    // Re-render and inspect ad cards: badge text appears exactly once (on ad_1).
    // WealthPath (ad_2) must NOT carry the badge.
    const tr2 = await renderEarn();
    const allTexts = collectText(tr2.root);
    const badgeCount = allTexts.filter((t) => t === "🎉 Check your Wallet!").length;
    expect(badgeCount).toBe(1);

    // WealthPath should still be rendered (it's a different ad card).
    expect(allTexts).toContain("WealthPath");

    act(() => { tr2.unmount(); });
  });
});
