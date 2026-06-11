export type OfferwallProviderKey = "tapjoy" | "adgate" | "offertoro" | "lootably" | "adjoe" | "adgem" | "ayet" | "notik" | "revlum" | "monlix" | "paymentwall";

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
  appId?: string | undefined;
  reportingKey?: string | undefined;
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
      appId: process.env.TAPJOY_APP_ID,
      reportingKey: process.env.TAPJOY_REPORTING_KEY,
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
    {
      key: "lootably",
      name: "Lootably",
      apiKey: process.env.LOOTABLY_API_KEY,
      baseUrl: "https://api.lootably.com/api/v1",
      isConfigured: !!process.env.LOOTABLY_API_KEY,
    },
    {
      key: "adjoe",
      name: "Adjoe",
      apiKey: process.env.ADJOE_SDK_KEY,
      baseUrl: "https://ad-backend.adjoe.io/v1",
      isConfigured: !!process.env.ADJOE_SDK_KEY && !!process.env.ADJOE_APP_ID,
    },
    {
      key: "adgem",
      name: "AdGem",
      apiKey: process.env.ADGEM_API_KEY,
      appId: process.env.ADGEM_APP_ID,
      baseUrl: "https://adgem.com/api/v1",
      isConfigured: !!process.env.ADGEM_API_KEY,
    },
    {
      key: "ayet",
      name: "AyeT Studios",
      apiKey: process.env.AYET_APP_ID,
      baseUrl: "https://www.ayetstudios.com/api/v1",
      isConfigured: !!process.env.AYET_APP_ID,
    },
    {
      key: "notik",
      name: "Notik",
      apiKey: process.env.NOTIK_API_KEY,
      baseUrl: "https://notik.me/api/v1",
      isConfigured: !!process.env.NOTIK_API_KEY,
    },
    {
      key: "revlum",
      name: "Revlum",
      apiKey: process.env.REVLUM_API_KEY,
      baseUrl: "https://revlum.com/api/v1",
      isConfigured: !!process.env.REVLUM_API_KEY,
    },
    {
      key: "monlix",
      name: "Monlix",
      apiKey: process.env.MONLIX_API_KEY,
      appId: process.env.MONLIX_APP_ID,
      baseUrl: "https://offers.monlix.com/api/v1",
      isConfigured: !!process.env.MONLIX_API_KEY && !!process.env.MONLIX_APP_ID,
    },
    {
      key: "paymentwall",
      name: "Paymentwall",
      apiKey: process.env.PAYMENTWALL_APP_KEY,
      baseUrl: "https://api.paymentwall.com/api",
      isConfigured: !!process.env.PAYMENTWALL_APP_KEY,
    },
  ];
}

async function fetchTapjoyOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const appIdParam = config.appId ? `?app_id=${encodeURIComponent(config.appId)}` : "";
    const res = await fetch(`${config.baseUrl}/offers${appIdParam}`, {
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
      offerUrl: sanitizeOfferUrl(o.click_url || o.offer_url || `https://app.tapjoy.com/offer/${o.offer_id || o.id}`, config.apiKey, "tapjoy"),
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
      offerUrl: sanitizeOfferUrl(o.link || o.offer_url || `https://wall.adgaterewards.com/offer/${o.id}`, config.apiKey, "adgate"),
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
      offerUrl: sanitizeOfferUrl(o.offer_url || o.tracking_url || `https://www.offertoro.com/offer/${o.offer_id || o.id}`, config.apiKey, "offertoro"),
      brand: o.advertiser || o.brand,
    }));
  } catch (err) {
    return [];
  }
}

async function fetchLootablyOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers?api_key=${config.apiKey}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Lootably API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => {
      const payout = typeof o.payout === "number" ? o.payout : parseFloat(o.payout || o.reward || "0.30");
      return {
        id: `lootably_${o.offer_id || o.id}`,
        provider: "lootably",
        providerName: "Lootably",
        title: o.name || o.title || "Lootably Offer",
        description: o.description || o.instructions || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.offer_type || o.category || o.type),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: !!(o.purchase_required || o.requires_payment),
        offerUrl: sanitizeOfferUrl(o.click_url || o.offer_url || `https://lootably.com/offer/${o.offer_id || o.id}`, config.apiKey, "lootably"),
        brand: o.advertiser || o.brand,
        expiresAt: o.expiry ? new Date(o.expiry).getTime() : undefined,
      };
    });
  } catch (err) {
    return [];
  }
}

