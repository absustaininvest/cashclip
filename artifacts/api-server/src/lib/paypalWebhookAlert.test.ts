/**
 * Throttle behaviour for the missing-PAYPAL_WEBHOOK_ID operator alert email.
 *
 * The condition (payouts configured but webhook secret absent) means every
 * PayPal status callback is rejected and withdrawals stay stuck. We want an
 * active email alert, but PayPal retries failed deliveries, so the same
 * condition can fire on every callback. These tests prove the alert is
 * debounced to at most once per cooldown window — matching the AdMob alert
 * pattern — so it cannot flood the operator inbox.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("./email", () => ({
  sendPayPalWebhookSecretMissingAlert: (...args: unknown[]) => mockSend(...args),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  alertPayPalWebhookSecretMissing,
  _resetPayPalWebhookAlertForTests,
} from "./paypalWebhookAlert";

beforeEach(() => {
  vi.clearAllMocks();
  _resetPayPalWebhookAlertForTests();
  delete process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS;
  delete process.env.PAYPAL_MODE;
});

describe("alertPayPalWebhookSecretMissing", () => {
  it("sends an email the first time it is called", () => {
    const sent = alertPayPalWebhookSecretMissing("callback", 1_000);
    expect(sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ source: "callback", mode: "sandbox" }),
    );
  });

  it("suppresses repeat alerts within the cooldown window", () => {
    expect(alertPayPalWebhookSecretMissing("callback", 0)).toBe(true);
    // A flood of callbacks just after — all within the default 6h cooldown.
    expect(alertPayPalWebhookSecretMissing("callback", 1_000)).toBe(false);
    expect(alertPayPalWebhookSecretMissing("callback", 60_000)).toBe(false);
    expect(alertPayPalWebhookSecretMissing("callback", 6 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("fires again once the cooldown window elapses", () => {
    expect(alertPayPalWebhookSecretMissing("startup", 0)).toBe(true);
    const sixHours = 6 * 60 * 60 * 1000;
    expect(alertPayPalWebhookSecretMissing("callback", sixHours)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("honours a custom cooldown from PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS", () => {
    process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS = "1000";
    expect(alertPayPalWebhookSecretMissing("callback", 0)).toBe(true);
    expect(alertPayPalWebhookSecretMissing("callback", 500)).toBe(false);
    expect(alertPayPalWebhookSecretMissing("callback", 1000)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("passes through the configured PayPal mode", () => {
    process.env.PAYPAL_MODE = "live";
    alertPayPalWebhookSecretMissing("startup", 0);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ source: "startup", mode: "live" }),
    );
  });

  it("does not throw or count an email when the send helper fails", () => {
    mockSend.mockImplementationOnce(() => {
      throw new Error("smtp down");
    });
    // Throttle still advances (returns true — it attempted), but no crash.
    expect(() => alertPayPalWebhookSecretMissing("callback", 0)).not.toThrow();
  });
});
