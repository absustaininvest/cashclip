import { storage } from "../storage";
import { logger } from "../lib/logger";

// Security events are retained far longer than webhook noise (default 30 days)
// because account-takeover / fraud investigations and incident response often
// surface weeks or months after the fact. 180 days gives a meaningful
// audit/incident-response window while still bounding unbounded table growth.
const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_INTERVAL_HOURS = 24;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function runSecurityAuditCleanup(retentionDays: number): Promise<number> {
  const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  try {
    const deleted = await storage.pruneSecurityAudit(before);
    if (deleted > 0) {
      logger.info({ deleted, before, retentionDays }, "Pruned old security_audit_log records");
    } else {
      logger.debug({ before, retentionDays }, "No security_audit_log records to prune");
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, "Failed to prune security_audit_log records");
    return 0;
  }
}

export function startSecurityAuditCleanupJob(): NodeJS.Timeout | null {
  const retentionDays = parsePositiveNumber(
    process.env["SECURITY_AUDIT_RETENTION_DAYS"],
    DEFAULT_RETENTION_DAYS,
  );
  const intervalHours = parsePositiveNumber(
    process.env["SECURITY_AUDIT_CLEANUP_INTERVAL_HOURS"],
    DEFAULT_INTERVAL_HOURS,
  );
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info(
    { retentionDays, intervalHours },
    "Scheduling security_audit_log cleanup job",
  );

  void runSecurityAuditCleanup(retentionDays);

  const timer = setInterval(() => {
    void runSecurityAuditCleanup(retentionDays);
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
