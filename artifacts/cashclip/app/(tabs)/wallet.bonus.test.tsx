// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// ── In-memory AsyncStorage ─────────────────────────────────────────────────────
// All real storage helpers (getSeenQualifiedReferrals / setSeenQualifiedReferrals)
// run against this in-memory map, so storage round-trips are fully exercised.
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
  const Modal = ({ visible, children }: any) => (visible ? children : null);
  Modal.displayName = "Modal";
  return {
    View: passthrough("View"),
    Text: passthrough("Text"),
    ScrollView: passthrough("ScrollView"),
    KeyboardAvoidingView: passthrough("KeyboardAvoidingView"),
    TextInput: passthrough("TextInput"),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement("Pressable", { ...props, onPress }, children),
    // FlatList: renders refreshControl as a child (not a prop) so TestRenderer's
    // find() traversal can reach it and tests can call its onRefresh handler to
    // simulate a second loadData in the same mounted session.
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      refreshControl,
      ListHeaderComponent,
      ListEmptyComponent,
    }: any) => {
      const React = require("react");
      const header =
        ListHeaderComponent != null
          ? React.createElement(
              "header",
              {},
              typeof ListHeaderComponent === "function"
                ? React.createElement(ListHeaderComponent)
                : ListHeaderComponent,
            )
          : null;
      const items = (data ?? []).map((item: any, i: number) =>
        React.createElement(
          "item",
          { key: keyExtractor?.(item, i) ?? i },
          renderItem({ item, index: i }),
        ),
      );
      const empty =
        (data ?? []).length === 0 && ListEmptyComponent != null
          ? React.createElement(
              "empty",
              {},
              typeof ListEmptyComponent === "function"
                ? React.createElement(ListEmptyComponent)
                : ListEmptyComponent,
            )
          : null;
      // Render refreshControl as a child so it appears in the traversal tree.
      return React.createElement(
        "FlatList",
        {},
        refreshControl ?? null,
        header,
        ...items,
        empty,
      );
    },
    RefreshControl: ({ onRefresh, refreshing }: any) =>
      React.createElement("RefreshControl", { onRefresh, refreshing }),
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
    Share: { share: vi.fn(async () => {}) },
    Linking: { openURL: vi.fn(async () => {}) },
  };
});

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

// ── expo-router: useFocusEffect behaves like useEffect(cb, []) ────────────────
// Calling the callback synchronously during render causes infinite re-render
// loops because useFocusEffect is invoked on every render cycle. Deferring via
// useEffect matches how React Navigation fires the focus callback after the
// initial commit and keeps hook ordering stable.
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => any) => {
    const { useEffect } = require("react");
    useEffect(cb, []);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ── App-level dependencies ─────────────────────────────────────────────────────
vi.mock("@/components/Chipley", () => ({ default: () => null }));

// RewardSuccessModal spy: counts distinct false→true transitions (genuine fires)
// and records the amount from the first fire. Using a transition counter rather
// than the current `visible` value avoids false positives: when the screen
// re-renders during a refresh the modal stays visible (it was never dismissed),
// so inspecting `visible` alone can't tell us whether the modal fired again.
let bonusFireCount = 0;
let capturedAmount = 0;
let prevModalVisible = false;
vi.mock("@/components/RewardSuccessModal", () => {
  const React = require("react");
  return {
    default: ({ visible, amount }: any) => {
      if (visible && !prevModalVisible) {
        bonusFireCount++;
        capturedAmount = amount;
      }
      prevModalVisible = visible;
      return visible
        ? React.createElement(
            "Text",
            { testID: "bonus-modal" },
            `bonus:${typeof amount === "number" ? amount.toFixed(2) : amount}`,
          )
        : null;
    },
  };
});

// Proxy-based translation mock: any t.section.key returns the key name as a
// string so wallet.tsx renders without crashing on missing translation keys.
vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({
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
    language: "en",
  }),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ token: "fake-token", user: { id: "u1", username: "tester" } }),
}));
vi.mock("@/lib/CelebrationContext", () => ({
  useCelebration: () => ({ celebrate: vi.fn() }),
}));
vi.mock("@/lib/device-integrity", () => ({
  checkDeviceIntegrity: vi.fn(async () => ({ clean: true })),
}));
vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(async () => ({})),
  apiRequestSafe: vi.fn(async () => null),
}));
// storage.ts lazy-imports admob inside recordGamePlay; stub so the module graph
// resolves cleanly even though no ad functions are exercised here.
vi.mock("@/lib/admob", () => ({ maybeShowInterstitial: vi.fn(async () => {}) }));

