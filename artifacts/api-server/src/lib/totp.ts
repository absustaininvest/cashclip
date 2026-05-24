import { createHmac, randomBytes } from "crypto";

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