async function fetchAdjoeOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const appId = process.env.ADJOE_APP_ID || "";
    const res = await fetch(`${config.baseUrl}/offers?app_id=${appId}`, {
      headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Adjoe API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.campaigns || data.data || []).map((o: any): Offer => {
      const payout = typeof o.payout === "number" ? o.payout
        : typeof o.reward_amount === "number" ? o.reward_amount / 100
        : parseFloat(o.payout || o.reward || "0.50");
      return {
        id: `adjoe_${o.offer_id || o.campaign_id || o.id}`,
        provider: "adjoe",
        providerName: "Adjoe",
        title: o.app_name || o.name || o.title || "Adjoe Offer",
        description: o.description || o.instructions || "Play this app and reach the required level to earn.",
        reward: payout,
        type: normalizeOfferType(o.offer_type || "app_install"),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: false,
        offerUrl: sanitizeOfferUrl(o.click_url || o.tracking_url || o.url || `https://adjoe.io/offer/${o.offer_id || o.id}`, config.apiKey, "adjoe"),
        brand: o.advertiser || o.developer || o.brand,
        iconUrl: o.icon_url || o.app_icon,
        expiresAt: o.end_date ? new Date(o.end_date).getTime() : undefined,
      };
    });
  } catch (err) {
    return [];
  }
}

const OFFER_PROVIDER_TRUSTED_HOSTS: Record<string, string[]> = {
  tapjoy:      ["tapjoy.com", "app.tapjoy.com"],
  adgate:      ["adgaterewards.com", "wall.adgaterewards.com"],
  offertoro:   ["offertoro.com", "www.offertoro.com"],
  lootably:    ["lootably.com", "www.lootably.com"],
  adjoe:       ["adjoe.io", "ad-backend.adjoe.io"],
  adgem:       ["adgem.com", "www.adgem.com"],
  ayet:        ["ayetstudios.com", "www.ayetstudios.com"],
  notik:       ["notik.me", "www.notik.me"],
  revlum:      ["revlum.com", "www.revlum.com"],
  monlix:      ["monlix.com", "offers.monlix.com"],
  paymentwall: ["paymentwall.com", "api.paymentwall.com"],
};

function isTrustedOfferHost(hostname: string, provider: string): boolean {
  const allowed = OFFER_PROVIDER_TRUSTED_HOSTS[provider];
  if (!allowed) return false;
  const h = hostname.toLowerCase();
  return allowed.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function sanitizeOfferUrl(url: string | undefined, apiKey: string | undefined, provider?: string): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  if (provider && !isTrustedOfferHost(parsed.hostname, provider)) return "";
  if (!apiKey || !url.includes(apiKey)) return parsed.toString();
  try {
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
    return "";
  }
}

async function fetchAdGemOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const appId = config.appId || "";
    const res = await fetch(`${config.baseUrl}/offers?api_key=${config.apiKey}&app_id=${appId}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`AdGem API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => {
      const payout = parseFloat(o.payout || o.reward || "0.50");
      return {
        id: `adgem_${o.offer_id || o.id}`,
        provider: "adgem",
        providerName: "AdGem",
        title: o.name || o.title || "AdGem Offer",
        description: o.description || o.instructions || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.offer_type || o.type),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: !!(o.purchase_required),
        offerUrl: sanitizeOfferUrl(o.click_url || o.offer_url || o.link, config.apiKey, "adgem"),
        brand: o.advertiser || o.brand,
      };
    });
  } catch {
    return [];
  }
}

async function fetchAyetOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const appId = config.apiKey || "";
    const res = await fetch(`https://www.ayetstudios.com/api/offers?app_id=${appId}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`AyeT API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.campaigns || []).map((o: any): Offer => {
      const payout = parseFloat(o.payout || o.reward || "0.50");
      return {
        id: `ayet_${o.offer_id || o.id}`,
        provider: "ayet",
        providerName: "AyeT Studios",
        title: o.name || o.title || "AyeT Offer",
        description: o.description || o.instructions || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.offer_type || o.category),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: false,
        offerUrl: sanitizeOfferUrl(o.click_url || o.tracking_url || o.url, config.apiKey, "ayet"),
        brand: o.advertiser || o.brand,
        iconUrl: o.icon_url,
      };
    });
  } catch {
    return [];
  }
}

async function fetchNotikOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers?token=${config.apiKey}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Notik API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => {
      const payout = parseFloat(o.payout || o.reward || "0.25");
      return {
        id: `notik_${o.offer_id || o.id}`,
        provider: "notik",
        providerName: "Notik",
        title: o.name || o.title || "Notik Offer",
        description: o.description || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.type || o.category),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: false,
        offerUrl: sanitizeOfferUrl(o.link || o.click_url, config.apiKey, "notik"),
        brand: o.brand || o.advertiser,
      };
    });
  } catch {
    return [];
  }
}

