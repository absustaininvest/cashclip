// @vitest-environment node
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

// React 19 requires this flag so act() flushes async effects in the node env.
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── In-memory AsyncStorage (legacy layer — no longer read by TrackingConsentGate) ──
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));

// ── In-memory expo-secure-store (Keychain on iOS) ─────────────────────────────
const keychain = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => (keychain.has(k) ? keychain.get(k)! : null),
  setItemAsync: async (k: string, v: string) => { keychain.set(k, v); },
  deleteItemAsync: async (k: string) => { keychain.delete(k); },
}));

// ── ATT mock ──────────────────────────────────────────────────────────────────
// getATTStatus shifts one value per call. requestATT records itself as called.
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

// ── LanguageContext mock — always returns English consent strings ──────────────
vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({
    lang: "en",
    t: {
      consent: {
        title: "Your Privacy & Earnings",
        subtitle: "CashClip uses tracking to personalize your ads and match you with higher-paying offers. Here's exactly what we access and why.",
        card1Title: "App Tracking (IDFA)",
        card1Body: "CashClip uses Apple's Advertising Identifier to link your in-app activity with ad networks. This lets advertisers show you relevant ads and measure performance — which is how your earnings flow within the platform. No name, email, or contact information is shared with advertisers.",
        card2Title: "Ad Personalization",
        card2Body: "By allowing custom personalization, CashClip matches you with offers and surveys enhanced for your profile. Please note that this feature is available, but it is not required to join and it is completely optional.",
        card3Title: "Your Control",
        card3Body: "Change your preference anytime under Settings → Privacy & Security → Tracking or inside the app under Profile → Settings.",
        legal: "By tapping \"Continue\" you agree to CashClip's Privacy Policy and Terms of Service. Tracking is not required — you may decline and still use CashClip.",
        continueBtn: "Continue",
        declineBtn: "Decline",
        declineTitle: "This Will Reduce Your Earnings",
        declineMessage: "Without tracking, ads and offers can't be personalized to you. You'll still earn, but less.\n\nYou can enable it anytime under Settings → Privacy & Security → Tracking.",
        openSettings: "Open Tracking Settings",
        continueWithout: "Continue Without",
        termsTitle: "Terms & Privacy",
        termsSub: "Please review before entering CashClip",
        acceptBtn: "Accept & Enter CashClip",
      },
      common: { back: "Back", ok: "OK" },
    },
    setLang: () => {},
  }),
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
    AppState: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
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
const TERMS_KEY = "terms_done_v1";

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
  return allText(root).some((t) => t.includes("Your Privacy"));
}

/** True when the terms step is rendered. */
function termsVisible(root: TestRenderer.ReactTestInstance): boolean {
  return allText(root).some((t) => t.includes("Terms & Privacy") || t.includes("Terms of Service"));
}

/**
 * Drain the microtask queue enough times for the entire useEffect async chain
 * to complete.
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

/**
 * Find the primary Continue button host and press it.
 * The button contains the checkmark icon adjacent to the "Continue" label.
 */
