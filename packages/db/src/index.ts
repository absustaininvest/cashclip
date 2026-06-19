import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Cap concurrent connections so a traffic spike can't exhaust the database's
  // connection slots (especially with multiple autoscaled replicas).
  max: Number(process.env.DB_POOL_MAX ?? 10),
  // Reclaim idle connections after 30s so we don't hold sockets open forever.
  idleTimeoutMillis: 30_000,
  // Fail fast (5s) when a new connection can't be established, instead of
  // hanging the request, so a brief DB blip surfaces quickly and recovers.
  connectionTimeoutMillis: 5_000,
});

// Without this handler, an error on an idle client (e.g. the database dropping
// the connection during a failover) is emitted as an "error" event on the pool
// with no listener, which crashes the whole process. Logging it lets pg discard
// the bad client and hand out a fresh one on the next query — self-healing.
pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle PostgreSQL client:", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
