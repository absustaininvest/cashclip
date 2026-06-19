import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  firstAttempt: timestamp("first_attempt", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LoginAttempt = typeof loginAttempts.$inferSelect;
