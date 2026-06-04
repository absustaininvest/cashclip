// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── Native module + side-effecting dependency stubs ──────────────────────────
// EarnScreen is a heavy native screen. We replace react-native and every native
// expo/animation module with light JS stand-ins so it can render under Node, and
// drive the check-in entirely through the mocked earn-client. The test asserts
// the milestone celebration modal only appears when the SERVER reports a
// milestoneBonus > 0 — the contract that guards the reward moment.

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
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// Minimal react-native: host-like components that simply render their children.
// Modal renders children ONLY when visible, so an invisible celebration is truly
// absent from the rendered tree (what the assertions rely on).
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

// Reanimated: shared values + no-op animation helpers. Animated.View passes through.
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
  ImpactFeedbackStyle: { Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success" },
}));
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

// App-level dependencies.
vi.mock("@/components/SponsoredSection", () => ({ default: () => null }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", username: "tester" } }) }));
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
  getUserStats: vi.fn(async () => ({ balance: 0, totalEarned: 0, streak: 6, dailyAdsWatched: 0 })),
  performDailyCheckin: vi.fn(async () => {}),
  getDailyCheckinInfo: vi.fn(async () => ({ checkedInToday: false, checkinStreak: 6 })),
  getDailyMissions: vi.fn(async () => []),
  getWeeklyMissions: vi.fn(async () => []),
  claimMissionReward: vi.fn(async () => 0),
}));

// recordCheckin is the lever the tests pull: its milestoneBonus decides the modal.
const recordCheckin = vi.fn();
vi.mock("@/lib/earn-client", () => ({
  recordEarnAction: vi.fn(async () => null),
  recordCheckin: (...args: any[]) => recordCheckin(...args),
  fetchCheckinStatus: vi.fn(async () => ({
    checkinStreak: 6,
    checkedInToday: false,
    ladder: [100, 120, 140, 160, 180, 200, 240],
    milestoneEvery: 7,
    milestoneBonus: 500,
    nextReward: 240,
    nextIsMilestone: true,
  })),
  beginSpin: vi.fn(async () => null),
  completeSpin: vi.fn(async () => null),
  claimAllReady: vi.fn(async () => null),
  refreshPendingFromServer: vi.fn(async () => ({
    pending: [], claimable: [], pendingPoints: 0, claimablePoints: 0, pendingUsd: 0, claimableUsd: 0,
  })),
  canSpinNow: vi.fn(async () => false),
  recordSpinTimestamp: vi.fn(async () => {}),
  getNextSpinTime: vi.fn(async () => null),
  formatPoints: (n: number) => String(n),
  formatCountdown: () => "Ready!",
  pointsToUsd: (n: number) => n / 1000,
}));

import EarnScreen from "./earn";

// Collect every plain-string text rendered anywhere in the tree.
function allText(node: TestRenderer.ReactTestInstance): string[] {
  const out: string[] = [];
  const visit = (n: TestRenderer.ReactTestInstance | string | null) => {
    if (n == null) return;
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    const kids = n.children ?? [];
    kids.forEach(visit);
  };
  node.children.forEach(visit);
  return out;
}

// The Check In button is the only element wired to the check-in handler; find it
// by its label and walk up to the pressable that owns the onPress.
function pressCheckIn(root: TestRenderer.ReactTestInstance) {
  const label = root.findAll(
    (n) => n.props.children === "Check In",
  )[0];
  let cur: any = label;
  while (cur && typeof cur.props?.onPress !== "function") cur = cur.parent;
  if (!cur) throw new Error("Check-in pressable not found");
  return cur.props.onPress();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  store.clear();
  recordCheckin.mockReset();
});

describe("Earn screen 7-day milestone celebration", () => {
  it("shows the milestone celebration when the server reports milestoneBonus > 0", async () => {
    recordCheckin.mockResolvedValue({ points: 240, checkinStreak: 7, milestoneBonus: 500 });

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(React.createElement(EarnScreen));
    });
    await flush(); // let loadAll() settle so the screen renders

    // Not celebrating before any check-in.
    expect(allText(tr.root)).not.toContain("7-day streak!");

    await act(async () => {
      await pressCheckIn(tr.root);
    });
    await flush();

    const text = allText(tr.root);
    expect(text).toContain("7-day streak!");
    expect(text.some((t) => t.includes("500"))).toBe(true);
    expect(text).toContain("bonus pts");
  });

  it("does NOT show the celebration on a normal check-in (milestoneBonus === 0)", async () => {
    recordCheckin.mockResolvedValue({ points: 120, checkinStreak: 3, milestoneBonus: 0 });

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(React.createElement(EarnScreen));
    });
    await flush();

    await act(async () => {
      await pressCheckIn(tr.root);
    });
    await flush();

    const text = allText(tr.root);
    expect(text).not.toContain("7-day streak!");
    expect(text).not.toContain("3-day streak!");
    expect(text).not.toContain("bonus pts");
  });
});
