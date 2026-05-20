export type OfferwallProviderKey = "tapjoy" | "adgate" | "offertoro";

export interface Offer {
  id: string;
  provider: OfferwallProviderKey;
  providerName: string;
  title: string;
  description: string;
  reward: number;
  type: "app_install" | "signup" | "purchase" | "survey" | "video" | "task";
  difficulty: "easy" | "medium" | "hard";
  requiresPayment: boolean;
  offerUrl: string;
  iconUrl?: string;
  brand?: string;
  expiresAt?: number;
}

export interface OfferwallProviderConfig {
  key: OfferwallProviderKey;
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
  isConfigured: boolean;
}

export interface OfferwallListResponse {
  offers: Offer[];
  provider: OfferwallProviderKey;
  error?: string;
}

export interface OfferCompletionVerifyRequest {
  offerId: string;
  provider: OfferwallProviderKey;
  userId: string;
  transactionId: string;
}

export interface OfferCompletionVerifyResponse {
  verified: boolean;
  reward: number;
  error?: string;
}

const OFFER_TYPE_LABELS: Record<string, Offer["type"]> = {
  app: "app_install",
  install: "app_install",
  signup: "signup",
  registration: "signup",
  purchase: "purchase",
  survey: "survey",
  video: "video",
  task: "task",
  default: "task",
};

function normalizeOfferType(raw: string | undefined): Offer["type"] {
  if (!raw) return "task";
  const lower = raw.toLowerCase();
  for (const [key, val] of Object.entries(OFFER_TYPE_LABELS)) {
    if (lower.includes(key)) return val;
  }
  return "task";
}

function getProviderConfigs(): OfferwallProviderConfig[] {
  return [
    {
      key: "tapjoy",
      name: "Tapjoy",
      apiKey: process.env.TAPJOY_SDK_KEY,
      baseUrl: "https://app.tapjoy.com/publisher/v1",
      isConfigured: !!process.env.TAPJOY_SDK_KEY,
    },
    {
      key: "adgate",
      name: "AdGate Media",
      apiKey: process.env.ADGATE_API_KEY,
      baseUrl: "https://wall.adgaterewards.com/api/v1",
      isConfigured: !!process.env.ADGATE_API_KEY,
    },
    {
      key: "offertoro",
      name: "OfferToro",
      apiKey: process.env.OFFERTORO_API_KEY,
      baseUrl: "https://www.offertoro.com/api/v1",
      isConfigured: !!process.env.OFFERTORO_API_KEY,
    },
  ];
}

async function fetchTapjoyOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers`, {
      headers: { "X-Api-Key": config.apiKey!, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Tapjoy API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.items || []).map((o: any): Offer => ({
      id: `tapjoy_${o.offer_id || o.id}`,
      provider: "tapjoy",
      providerName: "Tapjoy",
      title: o.name || o.title || "Tapjoy Offer",
      description: o.description || o.instructions || "Complete this offer to earn a reward.",
      reward: typeof o.payout === "number" ? o.payout : parseFloat(o.payout || o.reward || "0.50"),
      type: normalizeOfferType(o.offer_type || o.type),
      difficulty: (o.payout >= 2 ? "hard" : o.payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
      requiresPayment: o.requires_payment ?? false,
      offerUrl: sanitizeOfferUrl(o.click_url || o.offer_url || `https://app.tapjoy.com/offer/${o.offer_id || o.id}`, config.apiKey),
      brand: o.advertiser_name || o.brand,
      expiresAt: o.expiry_date ? new Date(o.expiry_date).getTime() : undefined,
    }));
  } catch (err) {
    return [];
  }
}

async function fetchAdGateOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers`, {
      headers: { "X-Api-Key": config.apiKey!, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`AdGate API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => ({
      id: `adgate_${o.id || o.offer_id}`,
      provider: "adgate",
      providerName: "AdGate Media",
      title: o.name || o.title || "AdGate Offer",
      description: o.description || "Complete this offer for a reward.",
      reward: typeof o.payout === "number" ? o.payout : parseFloat(o.payout || o.points || "0.40"),
      type: normalizeOfferType(o.category || o.type),
      difficulty: (o.payout >= 2 ? "hard" : o.payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
      requiresPayment: !!(o.purchase_required),
      offerUrl: sanitizeOfferUrl(o.link || o.offer_url || `https://wall.adgaterewards.com/offer/${o.id}`, config.apiKey),
      brand: o.advertiser || o.brand,
    }));
  } catch (err) {
    return [];
  }
}

