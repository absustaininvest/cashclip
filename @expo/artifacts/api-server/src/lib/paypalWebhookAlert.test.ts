/**
 * Throttle behaviour for the missing-PAYPAL_WEBHOOK_ID operator alert email.
 *
 * The condition (payouts configured but webhook secret absent) means every
 * PayPal status callback is rejected and withdrawals stay stuck. We want an
 * active email alert, but PayPal retries failed deliveries, so the same
 * condition can fire on every callback. These tests prove the alert is
 * debounced to at most once per cooldown window — and, unlike the AdMob alert,
 * that throttle is DB-backed (the shared `dedupe_slots` table) so the cooldown
 * holds GLOBALLY across the whole autoscaled fleet, not just per replica.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSend = vi.fn();
const mockReserve = vi.fn();
const mockRelease = vi.fn();

vi.mock("./email", () => ({
  sendPayPalWebhookSecretMissingAlert: (...args: unknown[]) => mockSend(...args),
}));

vi.mock("./dedupe", () => ({
  reserveDedupeSlot: (...args: unknown[]) => mockReserve(...args),
  releaseDedupeSlot: (...args: unknown[]) => mockRelease(...args),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { alertPayPalWebhookSecretMissing } from "./paypalWebhookAlert";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS;
  delete process.env.PAYPAL_MODE;
  // Default: a fresh slot is reserved (not a duplicate) so the email goes out.
  mockReserve.mockResolvedValue({ count: 1, duplicate: false });
  mockRelease.mockResolvedValue(undefined);
});

describe("alertPayPalWebhookSecretMissing", () => {
  it("sends an email when it wins a fresh shared cooldown slot", async () => {
    const sent = await alertPayPalWebhookSecretMissing("callback");
    expect(sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ source: "callback", mode: "sandbox" }),
    );
  });

  it("reserves the shared dedupe slot with the configured cooldown window", async () => {
    await alertPayPalWebhookSecretMissing("callback");
    expect(mockReserve).toHaveBeenCalledTimes(1);
    expect(mockReserve).toHaveBeenCalledWith(
      "paypal_webhook_secret_missing_alert",
      6 * 60 * 60 * 1000,
    );
  });

  it("suppresses the email when the shared slot is already held (duplicate)", async () => {
    // Another replica already reserved the slot within this cooldown window.
    mockReserve.mockResolvedValue({ count: 2, duplicate: true });
    const sent = await alertPayPalWebhookSecretMissing("callback");
    expect(sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("honours a custom cooldown from PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS", async () => {
    process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS = "1000";
    await alertPayPalWebhookSecretMissing("callback");
    expect(mockReserve).toHaveBeenCalledWith(
      "paypal_webhook_secret_missing_alert",
      1000,
    );
  });

  it("falls back to the default cooldown on an invalid override", async () => {
    process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS = "not-a-number";
    await alertPayPalWebhookSecretMissing("callback");
    expect(mockReserve).toHaveBeenCalledWith(
      "paypal_webhook_secret_missing_alert",
      6 * 60 * 60 * 1000,
    );
  });

  it("passes through the configured PayPal mode", async () => {
    process.env.PAYPAL_MODE = "live";
    await alertPayPalWebhookSecretMissing("startup");
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ source: "startup", mode: "live" }),
    );
  });

  it("suppresses (does not flood) when the shared throttle store is unreachable", async () => {
    mockReserve.mockRejectedValue(new Error("db down"));
    const sent = await alertPayPalWebhookSecretMissing("callback");
    expect(sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("releases the slot when the email send fails so a later callback can retry", async () => {
    mockSend.mockImplementationOnce(() => {
      throw new Error("smtp down");
    });
    await expect(
      alertPayPalWebhookSecretMissing("callback"),
    ).resolves.toBe(true);
    expect(mockRelease).toHaveBeenCalledWith("paypal_webhook_secret_missing_alert");
  });

  it("does not throw when both the send and the release fail", async () => {
    mockSend.mockImplementationOnce(() => {
      throw new Error("smtp down");
    });
    mockRelease.mockRejectedValueOnce(new Error("db down"));
    await expect(
      alertPayPalWebhookSecretMissing("callback"),
    ).resolves.toBe(true);
  });
});
