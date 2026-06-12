// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── Native module + side-effecting dependency stubs ──────────────────────────
// This suite targets the sad-Chipley fetch-error card in ReferralScreen:
//   - When fetchReferralStats returns null (network failure) and no prior
//     cached stats exist, the screen must render the error card with sad Chipley
//     and a "Try Again" button that re-invokes the fetch.

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
  const FlatList = ({ data, renderItem, ListEmptyComponent }: any) => {
    if (!data || data.length === 0) {
      return ListEmptyComponent
        ? React.createElement(ListEmptyComponent)
        : null;
    }
    return React.createElement(
      "FlatList",
      null,
      data.map((item: any, idx: number) => renderItem({ item, index: idx })),
    );
  };
  return {
    View: passthrough("View"),
    Text: passthrough("Text"),
    ScrollView: passthrough("ScrollView"),
    Pressable: passthrough("Pressable"),
    Modal,
    ActivityIndicator: passthrough("ActivityIndicator"),
    FlatList,
    Image: passthrough("Image"),
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
    Alert: { alert: vi.fn() },
    Share: { share: vi.fn(async () => {}) },
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
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));

vi.mock("@/components/Chipley", () => {
  const React = require("react");
  return { default: ({ pose }: any) => React.createElement("Chipley", { pose }) };
});
vi.mock("@/components/RewardSuccessModal", () => ({ default: () => null }));
vi.mock("@/lib/LanguageContext", async () => {
  const i18n: any = await vi.importActual("@/lib/i18n");
  return { useLanguage: () => ({ t: i18n.getTranslations("en"), language: "en", setLanguage: vi.fn() }) };
});
vi.mock("@/lib/CelebrationContext", () => ({ useCelebration: () => ({ celebrate: vi.fn() }) }));

vi.mock("@/lib/storage", () => ({
  cacheReferralStats: vi.fn(async () => {}),
  setWeeklyMissionProgress: vi.fn(async () => {}),
  getCurrentWeekStartMs: vi.fn(() => 0),
  getTotalReferrals: vi.fn(async () => 0),
  getReferralEarnings: vi.fn(async () => 0),
  getSeenQualifiedReferrals: vi.fn(async () => 0),
  setSeenQualifiedReferrals: vi.fn(async () => {}),
}));

// fetchReferralStats is the lever the tests pull.
const fetchReferralStatsMock = vi.fn();
vi.mock("@/lib/earn-client", () => ({
  fetchReferralStats: (...args: any[]) => fetchReferralStatsMock(...args),
}));

import ReferralScreen from "./referral";

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
  return root.findAll((n: any) => n.type === "Chipley" && n.props.pose === pose);
}

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

async function renderReferral() {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => { tr = TestRenderer.create(React.createElement(ReferralScreen)); });
  await flush();
  return tr;
}

beforeEach(() => {
  store.clear();
  fetchReferralStatsMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Referral fetch error card
// ─────────────────────────────────────────────────────────────────────────────
describe("Referral screen fetch error card", () => {
  it("shows sad Chipley and error card when fetchReferralStats returns null with no cached data", async () => {
    fetchReferralStatsMock.mockResolvedValue(null);

    const tr = await renderReferral();

    // Sad Chipley error card is visible.
    expect(findChipley(tr.root, "sad").length).toBeGreaterThan(0);
    expect(allText(tr.root)).toContain("Couldn't Load Referrals");
    expect(allText(tr.root)).toContain(
      "Something went wrong while fetching your referral data. Check your connection and try again.",
    );
    expect(allText(tr.root)).toContain("Try Again");
  });

  it("shows a second sad Chipley in the friends list area on fetch failure", async () => {
    fetchReferralStatsMock.mockResolvedValue(null);

    const tr = await renderReferral();

    // Both error Chipleys render: main card + friends-list placeholder.
    expect(findChipley(tr.root, "sad").length).toBeGreaterThanOrEqual(2);
    expect(allText(tr.root)).toContain(
      "Couldn't load your friends list. Pull down to retry.",
    );
  });

  it("'Try Again' button calls fetchReferralStats again", async () => {
    fetchReferralStatsMock.mockResolvedValue(null);

    const tr = await renderReferral();

    expect(fetchReferralStatsMock).toHaveBeenCalledTimes(1);

    const retryBtn = findPressableByLabel(tr.root, "Try Again");
    expect(retryBtn).not.toBeNull();
    await act(async () => { await retryBtn!.props.onPress(); });
    await flush();

    expect(fetchReferralStatsMock).toHaveBeenCalledTimes(2);
  });

  it("clears the error card when retry succeeds", async () => {
    // First load fails; retry returns live data with a referral code.
    fetchReferralStatsMock
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        code: "tester",
        totalReferrals: 1,
        qualifiedReferrals: 0,
        pendingReferrals: 1,
        referralEarnings: 0,
        bonusPerReferral: 0.5,
        qualifyAmount: 3,
        referrals: [],
      });

    const tr = await renderReferral();

    expect(allText(tr.root)).toContain("Couldn't Load Referrals");

    const retryBtn = findPressableByLabel(tr.root, "Try Again");
    await act(async () => { await retryBtn!.props.onPress(); });
    await flush();

    // Error card dismissed once live data arrives with a non-empty code.
    expect(allText(tr.root)).not.toContain("Couldn't Load Referrals");
    expect(allText(tr.root)).not.toContain("Something went wrong while fetching your referral data. Check your connection and try again.");
  });

  it("does NOT show the error card when fetchReferralStats succeeds", async () => {
    fetchReferralStatsMock.mockResolvedValue({
      code: "tester",
      totalReferrals: 0,
      qualifiedReferrals: 0,
      pendingReferrals: 0,
      referralEarnings: 0,
      bonusPerReferral: 0.5,
      qualifyAmount: 3,
      referrals: [],
    });

    const tr = await renderReferral();

    expect(allText(tr.root)).not.toContain("Couldn't Load Referrals");
    expect(findChipley(tr.root, "sad")).toHaveLength(0);
  });
});
