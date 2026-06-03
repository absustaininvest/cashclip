import crypto from "node:crypto";

function md5hex(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

export type SurveyProviderKey = "pollfish" | "cint" | "lucid" | "cpx" | "bitlabs" | "internal";

export interface ExternalSurvey {
  id: string;
  provider: SurveyProviderKey;
  providerName: string;
  title: string;
  description: string;
  reward: number;
  estimatedMinutes: number;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  surveyUrl: string;
  completionVerificationUrl?: string;
}

export interface ProviderConfig {
  key: SurveyProviderKey;
  name: string;
  apiKey: string | undefined;
  baseUrl: string;
  isConfigured: boolean;
}

export interface SurveyListResponse {
  surveys: ExternalSurvey[];
  provider: SurveyProviderKey;
  error?: string;
}

export interface CompletionVerifyRequest {
  surveyId: string;
  provider: SurveyProviderKey;
  userId: string;
  transactionId: string;
}

export interface CompletionVerifyResponse {
  verified: boolean;
  reward: number;
  error?: string;
}

function getProviderConfigs(): ProviderConfig[] {
  return [
    {
      key: "pollfish",
      name: "Pollfish",
      apiKey: process.env.POLLFISH_API_KEY,
      baseUrl: "https://api.pollfish.com/v2",
      isConfigured: !!process.env.POLLFISH_API_KEY,
    },
    {
      key: "cint",
      name: "Cint",
      apiKey: process.env.CINT_API_KEY,
      baseUrl: "https://api.cint.com/v1",
      isConfigured: !!process.env.CINT_API_KEY,
    },
    {
      key: "lucid",
      name: "Lucid (Cint)",
      apiKey: process.env.LUCID_API_KEY,
      baseUrl: "https://api.samplicio.us/supply/v1",
      isConfigured: !!process.env.LUCID_API_KEY,
    },
    {
      key: "cpx",
      name: "CPX Research",
      apiKey: process.env.CPX_API_KEY,
      baseUrl: "https://live.cpx-research.com/api",
      isConfigured: !!process.env.CPX_API_KEY && !!process.env.CPX_APP_ID,
    },
    {
      key: "bitlabs",
      name: "BitLabs",
      apiKey: process.env.BITLABS_API_KEY,
      baseUrl: "https://api.bitlabs.ai/v1",
      isConfigured: !!process.env.BITLABS_API_KEY,
    },
  ];
}

function sanitizeSurveyUrl(url: string | undefined, apiKey: string | undefined): string {
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

async function fetchPollfishSurveys(config: ProviderConfig): Promise<ExternalSurvey[]> {
  try {
    const res = await fetch(`${config.baseUrl}/surveys/available`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Pollfish API error: ${res.status}`);
    const data = await res.json() as any;
    const surveys: ExternalSurvey[] = (data.surveys || []).map((s: any) => ({
      id: `pollfish_${s.survey_id || s.id}`,
      provider: "pollfish" as SurveyProviderKey,
      providerName: "Pollfish",
      title: s.survey_name || s.title || "Pollfish Survey",
      description: s.description || "Complete this survey to earn a reward.",
      reward: typeof s.reward_value === "number" ? s.reward_value : parseFloat(s.reward_value || "0.50"),
      estimatedMinutes: s.loi || s.estimated_minutes || 5,
      category: s.category || "General",
      difficulty: (s.loi && s.loi <= 5 ? "easy" : s.loi <= 10 ? "medium" : "hard") as "easy" | "medium" | "hard",
      surveyUrl: sanitizeSurveyUrl(s.survey_url || `https://wss.pollfish.com/link/survey?survey_id=${s.survey_id || s.id}`, config.apiKey),
    }));
    return surveys;
  } catch (err) {
    return [];
  }
}

