export interface Integration {
  id: string;
  name: string;
  category: "ads" | "surveys" | "affiliates" | "payments" | "investments";
  envKey: string;
  additionalEnvKeys?: string[];
  signupUrl: string;
  description: string;
  priority: "start-here" | "recommended" | "optional";
  revenueShare: string;
  setupSteps: string[];
}

export const integrations: Integration[] = [
  {
    id: "admob",
    name: "Google AdMob",
    category: "ads",
    envKey: "ADMOB_APP_ID",
    signupUrl: "https://admob.google.com",
    description: "Primary video ad network. Largest ad inventory, highest fill rates. This should be your first integration.",
    priority: "start-here",
    revenueShare: "Covers ~30% of total revenue ($8,500/mo at scale)",
    setupSteps: [
      "Go to admob.google.com and sign in with a Google account",
      "Click 'Get Started' and accept the terms",
      "Add your app (select Android or iOS, search or enter manually)",
      "Create a Rewarded Video ad unit",
      "Copy your App ID (ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX)",
      "Paste it as the ADMOB_APP_ID secret in this project",
    ],
  },
  {
    id: "unity_ads",
    name: "Unity Ads",
    category: "ads",
    envKey: "UNITY_ADS_GAME_ID_IOS",
    additionalEnvKeys: ["UNITY_ADS_GAME_ID_ANDROID", "UNITY_MONETIZATION_API_KEY", "UNITY_ORGANIZATION_ID"],
    signupUrl: "https://cloud.unity.com",
    description: "In-app bidding via AdMob mediation. Unity Ads competes with AdMob in real-time, driving up your eCPMs automatically.",
    priority: "recommended",
    revenueShare: "Boosts ad revenue through real-time bidding against AdMob",
    setupSteps: [
      "Go to cloud.unity.com and create a Unity ID",
      "Create a new project and enable Ads Monetization",
      "Select 'I will use Mediation' → 'Google AdMob/Ad Manager'",
      "Complete the setup wizard to get your iOS and Android Game IDs",
      "Paste iOS Game ID as UNITY_ADS_GAME_ID_IOS and Android as UNITY_ADS_GAME_ID_ANDROID",
      "In AdMob, add Unity Ads as a bidding partner under Mediation using your Game IDs",
      "(Optional, earnings reports) In Unity go to Setup → API Access, copy the Monetization Stats API key → paste as UNITY_MONETIZATION_API_KEY",
      "(Optional, earnings reports) Copy your Unity Organization core ID → paste as UNITY_ORGANIZATION_ID (note: this ID changes if the project is ever transferred)",
    ],
  },
  {
    id: "ironsource",
    name: "IronSource (Unity LevelPlay)",
    category: "ads",
    envKey: "IRONSOURCE_APP_KEY",
    signupUrl: "https://platform.ironsrc.com",
    description: "Ad mediation platform that automatically picks the highest-paying ad from multiple networks.",
    priority: "optional",
    revenueShare: "Optimizes ad revenue by mediating between AdMob, Unity, and others",
    setupSteps: [
      "Go to platform.ironsrc.com and create a publisher account",
      "Add your app to the dashboard",
      "Enable Rewarded Video ad units",
      "Set up mediation with AdMob and Unity Ads",
      "Copy your App Key from the app settings",
      "Paste it as the IRONSOURCE_APP_KEY secret in this project",
    ],
  },
  {
    id: "pollfish",
    name: "Pollfish",
    category: "surveys",
    envKey: "POLLFISH_API_KEY",
    signupUrl: "https://www.pollfish.com/publisher",
    description: "Easiest survey platform to integrate. Provides short mobile-optimized surveys that pay $0.30-$1.50 each.",
    priority: "start-here",
    revenueShare: "Covers ~22% of total revenue ($6,200/mo at scale)",
    setupSteps: [
      "Go to pollfish.com/publisher and create an account",
      "Click 'Create App' and enter your app details",
      "Choose 'Rewarded Survey' integration type",
      "Copy your API Key from the app dashboard",
      "Paste it as the POLLFISH_API_KEY secret in this project",
    ],
  },
  {
    id: "cint",
    name: "Cint",
    category: "surveys",
    envKey: "CINT_API_KEY",
    signupUrl: "https://www.cint.com/for-publishers",
    description: "Enterprise survey marketplace. Higher-paying surveys ($1-$5) but requires publisher application approval.",
    priority: "recommended",
    revenueShare: "Premium surveys supplement Pollfish revenue",
    setupSteps: [
      "Go to cint.com/for-publishers and apply as a publisher",
      "Complete the application form with your app details and audience info",
      "Wait for approval (typically 3-5 business days)",
      "Once approved, access your publisher dashboard",
      "Copy your API Key from the integration settings",
      "Paste it as the CINT_API_KEY secret in this project",
    ],
  },
  {
    id: "lucid",
    name: "Lucid (Cint)",
    category: "surveys",
    envKey: "LUCID_API_KEY",
    signupUrl: "https://luc.id/for-suppliers",
    description: "Market research survey exchange. Now part of Cint. Good for longer, higher-paying research surveys.",
    priority: "optional",
    revenueShare: "Additional survey inventory alongside Pollfish and Cint",
    setupSteps: [
      "Go to luc.id/for-suppliers and apply",
      "Provide your app details and estimated monthly survey completions",
      "Wait for supplier approval",
      "Access the Lucid Marketplace API documentation",
      "Generate your API credentials",
      "Paste it as the LUCID_API_KEY secret in this project",
    ],
  },
  {
    id: "cpx",
    name: "CPX Research",
    category: "surveys",
    envKey: "CPX_API_KEY",
    additionalEnvKeys: ["CPX_APP_ID"],
    signupUrl: "https://www.cpx-research.com",
    description: "Self-serve survey platform — instant signup, surveys live in minutes. The fastest way to start earning survey revenue.",
    priority: "start-here",
    revenueShare: "Fast-fill survey inventory, $0.20-$3.00 per completion",
    setupSteps: [
      "Go to cpx-research.com and click 'Become a Publisher'",
      "Sign up — approval is instant (no waiting period)",
      "Create a new app in your CPX dashboard",
      "Copy your App ID and Secure Hash from the app settings",
      "Paste the Secure Hash as the CPX_API_KEY secret",
      "Paste the App ID as the CPX_APP_ID secret",
    ],
  },
  {
    id: "bitlabs",
    name: "BitLabs",
    category: "surveys",
    envKey: "BITLABS_API_KEY",
    signupUrl: "https://www.bitlabs.ai/",
    description: "Self-serve survey API built for indie reward apps. Instant access, well-documented, no approval gatekeeping.",
    priority: "recommended",
    revenueShare: "Adds high-quality survey supply, $0.20-$2.50 per completion",
    setupSteps: [
      "Go to bitlabs.ai/publishers and create an account",
      "Verify your email — access is granted immediately",
      "Create a new app in the BitLabs dashboard",
      "Copy your API Token from the app settings",
      "Paste it as the BITLABS_API_KEY secret in this project",
    ],
  },
  {
    id: "tapjoy",
    name: "Tapjoy",
    category: "affiliates",
    envKey: "TAPJOY_SDK_KEY",
    signupUrl: "https://dev.tapjoy.com",
    description: "Leading offerwall platform. Users complete app installs, sign-ups, and tasks for rewards.",
    priority: "recommended",
    revenueShare: "Covers ~16% of total revenue ($4,500/mo at scale)",
    setupSteps: [
      "Go to dev.tapjoy.com and create a publisher account",
      "Add your app to the Tapjoy dashboard",
      "Enable the Offerwall placement",
      "Configure your virtual currency exchange rate",
      "Copy your SDK Key from the app settings",
      "Paste it as the TAPJOY_SDK_KEY secret in this project",
    ],
  },
  {
    id: "adgate",
    name: "AdGate Media",
    category: "affiliates",
    envKey: "ADGATE_API_KEY",
    signupUrl: "https://wall.adgaterewards.com",
    description: "Offerwall with diverse offer types including app installs, sign-ups, quizzes, and video watches.",
    priority: "optional",
    revenueShare: "Supplements affiliate revenue through additional offers",
    setupSteps: [
      "Go to adgaterewards.com and sign up as a publisher",
      "Verify your account via email",
      "Add your app or website to the dashboard",
      "Configure your offerwall settings",
      "Copy your API Key from the publisher dashboard",
      "Paste it as the ADGATE_API_KEY secret in this project",
    ],
  },
  {
    id: "offertoro",
    name: "OfferToro",
    category: "affiliates",
    envKey: "OFFERTORO_API_KEY",
    signupUrl: "https://www.offertoro.com/publishers",
    description: "Global offerwall with offers from 200+ advertisers. Good international coverage.",
    priority: "optional",
    revenueShare: "Additional affiliate offers for global audience",
    setupSteps: [
      "Go to offertoro.com/publishers and register",
      "Complete the publisher profile",
      "Add your app details",
      "Configure the offerwall appearance",
      "Copy your API Key and App ID",
      "Paste it as the OFFERTORO_API_KEY secret in this project",
    ],
  },
  {
    id: "acorns",
    name: "Acorns",
    category: "investments",
    envKey: "ACORNS_AFFILIATE_ID",
    signupUrl: "https://acorns.com/affiliates",
    description: "Micro-investment platform. Users can invest their CashClip earnings directly. Earn affiliate commissions for every new Acorns account opened through CashClip.",
    priority: "recommended",
    revenueShare: "$5–$10 per new account opened via affiliate link",
    setupSteps: [
      "Go to acorns.com/affiliates and apply as a publisher",
      "Wait for approval (typically 1-3 business days)",
      "Get your affiliate ID from the Acorns publisher dashboard",
      "Paste it as ACORNS_AFFILIATE_ID",
    ],
  },
  {
    id: "stash",
    name: "Stash Invest",
    category: "investments",
    envKey: "STASH_AFFILIATE_ID",
    signupUrl: "https://stash.com",
    description: "Beginner-friendly investment app. Users invest CashClip earnings in stocks and ETFs. CashClip earns referral commissions for new Stash accounts.",
    priority: "recommended",
    revenueShare: "$5–$15 per new account opened via referral",
    setupSteps: [
      "Go to stash.com and look for their partner/affiliate program",
      "Apply as a publisher or contact partnerships@stash.com",
      "Get your referral/affiliate ID once approved",
      "Paste it as STASH_AFFILIATE_ID",
    ],
  },
  {
    id: "paypal",
    name: "PayPal Payouts",
    category: "payments",
    envKey: "PAYPAL_CLIENT_ID",
    signupUrl: "https://developer.paypal.com",
    description: "For paying users their earnings. PayPal Payouts API lets you send money to users via email.",
    priority: "recommended",
    revenueShare: "Required for user withdrawals - 2.9% + $0.30 per transaction",
    setupSteps: [
      "Go to developer.paypal.com and log in with a PayPal Business account",
      "Create a new app in the Developer Dashboard",
      "Select 'Payouts' under Features",
      "Copy the Client ID from your app credentials",
      "Paste it as the PAYPAL_CLIENT_ID secret in this project",
      "Also copy the Secret and paste as PAYPAL_SECRET",
    ],
  },
];

