import { createHmac, createHash, randomBytes } from "crypto";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  const result: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of s) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}

function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret(
  label = "AB Sustainability Admin",
  issuer = "AB Sustainability",
): { secret: string; uri: string } {
  const secret = base32Encode(randomBytes(20));
  const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

// ── Backup recovery codes ────────────────────────────────────────────────────
// Single-use codes shown once at 2FA setup so a lost authenticator never locks
// an admin out. Plaintext is returned to the client exactly once; only SHA-256
// hashes are persisted. Codes are high-entropy (50 bits) so an unsalted hash is
// sufficient; lookup is by exact hash match against the stored set.

// Normalize user input: uppercase and strip everything but A-Z/2-7 so that
// dashes, spaces, and casing in what the admin types/pastes don't matter.
export function normalizeBackupCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

// Returns formatted plaintext codes (e.g. "ABCDE-FGHIJ") for one-time display
// plus their hashes for storage. base32 alphabet keeps them copy/print friendly.
export function generateBackupCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    codes.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }
  return { codes, hashes };
}

export function verifyTotp(secret: string, code: string, windowSize = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const secretBuf = base32Decode(secret);
    const step = Math.floor(Date.now() / 1000 / 30);
    for (let i = -windowSize; i <= windowSize; i++) {
      if (hotp(secretBuf, step + i) === code) return true;
    }
    return false;
  } catch {
    return false;
  }
}