async function fetchCintSurveys(config: ProviderConfig): Promise<ExternalSurvey[]> {
  try {
    const res = await fetch(`${config.baseUrl}/surveys/available`, {
      headers: {
        "X-Api-Key": config.apiKey!,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Cint API error: ${res.status}`);
    const data = await res.json() as any;
    const surveys: ExternalSurvey[] = (data.surveys || data.items || []).map((s: any) => ({
      id: `cint_${s.id || s.surveyId}`,
      provider: "cint" as SurveyProviderKey,
      providerName: "Cint",
      title: s.name || s.title || "Cint Research Survey",
      description: s.description || "Market research survey from Cint.",
      reward: typeof s.cpi === "number" ? s.cpi : parseFloat(s.cpi || "1.00"),
      estimatedMinutes: s.loi || s.length_of_interview || 8,
      category: s.category || "Market Research",
      difficulty: (s.loi && s.loi <= 6 ? "easy" : s.loi <= 12 ? "medium" : "hard") as "easy" | "medium" | "hard",
      surveyUrl: sanitizeSurveyUrl(s.link || s.survey_url || `https://survey.cint.com/${s.id || s.surveyId}`, config.apiKey),
    }));
    return surveys;
  } catch (err) {
    return [];
  }
}

async function fetchLucidSurveys(config: ProviderConfig): Promise<ExternalSurvey[]> {
  try {
    const res = await fetch(`${config.baseUrl}/surveys/available`, {
      headers: {
        Authorization: config.apiKey!,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Lucid API error: ${res.status}`);
    const data = await res.json() as any;
    const surveys: ExternalSurvey[] = (data.AllSurveys || data.surveys || []).map((s: any) => ({
      id: `lucid_${s.SurveyNumber || s.id}`,
      provider: "lucid" as SurveyProviderKey,
      providerName: "Lucid (Cint)",
      title: s.SurveyName || s.title || "Lucid Research Survey",
      description: s.SurveyBrief || s.description || "Research survey from Lucid marketplace.",
      reward: typeof s.CPI === "number" ? s.CPI : parseFloat(s.CPI || "1.20"),
      estimatedMinutes: s.LOI || s.loi || 10,
      category: s.SurveyGroup || s.category || "Research",
      difficulty: (s.LOI && s.LOI <= 6 ? "easy" : s.LOI <= 15 ? "medium" : "hard") as "easy" | "medium" | "hard",
      surveyUrl: sanitizeSurveyUrl(s.SurveyURL || s.survey_url || `https://www.samplicio.us/s/${s.SurveyNumber || s.id}`, config.apiKey),
    }));
    return surveys;
  } catch (err) {
    return [];
  }
}

export function buildCpxWallUrl(userId: string, appId: string, apiKey: string, username?: string, email?: string): string {
  const secureHash = md5hex(`${userId}-${apiKey}`);
  const params = new URLSearchParams({
    app_id: appId,
    ext_user_id: userId,
    secure_hash: secureHash,
  });
  if (username) params.set("username", username);
  if (email) params.set("email", email);
  return `https://offers.cpx-research.com/index.php?${params.toString()}`;
}

function cpxWallCard(userId: string, appId: string, apiKey: string): ExternalSurvey {
  return {
    id: "cpx_wall",
    provider: "cpx" as SurveyProviderKey,
    providerName: "CPX Research",
    title: "CPX Research Surveys",
    description: "Earn cash completing paid surveys from CPX Research. Multiple surveys available — payouts credited automatically.",
    reward: 0.50,
    estimatedMinutes: 5,
    category: "Multiple Topics",
    difficulty: "easy" as "easy" | "medium" | "hard",
    surveyUrl: buildCpxWallUrl(userId, appId, apiKey),
  };
}

function cpxDifficulty(minutes: number): "easy" | "medium" | "hard" {
  if (minutes <= 6) return "easy";
  if (minutes <= 14) return "medium";
  return "hard";
}

interface CpxFetchOpts {
  ipUser?: string;
  userAgent?: string;
}