import { getVerificationState } from "./lib/integrationVerificationState";

export type ConnectionState =
  | "connected"
  | "pending"
  | "key_rejected"
  | "unreachable";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  priority: string;
  connected: boolean;
  connectionState: ConnectionState;
  verification?: {
    kind: "ok" | "failed" | "unsupported";
    status?: number;
    latencyMs?: number;
    error?: string;
    reason?: string;
    checkedAt: number;
  };
  envKey: string;
  signupUrl: string;
  description: string;
  revenueShare: string;
  setupSteps: string[];
}

export function getIntegrationStatuses(): IntegrationStatus[] {
  return integrations.map((i) => {
    const envOk = !!process.env[i.envKey] && (i.additionalEnvKeys ?? []).every((k) => !!process.env[k]);
    const verification = getVerificationState(i.envKey);

    let connectionState: ConnectionState;
    if (!envOk) {
      connectionState = "pending";
    } else if (verification?.kind === "failed") {
      // The save endpoint already rolled back any 4xx (key/config rejection)
      // by clearing the env var, so reaching here with envOk + failed means a
      // 5xx or network outage during verification. Surface that as
      // "unreachable" so the wizard distinguishes a rejected key from a
      // provider that's temporarily down. (`key_rejected` is reserved for
      // future scheduled re-verification, see follow-up #126.)
      connectionState = "unreachable";
    } else {
      // ok, unsupported, or no verification recorded yet (e.g. a value set
      // through project Secrets that hasn't been re-validated). Treat as
      // connected and let the periodic health check / next save surface
      // any issue.
      connectionState = "connected";
    }

    return {
      id: i.id,
      name: i.name,
      category: i.category,
      priority: i.priority,
      connected: connectionState === "connected",
      connectionState,
      verification: verification
        ? verification.kind === "ok"
          ? { kind: "ok", status: verification.status, latencyMs: verification.latencyMs, checkedAt: verification.checkedAt }
          : verification.kind === "failed"
            ? { kind: "failed", status: verification.status, latencyMs: verification.latencyMs, error: verification.error, checkedAt: verification.checkedAt }
            : { kind: "unsupported", reason: verification.reason, checkedAt: verification.checkedAt }
        : undefined,
      envKey: i.envKey,
      signupUrl: i.signupUrl,
      description: i.description,
      revenueShare: i.revenueShare,
      setupSteps: i.setupSteps,
    };
  });
}

export function getIntegrationSummary() {
  const statuses = getIntegrationStatuses();
  const total = statuses.length;
  const connected = statuses.filter((s) => s.connected).length;
  const startHere = statuses.filter((s) => s.priority === "start-here");
  const startHereConnected = startHere.filter((s) => s.connected).length;

  return {
    total,
    connected,
    pending: total - connected,
    readyToEarn: startHereConnected === startHere.length,
    startHereComplete: `${startHereConnected}/${startHere.length}`,
    byCategory: {
      ads: {
        total: statuses.filter((s) => s.category === "ads").length,
        connected: statuses.filter((s) => s.category === "ads" && s.connected).length,
      },
      surveys: {
        total: statuses.filter((s) => s.category === "surveys").length,
        connected: statuses.filter((s) => s.category === "surveys" && s.connected).length,
      },
      affiliates: {
        total: statuses.filter((s) => s.category === "affiliates").length,
        connected: statuses.filter((s) => s.category === "affiliates" && s.connected).length,
      },
      payments: {
        total: statuses.filter((s) => s.category === "payments").length,
        connected: statuses.filter((s) => s.category === "payments" && s.connected).length,
      },
    },
  };
}
