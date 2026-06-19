import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Store = typeof import("./integrationKeyStore");

const ENV_KEYS = [
  "TEST_PROVIDER_KEY",
  "TEST_PROVIDER_KEY_2",
  "TEST_OTHER_KEY",
];

let tmpDir: string;
let filePath: string;
const originalJwt = process.env["JWT_SECRET"];
const originalAccessSecret = process.env["JWT_ACCESS_SECRET"];
const originalPath = process.env["INTEGRATION_KEYS_PATH"];

async function loadStore(): Promise<Store> {
  vi.resetModules();
  return await import("./integrationKeyStore");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "intkey-test-"));
  filePath = join(tmpDir, "keys.enc.json");
  process.env["INTEGRATION_KEYS_PATH"] = filePath;
  // Clear JWT_ACCESS_SECRET so tests control the encryption secret via JWT_SECRET alone.
  delete process.env["JWT_ACCESS_SECRET"];
  process.env["JWT_SECRET"] = "test-secret-long-enough";
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  if (originalJwt === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = originalJwt;
  if (originalAccessSecret === undefined) delete process.env["JWT_ACCESS_SECRET"];
  else process.env["JWT_ACCESS_SECRET"] = originalAccessSecret;
  if (originalPath === undefined) delete process.env["INTEGRATION_KEYS_PATH"];
  else process.env["INTEGRATION_KEYS_PATH"] = originalPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("integrationKeyStore", () => {
  it("encrypts to disk and decrypts back on load (round-trip)", async () => {
    const store = await loadStore();
    const persisted = store.persistIntegrationKey("TEST_PROVIDER_KEY", "super-secret-value");
    expect(persisted).toBe(true);
    expect(existsSync(filePath)).toBe(true);

    // File contents must be encrypted, not plaintext
    const raw = readFileSync(filePath, "utf8");
    expect(raw).not.toContain("super-secret-value");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.entries.TEST_PROVIDER_KEY).toMatchObject({
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    });

    expect(store.isIntegrationKeyPersisted("TEST_PROVIDER_KEY")).toBe(true);

    // Simulate restart: env not set, fresh module load reads + decrypts
    delete process.env["TEST_PROVIDER_KEY"];
    const store2 = await loadStore();
    const result = store2.loadPersistedIntegrationKeys();
    expect(result).toMatchObject({ loaded: 1, skipped: 0, decryptionFailures: [] });
    expect(process.env["TEST_PROVIDER_KEY"]).toBe("super-secret-value");
  });

  it("env precedence: existing process.env value is not overwritten", async () => {
    const store = await loadStore();
    store.persistIntegrationKey("TEST_PROVIDER_KEY", "from-disk");

    process.env["TEST_PROVIDER_KEY"] = "from-env";
    const store2 = await loadStore();
    const result = store2.loadPersistedIntegrationKeys();
    expect(result).toMatchObject({ loaded: 0, skipped: 1, decryptionFailures: [] });
    expect(process.env["TEST_PROVIDER_KEY"]).toBe("from-env");
  });

  it("DELETE removes the entry from disk", async () => {
    const store = await loadStore();
    store.persistIntegrationKey("TEST_PROVIDER_KEY", "v1");
    store.persistIntegrationKey("TEST_OTHER_KEY", "v2");
    expect(store.isIntegrationKeyPersisted("TEST_PROVIDER_KEY")).toBe(true);

    const removed = store.deletePersistedIntegrationKey("TEST_PROVIDER_KEY");
    expect(removed).toBe(true);
    expect(store.isIntegrationKeyPersisted("TEST_PROVIDER_KEY")).toBe(false);
    expect(store.isIntegrationKeyPersisted("TEST_OTHER_KEY")).toBe(true);

    // Deleting a non-existent entry returns false
    const removedAgain = store.deletePersistedIntegrationKey("TEST_PROVIDER_KEY");
    expect(removedAgain).toBe(false);
  });

  it("missing JWT_SECRET disables persistence safely (persist returns false, no file written)", async () => {
    delete process.env["JWT_SECRET"];
    const store = await loadStore();
    const persisted = store.persistIntegrationKey("TEST_PROVIDER_KEY", "value");
    expect(persisted).toBe(false);
    expect(existsSync(filePath)).toBe(false);

    const result = store.loadPersistedIntegrationKeys();
    expect(result).toMatchObject({ loaded: 0, skipped: 0 });
    expect(process.env["TEST_PROVIDER_KEY"]).toBeUndefined();
  });

  it("short JWT_SECRET (<8 chars) disables persistence safely", async () => {
    process.env["JWT_SECRET"] = "short";
    const store = await loadStore();
    const persisted = store.persistIntegrationKey("TEST_PROVIDER_KEY", "value");
    expect(persisted).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  it("load skips entries that fail to decrypt (e.g. JWT_SECRET changed) without throwing and reports them", async () => {
    const store = await loadStore();
    store.persistIntegrationKey("TEST_PROVIDER_KEY", "value");
    delete process.env["TEST_PROVIDER_KEY"];

    // Rotate the secret so the existing ciphertext can no longer be decrypted
    process.env["JWT_SECRET"] = "different-secret-also-long";
    const store2 = await loadStore();
    const result = store2.loadPersistedIntegrationKeys();
    // loaded=0, skipped=0, but decryptionFailures tells the admin which key needs re-entry
    expect(result).toMatchObject({ loaded: 0, skipped: 0, decryptionFailures: ["TEST_PROVIDER_KEY"] });
    expect(process.env["TEST_PROVIDER_KEY"]).toBeUndefined();
  });

  it("returns an empty store when the file is corrupt instead of throwing", async () => {
    writeFileSync(filePath, "{not valid json");
    const store = await loadStore();
    const result = store.loadPersistedIntegrationKeys();
    expect(result).toMatchObject({ loaded: 0, skipped: 0, decryptionFailures: [] });
    expect(store.isIntegrationKeyPersisted("TEST_PROVIDER_KEY")).toBe(false);
  });

  describe("rotateEncryptionSecret", () => {
    it("migrates all entries to the new secret — store is readable after rotation", async () => {
      const oldSecret = "test-secret-long-enough";
      const newSecret = "new-rotated-secret-long";

      // Persist two keys with old secret
      const store = await loadStore();
      store.persistIntegrationKey("TEST_PROVIDER_KEY", "api-key-value-1");
      store.persistIntegrationKey("TEST_PROVIDER_KEY_2", "api-key-value-2");

      // Rotate to new secret (JWT_SECRET is still old here)
      const result = store.rotateEncryptionSecret(oldSecret, newSecret);
      expect(result).toEqual({ rotated: 2, failed: [], dryRun: false, total: 2 });

      // Switch JWT_SECRET to the new value, clear env vars
      process.env["JWT_SECRET"] = newSecret;
      delete process.env["TEST_PROVIDER_KEY"];
      delete process.env["TEST_PROVIDER_KEY_2"];

      // Fresh module load should decrypt successfully with the new secret
      const store2 = await loadStore();
      const loadResult = store2.loadPersistedIntegrationKeys();
      expect(loadResult).toMatchObject({ loaded: 2, skipped: 0, decryptionFailures: [] });
      expect(process.env["TEST_PROVIDER_KEY"]).toBe("api-key-value-1");
      expect(process.env["TEST_PROVIDER_KEY_2"]).toBe("api-key-value-2");
    });

    it("old secret no longer decrypts after rotation", async () => {
      const oldSecret = "test-secret-long-enough";
      const newSecret = "new-rotated-secret-long";

      const store = await loadStore();
      store.persistIntegrationKey("TEST_PROVIDER_KEY", "my-api-key");

      store.rotateEncryptionSecret(oldSecret, newSecret);

      // Attempt to load with old secret — should fail to decrypt
      // (JWT_SECRET is still the old value in this scope)
      delete process.env["TEST_PROVIDER_KEY"];
      const store2 = await loadStore();
      const result = store2.loadPersistedIntegrationKeys();
      expect(result).toMatchObject({ loaded: 0, decryptionFailures: ["TEST_PROVIDER_KEY"] });
      expect(process.env["TEST_PROVIDER_KEY"]).toBeUndefined();
    });

    it("leaves entries that cannot be decrypted with old secret unchanged", async () => {
      const oldSecret = "test-secret-long-enough";
      const newSecret = "new-rotated-secret-long";
      const unrelatedSecret = "yet-another-secret-!!";

      // Persist TEST_PROVIDER_KEY with old secret, TEST_OTHER_KEY with a different secret
      const store = await loadStore();
      store.persistIntegrationKey("TEST_PROVIDER_KEY", "key-A");

      // Manually write TEST_OTHER_KEY encrypted with an unrelated secret
      // by temporarily switching JWT_SECRET
      process.env["JWT_SECRET"] = unrelatedSecret;
      const store2 = await loadStore();
      store2.persistIntegrationKey("TEST_OTHER_KEY", "key-B");

      // Back to old secret for rotation
      process.env["JWT_SECRET"] = oldSecret;
      const store3 = await loadStore();

      const result = store3.rotateEncryptionSecret(oldSecret, newSecret);
      // TEST_PROVIDER_KEY rotates OK, TEST_OTHER_KEY fails (encrypted with unrelated secret)
      expect(result.rotated).toBe(1);
      expect(result.failed).toEqual(["TEST_OTHER_KEY"]);

      // Switch to new secret and verify TEST_PROVIDER_KEY loads
      process.env["JWT_SECRET"] = newSecret;
      delete process.env["TEST_PROVIDER_KEY"];
      delete process.env["TEST_OTHER_KEY"];
      const store4 = await loadStore();
      const loadResult = store4.loadPersistedIntegrationKeys();
      expect(loadResult.loaded).toBe(1);
      expect(process.env["TEST_PROVIDER_KEY"]).toBe("key-A");
      // TEST_OTHER_KEY still fails because it was left with the unrelated encryption
      expect(loadResult.decryptionFailures).toContain("TEST_OTHER_KEY");
    });

    it("empty store: rotation returns rotated=0 failed=[]", async () => {
      const store = await loadStore();
      const result = store.rotateEncryptionSecret(
        "test-secret-long-enough",
        "new-rotated-secret-long",
      );
      expect(result).toEqual({ rotated: 0, failed: [], dryRun: false, total: 0 });
    });

    describe("dryRun", () => {
      it("dry-run with correct old secret: previews rotated count and writes nothing", async () => {
        const oldSecret = "test-secret-long-enough";
        const newSecret = "new-rotated-secret-long";

        const store = await loadStore();
        store.persistIntegrationKey("TEST_PROVIDER_KEY", "api-key-value-1");
        store.persistIntegrationKey("TEST_PROVIDER_KEY_2", "api-key-value-2");

        const fileBefore = readFileSync(filePath, "utf8");

        const preview = store.rotateEncryptionSecret(oldSecret, newSecret, {
          dryRun: true,
        });
        expect(preview).toEqual({
          rotated: 2,
          failed: [],
          dryRun: true,
          total: 2,
        });

        // File on disk must be byte-for-byte unchanged
        const fileAfter = readFileSync(filePath, "utf8");
        expect(fileAfter).toBe(fileBefore);

        // Existing entries must still decrypt with the OLD secret
        // (proving nothing was actually re-encrypted)
        delete process.env["TEST_PROVIDER_KEY"];
        delete process.env["TEST_PROVIDER_KEY_2"];
        const store2 = await loadStore();
        const loadResult = store2.loadPersistedIntegrationKeys();
        expect(loadResult).toMatchObject({ loaded: 2, decryptionFailures: [] });
        expect(process.env["TEST_PROVIDER_KEY"]).toBe("api-key-value-1");
      });

      it("dry-run with WRONG old secret: surfaces every key as failed and writes nothing", async () => {
        const realOldSecret = "test-secret-long-enough";
        const wrongOldSecret = "totally-wrong-old-secret";
        const newSecret = "new-rotated-secret-long";

        const store = await loadStore();
        store.persistIntegrationKey("TEST_PROVIDER_KEY", "api-key-value-1");
        store.persistIntegrationKey("TEST_PROVIDER_KEY_2", "api-key-value-2");

        const fileBefore = readFileSync(filePath, "utf8");

        const preview = store.rotateEncryptionSecret(wrongOldSecret, newSecret, {
          dryRun: true,
        });
        expect(preview.dryRun).toBe(true);
        expect(preview.rotated).toBe(0);
        expect(preview.total).toBe(2);
        expect(preview.failed.sort()).toEqual(
          ["TEST_PROVIDER_KEY", "TEST_PROVIDER_KEY_2"].sort(),
        );

        // File untouched
        expect(readFileSync(filePath, "utf8")).toBe(fileBefore);

        // Real rotation with the correct old secret still works afterwards
        const realResult = store.rotateEncryptionSecret(realOldSecret, newSecret);
        expect(realResult).toEqual({
          rotated: 2,
          failed: [],
          dryRun: false,
          total: 2,
        });
      });

      it("dry-run rejects short secrets just like real rotation", async () => {
        const store = await loadStore();
        expect(() =>
          store.rotateEncryptionSecret("short", "new-rotated-secret-long", {
            dryRun: true,
          }),
        ).toThrow(/oldSecret must be at least 8/);
        expect(() =>
          store.rotateEncryptionSecret(
            "test-secret-long-enough",
            "short",
            { dryRun: true },
          ),
        ).toThrow(/newSecret must be at least 8/);
      });
    });

    it("rejects short oldSecret or newSecret", async () => {
      const store = await loadStore();
      expect(() => store.rotateEncryptionSecret("short", "new-rotated-secret-long")).toThrow(
        /oldSecret must be at least 8/,
      );
      expect(() => store.rotateEncryptionSecret("test-secret-long-enough", "short")).toThrow(
        /newSecret must be at least 8/,
      );
    });
  });
});