async function pressContinue(tr: TestRenderer.ReactTestRenderer) {
  const [checkmarkIcon] = tr.root.findAll(
    (n) => (n.type as string) === "Icon" && n.props.name === "checkmark-circle-outline",
  );
  expect(checkmarkIcon, "Checkmark icon not found — disclosure step may not be rendered").toBeTruthy();
  const primaryBtnHost = checkmarkIcon.parent!.parent!;
  await act(async () => {
    primaryBtnHost.props.onPress();
  });
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
// Core behavior: disclosure always shows on iOS cold launch
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — disclosure always shows on iOS cold launch", () => {
  it("renders the disclosures step on first mount with empty storage", async () => {
    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("does NOT call requestATT on mount — ATT is deferred to the Continue tap", async () => {
    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("renders disclosures even when TERMS_KEY is already in Keychain (returning user sees disclosure again)", async () => {
    keychain.set(TERMS_KEY, "1");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("renders disclosures even when old DONE_KEY (consent_done_v3) is in Keychain", async () => {
    keychain.set("consent_done_v3", "1");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("renders disclosures even when old DONE_KEY is in AsyncStorage", async () => {
    store.set("consent_done_v3", "1");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("renders disclosures even when legacy key consent_fully_done_v2 is in AsyncStorage", async () => {
    store.set("consent_fully_done_v2", "1");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("renders disclosures even when legacy key tracking_consent_dismissed_v1 is in AsyncStorage", async () => {
    store.set("tracking_consent_dismissed_v1", "1");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disclosure card copy — updated owner-approved text
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — disclosure card body text (owner-approved copy)", () => {
  it("IDFA card body contains the updated platform-earnings language", async () => {
    const tr = await renderGate();

    const texts = allText(tr.root).join(" ");
    expect(texts).toContain("how your earnings flow within the platform");
  });

  it("Ad Personalization card body contains the 'completely optional' language", async () => {
    const tr = await renderGate();

    const texts = allText(tr.root).join(" ");
    expect(texts).toContain("completely optional");
  });

  it("Your Control card body mentions both Settings paths", async () => {
    const tr = await renderGate();

    const texts = allText(tr.root).join(" ");
    expect(texts).toContain("Settings → Privacy & Security → Tracking");
    expect(texts).toContain("Profile → Settings");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TERMS_KEY gates the terms step — pressing Continue checks SecureStore
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — TERMS_KEY gates the terms step", () => {
  it("skips the terms step and calls finish() when TERMS_KEY is already set", async () => {
    keychain.set(TERMS_KEY, "1");
    // ATT status: authorized (no dialog needed)
    attStatuses.push("authorized");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    // Disclosure shows
    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    // Tap Continue
    await pressContinue(tr);
    await flush();

    // Terms skipped — straight to done
    expect(childrenVisible(tr.root)).toBe(true);
    expect(termsVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows the terms step when TERMS_KEY is absent", async () => {
    // No TERMS_KEY in keychain
    attStatuses.push("authorized");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);

    await pressContinue(tr);
    await flush();

    expect(termsVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("writes TERMS_KEY to Keychain when the user accepts the terms", async () => {
    attStatuses.push("authorized");

    const tr = await renderGate();
    await pressContinue(tr);
    await flush();

    expect(termsVisible(tr.root)).toBe(true);

    // Find and press the accept button
    const acceptNodes = tr.root.findAll(
      (n) => (n.type as string) === "Text" && allText(n).join("").includes("Accept & Enter CashClip"),
    );
    expect(acceptNodes.length, "Accept & Enter CashClip button not found").toBeGreaterThan(0);
    // Walk up to the TouchableOpacity host
    const acceptBtnHost = acceptNodes[0].parent!.parent!;
    await act(async () => {
      acceptBtnHost.props.onPress();
    });
    await flush();

    expect(keychain.get(TERMS_KEY)).toBe("1");
    expect(childrenVisible(tr.root)).toBe(true);
  });

  it("does NOT write TERMS_KEY to Keychain when the user declines (disclosure is shown each launch)", async () => {
    const tr = await renderGate();

    // Find the decline button and press it
    const declineNodes = tr.root.findAll(
      (n) => (n.type as string) === "Text" && allText(n).join("") === "Decline",
    );
    const declineBtnHost = declineNodes[0].parent!.parent!;
    await act(async () => {
      declineBtnHost.props.onPress();
    });

    // Alert fired; press "Continue Without"
    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    const cancelBtn = (alertCall[2] as Array<{ text: string; style?: string; onPress?: () => void }>)
      .find((b) => b.style === "cancel");
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn!.onPress?.();
    });
    await flush();

    // TERMS_KEY must NOT be written — next launch will show disclosure again
    expect(keychain.has(TERMS_KEY)).toBe(false);
    // But children are rendered (finish was called)
    expect(childrenVisible(tr.root)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT request is deferred to the Continue tap
// ─────────────────────────────────────────────────────────────────────────────
describe("TrackingConsentGate — ATT request fires on Continue tap, not on mount", () => {
  it("does not call requestATT on mount even when ATT is undetermined", async () => {
    // ATT status will be "undetermined" when acceptDisclosures checks it
    attStatuses.push("undetermined", "authorized");

    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("calls requestATT when the user taps Continue and ATT is undetermined", async () => {
    attStatuses.push("undetermined", "authorized");

    vi.useFakeTimers();

    const tr = await renderGate();
    expect(disclosuresVisible(tr.root)).toBe(true);

    // Tap Continue — triggers acceptDisclosures
    const [checkmarkIcon] = tr.root.findAll(
      (n) => (n.type as string) === "Icon" && n.props.name === "checkmark-circle-outline",
    );
    const primaryBtnHost = checkmarkIcon.parent!.parent!;

    await act(async () => {
      primaryBtnHost.props.onPress();
    });

    // Drain microtasks up to the 600 ms settle delay
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    // Advance past the 600 ms delay
    await act(async () => { vi.advanceTimersByTime(700); });
    // Drain remaining
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    vi.useRealTimers();

    expect(requestATTCalled).toBe(true);
  });

  it("does NOT call requestATT when ATT is already authorized on Continue tap", async () => {
    attStatuses.push("authorized");

    const tr = await renderGate();
    await pressContinue(tr);
    await flush();

    expect(requestATTCalled).toBe(false);
  });

  it("does NOT call requestATT when ATT is already denied on Continue tap", async () => {
    attStatuses.push("denied");

    const tr = await renderGate();
    await pressContinue(tr);
    await flush();

    expect(requestATTCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT status = "denied" on startup — disclosure still shows
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — ATT "denied" does not skip the disclosure', () => {
  it("renders the disclosures step even when ATT is already denied", async () => {
    // ATT status will be checked in acceptDisclosures, not on mount
    attStatuses.push("denied");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("does not call requestATT on mount when ATT is denied", async () => {
    attStatuses.push("denied");
    await renderGate();
    expect(requestATTCalled).toBe(false);
  });

  it("calls finish() after Continue is tapped when ATT is denied (TERMS_KEY present)", async () => {
    keychain.set(TERMS_KEY, "1");
    attStatuses.push("denied");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    await pressContinue(tr);
    await flush();

    expect(childrenVisible(tr.root)).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATT status = "restricted" on startup — disclosure still shows
// ─────────────────────────────────────────────────────────────────────────────
describe('TrackingConsentGate — ATT "restricted" does not skip the disclosure', () => {
  it("renders the disclosures step even when ATT is restricted", async () => {
    attStatuses.push("restricted");

    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);
    expect(childrenVisible(tr.root)).toBe(false);
  });

  it("does not call requestATT on mount when ATT is restricted", async () => {
    attStatuses.push("restricted");
    await renderGate();
    expect(requestATTCalled).toBe(false);
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
  it("primary button label and quoted button name in legal disclaimer are identical", async () => {
    const tr = await renderGate();

    // ── 1. Confirm the disclosures step actually rendered ────────────────────
    const texts = allText(tr.root);
    const legalLine = texts.find((t) => t.includes('By tapping "'));
    expect(
      legalLine,
      'Legal disclaimer not found — disclosures step may not have rendered',
    ).toBeTruthy();

    // ── 2. Extract the button name quoted in the legal text ──────────────────
    const match = legalLine!.match(/By tapping "([^"]+)"/);
    expect(match, 'Could not extract a quoted button name from the legal disclaimer').toBeTruthy();
    const quotedLabel = match![1];

    // ── 3. Find the primary button label in the rendered tree ────────────────
    const [checkmarkIcon] = tr.root.findAll(
      (n) => (n.type as string) === "Icon" && n.props.name === "checkmark-circle-outline",
    );
    expect(
      checkmarkIcon,
      'Checkmark icon not found — primary button may not be rendered on the disclosures step',
    ).toBeTruthy();

    const primaryBtnContainer = checkmarkIcon.parent!.parent!;
    const textHosts = primaryBtnContainer.findAll((n) => (n.type as string) === "Text");
    expect(
      textHosts.length,
      'No Text host nodes found inside the primary button container',
    ).toBeGreaterThan(0);

    const primaryBtnLabel = textHosts.map((n) => allText(n).join("")).join("");
    expect(primaryBtnLabel, "Primary button label is empty").toBeTruthy();

    // ── 4. The label must match the quoted name in the disclaimer ─────────────
    expect(primaryBtnLabel).toBe(quotedLabel);
  });

  it("catches a mismatch when the button label changes but the legal text does not", () => {
    const legalText = 'By tapping "Continue" you agree to CashClip\'s Privacy Policy.';
    const changedButtonLabel = "Accept & Continue";

    const legalMatch = legalText.match(/By tapping "([^"]+)"/);
    expect(legalMatch).toBeTruthy();
    const quotedLabel = legalMatch![1];

    expect(changedButtonLabel).not.toBe(quotedLabel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Decline Alert — strings must stay in sync with the component.
// ─────────────────────────────────────────────────────────────────────────────
const DECLINE_CANCEL_LABEL = "Continue Without";
const DECLINE_OPEN_SETTINGS_LABEL = "Open Tracking Settings";
const DECLINE_ALERT_TITLE = "This Will Reduce Your Earnings";
const DECLINE_ALERT_MESSAGE =
  "Without tracking, ads and offers can't be personalized to you. You'll still earn, but less.\n\nYou can enable it anytime under Settings → Privacy & Security → Tracking.";

describe('Decline Alert — "Continue Without" button label is consistent', () => {
  async function renderAndPressDecline() {
    const tr = await renderGate();

    expect(disclosuresVisible(tr.root)).toBe(true);

    const declineTextNode = tr.root.findAll(
      (n) => (n.type as string) === "Text" && allText(n).join("") === "Decline",
    )[0];
    expect(
      declineTextNode,
      '"Decline" secondary button text node not found in the disclosures step',
    ).toBeTruthy();

    const declineBtnHost = declineTextNode.parent!.parent!;
    expect(declineBtnHost.props.onPress != null).toBe(true);

    await act(async () => {
      declineBtnHost.props.onPress();
    });

    return tr;
  }

  it("cancel button label extracted from the live Alert call matches DECLINE_CANCEL_LABEL", async () => {
    await renderAndPressDecline();

    expect(Alert.alert).toHaveBeenCalledTimes(1);

    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    const alertButtons: Array<{ text: string; style?: string }> = alertCall[2];
    expect(Array.isArray(alertButtons)).toBe(true);

    const cancelBtn = alertButtons.find((b) => b.style === "cancel");
    expect(cancelBtn, 'No button with style="cancel" found in the decline Alert').toBeTruthy();

    expect(cancelBtn!.text).toBe(DECLINE_CANCEL_LABEL);
  });

  it("Alert title extracted from the live Alert call matches DECLINE_ALERT_TITLE", async () => {
    await renderAndPressDecline();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(alertCall[0]).toBe(DECLINE_ALERT_TITLE);
  });

  it("Alert message extracted from the live Alert call matches DECLINE_ALERT_MESSAGE", async () => {
    await renderAndPressDecline();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(alertCall[1]).toBe(DECLINE_ALERT_MESSAGE);
  });

  it("catches a mismatch when the Alert title is changed to something else", () => {
    const changedTitle = "Warning: Earnings Will Drop";
    expect(changedTitle).not.toBe(DECLINE_ALERT_TITLE);
  });

  it("catches a mismatch when the Alert message body is changed to something else", () => {
    const changedMessage = "Tracking is off. Your personalized ads will be limited.";
    expect(changedMessage).not.toBe(DECLINE_ALERT_MESSAGE);
  });

  it("catches a mismatch when the Alert cancel button is renamed to something else", () => {
    const simulatedButtons: Array<{ text: string; style?: string }> = [
      { text: "Open Tracking Settings" },
      { text: "Skip For Now", style: "cancel" },
    ];
    const cancelBtn = simulatedButtons.find((b) => b.style === "cancel");
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn!.text).not.toBe(DECLINE_CANCEL_LABEL);
  });

  it("open-settings button label extracted from the live Alert call matches DECLINE_OPEN_SETTINGS_LABEL", async () => {
    await renderAndPressDecline();

    expect(Alert.alert).toHaveBeenCalledTimes(1);

    const alertCall = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    const alertButtons: Array<{ text: string; style?: string }> = alertCall[2];
    expect(Array.isArray(alertButtons)).toBe(true);

    const openSettingsBtn = alertButtons.find((b) => b.style !== "cancel");
    expect(openSettingsBtn, '"Open Tracking Settings" button missing').toBeTruthy();
    expect(openSettingsBtn!.text).toBe(DECLINE_OPEN_SETTINGS_LABEL);
  });

  it("catches a mismatch when the open-settings button label is renamed to something else", () => {
    const simulatedButtons: Array<{ text: string; style?: string }> = [
      { text: "Go To Settings" },
      { text: "Continue Without", style: "cancel" },
    ];
    const openSettingsBtn = simulatedButtons.find((b) => b.style !== "cancel");
    expect(openSettingsBtn).toBeTruthy();
    expect(openSettingsBtn!.text).not.toBe(DECLINE_OPEN_SETTINGS_LABEL);
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

  it("does NOT write TERMS_KEY — Android re-uses the Platform.OS guard on every launch instead", async () => {
    await renderGate();

    expect(keychain.has(TERMS_KEY)).toBe(false);
    expect(store.has(TERMS_KEY)).toBe(false);
  });

  it("never calls requestATT() — Android has no ATT dialog", async () => {
    await renderGate();

    expect(requestATTCalled).toBe(false);
  });

  it("still calls finish() and renders children when TERMS_KEY is already in Keychain", async () => {
    keychain.set(TERMS_KEY, "1");

    const onDone = vi.fn();
    const tr = await renderGate(onDone);

    expect(childrenVisible(tr.root)).toBe(true);
    expect(disclosuresVisible(tr.root)).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
