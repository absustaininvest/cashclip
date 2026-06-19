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
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));

vi.mock("@/components/SponsoredSection", () => ({ default: () => null }));
vi.mock("@/components/Chipley", () => ({ default: () => null }));
vi.mock("@/lib/CelebrationContext", () => ({
  useCelebration: () => ({ celebrate: vi.fn() }),
  CelebrationProvider: ({ children }: any) => children,
}));
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

// Like collectStrings but also coerces numbers to strings so that JSX
// interpolations such as `{reward} pts` (children: [100, " pts"]) are captured.
function collectText(node: any): string {
  const parts: string[] = [];
  const visit = (n: any) => {
    if (n == null) return;
    if (typeof n === "string" || typeof n === "number") {
      parts.push(String(n));
      return;
    }
    (n.children ?? []).forEach(visit);
  };
  (node.children ?? []).forEach(visit);
  return parts.join("");
}

// Return the rung Views in DOM order.
//
// The react-native mock wraps every host element in a functional component, so
// the real element tree is deeper than the JSX looks:
//
//   Functional View (rung)          ← JSX <View key={i} …>
//     HOST "View"                   ← rendered by the functional wrapper
//       Functional Icon or Text     ← JSX {isActive ? <Ionicons/> : <Text>{dayNum}</Text>}
//         HOST "Icon" | HOST "Text"
//       Functional Text             ← JSX <Text>{reward} pts</Text>
//         HOST "Text" ("100 pts")   ← this is what findAll gives us
//
// So the HOST reward-text's parent is the functional Text wrapper and its
// grandparent is the HOST "View" rung — not the functional View wrapper.
//
// A WheelSegment View also holds a "{N} pts" label Text but its sibling is a
// dot View (no checkmark, no plain-digit day number), so it is excluded by the
// subtree check below.
function findDayRungs(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance[] {
  // HOST "Text" instances whose content is a bare "{reward} pts" label.
  const rewardTexts = root.findAll(
    (n: any) =>
      (n.type as string) === "Text" && /^\d+\s*pts$/.test(collectText(n)),
  );

  const seen = new Set<TestRenderer.ReactTestInstance>();
  const rungs: TestRenderer.ReactTestInstance[] = [];

  for (const t of rewardTexts) {
    // HOST "Text" → Functional Text wrapper → HOST "View" (rung)
    const rung: any = t.parent?.parent;
    if (!rung || seen.has(rung)) continue;

    // A ladder rung always has either a checkmark icon (isActive) or a
    // plain day-number text (inactive/current) somewhere in its subtree.
    // WheelSegment Views contain only a dot View and the label Text — neither.
    const hasCheckmark =
      rung.findAll(
        (n: any) => (n.type as string) === "Icon" && n.props?.name === "checkmark",
      ).length > 0;
    const hasDayNumber =
      rung.findAll(
        (n: any) => (n.type as string) === "Text" && /^\d+$/.test(collectText(n)),
      ).length > 0;

    if (hasCheckmark || hasDayNumber) {
      seen.add(rung);
      rungs.push(rung);
    }
  }

  return rungs;
}

// Does the given rung show a checkmark icon (isActive = true)?
function rungHasCheckmark(rung: TestRenderer.ReactTestInstance): boolean {
  return (
    rung.findAll(
      (n: any) => (n.type as string) === "Icon" && n.props.name === "checkmark",
    ).length > 0
  );
}

// Flatten the style prop (which may be an array with false values) into a list
// of plain objects so we can inspect individual style keys.
function flattenStyles(rung: TestRenderer.ReactTestInstance): any[] {
  const raw: any[] = [].concat((rung as any).props?.style ?? []);
  return raw.filter((s) => s && typeof s === "object");
}

// Does the rung carry the "isCurrent" highlight? dayCircleCurrent is the only
// style in earn.tsx with borderStyle: "dashed".
function rungHasCurrentStyle(rung: TestRenderer.ReactTestInstance): boolean {
  return flattenStyles(rung).some((s) => s.borderStyle === "dashed");
}

// Does the rung carry the "isToday" highlight? dayCircleToday is the only style
// in earn.tsx with borderWidth: 2 (milestone and current both use 1.5).
function rungHasTodayStyle(rung: TestRenderer.ReactTestInstance): boolean {
  return flattenStyles(rung).some((s) => s.borderWidth === 2);
}

// Return the 1-based day numbers of every rung that carries a milestone star
// badge. Uses findDayRungs so the star search is scoped to identified ladder
// rungs rather than walking the whole tree (which would also pick up the star
// icons in AdCard reward pills and other non-ladder elements).
function milestoneDayNumbers(root: TestRenderer.ReactTestInstance): number[] {
  const rungs = findDayRungs(root);
  return rungs
    .map((rung, i) => {
      const hasStar =
        rung.findAll(
          (n: any) => (n.type as string) === "Icon" && n.props.name === "star",
        ).length > 0;
      return hasStar ? i + 1 : null;
    })
    .filter((n): n is number => n != null);
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

describe("Earn screen check-in streak ladder – reward amounts", () => {
  it("renders each rung with the matching reward value from the server ladder, in order", async () => {
    const ladder = [100, 150, 200, 250, 300, 350, 400];
    hoisted.checkinStatus = {
      checkinStreak: 3,
      checkedInToday: false,
      ladder,
      milestoneEvery: 7,
      milestoneBonus: 500,
      nextReward: 250,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();
    const rungs = findDayRungs(tr.root);

    // One rung per ladder entry, in order.
    expect(rungs).toHaveLength(ladder.length);

    // Each rung's "{reward} pts" label matches the corresponding ladder value.
    rungs.forEach((rung, i) => {
      const rewardText = rung.findAll(
        (n: any) =>
          (n.type as string) === "Text" && /^\d+\s*pts$/.test(collectText(n)),
      );
      expect(rewardText).toHaveLength(1);
      expect(collectText(rewardText[0])).toBe(`${ladder[i]} pts`);
    });
  });

  it("reflects a different ladder array when the server returns different values", async () => {
    const ladder = [50, 75, 100, 125, 150, 175, 999];
    hoisted.checkinStatus = {
      checkinStreak: 0,
      checkedInToday: false,
      ladder,
      milestoneEvery: 7,
      milestoneBonus: 999,
      nextReward: 50,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();
    const rungs = findDayRungs(tr.root);

    expect(rungs).toHaveLength(ladder.length);
    rungs.forEach((rung, i) => {
      const rewardText = rung.findAll(
        (n: any) =>
          (n.type as string) === "Text" && /^\d+\s*pts$/.test(collectText(n)),
      );
      expect(collectText(rewardText[0])).toBe(`${ladder[i]} pts`);
    });
  });
});

describe("Earn screen check-in streak ladder – active and current highlighting", () => {
  it("marks days up to the streak as active (checkmark) and the next rung as current (no checkmark)", async () => {
    const ladder = [100, 120, 140, 160, 180, 200, 240];
    const streak = 3;
    hoisted.checkinStatus = {
      checkinStreak: streak,
      checkedInToday: false,
      ladder,
      milestoneEvery: 7,
      milestoneBonus: 500,
      nextReward: 160,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();
    const rungs = findDayRungs(tr.root);

    expect(rungs).toHaveLength(ladder.length);

    // Days 1..streak: isActive → checkmark replaces the day number.
    for (let i = 0; i < streak; i++) {
      expect(rungHasCheckmark(rungs[i])).toBe(true);
    }

    // Day streak+1: isCurrent → NOT active, so no checkmark (day number shown).
    expect(rungHasCheckmark(rungs[streak])).toBe(false);
    // isCurrent also applies the dashed-border highlight style.
    expect(rungHasCurrentStyle(rungs[streak])).toBe(true);
    // No other rung carries the dashed-border current highlight.
    for (let i = 0; i < ladder.length; i++) {
      if (i === streak) continue;
      expect(rungHasCurrentStyle(rungs[i])).toBe(false);
    }

    // Days beyond streak+1: also not active.
    for (let i = streak + 1; i < ladder.length; i++) {
      expect(rungHasCheckmark(rungs[i])).toBe(false);
    }
  });

  it("marks the streak day itself as active (isToday) when already checked in today", async () => {
    const ladder = [100, 120, 140, 160, 180, 200, 240];
    const streak = 5;
    hoisted.checkinStatus = {
      checkinStreak: streak,
      checkedInToday: true,
      ladder,
      milestoneEvery: 7,
      milestoneBonus: 500,
      nextReward: 200,
      nextIsMilestone: false,
    };

    const tr = await renderEarn();
    const rungs = findDayRungs(tr.root);

    expect(rungs).toHaveLength(ladder.length);

    // All days up to and including the streak day are active (isToday is a
    // style variant of active — the checkmark still replaces the day number).
    for (let i = 0; i < streak; i++) {
      expect(rungHasCheckmark(rungs[i])).toBe(true);
    }

    // The streak day itself (rungs[streak - 1]) carries the isToday accent
    // border (borderWidth: 2) — distinguishable from the plain active style.
    expect(rungHasTodayStyle(rungs[streak - 1])).toBe(true);
    // Earlier active days only get dayCircleActive (no borderWidth: 2).
    for (let i = 0; i < streak - 1; i++) {
      expect(rungHasTodayStyle(rungs[i])).toBe(false);
    }

    // Days past the streak are not active (no check-in has reached them yet).
    for (let i = streak; i < ladder.length; i++) {
      expect(rungHasCheckmark(rungs[i])).toBe(false);
    }
  });

  it("shows no active rungs when streak is zero (fresh user)", async () => {
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
    const rungs = findDayRungs(tr.root);

    // No day has been completed yet — every rung shows a day number, not a checkmark.
    for (const rung of rungs) {
      expect(rungHasCheckmark(rung)).toBe(false);
    }
    // Day 1 is the current rung (isCurrent = dayNum === 0 + 1 = 1, checkedInToday false).
    expect(rungs).toHaveLength(7);
  });
});