// Fetch the live list of individual CPX surveys for this user via the CPX
// JSON survey API (output_method=api). Each survey becomes its own card on the
// Surveys tab. CPX returns a per-user, per-survey signed deep link in `href`.
// `payout` is the user-facing payout in USD (the CPX app is configured in USD).
// Falls back to the single offerwall card when the API returns nothing or errors
// so the Surveys tab is never empty.
async function fetchCpxSurveys(config: ProviderConfig, userId: string, opts?: CpxFetchOpts): Promise<ExternalSurvey[]> {
  const appId = process.env.CPX_APP_ID;
  if (!appId || !config.apiKey || !userId) return [];
  try {
    const secureHash = md5hex(`${userId}-${config.apiKey}`);
    const params = new URLSearchParams({
      app_id: appId,
      ext_user_id: userId,
      secure_hash: secureHash,
      output_method: "api",
      limit: "20",
    });
    if (opts?.ipUser) params.set("ip_user", opts.ipUser);
    if (opts?.userAgent) params.set("user_agent", opts.userAgent);

    const res = await fetch(`https://live-api.cpx-research.com/api/get-surveys.php?${params.toString()}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return [cpxWallCard(userId, appId, config.apiKey)];

    const data = await res.json() as any;
    const list = Array.isArray(data?.surveys) ? data.surveys : [];

    const surveys: ExternalSurvey[] = list
      .map((s: any): ExternalSurvey | null => {
        const id = String(s?.id ?? s?.survey_id ?? "").trim();
        const url = String(s?.href ?? s?.href_new ?? "").trim();
        if (!id || !url) return null;
        const reward = parseFloat(String(s?.payout ?? s?.payout_publisher_usd ?? "0")) || 0;
        const minutes = parseInt(String(s?.loi ?? "5"), 10) || 5;
        const category = String(s?.category || "Survey").trim() || "Survey";
        return {
          id: `cpx_${id}`,
          provider: "cpx" as SurveyProviderKey,
          providerName: "CPX Research",
          title: `${category} Survey`,
          description: `Earn $${reward.toFixed(2)} for about ${minutes} min — payout credited automatically.`,
          reward,
          estimatedMinutes: minutes,
          category,
          difficulty: cpxDifficulty(minutes),
          surveyUrl: url,
        };
      })
      .filter((s: ExternalSurvey | null): s is ExternalSurvey => s !== null);

    if (surveys.length === 0) return [cpxWallCard(userId, appId, config.apiKey)];
    return surveys;
  } catch {
    return [cpxWallCard(userId, appId, config.apiKey)];
  }
}

async function fetchBitlabsSurveys(config: ProviderConfig, userId: string): Promise<ExternalSurvey[]> {
  try {
    const url = new URL(`${config.baseUrl}/client/surveys`);
    if (userId) url.searchParams.set("uid", userId);
    const res = await fetch(url.toString(), {
      headers: {
        "X-Api-Token": config.apiKey!,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`BitLabs API error: ${res.status}`);
    const data = await res.json() as any;
    const list = data.data?.surveys || data.surveys || [];
    const surveys: ExternalSurvey[] = list.map((s: any) => ({
      id: `bitlabs_${s.id || s.network_id}`,
      provider: "bitlabs" as SurveyProviderKey,
      providerName: "BitLabs",
      title: s.title || `BitLabs Survey (${s.category?.name || "General"})`,
      description: s.description || "Quick paid survey from BitLabs.",
      reward: typeof s.value === "number" ? s.value : parseFloat(s.value || s.cpi || "0.50"),
      estimatedMinutes: parseInt(s.loi || s.length || "6", 10),
      category: s.category?.name || "General",
      difficulty: (parseInt(s.loi || "6", 10) <= 5 ? "easy" : parseInt(s.loi || "10", 10) <= 12 ? "medium" : "hard") as "easy" | "medium" | "hard",
      surveyUrl: sanitizeSurveyUrl(s.link || s.click_url, config.apiKey),
    }));
    return surveys;
  } catch (err) {
    return [];
  }
}

export async function fetchExternalSurveys(userId: string, opts?: CpxFetchOpts): Promise<SurveyListResponse[]> {
  const configs = getProviderConfigs();
  const configured = configs.filter((c) => c.isConfigured);

  if (configured.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    configured.map(async (config): Promise<SurveyListResponse> => {
      let surveys: ExternalSurvey[] = [];
      if (config.key === "pollfish") surveys = await fetchPollfishSurveys(config);
      else if (config.key === "cint") surveys = await fetchCintSurveys(config);
      else if (config.key === "lucid") surveys = await fetchLucidSurveys(config);
      else if (config.key === "cpx") surveys = await fetchCpxSurveys(config, userId, opts);
      else if (config.key === "bitlabs") surveys = await fetchBitlabsSurveys(config, userId);
      return { surveys, provider: config.key };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<SurveyListResponse> => r.status === "fulfilled")
    .map((r) => r.value);
}

export interface ProviderCompletionPayload {
  status?: string;
  state?: string;
  completed?: boolean;
  verified?: boolean;
  transaction_id?: string;
  transactionId?: string;
  user_id?: string;
  userId?: string;
  respondent_id?: string;
  respondentId?: string;
  reward?: number | string;
  payout?: number | string;
  amount?: number | string;
  value?: number | string;
  reward_value?: number | string;
  [key: string]: unknown;
}

export function parseProviderReward(payload: ProviderCompletionPayload | null): number {
  if (!payload) return 0;
  const raw = payload.reward ?? payload.payout ?? payload.amount ?? payload.value ?? payload.reward_value;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isCompletionPayloadValid(payload: ProviderCompletionPayload | null, transactionId: string, userId?: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const status = (payload.status || payload.state || "").toString().toLowerCase();
  const completed = payload.completed === true || payload.verified === true;
  const txn = (payload.transaction_id || payload.transactionId || "").toString();
  const statusOk = ["completed", "complete", "success", "verified", "approved"].includes(status);
  if (!statusOk && !completed) return false;
  if (txn && txn !== transactionId) return false;
  if (userId) {
    const payloadUser = (payload.user_id || payload.userId || payload.respondent_id || payload.respondentId || "").toString();
    if (payloadUser && payloadUser !== userId) return false;
  }
  return true;
}

async function safeJson(res: Response): Promise<ProviderCompletionPayload | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as ProviderCompletionPayload;
  } catch {
    return null;
  }
}

async function verifyPollfishCompletion(surveyId: string, apiKey: string, transactionId: string, userId: string): Promise<{ verified: boolean; reward: number }> {
  try {
    const rawId = surveyId.replace("pollfish_", "");
    const res = await fetch(`https://api.pollfish.com/v2/surveys/${rawId}/completions/${transactionId}?user_id=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { verified: false, reward: 0 };
    const payload = await safeJson(res);
    return { verified: isCompletionPayloadValid(payload, transactionId, userId), reward: parseProviderReward(payload) };
  } catch {
    return { verified: false, reward: 0 };
  }
}

async function verifyCintCompletion(surveyId: string, apiKey: string, transactionId: string, userId: string): Promise<{ verified: boolean; reward: number }> {
  try {
    const rawId = surveyId.replace("cint_", "");
    const res = await fetch(`https://api.cint.com/v1/surveys/${rawId}/completions/${transactionId}?respondent_id=${encodeURIComponent(userId)}`, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!res.ok) return { verified: false, reward: 0 };
    const payload = await safeJson(res);
    return { verified: isCompletionPayloadValid(payload, transactionId, userId), reward: parseProviderReward(payload) };
  } catch {
    return { verified: false, reward: 0 };
  }
}

async function verifyLucidCompletion(surveyId: string, apiKey: string, transactionId: string, userId: string): Promise<{ verified: boolean; reward: number }> {
  try {
    const rawId = surveyId.replace("lucid_", "");
    const res = await fetch(`https://api.samplicio.us/supply/v1/surveys/${rawId}/completions/${transactionId}?respondent_id=${encodeURIComponent(userId)}`, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return { verified: false, reward: 0 };
    const payload = await safeJson(res);
    return { verified: isCompletionPayloadValid(payload, transactionId, userId), reward: parseProviderReward(payload) };
  } catch {
    return { verified: false, reward: 0 };
  }
}

function isStrictCompletionPayloadValid(payload: ProviderCompletionPayload | null, transactionId: string, userId: string): boolean {
  if (!isCompletionPayloadValid(payload, transactionId, userId)) return false;
  if (!payload) return false;
  const txn = (payload.transaction_id || payload.transactionId || "").toString();
  const payloadUser = (payload.user_id || payload.userId || payload.respondent_id || payload.respondentId || "").toString();
  return txn === transactionId && payloadUser === userId;
}

async function verifyCpxCompletion(surveyId: string, apiKey: string, transactionId: string, userId: string): Promise<{ verified: boolean; reward: number }> {
  try {
    const appId = process.env.CPX_APP_ID;
    if (!appId) return { verified: false, reward: 0 };
    const rawId = surveyId.replace("cpx_", "");
    // CPX transaction verification hash = MD5(ext_user_id + "-" + hash_key)
    const secureHash = md5hex(`${userId}-${apiKey}`);
    const res = await fetch(`https://live.cpx-research.com/api/get-transactions.php?app_id=${encodeURIComponent(appId)}&secure_hash=${encodeURIComponent(secureHash)}&ext_user_id=${encodeURIComponent(userId)}&trans_id=${encodeURIComponent(transactionId)}&survey_id=${encodeURIComponent(rawId)}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return { verified: false, reward: 0 };
    const payload = await safeJson(res);
    return { verified: isStrictCompletionPayloadValid(payload, transactionId, userId), reward: parseProviderReward(payload) };
  } catch {
    return { verified: false, reward: 0 };
  }
}

async function verifyBitlabsCompletion(surveyId: string, apiKey: string, transactionId: string, userId: string): Promise<{ verified: boolean; reward: number }> {
  try {
    const rawId = surveyId.replace("bitlabs_", "");
    const res = await fetch(`https://api.bitlabs.ai/v1/client/transactions?survey_id=${encodeURIComponent(rawId)}&transaction_id=${encodeURIComponent(transactionId)}&user_id=${encodeURIComponent(userId)}`, {
      headers: { "X-Api-Token": apiKey },
    });
    if (!res.ok) return { verified: false, reward: 0 };
    const payload = await safeJson(res);
    return { verified: isStrictCompletionPayloadValid(payload, transactionId, userId), reward: parseProviderReward(payload) };
  } catch {
    return { verified: false, reward: 0 };
  }
}

/**
 * Verify that a survey completion event is genuine with the upstream provider.
 *
 * **Reward amount**: `response.reward` is the payout figure parsed from the
 * provider's verification response body (0 when the provider does not include
 * one). The caller in `surveys.ts` falls back to `session.expectedReward` when
 * `reward` is 0, and always clamps the final amount against
 * `PROVIDER_REWARD_RANGES` regardless of the source. Any non-zero reward
 * returned here is still subject to that clamping step.
 */
export async function verifyProviderCompletion(req: CompletionVerifyRequest): Promise<CompletionVerifyResponse> {
  const transactionId = (req.transactionId || "").trim();
  if (transactionId.length === 0) {
    return { verified: false, reward: 0, error: "transactionId is required for survey verification" };
  }

  const configs = getProviderConfigs();
  const config = configs.find((c) => c.key === req.provider);

  if (!config || !config.isConfigured) {
    return { verified: false, reward: 0, error: `Provider ${req.provider} not configured` };
  }

  let result: { verified: boolean; reward: number } = { verified: false, reward: 0 };
  if (req.provider === "pollfish") {
    result = await verifyPollfishCompletion(req.surveyId, config.apiKey!, transactionId, req.userId);
  } else if (req.provider === "cint") {
    result = await verifyCintCompletion(req.surveyId, config.apiKey!, transactionId, req.userId);
  } else if (req.provider === "lucid") {
    result = await verifyLucidCompletion(req.surveyId, config.apiKey!, transactionId, req.userId);
  } else if (req.provider === "cpx") {
    result = await verifyCpxCompletion(req.surveyId, config.apiKey!, transactionId, req.userId);
  } else if (req.provider === "bitlabs") {
    result = await verifyBitlabsCompletion(req.surveyId, config.apiKey!, transactionId, req.userId);
  }

  return {
    verified: result.verified,
    reward: result.reward,
    error: result.verified ? undefined : "Provider did not confirm completion",
  };
}

export function getConfiguredProviders(): ProviderConfig[] {
  return getProviderConfigs().filter((c) => c.isConfigured);
}

export function getProviderStatus(): { provider: string; name: string; configured: boolean }[] {
  return getProviderConfigs().map((c) => ({
    provider: c.key,
    name: c.name,
    configured: c.isConfigured,
  }));
}
