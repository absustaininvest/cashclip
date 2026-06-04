import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Dedicated store for short-lived idempotency / dedupe slots (e.g. preventing
 * the same outbound support reply from being sent twice in quick succession).
 *
 * Deliberately separate from `login_attempts`: login throttling and outbound
 * dedupe are unrelated concerns, and conflating them in one table means tuning,
 * pruning, or schema changes to one can silently affect the other.
 */
export const dedupeSlots = pgTable("dedupe_slots", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DedupeSlot = typeof dedupeSlots.$inferSelect;
