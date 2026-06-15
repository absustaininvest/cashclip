// @vitest-environment node
/**
 * Fill-callback pre-auth guard tests for _layout.tsx
 *
 * The onConsentDone handler in RootLayout registers a fill-change callback via
 * setFillChangeCallback. Inside that callback, secureGet is called to read the
 * JWT. If no token is present, apiRequestSafe must NOT be called. If a token is
 * present, apiRequestSafe must be called with the correct payload.
 *
 * Strategy:
 *   1. Mock setFillChangeCallback to capture whatever callback _layout registers.
 *   2. Mock TrackingConsentGate to immediately invoke its onConsentDone prop,
 *      which is the trigger that registers the fill callback.
 *   3. Render RootLayout (the exported default) with all heavy deps stubbed out.
 *   4. Invoke the captured callback under two secureGet scenarios and assert.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TestRenderer, { act } from "react-test-renderer";

(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── Key spies — must be declared before vi.mock() factories run ───────────────
const mockSecureGet = vi.fn<(key: string) => Promise<string | null>>();
const mockApiRequestSafe = vi.fn<(...args: any[]) => Promise<any>>();
let capturedFillCb: ((fillAvailable: boolean) => void) | null = null;
let capturedRevokeCb: (() => void) | null = null;

// ── @/lib/secure-store ────────────────────────────────────────────────────────
vi.mock("@/lib/secure-store", () => ({
  secureGet: (key: string) => mockSecureGet(key),
  secureSet: vi.fn(),
  secureDelete: vi.fn(),
  secureMultiDelete: vi.fn(),
}));

// ── @/lib/query-client ────────────────────────────────────────────────────────
vi.mock("@/lib/query-client", () => ({
  apiRequestSafe: (method: string, url: string, body?: unknown) => mockApiRequestSafe(method, url, body),
  apiRequest: vi.fn(),
  queryClient: {
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
}));

// ── @/lib/admob — captures the fill callback on setFillChangeCallback ─────────
vi.mock("@/lib/admob", () => ({
  setFillChangeCallback: vi.fn((cb: any) => { capturedFillCb = cb; }),
  initializeAdMob: vi.fn(async () => false),
  preloadRewardedAd: vi.fn(),
  requestAdsConsent: vi.fn(async () => {}),
  isAdMobReady: vi.fn(() => false),
  showRewardedAd: vi.fn(async () => null),
  isRewardedAdPreloaded: vi.fn(() => false),
}));

// ── TrackingConsentGate — fires onConsentDone immediately; captures revoke cb ─
vi.mock("@/components/TrackingConsentGate", () => ({
  TrackingConsentGate: ({ onConsentDone, onConsentRevoked, children }: any) => {
    capturedRevokeCb = onConsentRevoked ?? null;
    React.useEffect(() => {
      onConsentDone?.();
    }, []);
    return React.createElement(React.Fragment, null, children);
  },
}));

// ── expo-router ───────────────────────────────────────────────────────────────
vi.mock("expo-router", () => {
  const React = require("react");
  const Screen = () => null;
  const Stack = Object.assign(
    ({ children }: any) => React.createElement(React.Fragment, null, children),
    { Screen },
  );
  return {
    Stack,
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useSegments: () => [],
    usePathname: () => "/",
  };
});

// ── expo-splash-screen ────────────────────────────────────────────────────────
vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn(),
  hideAsync: vi.fn(async () => {}),
}));

// ── @expo-google-fonts/outfit — fonts always ready ───────────────────────────
vi.mock("@expo-google-fonts/outfit", () => ({
  useFonts: () => [true, null],
  Outfit_400Regular: "Outfit_400Regular",
  Outfit_600SemiBold: "Outfit_600SemiBold",
  Outfit_700Bold: "Outfit_700Bold",
}));

// ── react-native-gesture-handler ──────────────────────────────────────────────
vi.mock("react-native-gesture-handler", () => {
  const React = require("react");
  return {
    GestureHandlerRootView: ({ children, style }: any) =>
      React.createElement("GestureHandlerRootView", { style }, children),
  };
});

// ── expo-status-bar ───────────────────────────────────────────────────────────
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));

// ── Pass-through layout wrappers ──────────────────────────────────────────────
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
}));
vi.mock("@/components/ForceUpdateGate", () => ({
  ForceUpdateGate: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
}));
vi.mock("@/components/OtaUpdateGate", () => ({
  OtaUpdateGate: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
}));

// ── Context providers — simple pass-throughs ──────────────────────────────────
vi.mock("@/lib/LanguageContext", () => ({
  LanguageProvider: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
  useLanguage: () => ({
    t: { common: { back: "Back" }, referral: { referralProgram: "Referral" } },
    language: "en",
    setLanguage: vi.fn(),
  }),
}));
vi.mock("@/lib/AuthContext", () => ({
  AuthProvider: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
  useAuth: () => ({ user: null, isLoading: false }),
}));
vi.mock("@/lib/CelebrationContext", () => ({
  CelebrationProvider: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
}));

// ── @tanstack/react-query ─────────────────────────────────────────────────────
vi.mock("@tanstack/react-query", () => ({
  QueryClientProvider: ({ children }: any) =>
    require("react").createElement(require("react").Fragment, null, children),
}));

// ── Ad analytics ─────────────────────────────────────────────────────────────
vi.mock("@/lib/ad-analytics", () => ({
  startAdAnalyticsFlush: vi.fn(),
  stopAdAnalyticsFlush: vi.fn(),
}));

// ── Earn client ───────────────────────────────────────────────────────────────
vi.mock("@/lib/earn-client", () => ({
  hydrateDisplayRate: vi.fn(),
  fetchConversionRate: vi.fn(),
}));

// ── Streak notifications ──────────────────────────────────────────────────────
vi.mock("@/lib/streak-notifications", () => ({
  configureNotificationHandler: vi.fn(),
  requestNotificationPermission: vi.fn(async () => {}),
}));

// ── Telemetry — all fail-open, never affect test outcome ──────────────────────
vi.mock("@logrocket/react-native", () => ({
  default: { init: vi.fn() },
}));
vi.mock("expo-updates", () => ({
  isEmbeddedLaunch: true,
  updateId: null,
  channel: "production",
}));
vi.mock("@sentry/react-native", () => ({
  init: vi.fn(),
  // wrap() must return the component itself so the default export is renderable
  wrap: (component: any) => component,
}));
vi.mock("vexo-analytics", () => ({ vexo: vi.fn() }));

// ── react-native ──────────────────────────────────────────────────────────────
vi.mock("react-native", () => {
  const React = require("react");
  const passthrough = (name: string) =>
    ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    View: passthrough("View"),
    ActivityIndicator: () => null,
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      hairlineWidth: 1,
    },
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
  };
});

// ── @/constants/colors ────────────────────────────────────────────────────────
vi.mock("@/constants/colors", () => ({
  default: { primary: "#00E676", background: "#0A0A0F" },
}));

// ── Import the layout AFTER all mocks are registered ─────────────────────────
import RootLayout from "./_layout";
// setFillChangeCallback is already mocked above; this import gives access to
// its spy so we can assert call arguments (e.g. called with null on revocation).
import { setFillChangeCallback } from "@/lib/admob";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAndCaptureFillCb(): Promise<void> {
  capturedFillCb = null;
  await act(async () => {
    TestRenderer.create(React.createElement(RootLayout));
  });
  await flush();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fill callback pre-auth guard (_layout.tsx)", () => {
  beforeEach(() => {
    capturedFillCb = null;
    capturedRevokeCb = null;
    mockSecureGet.mockReset();
    mockApiRequestSafe.mockReset();
    mockApiRequestSafe.mockResolvedValue({ ok: true });
    vi.mocked(setFillChangeCallback).mockClear();
  });

  afterEach(() => {
    capturedFillCb = null;
    capturedRevokeCb = null;
  });

  it("does NOT call apiRequestSafe when secureGet returns null (no token)", async () => {
    mockSecureGet.mockResolvedValue(null);

    await renderAndCaptureFillCb();

    expect(capturedFillCb).toBeTruthy();

    // Fire the fill callback — no token means the guard should bail early
    await act(async () => {
      capturedFillCb!(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiRequestSafe).not.toHaveBeenCalled();
  });

  it("calls apiRequestSafe with the correct payload when a token is present", async () => {
    mockSecureGet.mockResolvedValue("eyJhbGciOiJIUzI1NiJ9.test.token");

    await renderAndCaptureFillCb();

    expect(capturedFillCb).toBeTruthy();

    // Fire the fill callback with fillAvailable = true
    await act(async () => {
      capturedFillCb!(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiRequestSafe).toHaveBeenCalledOnce();
    expect(mockApiRequestSafe).toHaveBeenCalledWith(
      "POST",
      "/api/earn/ad-fill",
      { rewardedFillAvailable: true },
    );
  });

  it("passes fillAvailable=false correctly when fill drops", async () => {
    mockSecureGet.mockResolvedValue("eyJhbGciOiJIUzI1NiJ9.test.token");

    await renderAndCaptureFillCb();

    await act(async () => {
      capturedFillCb!(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiRequestSafe).toHaveBeenCalledOnce();
    expect(mockApiRequestSafe).toHaveBeenCalledWith(
      "POST",
      "/api/earn/ad-fill",
      { rewardedFillAvailable: false },
    );
  });

  it("calls setFillChangeCallback(null) when consent is revoked after onConsentDone", async () => {
    mockSecureGet.mockResolvedValue(null);

    await renderAndCaptureFillCb();

    // onConsentDone fires on mount and registers a real fill callback
    expect(capturedFillCb).toBeTruthy();
    // onConsentRevoked must have been passed to the gate
    expect(capturedRevokeCb).toBeTruthy();

    // Clear prior calls so we can assert the revocation call in isolation
    vi.mocked(setFillChangeCallback).mockClear();

    // Simulate the user revoking tracking consent (e.g. via iOS Settings → Tracking)
    await act(async () => {
      capturedRevokeCb!();
      await Promise.resolve();
    });

    // The fill callback must be torn down — setFillChangeCallback(null) unregisters it
    expect(vi.mocked(setFillChangeCallback)).toHaveBeenCalledOnce();
    expect(vi.mocked(setFillChangeCallback)).toHaveBeenCalledWith(null);

    // No fill POST should have been sent during or after revocation
    expect(mockApiRequestSafe).not.toHaveBeenCalled();
  });
});
