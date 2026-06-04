// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── Native module + side-effecting dependency stubs ──────────────────────────
// Mirrors the harness in earn.milestone.test.tsx, but this suite targets the
// check-in streak LADDER itself: every Nth day (milestoneEvery from the server)
// must render a star milestone badge on the correct rung — and ONLY on those
// rungs. A regression that drops the markers or marks the wrong days is exactly
// what these assertions guard.

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

// The milestone badge renders <Ionicons name="star" .../>. We keep the icon's
// `name` prop on the host node so we can locate the star markers precisely.
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
  getUserStats: vi.fn(async () => ({ balance: 0, totalEarned: 0, streak: 0, dailyAdsWatched: 0 })),
  performDailyCheckin: vi.fn(async () => {}),
  getDailyCheckinInfo: vi.fn(async () => ({ checkedInToday: false, checkinStreak: 0 })),
  getDailyMissions: vi.fn(async () => []),
  getWeeklyMissions: vi.fn(async () => []),
  claimMissionReward: vi.fn(async () => 0),
}));

// fetchCheckinStatus is the lever this suite pulls: its ladder + milestoneEvery
// decide which rungs become milestones. A hoisted holder lets each test swap the
// server response before rendering.
const hoisted = vi.hoisted(() => ({ checkinStatus: null as any }));
vi.mock("@/lib/earn-client", () => ({
  recordEarnAction: vi.fn(async () => null),
  recordCheckin: vi.fn(async () => null),
  fetchCheckinStatus: vi.fn(async () => hoisted.checkinStatus),
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

// Recursively collect the plain-string text under a node.
function collectStrings(node: any): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (n == null) return;
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    (n.children ?? []).forEach(visit);
  };
  (node.children ?? []).forEach(visit);
  return out;
}

// For each rendered star milestone badge, walk up to its day rung and read the
// day number printed on that rung. With checkinStreak = 0 every rung is inactive
// and renders its day number (not a checkmark), so the mapping is unambiguous.
// The rung is the nearest ancestor that owns this day's "{reward} pts" text.
function milestoneDayNumbers(root: TestRenderer.ReactTestInstance): number[] {
  const stars = root.findAll(
    (n: any) => n.type === "Icon" && n.props.name === "star",
  );
  return stars
    .map((star) => {
      let cur: any = star.parent;
      while (cur) {
        const texts = cur.findAll((n: any) => n.type === "Text");
        const hasReward = texts.some((t: any) =>
          /^\d+\s+pts$/.test(collectStrings(t).join("")),
        );
        if (hasReward) {
          // This ancestor is the single day rung; read its day number.
          for (const t of texts) {
            const s = collectStrings(t).join("");
            if (/^\d+$/.test(s)) return Number(s);
          }
          return null;
        }
        cur = cur.parent;
      }
      return null;
    })
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderEarn() {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tr = TestRenderer.create(React.createElement(EarnScreen));
  });
  await flush(); // let loadAll() settle so the ladder renders from the server
  return tr;
}

beforeEach(() => {
  store.clear();
  hoisted.checkinStatus = null;
});

describe("Earn screen check-in streak ladder milestones", () => {
  it("flags the 7th-day rung as a milestone when milestoneEvery = 7", async () => {
    hoisted.checkinStatus = {
      checkinStreak: 0,
      checkedInToday: false,
      ladder: [100, 120, 140, 160, 180, 200, 240],
      milestoneEvery: 7,
      milestoneBonus: 500,
      nextReward: 100,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();

    // Exactly one milestone marker, on day 7 — none on days 1–6.
    expect(milestoneDayNumbers(tr.root)).toEqual([7]);
  });

  it("flags every Nth rung (7 and 14) on a longer ladder and nothing in between", async () => {
    hoisted.checkinStatus = {
      checkinStreak: 0,
      checkedInToday: false,
      ladder: [
        100, 120, 140, 160, 180, 200, 240, // days 1–7
        260, 280, 300, 320, 340, 360, 500, // days 8–14
      ],
      milestoneEvery: 7,
      milestoneBonus: 500,
      nextReward: 100,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();

    const milestones = milestoneDayNumbers(tr.root);
    expect(milestones).toEqual([7, 14]);
    // Defensive: non-milestone days never carry the star badge.
    for (const day of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]) {
      expect(milestones).not.toContain(day);
    }
  });

  it("renders no milestone markers when the server reports milestoneEvery = 0", async () => {
    hoisted.checkinStatus = {
      checkinStreak: 0,
      checkedInToday: false,
      ladder: [100, 120, 140, 160, 180, 200, 240],
      milestoneEvery: 0,
      milestoneBonus: 0,
      nextReward: 100,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();

    expect(milestoneDayNumbers(tr.root)).toEqual([]);
  });
});
