import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "./logger";

const FILE_PATH = resolve(
  process.env["INTEGRATION_KEYS_PATH"] ?? ".data/integration-keys.enc.json",
);
const SCRYPT_SALT = "cashclip-integration-keys-v1";
const ALGO = "aes-256-gcm";

interface EncryptedFile {
  version: 1;
  entries: Record<
    string,
    { iv: string; tag: string; ciphertext: string }
  >;
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SCRYPT_SALT, 32);
}

function getSecret(): Buffer | null {
  const secret = process.env["JWT_TRIDENTE"] ?? process.env["JWT_SECRET"];
  if (!secret || secret.length < 8) {
    return null;
  }
  return deriveKey(secret);
}

function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(
  entry: { iv: string; tag: string; ciphertext: string },
  key: Buffer,
): string {
  const iv = Buffer.from(entry.iv, "base64");
  const tag = Buffer.from(entry.tag, "base64");
  const ciphertext = Buffer.from(entry.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

function readFile(): EncryptedFile {
  if (!existsSync(FILE_PATH)) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = readFileSync(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as EncryptedFile;
    if (parsed?.version !== 1 || typeof parsed.entries !== "object") {
      throw new Error("Unexpected file shape");
    }
    return parsed;
  } catch (err) {
    logger.error(
      { err, file: FILE_PATH },
      "Failed to read integration key store; starting with empty store",
    );
    return { version: 1, entries: {} };
  }
}

function writeFileAtomic(data: EncryptedFile) {
  mkdirSync(dirname(FILE_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${FILE_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE_PATH);
}

interface KeyHealthState {
  decryptionFailures: string[];
  secretMissing: boolean;
  checkedAt: number;
}

let lastKeyHealth: KeyHealthState = {
  decryptionFailures: [],
  secretMissing: false,
  checkedAt: 0,
};

export function getIntegrationKeyHealth(): KeyHealthState {
  return { ...lastKeyHealth, decryptionFailures: [...lastKeyHealth.decryptionFailures] };
}

export function clearIntegrationKeyHealthFor(envKey: string): void {
  if (lastKeyHealth.decryptionFailures.includes(envKey)) {
    lastKeyHealth = {
      ...lastKeyHealth,
      decryptionFailures: lastKeyHealth.decryptionFailures.filter((k) => k !== envKey),
    };
  }
}

export function loadPersistedIntegrationKeys(): {
  loaded: number;
  skipped: number;
  decryptionFailures: string[];
} {
  const key = getSecret();
  if (!key) {
    logger.warn(
      "JWT_SECRET not set or too short — skipping persisted integration key load",
    );
    lastKeyHealth = {
      decryptionFailures: [],
      secretMissing: true,
      checkedAt: Date.now(),
    };
    return { loaded: 0, skipped: 0, decryptionFailures: [] };
  }
  const file = readFile();
  let loaded = 0;
  let skipped = 0;
  const decryptionFailures: string[] = [];
  for (const [envKey, entry] of Object.entries(file.entries)) {
    if (process.env[envKey]) {
      // env var already set (e.g. via project Secrets) takes precedence
      skipped += 1;
      continue;
    }
    try {
      process.env[envKey] = decrypt(entry, key);
      loaded += 1;
    } catch (err) {
      decryptionFailures.push(envKey);
      logger.error(
        { err, envKey },
        "Failed to decrypt persisted integration key — this usually means JWT_SECRET was rotated. " +
        `Re-enter the API key for this provider via the admin integrations panel (env key: ${envKey}).`,
      );
    }
  }
  if (loaded > 0 || skipped > 0 || decryptionFailures.length > 0) {
    logger.info(
      { loaded, skipped, decryptionFailures, file: FILE_PATH },
      "Loaded persisted integration keys",
    );
  }
  if (decryptionFailures.length > 0) {
    logger.warn(
      { decryptionFailures },
      `${decryptionFailures.length} integration key(s) could not be decrypted and must be re-entered: ${decryptionFailures.join(", ")}. ` +
      "If you recently rotated JWT_SECRET, use POST /api/admin/integrations/rotate-secret with the old secret to migrate the store.",
    );
  }
  lastKeyHealth = {
    decryptionFailures: [...decryptionFailures],
    secretMissing: false,
    checkedAt: Date.now(),
  };
  return { loaded, skipped, decryptionFailures };
}

export function persistIntegrationKey(envKey: string, value: string): boolean {
  const key = getSecret();
  if (!key) {
    logger.warn(
      { envKey },
      "JWT_SECRET not set — saved key only in-process, not persisted to disk",
    );
    return false;
  }
  const file = readFile();
  file.entries[envKey] = encrypt(value, key);
  writeFileAtomic(file);
  clearIntegrationKeyHealthFor(envKey);
  return true;
}

export function deletePersistedIntegrationKey(envKey: string): boolean {
  const file = readFile();
  if (!(envKey in file.entries)) {
    return false;
  }
  delete file.entries[envKey];
  writeFileAtomic(file);
  clearIntegrationKeyHealthFor(envKey);
  return true;
}

export function isIntegrationKeyPersisted(envKey: string): boolean {
  const file = readFile();
  return envKey in file.entries;
}

/**
 * Re-encrypts every entry in the on-disk store from `oldSecret` to `newSecret`
 * (which should be the current JWT_SECRET value).
 *
 * Returns the number of entries successfully rotated and the list of env keys
 * that could not be decrypted with the old secret (they will remain unchanged
 * in the store so the operator can re-enter them manually).
 *
 * This is an atomic operation: the file is only replaced after all successful
 * entries have been re-encrypted.
 *
 * When `dryRun` is true, the function only previews what would happen: nothing
 * is written to disk and no in-memory health state is mutated. The returned
 * shape is the same plus `dryRun: true` so callers can distinguish it. This is
 * useful for validating that the supplied old secret actually decrypts the
 * existing entries before committing to a real rotation — an operator who
 * accidentally supplies a wrong old secret would otherwise see rotated=0 with
 * every key listed in `failed` and might not realize nothing was migrated.
 */
export function rotateEncryptionSecret(
  oldSecret: string,
  newSecret: string,
  options: { dryRun?: boolean } = {},
): { rotated: number; failed: string[]; dryRun: boolean; total: number } {
  if (!oldSecret || oldSecret.length < 8) {
    throw new Error("oldSecret must be at least 8 characters");
  }
  if (!newSecret || newSecret.length < 8) {
    throw new Error("newSecret must be at least 8 characters");
  }

  const dryRun = options.dryRun === true;
  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  const file = readFile();
  const failed: string[] = [];
  let rotated = 0;

  const updatedEntries: EncryptedFile["entries"] = {};

  for (const [envKey, entry] of Object.entries(file.entries)) {
    try {
      const plaintext = decrypt(entry, oldKey);
      // In dry-run mode we still attempt re-encryption to catch any errors,
      // but we never persist the result.
      updatedEntries[envKey] = dryRun ? entry : encrypt(plaintext, newKey);
      rotated += 1;
      if (!dryRun) {
        clearIntegrationKeyHealthFor(envKey);
      }
    } catch {
      // Leave the entry as-is so it isn't silently dropped
      updatedEntries[envKey] = entry;
      failed.push(envKey);
      if (!dryRun) {
        logger.warn(
          { envKey },
          "rotateEncryptionSecret: could not decrypt entry with old secret — entry left unchanged, re-enter this key manually",
        );
      }
    }
  }

  const total = Object.keys(file.entries).length;

  if (dryRun) {
    logger.info(
      { rotated, failed, total, file: FILE_PATH, dryRun: true },
      "Integration key store rotation dry-run preview (no changes written)",
    );
    return { rotated, failed, dryRun: true, total };
  }

  writeFileAtomic({ version: 1, entries: updatedEntries });

  logger.info(
    { rotated, failed, total, file: FILE_PATH },
    "Integration key store re-encrypted with new secret",
  );

  return { rotated, failed, dryRun: false, total };
}
