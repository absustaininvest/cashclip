import { secureGet, secureSet } from "./secure-store";

const TOKEN_KEY_PREFIX = "cashclip_install_token_v1";

/**
 * In-memory cache keyed by userId so account switches on one device don't
 * cross-contaminate tokens.
 */
const cache = new Map<string, string>();

/**
 * Extracts a user identifier from a JWT auth token to scope install token
 * storage per user. Decodes without verification — used only as a storage
 * key discriminator, not as a security boundary.
 */
function extractUserIdFromJwt(authToken: string): string {
  try {
    const parts = authToken.split(".");
    if (parts.length !== 3) return "unknown";
    // Base64url → standard base64: replace URL-safe chars, then pad to a
    // multiple of 4 so atob() doesn't throw on unpadded JWT payloads.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const id = payload.userId ?? payload.sub ?? null;
    return typeof id === "string" && id.length > 0 ? id : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Returns the server-issued install token for this device+user.
 *
 * Storage is user-scoped so that account switches on a shared device don't
 * cause one user's token to be presented under another user's session.
 *
 * On first call for a given user (or after token loss), registers the device
 * with the server: the server generates an opaque random token, stores its
 * SHA-256 hash in device_installs, and returns the raw token. The client
 * caches it per-user in secure storage and sends it as X-Install-Token on
 * all sponsored-visit requests.
 *
 * The token is server-issued and rate-limited at registration, so it cannot
 * be freely reminted per account the way a client-generated UUID can.
 */
export async function getOrRegisterInstallToken(
  authToken: string,
  deviceId: string,
  apiBase: string,
): Promise<string | null> {
  const userId = extractUserIdFromJwt(authToken);
  const storageKey = `${TOKEN_KEY_PREFIX}:${userId}`;

  const memCached = cache.get(userId);
  if (memCached) return memCached;

  try {
    const existing = await secureGet(storageKey);
    if (existing && /^[a-f0-9]{64}$/.test(existing)) {
      cache.set(userId, existing);
      return existing;
    }
  } catch {}

  try {
    const res = await globalThis.fetch(
      new URL("/api/device/register", apiBase).toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
        },
        body: "{}",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { installToken?: string };
    if (!data.installToken || !/^[a-f0-9]{64}$/.test(data.installToken)) return null;
    try { await secureSet(storageKey, data.installToken); } catch {}
    cache.set(userId, data.installToken);
    return data.installToken;
  } catch {
    return null;
  }
}

/** Call on logout or account switch to invalidate the in-memory cache. */
export function clearInstallTokenCache(userId?: string): void {
  if (userId) {
    cache.delete(userId);
  } else {
    cache.clear();
  }
}