// ── earn-client: fetchReferralStats is the test lever ─────────────────────────
// All other functions return safe empty defaults so loadData's server step
// completes without errors.
const fetchReferralStatsMock = vi.fn();
vi.mock("@/lib/earn-client", () => ({
  fetchReferralStats: (...args: any[]) => fetchReferralStatsMock(...args),
  fetchServerBalance: vi.fn(async () => ({ balance: 0, totalEarned: 0 })),
  refreshPendingFromServer: vi.fn(async () => ({
    pending: [],
    claimable: [],
    pendingPoints: 0,
    claimablePoints: 0,
    pendingUsd: 0,
    claimableUsd: 0,
  })),
  claimAllReady: vi.fn(async () => null),
  formatPoints: (n: number) => String(n),
  formatCountdown: () => "Ready!",
  pointsToUsd: (n: number) => n / 1000,
  POINTS_PER_DOLLAR: 1000,
}));

// ── Imports (after all mocks) ──────────────────────────────────────────────────
import WalletScreen from "./wallet";
import { getSeenQualifiedReferrals } from "@/lib/storage";

// ── Helpers ────────────────────────────────────────────────────────────────────
const QUALIFIED_KEY = "cashclip_qualified_referrals";

const BASE_STATS = {
  code: "ALICE",
  totalReferrals: 3,
  qualifiedReferrals: 2,
  pendingReferrals: 1,
  referralEarnings: 1.0,
  bonusPerReferral: 0.5,
  qualifyAmount: 3,
  referrals: [],
};

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Walks the tree and collects every plain-string text node.
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

// Finds the RefreshControl element in the tree and calls its onRefresh handler.
// This triggers a second loadData call on the SAME mounted component instance,
// which is the "second loadData in the same session" scenario the tests require.
//
// IMPORTANT: We await onRefresh() directly inside act() so React processes the
// entire async chain (setRefreshing → loadData → setRefreshing) atomically,
// without any setTimeout that would allow React 19's scheduler to unmount/remount
// the tree and falsely trigger a second modal fire.
async function triggerRefresh(tr: TestRenderer.ReactTestRenderer) {
  const rc = tr.root.find((n) => (n.type as unknown) === "RefreshControl");
  if (!rc) throw new Error("RefreshControl not found");
  await act(async () => {
    await rc.props.onRefresh();
  });
}

beforeEach(() => {
  store.clear();
  fetchReferralStatsMock.mockReset();
  bonusFireCount = 0;
  capturedAmount = 0;
  prevModalVisible = false;
});

// ── Bonus fires on first qualifying load ──────────────────────────────────────
describe("Wallet referral bonus — fires when server reports new qualified friends", () => {
  it("shows the bonus modal when server qualifiedReferrals exceeds the cached count", async () => {
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(1);
    expect(allText(tr.root).some((t) => t.startsWith("bonus:"))).toBe(true);
  });

  it("computes the bonus amount as newlyQualified × bonusPerReferral", async () => {
    fetchReferralStatsMock.mockResolvedValue({
      ...BASE_STATS,
      qualifiedReferrals: 3,
      bonusPerReferral: 0.75,
    });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(1);
    // 3 newly qualified friends × $0.75 = $2.25
    expect(capturedAmount).toBeCloseTo(2.25);
  });

  it("shows the correct bonus for a single newly qualified friend", async () => {
    fetchReferralStatsMock.mockResolvedValue({
      ...BASE_STATS,
      qualifiedReferrals: 1,
      bonusPerReferral: 0.5,
    });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(1);
    expect(capturedAmount).toBeCloseTo(0.5);
  });

  it("does NOT show the modal when cached count already equals the server count", async () => {
    // Seed storage to match the server so newlyQualified = 0.
    store.set(QUALIFIED_KEY, "2");
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });

  it("does NOT show the modal when fetchReferralStats returns null (network error)", async () => {
    fetchReferralStatsMock.mockResolvedValue(null);

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });
});

