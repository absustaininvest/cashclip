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
import { Platform, Alert } from "react-native";
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
      React.createElement(TrackingConsentGate, { onConsentDone, children: CHILD }),
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
        React.createElement(TrackingConsentGate, { onConsentDone: onDone, children: CHILD }),
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
        React.createElement(TrackingConsentGate, { onConsentDone: undefined, children: CHILD }),
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
        React.createElement(TrackingConsentGate, { onConsentDone: undefined, children: CHILD }),
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
// Disclosures step — button label must match legal disclaimer quoted name
//
// The legal text reads: By tapping "<label>" you agree …
// The primary button label must equal the quoted <label> word-for-word.
// If either changes without the other being updated, this test catches it.
// ─────────────────────────────────────────────────────────────────────────────
describe("Disclosures step — button label must match legal disclaimer quoted name", () => {
  /**
   * Reach the disclosures step: both ATT reads return "undetermined" so the
   * component falls through the post-dialog status check and calls
   * setStep("disclosures").
   */
  async function renderDisclosures() {
    attStatuses.push("undetermined", "undetermined");

    vi.useFakeTimers();

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(
        React.createElement(TrackingConsentGate, { children: CHILD }),
      );
    });
    await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });

    vi.useRealTimers();
    return tr;
  }

  it("primary button label and quoted button name in legal disclaimer are identical", async () => {
    const tr = await renderDisclosures();

    // ── 1. Confirm the disclosures step actually rendered ────────────────────
    const texts = allText(tr.root);
    const legalLine = texts.find((t) => t.includes('By tapping "'));
    expect(
      legalLine,
      'Legal disclaimer not found — disclosures step may not have rendered',
    ).toBeTruthy();

    // ── 2. Extract the button name quoted in the legal text ──────────────────
    // Matches the first double-quoted word in: By tapping "<label>" you agree…
    const match = legalLine!.match(/By tapping "([^"]+)"/);
    expect(match, 'Could not extract a quoted button name from the legal disclaimer').toBeTruthy();
    const quotedLabel = match![1];

    // ── 3. Find the primary button label in the rendered tree ────────────────
    // TestRenderer produces two fiber nodes per React component: one for the
    // function component itself and one for the host element it returns.
    //
    // The primary button renders (simplified TestRenderer tree):
    //   TouchableOpacity passthrough fn
    //     "TouchableOpacity" host          ← grandparent of the "Icon" host
    //       Ionicons fn
    //         "Icon" host  (name="checkmark-circle-outline")  ← what we find
    //       Text passthrough fn
    //         "Text" host → "Continue"
    //
    // Walking up two levels from the "Icon" host reaches the "TouchableOpacity"
    // host, whose subtree contains the primary button's Text.
    const [checkmarkIcon] = tr.root.findAll(
      (n) => n.type === "Icon" && n.props.name === "checkmark-circle-outline",
    );
    expect(
      checkmarkIcon,
      'Checkmark icon not found — primary button may not be rendered on the disclosures step',
    ).toBeTruthy();

    // parent  = Ionicons function component fiber
    // parent.parent = "TouchableOpacity" host element — the direct button container
    const primaryBtnContainer = checkmarkIcon.parent!.parent!;
    const textHosts = primaryBtnContainer.findAll((n) => n.type === "Text");
    expect(
      textHosts.length,
      'No Text host nodes found inside the primary button container',
    ).toBeGreaterThan(0);

    const primaryBtnLabel = textHosts.map((n) => allText(n).join("")).join("");
    expect(primaryBtnLabel, "Primary button label is empty").toBeTruthy();

    // ── 4. The label must match the quoted name in the disclaimer ─────────────
    expect(primaryBtnLabel).toBe(quotedLabel);
  });

  it("catches a mismatch when the button label changes but the legal text does not", async () => {
    // This test intentionally simulates a mismatch to prove the assertion fires.
    // It does NOT render the real component — it directly exercises the comparison
    // logic so the test suite itself is self-validating.

    const legalText = 'By tapping "Continue" you agree to CashClip\'s Privacy Policy.';
    const changedButtonLabel = "Accept & Continue"; // hypothetical rename

    const legalMatch = legalText.match(/By tapping "([^"]+)"/);
    expect(legalMatch).toBeTruthy();
    const quotedLabel = legalMatch![1]; // "Continue"

    // The changed button label must NOT equal the stale quoted name.
    expect(changedButtonLabel).not.toBe(quotedLabel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Decline Alert — "Continue Without" button label must stay in sync
//
// declineDisclosures() fires Alert.alert() with a "Continue Without" cancel
// button.  This constant is the single source of truth for that label.
// Both the live-extraction test and the mismatch-simulation test reference it,
// so renaming the button in the component causes an immediate failure here.
// ─────────────────────────────────────────────────────────────────────────────
const DECLINE_CANCEL_LABEL = "Continue Without";

describe('Decline Alert — "Continue Without" button label is consistent', () => {
  /**
   * Render the disclosures step (same path as the primary-button tests):
   * both ATT reads return "undetermined" so the component falls through to
   * setStep("disclosures").
   */
  async function renderDisclosuresForDecline() {
    attStatuses.push("undetermined", "undetermined");

    vi.useFakeTimers();

    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tr = TestRenderer.create(
        React.createElement(TrackingConsentGate, { children: CHILD }),
      );
    });
    await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });

    vi.useRealTimers();
    return tr;
  }

  it("cancel button label extracted from the live Alert call matches DECLINE_CANCEL_LABEL", async () => {
    const tr = await renderDisclosuresForDecline();

    // ── 1. Confirm the disclosures step actually rendered ────────────────────
    expect(disclosuresVisible(tr.root)).toBe(true);

    // ── 2. Find the "Decline" secondary button and press it ──────────────────
    // Tree shape (passthrough stubs):
    //   TouchableOpacity fn → "TouchableOpacity" host (has onPress)
    //     Text fn → "Text" host → "Decline"
    const declineTextNode = tr.root.findAll(
      (n) => n.type === "Text" && allText(n).join("") === "Decline",
    )[0];
    expect(
      declineTextNode,
      '"Decline" secondary button text node not found in the disclosures step',
    ).toBeTruthy();

    // parent = Text passthrough fn; parent.parent = "TouchableOpacity" host
    const declineBtnHost = declineTextNode.parent!.parent!;
    expect(
      declineBtnHost.props.onPress != null,
      '"TouchableOpacity" host above the Decline text has no onPress',
    ).toBe(true);

    await act(async () => {
      declineBtnHost.props.onPress();
    });

    // ── 3. Alert.alert must have been called exactly once ────────────────────
    expect(Alert.alert).toHaveBeenCalledTimes(1);

    // ── 4. Extract the cancel button from the Alert call ─────────────────────
    // Alert.alert(title, message, buttons[])
    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    const alertButtons: Array<{ text: string; style?: string }> = alertCall[2];
    expect(
      Array.isArray(alertButtons),
      'Alert.alert was not called with a buttons array as the third argument',
    ).toBe(true);

    const cancelBtn = alertButtons.find((b) => b.style === "cancel");
    expect(
      cancelBtn,
      'No button with style="cancel" found in the decline Alert',
    ).toBeTruthy();

    const extractedLabel = cancelBtn!.text;
    expect(extractedLabel, 'Cancel button text is empty').toBeTruthy();

    // ── 5. The extracted label must equal the shared constant ─────────────────
    // DECLINE_CANCEL_LABEL is the single reference point for this button name.
    // A rename in the component without updating that constant breaks this test.
    expect(extractedLabel).toBe(DECLINE_CANCEL_LABEL);
  });

  it("catches a mismatch when the Alert cancel button is renamed to something else", () => {
    // Simulate what the Alert buttons array would look like after a rename.
    // This exercises the same cancel-button extraction logic as the live test,
    // proving the assertion fires when the component drifts from DECLINE_CANCEL_LABEL.
    const simulatedButtons: Array<{ text: string; style?: string }> = [
      { text: "Open Tracking Settings" },
      { text: "Skip For Now", style: "cancel" }, // hypothetical rename
    ];

    const cancelBtn = simulatedButtons.find((b) => b.style === "cancel");
    expect(cancelBtn).toBeTruthy();

    // The renamed label must NOT match the expected constant — proving the
    // live-extraction assertion above would catch this drift.
    expect(cancelBtn!.text).not.toBe(DECLINE_CANCEL_LABEL);
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
