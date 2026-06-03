import { vi } from "vitest";
import type { IStorage } from "../storage";

/**
 * A storage mock where every method is a `vi.fn()`.
 * The type is structurally compatible with `IStorage` so TypeScript catches
 * callers that pass an override for a method that no longer exists on the
 * interface.
 */
export type StorageMock = { [K in keyof IStorage]: ReturnType<typeof vi.fn> };

/**
 * Create a typed storage mock with every `IStorage` method pre-wired to
 * `.mockResolvedValue(<sensible default>)`.
 *
 * The defaults are chosen so that awaiting any method that is NOT explicitly
 * overridden never throws — a bare `vi.fn()` returns `undefined` synchronously,
 * so `await vi.fn()()` throws "Cannot read properties of undefined" on the
 * first `.then()` call.  Pre-setting each stub with `mockResolvedValue` avoids
 * that footgun automatically.
 *
 * Usage:
 *
 *   const storageMock = createStorageMock({
 *     getUser: vi.fn().mockResolvedValue(fakeUser),
 *   });
 *
 *   vi.mock("./storage", () => ({ storage: storageMock }));
 *
 * Or inside a vi.mock async factory (when the mock reference must be captured
 * before module evaluation):
 *
 *   const mockGetUser = vi.hoisted(() => vi.fn());
 *
 *   vi.mock("./storage", async () => {
 *     const { createStorageMock } = await import("./testHelpers/mockStorage");
 *     return { storage: createStorageMock({ getUser: mockGetUser }) };
 *   });
 */
export function createStorageMock(overrides: Partial<StorageMock> = {}): StorageMock {
  const base: StorageMock = {
    // ── User ─────────────────────────────────────────────────────────────
    getUser:                               vi.fn().mockResolvedValue(undefined),
    getUserByUsername:                     vi.fn().mockResolvedValue(undefined),
    getUserByEmail:                        vi.fn().mockResolvedValue(undefined),
    getAllUsers:                           vi.fn().mockResolvedValue({ users: [], total: 0 }),
    createUser:                           vi.fn().mockResolvedValue(undefined),
    updateUserPassword:                   vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    incrementTokenVersion:                vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    setTotpBackupCodes:                   vi.fn().mockResolvedValue(undefined),
    recordSecurityAudit:                  vi.fn().mockResolvedValue(undefined),
    getSecurityAuditEntries:              vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    getTotpBackupCodesRemaining:          vi.fn().mockResolvedValue(0),
    consumeTotpBackupCode:                vi.fn().mockResolvedValue(false),
    factoryResetUser:                     vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    deleteUser:                           vi.fn().mockResolvedValue(undefined),
    getUserProfile:                       vi.fn().mockResolvedValue(undefined),
    updateUserProfile:                    vi.fn().mockResolvedValue(undefined),

    // ── Balance / ledger ─────────────────────────────────────────────────
    getUserBalance:                       vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    creditUser:                           vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    debitUser:                            vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    getUserLedger:                        vi.fn().mockResolvedValue([]),

    // ── Withdrawals ───────────────────────────────────────────────────────
    createWithdrawal:                     vi.fn().mockResolvedValue(undefined),
    createWithdrawalAtomic:              vi.fn().mockResolvedValue(undefined),
    getWithdrawals:                       vi.fn().mockResolvedValue([]),
    getWithdrawalById:                    vi.fn().mockResolvedValue(undefined),
    getUserWithdrawals:                   vi.fn().mockResolvedValue([]),
    updateWithdrawalStatus:               vi.fn().mockResolvedValue(undefined),
    updateWithdrawalStatusIfStatus:       vi.fn().mockResolvedValue(undefined),

    // ── Reward sessions ──────────────────────────────────────────────────
    createRewardSession:                  vi.fn().mockResolvedValue(undefined),
    getRewardSession:                     vi.fn().mockResolvedValue(undefined),
    findCompletedRewardSession:           vi.fn().mockResolvedValue(undefined),
    findPendingRewardSession:             vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAtomic:         vi.fn().mockResolvedValue(undefined),
    findCompletedSessionByProviderTransactionId: vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAndCredit:      vi.fn().mockResolvedValue(undefined),

    // ── Webhook audit ────────────────────────────────────────────────────
    insertWebhookAudit:                   vi.fn().mockResolvedValue(undefined),
    countWebhookAuditByIp:               vi.fn().mockResolvedValue(0),
    getWebhookAudits:                     vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders:            vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders:            vi.fn().mockResolvedValue([]),
    pruneWebhookAudit:                    vi.fn().mockResolvedValue(0),
    pruneSecurityAudit:                   vi.fn().mockResolvedValue(0),
  };

  return { ...base, ...overrides };
}