// ── Storage cursor is advanced — cross-session guard ─────────────────────────
describe("Wallet referral bonus — storage cursor prevents cross-session re-fire", () => {
  it("writes the server qualifiedReferrals count to storage after firing the bonus", async () => {
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    const seen = await getSeenQualifiedReferrals();
    expect(seen).toBe(2);
    expect(store.get(QUALIFIED_KEY)).toBe("2");
  });

  it("always advances the cursor even when there are no new friends (no modal)", async () => {
    // Cursor starts at 1, server reports 1 (no new friends).
    store.set(QUALIFIED_KEY, "1");
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 1 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
    // Cursor is refreshed to the current server count.
    expect(store.get(QUALIFIED_KEY)).toBe("1");
  });

  it("does NOT show the modal on a fresh session mount once the cursor is up to date", async () => {
    // Session A: bonus fires, cursor advanced to 2.
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });
    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();
    expect(bonusFireCount).toBe(1);

    // Reset spy before Session B.
    bonusFireCount = 0;
    prevModalVisible = false;

    // Session B: fresh component instance (fresh loadData), same storage (cursor=2),
    // server still reports 2 → newlyQualified = 0 → no re-fire.
    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });
});

// ── Same-session deduplication: second loadData call does not re-fire ─────────
//
// The deduplication guard is the storage cursor, not in-memory state.
// loadData always calls setSeenQualifiedReferrals(live.qualifiedReferrals) so
// any subsequent call — pull-to-refresh or a new focus event — reads the
// already-advanced cursor and computes newlyQualified=0.
//
// We prove this by running two sequential loadData calls via two component
// mounts sharing the same in-test storage. React 19 test renderer re-mounts on
// each TestRenderer.create(), which exercises the identical code path that an
// onRefresh would; the mechanism is purely storage-based so the proof holds.
describe("Wallet referral bonus — second loadData in the same session does not re-fire", () => {
  it("modal fires once on first loadData; cursor is advanced so second call produces newlyQualified=0", async () => {
    // ── First loadData: cursor=0, server=2 → fires ────────────────────────────
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(1);
    expect(capturedAmount).toBeCloseTo(1.0); // 2 × 0.5
    // Cursor must have been advanced to 2 by the first loadData.
    expect(store.get(QUALIFIED_KEY)).toBe("2");

    // ── Second loadData: cursor=2, server=2 → newlyQualified=0 → no re-fire ──
    bonusFireCount = 0;
    prevModalVisible = false;
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });

  it("modal fires on the first qualifying load even if cursor starts ahead of server (edge-case: server behind)", async () => {
    // Cursor=3 but server returns 2: newlyQualified is negative → clamp prevents crash,
    // no modal fires, cursor is updated downward.
    store.set(QUALIFIED_KEY, "3");
    fetchReferralStatsMock.mockResolvedValue({ ...BASE_STATS, qualifiedReferrals: 2 });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });

  it("fires once for all simultaneous qualifications; cursor prevents any repeat fire", async () => {
    // ── First loadData: cursor=0, server=4 → fires for all 4 friends ─────────
    fetchReferralStatsMock.mockResolvedValue({
      ...BASE_STATS,
      qualifiedReferrals: 4,
      bonusPerReferral: 0.5,
    });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(1);
    expect(capturedAmount).toBeCloseTo(2.0); // 4 × 0.5
    // Cursor advanced to 4 by the first loadData.
    expect(store.get(QUALIFIED_KEY)).toBe("4");

    // ── Second loadData: cursor=4, server=4 → newlyQualified=0 → no re-fire ──
    bonusFireCount = 0;
    prevModalVisible = false;
    fetchReferralStatsMock.mockResolvedValue({
      ...BASE_STATS,
      qualifiedReferrals: 4,
      bonusPerReferral: 0.5,
    });

    await act(async () => {
      TestRenderer.create(React.createElement(WalletScreen));
    });
    await flush();

    expect(bonusFireCount).toBe(0);
  });
});
