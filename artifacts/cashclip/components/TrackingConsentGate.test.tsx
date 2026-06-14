// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── In-memory AsyncStorage (legacy / migration layer) ─────────────────────────
// Represents the app container storage that iOS clears on full reinstall.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// ── In-memory expo-secure-store (Keychain on iOS — survives reinstalls) ───────
// Mocking expo-secure-store directly (rather than @/lib/secure-store) means
// the test exercises the real secure-store.ts code path, including its
// Platform.OS branch.  Any accidental AsyncStorage fallback added inside
// secure-store.ts would surface here as a false "key found" in Keychain.
const keychain = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => (keychain.has(k) ? keychain.get(k)! : null),
  setItemAsync: async (k: string, v: string) => { keychain.set(k, v); },
  deleteItemAsync: async (k: string) => { keychain.delete(k); },
}));

// ── ATT mock — tests push statuses into attStatuses to control each call ──────
// getATTStatus shifts one value per call.  Two values are needed for the
// "undetermined → denied" path (initial check + post-dialog re-check).
const attStatuses: string[] = [];
let requestATTCalled = false;

vi.mock("@/lib/att", () => ({
  getATTStatus: vi.fn(async () => attStatuses.shift() ?? "unavailable"),
  requestATT: vi.fn(async () => { requestATTCalled = true; }),
}));

// ── requestAdsConsent spy ─────────────────────────────────────────────────────
vi.mock("@/lib/admob", () => ({
  requestAdsConsent: vi.fn(async () => {}),
}));

// ── React Native stub (Platform.OS = "ios") ───────────────────────────────────
// Platform.OS = "ios" means secure-store.ts takes the native branch:
//   secureGet → ExpoSecureStore.getItemAsync (keychain map above)
//   secureSet → ExpoSecureStore.setItemAsync (keychain map above)
// There is no AsyncStorage fallback on this path.
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
    TouchableOpacity: passthrough("TouchableOpacity"),
    ScrollView: passthrough("ScrollView"),
    ActivityIndicator: passthrough("ActivityIndicator"),
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
    Linking: { openURL: vi.fn(async () => {}) },
    Alert: { alert: vi.fn() },
  };
});

// ── Lightweight stubs for Expo/icon deps ──────────────────────────────────────
vi.mock("@expo/vector-icons", () => {
  const React = require("react");
  const Icon = ({ name }: any) => React.createElement("Icon", { name });
  return { Ionicons: Icon };
});

vi.mock("@/constants/colors", () => ({
  default: { primary: "#00FF00", radius: { lg: 12 } },
}));

// ── Import component under test ───────────────────────────────────────────────
import { Platform } from "react-native";
import { TrackingConsentGate } from "./TrackingConsentGate";

// ── Constants ─────────────────────────────────────────────────────────────────
const DONE_KEY = "consent_done_v3";

// Sentinel child — visible in the tree only when step = "done".
const CHILD = React.createElement("Text" as any, null, "CHILD");

// ── Helpers ───────────────────────────────────────────────────────────────────

function allText(root: TestRenderer.ReactTestInstance): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (typeof n === "string") { out.push(n); return; }
    if (n?.children) n.children.forEach(visit);
  };
  root.children.forEach(visit);
  return out;
}

/** True when the gate has reached step="done" and renders its children. */
function childrenVisible(root: TestRenderer.ReactTestInstance): boolean {
  return allText(root).includes("CHILD");
}

/** True when the disclosures step is rendered. */
function disclosuresVisible(root: TestRenderer.ReactTestInstance): boolean {
  return allText(root).some((t) => t.includes("Your Privacy") || t.includes("Accept & Earn More"));
}

/**
 * Drain the microtask queue enough times for the entire useEffect async chain
 * to complete:
 *   3× AsyncStorage.getItem + getATTStatus (mocked async) + SecureStore ops
 *   = ~6 async ticks; run 30 for safety margin.
 */
async function flush(ticks = 30) {
  await act(async () => {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  });
}

async function renderGate(onConsentDone?: () => void) {
  let tr!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tr = TestRenderer.create(
      React.createElement(TrackingConsentGate, { onConsentDone }, CHILD),
    );
  });
  await flush();
  return tr;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  store.clear();
  keychain.clear();
  attStatuses.length = 0;
  requestATTCalled = false;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Prove secureGet reads from Keychain, not AsyncStorage