async function fetchOfferToroOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers`, {
      headers: { "X-Api-Key": config.apiKey!, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`OfferToro API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.result || []).map((o: any): Offer => ({
      id: `offertoro_${o.offer_id || o.id}`,
      provider: "offertoro",
      providerName: "OfferToro",
      title: o.offer_name || o.name || "OfferToro Offer",
      description: o.offer_desc || o.description || "Complete this offer to earn a reward.",
      reward: typeof o.payout === "number" ? o.payout : parseFloat(o.payout || "0.35"),
      type: normalizeOfferType(o.offer_type || o.type),
      difficulty: (o.payout >= 2 ? "hard" : o.payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
      requiresPayment: !!(o.requires_credit_card),
      offerUrl: sanitizeOfferUrl(o.offer_url || o.tracking_url || `https://www.offertoro.com/offer/${o.offer_id || o.id}`, config.apiKey),
      brand: o.advertiser || o.brand,
    }));
  } catch (err) {
    return [];
  }
}

function sanitizeOfferUrl(url: string | undefined, apiKey: string | undefined): string {
  if (!url) return "";
  if (!apiKey || !url.includes(apiKey)) return url;
  try {
    const parsed = new URL(url);
    const toRemove: string[] = [];
    parsed.searchParams.forEach((value, key) => {
      if (value === apiKey) toRemove.push(key);
    });
    if (toRemove.length === 0) {
      const pathSegments = parsed.pathname.split("/");
      const cleaned = pathSegments.filter((seg) => seg !== apiKey).join("/");
      parsed.pathname = cleaned;
    } else {
      toRemove.forEach((key) => parsed.searchParams.delete(key));
    }
    return parsed.toString();
  } catch {
    return url.split("?")[0] || "";
  }
}

export async function fetchAllOffers(): Promise<OfferwallListResponse[]> {
  const configs = getProviderConfigs().filter((c) => c.isConfigured);
  if (configs.length === 0) return [];

  const results = await Promise.allSettled(
    configs.map(async (config): Promise<OfferwallListResponse> => {
      let offers: Offer[] = [];
      if (config.key === "tapjoy") offers = await fetchTapjoyOffers(config);
      else if (config.key === "adgate") offers = await fetchAdGateOffers(config);
      else if (config.key === "offertoro") offers = await fetchOfferToroOffers(config);

      return { offers, provider: config.key };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<OfferwallListResponse> => r.status === "fulfilled")
    .map((r) => r.value);
}

export async function verifyOfferCompletion(req: OfferCompletionVerifyRequest): Promise<OfferCompletionVerifyResponse> {
  const transactionId = (req.transactionId || "").trim();
  if (transactionId.length === 0) {
    return { verified: false, reward: 0, error: "transactionId is required for offer verification" };
  }

  const configs = getProviderConfigs();
  const config = configs.find((c) => c.key === req.provider);
  if (!config || !config.isConfigured) {
    return { verified: false, reward: 0, error: `Provider ${req.provider} not configured` };
  }

  try {
    let endpoint = "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const txn = encodeURIComponent(transactionId);
    const offer = encodeURIComponent(req.offerId);
    const user = encodeURIComponent(req.userId);

    if (req.provider === "tapjoy") {
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?transaction_id=${txn}&user_id=${user}`;
      headers["X-Api-Key"] = config.apiKey!;
    } else if (req.provider === "adgate") {
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?api_key=${config.apiKey}&transaction_id=${txn}&user_id=${user}`;
    } else if (req.provider === "offertoro") {
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?pub_id=${config.apiKey}&transaction_id=${txn}&user_id=${user}`;
    }

    const res = await fetch(endpoint, { method: "GET", headers });
    if (!res.ok) {
      return { verified: false, reward: 0, error: `Provider returned ${res.status}` };
    }
    const bodyOk = await offerCompletionBodyOk(res, transactionId, req.userId);
    if (!bodyOk) {
      return { verified: false, reward: 0, error: "Provider response did not confirm completion" };
    }
    return { verified: true, reward: 0 };
  } catch {
    return { verified: false, reward: 0, error: "Provider verification request failed" };
  }
}

interface OfferCompletionPayload {
  status?: string;
  state?: string;
  completed?: boolean;
  verified?: boolean;
  transaction_id?: string;
  transactionId?: string;
  user_id?: string;
  userId?: string;
}

async function offerCompletionBodyOk(res: Response, transactionId: string, userId: string): Promise<boolean> {
  let payload: OfferCompletionPayload | null = null;
  try {
    const text = await res.text();
    if (!text) return false;
    payload = JSON.parse(text) as OfferCompletionPayload;
  } catch {
    return false;
  }
  if (!payload || typeof payload !== "object") return false;
  const status = (payload.status || payload.state || "").toString().toLowerCase();
  const flag = payload.completed === true || payload.verified === true;
  const txn = (payload.transaction_id || payload.transactionId || "").toString();
  const statusOk = ["completed", "complete", "success", "verified", "approved"].includes(status);
  if (!statusOk && !flag) return false;
  if (txn && txn !== transactionId) return false;
  const payloadUser = (payload.user_id || payload.userId || "").toString();
  if (payloadUser && payloadUser !== userId) return false;
  return true;
}

export function getOfferwallProviderStatus(): { provider: string; name: string; configured: boolean }[] {
  return getProviderConfigs().map((c) => ({
    provider: c.key,
    name: c.name,
    configured: c.isConfigured,
  }));
}