async function fetchRevlumOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/offers?api_key=${config.apiKey}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Revlum API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => {
      const payout = parseFloat(o.payout || o.reward || "0.30");
      return {
        id: `revlum_${o.offer_id || o.id}`,
        provider: "revlum",
        providerName: "Revlum",
        title: o.name || o.title || "Revlum Offer",
        description: o.description || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.type || o.category),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: false,
        offerUrl: sanitizeOfferUrl(o.link || o.click_url || o.offer_url, config.apiKey, "revlum"),
        brand: o.brand || o.advertiser,
      };
    });
  } catch {
    return [];
  }
}

async function fetchMonlixOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const appId = config.appId || "";
    const res = await fetch(`${config.baseUrl}/offers?app=${appId}&api_key=${config.apiKey}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Monlix API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.offers || data.data || []).map((o: any): Offer => {
      const payout = parseFloat(o.payout || o.reward || o.amount || "0.25");
      return {
        id: `monlix_${o.offer_id || o.id}`,
        provider: "monlix",
        providerName: "Monlix",
        title: o.name || o.title || "Monlix Offer",
        description: o.description || o.instructions || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.type || o.category),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: !!(o.requires_payment),
        offerUrl: sanitizeOfferUrl(o.click_url || o.offer_url, config.apiKey, "monlix"),
        brand: o.brand || o.advertiser,
      };
    });
  } catch {
    return [];
  }
}

async function fetchPaymentwallOffers(config: OfferwallProviderConfig): Promise<Offer[]> {
  try {
    const res = await fetch(`${config.baseUrl}/ps/widgetlist?key=${config.apiKey}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Paymentwall API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.products || data.items || []).map((o: any): Offer => {
      const payout = parseFloat(o.amount || o.price || "1.00");
      return {
        id: `paymentwall_${o.id}`,
        provider: "paymentwall",
        providerName: "Paymentwall",
        title: o.name || "Paymentwall Offer",
        description: o.description || "Complete this offer to earn a reward.",
        reward: payout,
        type: normalizeOfferType(o.type),
        difficulty: (payout >= 2 ? "hard" : payout >= 0.75 ? "medium" : "easy") as Offer["difficulty"],
        requiresPayment: false,
        offerUrl: sanitizeOfferUrl(o.url || o.link, config.apiKey, "paymentwall"),
        brand: o.advertiser,
      };
    });
  } catch {
    return [];
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
      else if (config.key === "lootably") offers = await fetchLootablyOffers(config);
      else if (config.key === "adjoe") offers = await fetchAdjoeOffers(config);
      else if (config.key === "adgem") offers = await fetchAdGemOffers(config);
      else if (config.key === "ayet") offers = await fetchAyetOffers(config);
      else if (config.key === "notik") offers = await fetchNotikOffers(config);
      else if (config.key === "revlum") offers = await fetchRevlumOffers(config);
      else if (config.key === "monlix") offers = await fetchMonlixOffers(config);
      else if (config.key === "paymentwall") offers = await fetchPaymentwallOffers(config);

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
      const appIdQ = config.appId ? `&app_id=${encodeURIComponent(config.appId)}` : "";
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?transaction_id=${txn}&user_id=${user}${appIdQ}`;
      headers["X-Api-Key"] = config.apiKey!;
    } else if (req.provider === "adgate") {
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?api_key=${config.apiKey}&transaction_id=${txn}&user_id=${user}`;
    } else if (req.provider === "offertoro") {
      endpoint = `${config.baseUrl}/conversions/${offer}/verify?pub_id=${config.apiKey}&transaction_id=${txn}&user_id=${user}`;
    } else if (req.provider === "lootably") {
      endpoint = `${config.baseUrl}/conversions/verify?api_key=${config.apiKey}&transaction_id=${txn}&offer_id=${offer}&user_id=${user}`;
    } else if (req.provider === "adjoe") {
      endpoint = `${config.baseUrl}/conversions/verify?transaction_id=${txn}&offer_id=${offer}&user_id=${user}`;
      headers["Authorization"] = `Bearer ${config.apiKey}`;
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
  const statusOk = ["completed", "complete", "success", "verified", "approved"].includes(status);
  if (!statusOk && !flag) return false;
  const txn = (payload.transaction_id || payload.transactionId || "").toString();
  if (!txn || txn !== transactionId) return false;
  const payloadUser = (payload.user_id || payload.userId || "").toString();
  if (!payloadUser || payloadUser !== userId) return false;
  return true;
}

export function getOfferwallProviderStatus(): {
  provider: string;
  name: string;
  configured: boolean;
  appIdConfigured?: boolean;
  reportingKeyConfigured?: boolean;
}[] {
  return getProviderConfigs().map((c) => ({
    provider: c.key,
    name: c.name,
    configured: c.isConfigured,
    ...(c.key === "tapjoy"
      ? { appIdConfigured: !!c.appId, reportingKeyConfigured: !!c.reportingKey }
      : {}),
  }));
}