// ─────────────────────────────────────────────────────────────────────────────
describe("secure-store.ts — secureGet on native reads Keychain, not AsyncStorage", () => {
  it("returns null when only AsyncStorage has the key (no Keychain fallback)", async () => {
    // Populate AsyncStorage with the key but leave Keychain empty.
    // If secureGet incorrectly fell back to AsyncStorage it would return "1"
    // and skip the explicit migration path in the gate.
    store.set(DONE_KEY, "1");

    // Render the gate — secureGet(DONE_KEY) should return null (Keychain empty),
    // so the gate must fall through to the AsyncStorage migration check.
    await renderGate();

    // Migration must have occurred: key should now be in Keychain.
    expect(keychain.get(DONE_KEY)).toBe("1");
  });

  it("returns the value when only Keychain has the key (normal returning-user path)", async () => {
    keychain.set(DONE_KEY, "1");
    // AsyncStorage is empty — proves reading comes from Keychain only.

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT status = "denied" on startup
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — ATT status "denied" on startup', () => {
  it("calls finish() immediately and renders children without showing disclosures", async () => {
    attStatuses.push("denied");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the DONE_KEY to Keychain (SecureStore) so the gate survives reinstall", async () => {
    attStatuses.push("denied");

    await renderGate();

    expect(keychain.get(DONE_KEY)).toBe("1");
    // Must NOT be written to AsyncStorage (would be lost on reinstall).
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it("does not call requestATT() because iOS would never show the dialog again", async () => {
    attStatuses.push("denied");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT status = "restricted" on startup
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — ATT status "restricted" on startup', () => {
  it("calls finish() immediately and renders children without showing disclosures", async () => {
    attStatuses.push("restricted");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the DONE_KEY to Keychain (SecureStore) so the gate survives reinstall", async () => {
    attStatuses.push("restricted");

    await renderGate();

    expect(keychain.get(DONE_KEY)).toBe("1");
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it("does not call requestATT() because iOS would never show the dialog again", async () => {
    attStatuses.push("restricted");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path: DONE_KEY already present in Keychain (returning user)
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — DONE_KEY already set in Keychain (returning user)", () => {
  it("renders children immediately without showing any consent UI", async () => {
    keychain.set(DONE_KEY, "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not call requestATT() — no ATT dialog for returning users", async () => {
    keychain.set(DONE_KEY, "1");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("leaves DONE_KEY intact in Keychain", async () => {
    keychain.set(DONE_KEY, "1");

    await renderGate();

    expect(keychain.get(DONE_KEY)).toBe("1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OTA upgrade scenario: DONE_KEY written by old build in AsyncStorage
// After an OTA update the Keychain is empty; AsyncStorage still has the key.
// The gate must detect it, promote it to Keychain, and never re-prompt.
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — OTA upgrade: DONE_KEY from old build in AsyncStorage", () => {
  it("passes through without re-prompting when only AsyncStorage has the key", async () => {
    // Simulate old build: wrote consent_done_v3 to AsyncStorage (not Keychain).
    store.set(DONE_KEY, "1");
    // Keychain is empty — secureGet returns null here.

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("promotes the key to Keychain on first launch after the update", async () => {
    store.set(DONE_KEY, "1");

    await renderGate();

    // After migration, Keychain must hold the key so reinstalls pass through.
    expect(keychain.get(DONE_KEY)).toBe("1");
  });

  it("does not call requestATT() when the old AsyncStorage key is present", async () => {
    store.set(DONE_KEY, "1");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("survives reinstall: subsequent launch with AsyncStorage cleared still skips the gate", async () => {
    // Phase 1 — first launch after OTA update: migrate AsyncStorage → Keychain.
    store.set(DONE_KEY, "1");
    await renderGate();
    expect(keychain.get(DONE_KEY)).toBe("1");

    // Phase 2 — simulate reinstall: iOS clears AsyncStorage but Keychain persists.
    store.clear();
    vi.clearAllMocks();
    attStatuses.length = 0;
    requestATTCalled = false;
    // keychain still has the key (Keychain survives reinstall on iOS).

    const onDone = vi.fn();
    const tr2 = await renderGate(onDone);

    expect(childrenVisible(tr2.root)).toBe(true);
    expect(disclosuresVisible(tr2.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path: legacy key consent_fully_done_v2 present → migrate + skip
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — legacy key consent_fully_done_v2 present", () => {
  it("renders children immediately without showing any consent UI", async () => {
    store.set("consent_fully_done_v2", "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("migrates by writing DONE_KEY to Keychain so future reinstalls also skip the gate", async () => {
    store.set("consent_fully_done_v2", "1");

    await renderGate();

    expect(keychain.get(DONE_KEY)).toBe("1");
  });

  it("does not call requestATT() — no ATT dialog needed", async () => {
    store.set("consent_fully_done_v2", "1");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path: legacy key tracking_consent_dismissed_v1 present → migrate + skip
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — legacy key tracking_consent_dismissed_v1 present", () => {
  it("renders children immediately without showing any consent UI", async () => {
    store.set("tracking_consent_dismissed_v1", "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("migrates by writing DONE_KEY to Keychain so future reinstalls also skip the gate", async () => {
    store.set("tracking_consent_dismissed_v1", "1");

    await renderGate();

    expect(keychain.get(DONE_KEY)).toBe("1");
  });

  it("does not call requestATT() — no ATT dialog needed", async () => {
    store.set("tracking_consent_dismissed_v1", "1");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT status = "undetermined" → "denied" after requestATT()
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — ATT "undetermined" → "denied" after requestATT()', () => {
  it("calls requestATT(), then finish() — does not show disclosures", async () => {
    // First getATTStatus call: "undetermined" → triggers requestATT().
    // Second getATTStatus call (after the 600 ms settle delay): "denied" → finish().
    attStatuses.push("undetermined", "denied");

    const onDone = vi.fn();

    // Use fake timers to skip the 600 ms ATT-settle delay without blocking.
    vi.useFakeTimers();

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(
        React.createElement(TrackingConsentGate, { onConsentDone: onDone }, CHILD),
      );
    });

    // Drain microtasks up to the setTimeout pause (storage reads + first getATTStatus).
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    // Advance past the 600 ms ATT-settle delay.
    await act(async () => { vi.advanceTimersByTime(700); });

    // Drain remaining microtasks (second getATTStatus + SecureStore write + finish).
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    vi.useRealTimers();

    expect(requestATTCalled).toBe(true);
    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the DONE_KEY to Keychain after the post-dialog denied status", async () => {
    attStatuses.push("undetermined", "denied");

    vi.useFakeTimers();

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(
        React.createElement(TrackingConsentGate, { onConsentDone: undefined }, CHILD),
      );
    });

    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    vi.useRealTimers();

    void tr;
    expect(keychain.get(DONE_KEY)).toBe("1");
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it("never reaches setStep('disclosures') when the post-dialog status is denied", async () => {
    attStatuses.push("undetermined", "denied");

    vi.useFakeTimers();

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(
        React.createElement(TrackingConsentGate, { onConsentDone: undefined }, CHILD),
      );
    });

    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    vi.useRealTimers();

    expect(disclosuresVisible(tr.root)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform.OS = "android" — non-iOS fast-path
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — Platform.OS = "android" (non-iOS fast-path)', () => {
  beforeEach(() => {
    (Platform as any).OS = "android";
    (Platform as any).select = (o: any) => o.android ?? o.default;
  });

  afterEach(() => {
    (Platform as any).OS = "ios";
    (Platform as any).select = (o: any) => o.ios ?? o.default;
  });

  it("calls finish() immediately, renders children, and never shows the ATT/disclosure UI", async () => {
    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does NOT write DONE_KEY — Android re-uses the Platform.OS guard on every launch instead", async () => {
    await renderGate();

    expect(keychain.has(DONE_KEY)).toBe(false);
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it("never calls requestATT() — Android has no ATT dialog", async () => {
    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("still calls finish() and renders children when DONE_KEY is already in Keychain (subsequent launch)", async () => {
    // On Android, Platform.OS guard fires before any storage read.
    // DONE_KEY presence is irrelevant but must not cause errors.
    keychain.set(DONE_KEY, "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
