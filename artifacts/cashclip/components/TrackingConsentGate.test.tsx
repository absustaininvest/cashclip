// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── In-memory AsyncStorage ────────────────────────────────────────────────────
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
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
 *   3× AsyncStorage.getItem + getATTStatus (mocked async) + AsyncStorage.setItem
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
  attStatuses.length = 0;
  requestATTCalled = false;
  vi.clearAllMocks();
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

  it("writes the DONE_KEY to AsyncStorage so the gate never re-appears on relaunch", async () => {
    attStatuses.push("denied");

    await renderGate();

    expect(store.get(DONE_KEY)).toBe("1");
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

  it("writes the DONE_KEY to AsyncStorage so the gate never re-appears on relaunch", async () => {
    attStatuses.push("restricted");

    await renderGate();

    expect(store.get(DONE_KEY)).toBe("1");
  });

  it("does not call requestATT() because iOS would never show the dialog again", async () => {
    attStatuses.push("restricted");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path: DONE_KEY already present (returning user)
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — DONE_KEY already set (returning user)", () => {
  it("renders children immediately without showing any consent UI", async () => {
    store.set(DONE_KEY, "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not call requestATT() — no ATT dialog for returning users", async () => {
    store.set(DONE_KEY, "1");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("leaves DONE_KEY intact in AsyncStorage", async () => {
    store.set(DONE_KEY, "1");

    await renderGate();

    expect(store.get(DONE_KEY)).toBe("1");
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

  it("migrates by writing DONE_KEY so future launches skip the gate too", async () => {
    store.set("consent_fully_done_v2", "1");

    await renderGate();

    expect(store.get(DONE_KEY)).toBe("1");
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

  it("migrates by writing DONE_KEY so future launches skip the gate too", async () => {
    store.set("tracking_consent_dismissed_v1", "1");

    await renderGate();

    expect(store.get(DONE_KEY)).toBe("1");
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

    // Drain microtasks up to the setTimeout pause (AsyncStorage reads + first getATTStatus).
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    // Advance past the 600 ms ATT-settle delay.
    await act(async () => { vi.advanceTimersByTime(700); });

    // Drain remaining microtasks (second getATTStatus + AsyncStorage.setItem + finish).
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    vi.useRealTimers();

    expect(requestATTCalled).toBe(true);
    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the DONE_KEY after the post-dialog denied status so gate never re-appears", async () => {
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
    expect(store.get(DONE_KEY)).toBe("1");
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
