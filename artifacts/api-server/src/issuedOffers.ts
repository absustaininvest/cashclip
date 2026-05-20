type OfferSource = "survey" | "offerwall";

interface IssuedOfferRecord {
  source: OfferSource;
  provider: string;
  expectedReward: number;
  expiresAt: number;
}

const ISSUED_TTL_MS = 30 * 60 * 1000;
const MAX_PER_USER = 200;

const issued = new Map<string, Map<string, IssuedOfferRecord>>();

function key(userId: string, externalId: string): string {
  return `${userId}::${externalId}`;
}

function pruneUser(userId: string) {
  const userMap = issued.get(userId);
  if (!userMap) return;
  const now = Date.now();
  for (const [id, rec] of userMap) {
    if (rec.expiresAt < now) userMap.delete(id);
  }
  if (userMap.size > MAX_PER_USER) {
    const sorted = [...userMap.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const drop = sorted.slice(0, sorted.length - MAX_PER_USER);
    for (const [id] of drop) userMap.delete(id);
  }
  if (userMap.size === 0) issued.delete(userId);
}

export function recordIssuedOffers(
  userId: string,
  source: OfferSource,
  offers: { id: string; provider: string; reward: number }[]
): void {
  if (!offers.length) return;
  let userMap = issued.get(userId);
  if (!userMap) {
    userMap = new Map();
    issued.set(userId, userMap);
  }
  const expiresAt = Date.now() + ISSUED_TTL_MS;
  for (const o of offers) {
    userMap.set(o.id, {
      source,
      provider: o.provider,
      expectedReward: o.reward,
      expiresAt,
    });
  }
  pruneUser(userId);
}

export function getIssuedOffer(
  userId: string,
  externalId: string,
  source: OfferSource
): IssuedOfferRecord | null {
  pruneUser(userId);
  const userMap = issued.get(userId);
  if (!userMap) return null;
  const rec = userMap.get(externalId);
  if (!rec) return null;
  if (rec.source !== source) return null;
  if (rec.expiresAt < Date.now()) {
    userMap.delete(externalId);
    return null;
  }
  return rec;
}

export function generateSessionToken(prefix: string): string {
  const rand = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, "");
  return `${prefix}_${Date.now()}_${rand}`;
}
