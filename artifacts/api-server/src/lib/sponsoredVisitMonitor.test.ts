/**
 * Unit tests for the sponsored-visit settlement alert monitor.
 *
 * All DB calls and the email sender are fully mocked so no Postgres
 * connection is required. Tests cover:
 *
 *   1. Fires when there are 0 settlements AND active campaigns exist.
 *   2. Does NOT fire when there are settlements in the 2-hour window.
 *   3. Does NOT fire when there are no active campaigns.
 *   4. Does NOT fire within the 4-hour debounce window.
 *   5. Fires again after the debounce window expires.
 *   6. Persists the last_alerted timestamp to system_kv after firing.
 *   7. Does not write to system_kv when the alert is suppressed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
// vi.mock factories are hoisted, so mockLogger must also be hoisted via
// vi.hoisted() to be accessible inside the factory.

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: mockLogger,
}));

// ── Email mock ────────────────────────────────────────────────────────────────

vi.mock("./email", () => ({
  sendSponsoredVisitSettlementAlert: vi.fn(),
}));

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
// sql is used as a tagged template literal. We only need it to return something
// non-null so db.execute() receives a defined argument.

vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      ({ strings, values, __isSql: true }),
    { raw: (s: string) => s },
  ),
}));

// ── @workspace/db mock ────────────────────────────────────────────────────────
// db.execute is the single interface point for this module.
// Each test configures its own sequence of return values via mockResolvedValueOnce.

const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────

import {
  _runCheckForTests as runCheck,
  startSponsoredVisitAlertMonitor,
  stopSponsoredVisitAlertMonitor,
} from "./sponsoredVisitMonitor";
import { sendSponsoredVisitSettlementAlert } from "./email";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEBOUNCE_HOURS = 4;

function settlementRow(count: number) {
  return { rows: [{ success_count: count }] };
}

function campaignRow(count: number) {
  return { rows: [{ active_count: count }] };
}

function kvRow(isoString: string | null) {
  return { rows: isoString ? [{ value: isoString }] : [] };
}

function kvWriteRow() {
  return { rows: [] };
}

// Set up the four execute calls that happen when an alert fires:
//   1. settlement COUNT (Promise.all call 1)
//   2. active-campaign COUNT (Promise.all call 2)
//   3. system_kv read (readLastAlerted)
//   4. system_kv upsert (writeLastAlerted)
function setupAlertFiringSequence(opts: {
  settlements?: number;
  campaigns?: number;
  lastAlertedAt?: string | null;
}) {
  const { settlements = 0, campaigns = 2, lastAlertedAt = null } = opts;
  mockExecute
    .mockResolvedValueOnce(settlementRow(settlements))
    .mockResolvedValueOnce(campaignRow(campaigns))
    .mockResolvedValueOnce(kvRow(lastAlertedAt))
    .mockResolvedValueOnce(kvWriteRow());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sponsoredVisitMonitor — runCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Fires when 0 settlements + active campaigns ─────────────────────────
  describe("alert fires", () => {
    it("calls sendSponsoredVisitSettlementAlert when there are 0 settlements and active campaigns exist", async () => {
      setupAlertFiringSequence({ settlements: 0, campaigns: 3 });

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledOnce();
    });

    it("passes correct activeCampaigns count and windowHours to the email sender", async () => {
      setupAlertFiringSequence({ settlements: 0, campaigns: 5 });

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          activeCampaigns: 5,
          windowHours: 2,
        }),
      );
    });

    it("includes a checkedAt Date in the email payload", async () => {
      setupAlertFiringSequence({ settlements: 0, campaigns: 1 });

      await runCheck();

      const payload = (sendSponsoredVisitSettlementAlert as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as { checkedAt: unknown };
      expect(payload.checkedAt).toBeInstanceOf(Date);
    });
  });

  // ── 2. Does NOT fire when settlements > 0 ─────────────────────────────────
  describe("suppressed — settlements present", () => {
    it("does not alert when there is at least 1 settlement in the window", async () => {
      mockExecute
        .mockResolvedValueOnce(settlementRow(1))
        .mockResolvedValueOnce(campaignRow(2));

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });

    it("does not alert when there are many settlements", async () => {
      mockExecute
        .mockResolvedValueOnce(settlementRow(42))
        .mockResolvedValueOnce(campaignRow(3));

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });
  });

  // ── 3. Does NOT fire when no active campaigns ─────────────────────────────
  describe("suppressed — no active campaigns", () => {
    it("does not alert when active campaign count is 0 (nothing to stall)", async () => {
      mockExecute
        .mockResolvedValueOnce(settlementRow(0))
        .mockResolvedValueOnce(campaignRow(0));

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });
  });

  // ── 4. Does NOT fire within the 4-hour debounce window ────────────────────
  describe("suppressed — within debounce window", () => {
    it("does not alert when last alert was sent 1 hour ago (well inside debounce)", async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      mockExecute
        .mockResolvedValueOnce(settlementRow(0))
        .mockResolvedValueOnce(campaignRow(2))
        .mockResolvedValueOnce(kvRow(oneHourAgo));

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });

    it("does not alert when last alert was sent exactly (DEBOUNCE - 1 min) ago", async () => {
      const justInsideWindow = new Date(
        Date.now() - (DEBOUNCE_HOURS * 60 * 60 * 1000 - 60 * 1000),
      ).toISOString();
      mockExecute
        .mockResolvedValueOnce(settlementRow(0))
        .mockResolvedValueOnce(campaignRow(2))
        .mockResolvedValueOnce(kvRow(justInsideWindow));

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });
  });

  // ── 5. Fires again after debounce expires ─────────────────────────────────
  describe("fires after debounce window expires", () => {
    it("alerts when last alert was sent more than 4 hours ago", async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      setupAlertFiringSequence({ settlements: 0, campaigns: 2, lastAlertedAt: fiveHoursAgo });

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledOnce();
    });

    it("alerts when last alert was sent exactly DEBOUNCE + 1 minute ago", async () => {
      const justPastDebounce = new Date(
        Date.now() - (DEBOUNCE_HOURS * 60 * 60 * 1000 + 60 * 1000),
      ).toISOString();
      setupAlertFiringSequence({ settlements: 0, campaigns: 1, lastAlertedAt: justPastDebounce });

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledOnce();
    });

    it("alerts when no previous debounce record exists (first ever alert)", async () => {
      setupAlertFiringSequence({ settlements: 0, campaigns: 2, lastAlertedAt: null });

      await runCheck();

      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledOnce();
    });
  });

  // ── 6. Persists last_alerted timestamp to system_kv ──────────────────────
  describe("system_kv write after firing", () => {
    it("calls db.execute a 4th time (the KV upsert) after the alert fires", async () => {
      setupAlertFiringSequence({ settlements: 0, campaigns: 2 });

      await runCheck();

      // Calls: (1) settlement count, (2) campaign count, (3) KV read, (4) KV write
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it("does not call db.execute more than 2 times when alert is suppressed by settlement count", async () => {
      mockExecute
        .mockResolvedValueOnce(settlementRow(5))
        .mockResolvedValueOnce(campaignRow(2));

      await runCheck();

      // Only the two Promise.all queries run; KV is never read or written
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("does not write to system_kv when debounced", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      mockExecute
        .mockResolvedValueOnce(settlementRow(0))
        .mockResolvedValueOnce(campaignRow(3))
        .mockResolvedValueOnce(kvRow(twoHoursAgo));

      await runCheck();

      // Calls: (1) settlement, (2) campaign, (3) KV read — no KV write
      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(sendSponsoredVisitSettlementAlert).not.toHaveBeenCalled();
    });
  });

  // ── 7. KV write failure is non-fatal ─────────────────────────────────────
  describe("resilience", () => {
    it("does not throw even if the system_kv write fails", async () => {
      mockExecute
        .mockResolvedValueOnce(settlementRow(0))
        .mockResolvedValueOnce(campaignRow(2))
        .mockResolvedValueOnce(kvRow(null))
        .mockRejectedValueOnce(new Error("DB write error"));

      await expect(runCheck()).resolves.toBeUndefined();
      // Alert was still dispatched before the failed write
      expect(sendSponsoredVisitSettlementAlert).toHaveBeenCalledOnce();
    });
  });
});

// ── startSponsoredVisitAlertMonitor — startup wiring ─────────────────────────

describe("startSponsoredVisitAlertMonitor — startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopSponsoredVisitAlertMonitor();
    vi.useRealTimers();
  });

  it("emits an info log on successful startup", async () => {
    // ensureSystemKvTable → CREATE TABLE
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await startSponsoredVisitAlertMonitor();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ checkIntervalMinutes: 30 }),
      expect.stringContaining("monitor started"),
    );
  });

  it("registers an interval that invokes runCheck after 30 minutes", async () => {
    // ensureSystemKvTable → CREATE TABLE
    mockExecute.mockResolvedValueOnce({ rows: [] });
    // runCheck called by the interval: settlement count + campaign count
    mockExecute
      .mockResolvedValueOnce(settlementRow(0))
      .mockResolvedValueOnce(campaignRow(0));

    await startSponsoredVisitAlertMonitor();

    const callsAfterStart = mockExecute.mock.calls.length; // 1 (CREATE TABLE only)

    // Advance exactly one interval period
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    // runCheck must have issued at least the two COUNT queries
    expect(mockExecute.mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it("does not start (no interval) when ensureSystemKvTable rejects", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Table creation failed"));

    await startSponsoredVisitAlertMonitor();

    const callsAfterStart = mockExecute.mock.calls.length; // 1 (failed CREATE TABLE)

    // Advance well past the interval — runCheck must never be called
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(mockExecute.mock.calls.length).toBe(callsAfterStart);
  });

  it("logs an error and returns without starting when ensureSystemKvTable rejects", async () => {
    const cause = new Error("DB unavailable");
    mockExecute.mockRejectedValueOnce(cause);

    await startSponsoredVisitAlertMonitor();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause }),
      expect.stringContaining("sponsored-visit monitor will not start"),
    );
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  // ── No duplicate intervals on restart ─────────────────────────────────────
  it("calling start twice does not register two independent intervals", async () => {
    // First start: ensureSystemKvTable succeeds
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await startSponsoredVisitAlertMonitor();

    // Second start: ensureSystemKvTable succeeds again
    mockExecute.mockResolvedValueOnce({ rows: [] });
    await startSponsoredVisitAlertMonitor();

    // After both starts, prime runCheck with suppress-alert data so the check
    // completes without side-effects (settlements present → early return)
    mockExecute
      .mockResolvedValueOnce(settlementRow(1))
      .mockResolvedValueOnce(campaignRow(2));

    const callsBeforeAdvance = mockExecute.mock.calls.length; // 2 (two CREATE TABLE calls)

    // Advance exactly one interval — only ONE interval should be active
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    // runCheck issues exactly 2 COUNT queries per invocation; with one interval
    // we expect exactly 2 additional calls (not 4 which would indicate two intervals)
    expect(mockExecute.mock.calls.length - callsBeforeAdvance).toBe(2);
  });
});
