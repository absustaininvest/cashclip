// First-party, cookieless web analytics for the absustain corporate site.
// Sends fire-and-forget events to the API collector at /api/analytics/collect
// (same origin in production and via the Vite dev proxy). No cookies are set
// and no consent is required. See docs/web-analytics.md for the taxonomy.

const ENDPOINT = "/api/analytics/collect";
const SURFACE = "absustain";

type Props = Record<string, string | number | boolean>;

function readSource() {
  try {
    const params = new URLSearchParams(window.location.search);
    const pick = (k: string): string | undefined => {
      const v = params.get(k);
      return v ? v.slice(0, 256) : undefined;
    };
    return {
      referrer: document.referrer ? document.referrer.slice(0, 1024) : undefined,
      utmSource: pick("utm_source"),
      utmMedium: pick("utm_medium"),
      utmCampaign: pick("utm_campaign"),
      utmTerm: pick("utm_term"),
      utmContent: pick("utm_content"),
    };
  } catch {
    return {};
  }
}

// Capture the traffic source once on first load. It persists for the page
// session so every event — even after client-side (wouter) navigation — keeps
// its original attribution.
const source = readSource();

function send(eventName: string, props?: Props) {
  if (typeof window === "undefined") return;
  try {
    const body: Record<string, unknown> = {
      eventName,
      surface: SURFACE,
      path: window.location.pathname,
      ...source,
    };
    if (props && Object.keys(props).length) body.props = props;

    const payload = JSON.stringify(body);
    const blob = new Blob([payload], { type: "application/json" });
    if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) {
      return;
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
}

export function trackPageview() {
  send("pageview");
}

export function trackEvent(name: string, props?: Props) {
  send(name, props);
}

let clicksWired = false;

// Delegated click tracking: a single capture-phase listener classifies clicks
// on outbound links so we don't have to instrument every anchor. Covers
// app-store links, CashClip download links, and any link carrying a ?ref= code.
export function initAnalyticsClickTracking() {
  if (clicksWired || typeof document === "undefined") return;
  clicksWired = true;

  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      const host = url.hostname.replace(/^www\./, "");
      const ref = url.searchParams.get("ref");

      if (host === "apps.apple.com") {
        trackEvent("app_store_click", { store: "ios" });
      } else if (host === "play.google.com") {
        trackEvent("app_store_click", { store: "android" });
      } else if (host === "cash-clip.app") {
        trackEvent("download_click", {});
      }

      if (ref) {
        trackEvent("referral_click", { ref: ref.slice(0, 128) });
      }
    },
    { capture: true },
  );
}
