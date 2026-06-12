import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";

// Shared store for the spin wheel's anti-cheat challenge tokens.
// /api/earn/spin/begin issues a token; /api/earn/spin/complete consumes it.
// Kept in the database (not process memory) so a token issued by one
// autoscaled replica can be validated and single-use-consumed by any other.
export const spinChallenges = pgTable(
  "spin_challenges",
  {
    token: text("token").primaryKey(),
    userId: text("user_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Predetermined reward (picked at begin, used at complete so the wheel
    // animates to the exact segment the server already decided).
    points: integer("points"),
  },
  (t) => [index("spin_challenges_expires_at_idx").on(t.expiresAt)],
);

export type SpinChallenge = typeof spinChallenges.$inferSelect;
