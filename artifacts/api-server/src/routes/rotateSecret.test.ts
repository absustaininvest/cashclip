import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Integration tests for POST /api/admin/integrations/rotate-secret.
 *
 * The real adminMiddleware requires a live database.  We replace it with a
 * stub that always grants access so the test stays self-contained and fast.
 * The underlying key-store logic (rotateEncryptionSecret) is exercised through
 * the full HTTP request/response cycle, giving us contract coverage without a
 * database.
 */

const OLD_SECRET = "old-jwt-secret-long";
const NEW_SECRET = "new-jwt-secret-long";

const ENV_KEYS = ["RT_TEST_PROVIDER_KEY", "RT_TEST_OTHER_KEY"];

let tmpDir: string;
let app: Express;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "rotate-secret-route-test-"));
  const filePath = join(tmpDir, "keys.enc.json");

  // Point the store at a temp file and set the "old" secret.
  // Clear JWT_TRIDENTE so the key-store uses JWT_SECRET alone (keeps test secret
  // independent of any real Replit env value).
  process.env["INTEGRATION_KEYS_PATH"] = filePath;
  delete process.env["JWT_TRIDENTE"];
  process.env["JWT_SECRET"] = OLD_SECRET;
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  for (const k of ENV_KEYS) delete process.env[k];

  // Build a minimal Express app that only wires the rotate-secret route,
  // using a stub admin middleware so we don't need a database.
  const stubAdmin = (_req: Request, _res: Response, next: NextFunction) => next();

  // Dynamically import after env is set so the module picks up the right path.
  vi.resetModules();
  const { rotateEncryptionSecret, persistIntegrationKey } = await import(
    "../lib/integrationKeyStore"
  );

  // Pre-populate the store with a key encrypted under OLD_SECRET
  persistIntegrationKey("RT_TEST_PROVIDER_KEY", "provider-api-key");

  app = express();
  app.use(express.json());

  // Inline the same route logic as cashclip.ts (no DB dependency path)
  app.post(
    "/api/admin/integrations/rotate-secret",
    stubAdmin,
    (req: Request, res: Response) => {
      const { oldSecret } = (req.body ?? {}) as { oldSecret?: unknown };

      if (typeof oldSecret !== "string" || oldSecret.length < 8) {
        res.status(400).json({
          error: "Field 'oldSecret' must be a string of at least 8 characters",
        });
        return;
      }

      const newSecret = process.env["JWT_SECRET"];
      if (!newSecret || newSecret.length < 8) {
        res.status(500).json({
          error: "JWT_SECRET is not configured on the server — cannot derive a new encryption key",
        });
        return;
      }

      if (oldSecret === newSecret) {
        res.status(400).json({
          error: "oldSecret is identical to the current JWT_SECRET — rotation is a no-op",
        });
        return;
      }

      try {
        const result = rotateEncryptionSecret(oldSecret, newSecret);

        const noteFragments: string[] = [];
        if (result.rotated > 0) {
          noteFragments.push(
            `${result.rotated} key(s) successfully re-encrypted with the new secret.`,
          );
        }
        if (result.failed.length > 0) {
          noteFragments.push(
            `${result.failed.length} key(s) could not be decrypted with the old secret and must be re-entered manually: ${result.failed.join(", ")}.`,
          );
        }
        if (result.rotated === 0 && result.failed.length === 0) {
          noteFragments.push("No persisted keys found — nothing to rotate.");
        }

        res.json({
          ok: true,
          rotated: result.rotated,
          failed: result.failed,
          note: noteFragments.join(" "),
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Rotation failed",
        });
      }
    },
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["INTEGRATION_KEYS_PATH"];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  // Keep JWT_SECRET aligned between tests; restore to OLD_SECRET by default
  process.env["JWT_SECRET"] = OLD_SECRET;
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("POST /api/admin/integrations/rotate-secret", () => {
  it("400 when oldSecret is missing", async () => {
    const res = await request(app)
      .post("/api/admin/integrations/rotate-secret")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oldSecret.*must be a string/i);
  });

  it("400 when oldSecret is shorter than 8 chars", async () => {
    const res = await request(app)
      .post("/api/admin/integrations/rotate-secret")
      .send({ oldSecret: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oldSecret.*must be a string/i);
  });

  it("400 when oldSecret equals the current JWT_SECRET (no-op guard)", async () => {
    // JWT_SECRET is still OLD_SECRET here
    const res = await request(app)
      .post("/api/admin/integrations/rotate-secret")
      .send({ oldSecret: OLD_SECRET });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/identical/i);
  });

  it("happy path: successfully rotates an entry from old secret to new secret", async () => {
    // Switch JWT_SECRET to the new value so the endpoint treats it as the target
    process.env["JWT_SECRET"] = NEW_SECRET;

    const res = await request(app)
      .post("/api/admin/integrations/rotate-secret")
      .send({ oldSecret: OLD_SECRET });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rotated).toBe(1);
    expect(res.body.failed).toEqual([]);
    expect(res.body.note).toMatch(/1 key\(s\) successfully re-encrypted/i);
  });

  it("happy path: empty store returns rotated=0 failed=[] with informational note", async () => {
    // Use a fresh temp file with no entries
    const emptyDir = mkdtempSync(join(tmpdir(), "rotate-empty-"));
    const prevPath = process.env["INTEGRATION_KEYS_PATH"];
    process.env["INTEGRATION_KEYS_PATH"] = join(emptyDir, "empty.enc.json");
    process.env["JWT_SECRET"] = NEW_SECRET;

    try {
      vi.resetModules();
      const { rotateEncryptionSecret: rotFn } = await import("../lib/integrationKeyStore");

      const localApp = express();
      localApp.use(express.json());
      localApp.post(
        "/api/admin/integrations/rotate-secret",
        (_req, res) => {
          process.env["JWT_SECRET"] = NEW_SECRET;
          const result = rotFn(OLD_SECRET, NEW_SECRET);
          res.json({ ok: true, rotated: result.rotated, failed: result.failed });
        },
      );

      const emptyRes = await request(localApp)
        .post("/api/admin/integrations/rotate-secret")
        .send({ oldSecret: OLD_SECRET });

      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.rotated).toBe(0);
      expect(emptyRes.body.failed).toEqual([]);
    } finally {
      process.env["INTEGRATION_KEYS_PATH"] = prevPath;
      process.env["JWT_SECRET"] = OLD_SECRET;
      rmSync(emptyDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("reports failed entries when oldSecret is wrong for some entries", async () => {
    // The store already has RT_TEST_PROVIDER_KEY encrypted with OLD_SECRET.
    // Pretend we're rotating from a WRONG old secret — all entries will fail.
    process.env["JWT_SECRET"] = NEW_SECRET;

    const res = await request(app)
      .post("/api/admin/integrations/rotate-secret")
      .send({ oldSecret: "completely-wrong-secret" });

    // The endpoint itself succeeds (200) — it's the rotation that partially fails
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.failed)).toBe(true);
    expect(res.body.note).toMatch(/could not be decrypted.*must be re-entered/i);
  });
});
