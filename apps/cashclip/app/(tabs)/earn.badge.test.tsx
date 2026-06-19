// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── AsyncStorage stub ─────────────────────────────────────────────────────────
// Shared in-memory store across all tests in this file.  Tests seed it before
// rendering to simulate cold-launch (stale session ID) vs warm-resume (matching
// session ID) storage states.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// ── React Native stub ─────────────────────────────────────────────────────────
vi.mock("react-native", () => {
  const React = require("react");
  const passthrough = (name: string) =>
    Object.assign(
      ({ children, ...props }: any) =>
        React.createElement(name, props, children),
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
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      hairlineWidth: 1,
    },
    Alert: { alert: vi.fn() },
    Linking: { openURL: vi.fn(async () => {}) },
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("react-native-reanimated", () => {
  const React = require("react");
  const View = ({ children, ...props }: any) =>
    React.createElement("View", props, children);
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
  useFocusEffect: () => {},
}));

vi.mock("@/components/SponsoredSection", () => ({ default: () => null }));
vi.mock("@/components/Chipley", () => ({ default: () => null }));
vi.mock("@/lib/CelebrationContext", () => ({
  useCelebration: () => ({ celebrate: vi.fn() }),
}));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "tester" } }),
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
vi.mock("@/lib/streak-notifications", () => ({
  scheduleStreakReminder: vi.fn(async () => {}),
  cancelStreakReminder: vi.fn(async () => {}),
}));

vi.mock("@/lib/storage", () => ({
  getUserStats: vi.fn(async () => ({
    balance: 0,
    totalEarned: 0,
    streak: 0,
    dailyAdsWatched: 0,
  })),
  performDailyCheckin: vi.fn(async () => {}),
  getDailyCheckinInfo: vi.fn(async () => ({
    checkedInToday: false,
    checkinStreak: 0,
  })),
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
    ladder: [100, 120, 140, 160, 180, 200, 240],
    milestoneEvery: 7,
    milestoneBonus: 0,
    nextReward: 100,
    nextIsMilestone: false,
  })),
  beginSpin: vi.fn(async () => null),
  completeSpin: vi.fn(async () => null),
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

// ── Subject under test ────────────────────────────────────────────────────────
// _sessionId is the module-level ID generated when earn.tsx loads.  Tests use
// it as the "current session" value so they can distinguish matching vs stale.
import EarnScreen, { _AD_BADGE_KEY, _sessionId } from "./earn";

// ── Helpers ───────────────────────────────────────────────────────────────────
function collectText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (node.children) return collectText(node.children);
  return "";
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("game-earned badge — session-scoped persistence", () => {
  beforeEach(() => {
    store.clear();
  });

  it("cold launch: does NOT show a badge stored under a stale session ID", async () => {
    // Simulate storage left over from a previous app launch: sessionId differs
    // from the current process's _sessionId, so the badge must be discarded.
    store.set(
      _AD_BADGE_KEY,
      JSON.stringify({ sessionId: "stale-session-from-prior-launch", pts: 750 }),
    );

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<EarnScreen />);
    });
    // Flush any remaining microtasks / state updates.
    await act(async () => {});

    const rendered = collectText(renderer.toJSON());
    expect(rendered).not.toContain("pts earned");
  });

  it("warm resume: restores a badge stored under the current session ID", async () => {
    // Simulate storage written during this same process (same sessionId, e.g.
    // user played a game then navigated back to the Earn tab).
    store.set(
      _AD_BADGE_KEY,
      JSON.stringify({ sessionId: _sessionId, pts: 500 }),
    );

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<EarnScreen />);
    });
    await act(async () => {});

    const rendered = collectText(renderer.toJSON());
    // The badge text node is split across JSX children ("+" + pts number + " pts
    // earned"), so the joined string reads "+ 500  pts earned" with extra spaces.
    // We verify both that the points value is shown and the badge label is present.
    expect(rendered).toContain("500");
    expect(rendered).toContain("pts earned");
  });
});
