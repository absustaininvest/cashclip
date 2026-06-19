import { storage } from "../storage";
import { logger } from "../lib/logger";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_HOURS = 24;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function runWebhookAuditCleanup(retentionDays: number): Promise<number> {
  const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  try {
    const deleted = await storage.pruneWebhookAudit(before);
    if (deleted > 0) {
      logger.info({ deleted, before, retentionDays }, "Pruned old webhook_audit records");
    } else {
      logger.debug({ before, retentionDays }, "No webhook_audit records to prune");
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, "Failed to prune webhook_audit records");
    return 0;
  }
}

export function startWebhookAuditCleanupJob(): NodeJS.Timeout | null {
  const retentionDays = parsePositiveNumber(
    process.env["WEBHOOK_AUDIT_RETENTION_DAYS"],
    DEFAULT_RETENTION_DAYS,
  );
  const intervalHours = parsePositiveNumber(
    process.env["WEBHOOK_AUDIT_CLEANUP_INTERVAL_HOURS"],
    DEFAULT_INTERVAL_HOURS,
  );
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info(
    { retentionDays, intervalHours },
    "Scheduling webhook_audit cleanup job",
  );

  void runWebhookAuditCleanup(retentionDays);

  const timer = setInterval(() => {
    void runWebhookAuditCleanup(retentionDays);
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
