import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { IntegrationHubPanel } from "./Admin";

const TOKEN = "test-admin-token";

const HUB_URL = "/api/admin/integration-hub";
const ALERTS_URL = "/api/admin/webhook-alerts";
const ALERT_EMAIL_URL = "/api/admin/admob/alert-email";
const AD_STATUS_URL = "/api/admin/ad-status";
const ECONOMY_RATE_URL = "/api/economy/rate";

const AD_STATUS_DEFAULT = { lpNative: false, unityNative: false, adSystemActive: false };

const HUB_DATA = {
  checkedAt: new Date("2026-06-07T00:00:00Z").toISOString(),
  onlineWindowMinutes: 5,
  usersOnline: 3,
  version: { current: "1.1.0", lastDeployedAt: null },
  services: [{ name: "API", up: true }],
  integrations: { total: 0, green: 0, items: [] },
};

/**
 * A single fire/resolve event in the reverse-chronological log returned by
 * GET /api/admin/webhook-alerts. The component collapses these per condition,
 * taking the most recent (first-seen, since the list is newest-first) as the
 * current state.
 */
function staleSyncEvent(
  status: "firing" | "resolved",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `stale-${status}-${Math.random().toString(36).slice(2)}`,
    condition: "stale_sync" as const,
    status,
    message:
      status === "firing"
        ? "Reporting sync has gone stale"
        : "Reporting sync recovered",
    firstSeenAt: new Date("2026-06-06T00:00:00Z").toISOString(),
    firedAt: new Date("2026-06-06T00:00:00Z").toISOString(),
    cooldownMs: 0,
    threshold: 6,
    detail: { ageMs: 9 * 3_600_000 },
    ...overrides,
  };
}

/**
 * A revenue_divergence event — used only to verify that the UI silently
 * ignores such events (the condition is permanently disabled server-side).
 */
function revenueDivergenceEvent(
  status: "firing" | "resolved",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `rev-${status}-${Math.random().toString(36).slice(2)}`,
    condition: "revenue_divergence" as const,
    status,
    message:
      status === "firing"
        ? "Revenue divergence exceeded threshold"
        : "Revenue divergence back within threshold",
    firstSeenAt: new Date("2026-06-06T00:00:00Z").toISOString(),
    firedAt: new Date("2026-06-06T00:00:00Z").toISOString(),
    cooldownMs: 0,
    threshold: 15,
    detail: {
      differencePct: 42,
      officialEarnings: 100,
      appReportedEarnings: 142,
      currency: "USD",
    },
    ...overrides,
  };
}

/**
 * Installs a fetch mock: the integration-hub endpoint returns a minimal,
 * alert-free hub payload, and the webhook-alerts endpoint returns the supplied
 * reverse-chronological event log.
 */
function installFetchMock(admobAlerts: any[]) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();

    if (u.startsWith(HUB_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => HUB_DATA,
      } as Response;
    }

    if (u.startsWith(ALERTS_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ admobAlerts }),
      } as Response;
    }

    if (u.startsWith(ALERT_EMAIL_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: false,
          recipient: "",
          persistedRecipient: null,
          recipientSource: "default",
          enabledSource: "setting",
          defaultRecipient: "",
        }),
      } as Response;
    }

    if (u.startsWith(AD_STATUS_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => AD_STATUS_DEFAULT,
      } as Response;
    }

    if (u.startsWith(ECONOMY_RATE_URL)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ displayPointsPerDollar: 10000 }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderPanel() {
  render(<IntegrationHubPanel token={TOKEN} onLogout={() => {}} />);
}

/** Finds the alert row (card) for a given condition label. */
async function findAlertRow(label: string) {
  const heading = await screen.findByText(label);
  // climb to the bordered card wrapping the icon, status pill and detail.
  return heading.closest("div.flex.items-start") as HTMLElement;
}

describe("IntegrationHubPanel — AdMob alert state collapse", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a single firing condition as red/Firing", async () => {
    installFetchMock([staleSyncEvent("firing")]);
    renderPanel();

    const row = await findAlertRow("Reporting sync stale");
    expect(within(row).getByText("Firing")).toBeInTheDocument();
    expect(within(row).queryByText("Resolved")).not.toBeInTheDocument();

    // Section summary reflects one active alert.
    expect(await screen.findByText("1 active")).toBeInTheDocument();

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("quiets a condition to green/Resolved when a later resolve event supersedes the fire", async () => {
    // Reverse-chronological: the resolve event is newest (listed first), the
    // older fire event follows. Latest-wins => Resolved.
    installFetchMock([
      staleSyncEvent("resolved", {
        firedAt: new Date("2026-06-06T05:00:00Z").toISOString(),
      }),
      staleSyncEvent("firing", {
        firedAt: new Date("2026-06-06T00:00:00Z").toISOString(),
      }),
    ]);
    renderPanel();

    const row = await findAlertRow("Reporting sync stale");
    expect(within(row).getByText("Resolved")).toBeInTheDocument();
    expect(within(row).queryByText("Firing")).not.toBeInTheDocument();

    // Only one row rendered for the condition (the stale fire didn't linger).
    expect(screen.getAllByText("Reporting sync stale")).toHaveLength(1);

    // Section summary reflects no active alerts.
    expect(await screen.findByText("All clear")).toBeInTheDocument();

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("renders only stale_sync and silently drops a revenue_divergence event from the server", async () => {
    installFetchMock([
      // revenue_divergence firing — must be silently dropped by the UI.
      revenueDivergenceEvent("firing"),
      // stale_sync resolved (newest event for it), older fire follows.
      staleSyncEvent("resolved", {
        firedAt: new Date("2026-06-06T05:00:00Z").toISOString(),
        detail: { ageMs: 2 * 3_600_000 },
      }),
      staleSyncEvent("firing", {
        firedAt: new Date("2026-06-06T00:00:00Z").toISOString(),
      }),
    ]);
    renderPanel();

    const staleRow = await findAlertRow("Reporting sync stale");
    expect(within(staleRow).getByText("Resolved")).toBeInTheDocument();
    // detail derived from ageMs: 2h ago
    expect(within(staleRow).getByText("Last sync ~2.0h ago")).toBeInTheDocument();

    // revenue_divergence must not appear in the UI at all.
    expect(screen.queryByText("Revenue divergence")).not.toBeInTheDocument();

    // Section summary: stale_sync is resolved — no active alerts.
    expect(await screen.findByText("All clear")).toBeInTheDocument();

    // Only one condition row rendered.
    expect(screen.getAllByText("Reporting sync stale")).toHaveLength(1);

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("hides the AdMob alerts section entirely when there are no events", async () => {
    installFetchMock([]);
    renderPanel();

    // Wait for the hub to settle (services line renders once loaded).
    await waitFor(() => {
      expect(
        screen.queryByText("AdMob Reporting Alerts"),
      ).not.toBeInTheDocument();
    });

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("hides the AdMob alerts section when only revenue_divergence events are present", async () => {
    installFetchMock([revenueDivergenceEvent("firing")]);
    renderPanel();

    // All revenue_divergence events are dropped — section should be hidden.
    await waitFor(() => {
      expect(
        screen.queryByText("AdMob Reporting Alerts"),
      ).not.toBeInTheDocument();
    });

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("stale_sync with only lastSyncedAt (no ageMs) falls back to hubTimeAgo string", async () => {
    const fixedNow = new Date("2026-06-10T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const lastSyncedAt = new Date(fixedNow - 3 * 3_600_000).toISOString();

    installFetchMock([
      staleSyncEvent("firing", {
        detail: { lastSyncedAt },
      }),
    ]);
    renderPanel();

    const row = await findAlertRow("Reporting sync stale");
    expect(within(row).getByText("Last sync 3h ago")).toBeInTheDocument();

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("stale_sync with no timing fields at all shows 'Reporting has never synced'", async () => {
    installFetchMock([
      staleSyncEvent("firing", {
        detail: {},
      }),
    ]);
    renderPanel();

    const row = await findAlertRow("Reporting sync stale");
    expect(
      within(row).getByText("Reporting has never synced"),
    ).toBeInTheDocument();

    // Fetch cycle completed cleanly — no error banner.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });
});

describe("IntegrationHubPanel — error banner on fetch failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the error banner when the hub endpoint rejects (network error)", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith(HUB_URL)) {
        throw new Error("Network error");
      }
      if (u.startsWith(ALERTS_URL)) {
        return { ok: true, status: 200, json: async () => ({ admobAlerts: [] }) } as Response;
      }
      if (u.startsWith(ALERT_EMAIL_URL)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            enabled: false,
            recipient: "",
            persistedRecipient: null,
            recipientSource: "default",
            enabledSource: "setting",
            defaultRecipient: "",
          }),
        } as Response;
      }
      if (u.startsWith(AD_STATUS_URL)) {
        return { ok: true, status: 200, json: async () => AD_STATUS_DEFAULT } as Response;
      }
      throw new Error(`Unexpected fetch call: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await screen.findByText(/showing the last known values where available/i);
  });

  it("shows the error banner when the hub endpoint returns a non-ok response", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.startsWith(HUB_URL)) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      if (u.startsWith(ALERTS_URL)) {
        return { ok: true, status: 200, json: async () => ({ admobAlerts: [] }) } as Response;
      }
      if (u.startsWith(ALERT_EMAIL_URL)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            enabled: false,
            recipient: "",
            persistedRecipient: null,
            recipientSource: "default",
            enabledSource: "setting",
            defaultRecipient: "",
          }),
        } as Response;
      }
      if (u.startsWith(AD_STATUS_URL)) {
        return { ok: true, status: 200, json: async () => AD_STATUS_DEFAULT } as Response;
      }
      throw new Error(`Unexpected fetch call: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await screen.findByText(/showing the last known values where available/i);
  });
});

describe("IntegrationHubPanel — resilience and auth", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still renders core hub status when webhook-alerts returns a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.startsWith(HUB_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => HUB_DATA,
          } as Response;
        }
        if (u.startsWith(ALERTS_URL)) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "internal server error" }),
          } as Response;
        }
        if (u.startsWith(ALERT_EMAIL_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              enabled: false,
              recipient: "",
              persistedRecipient: null,
              recipientSource: "default",
              enabledSource: "setting",
              defaultRecipient: "",
            }),
          } as Response;
        }
        if (u.startsWith(AD_STATUS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => AD_STATUS_DEFAULT,
          } as Response;
        }
        if (u.startsWith(ECONOMY_RATE_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ displayPointsPerDollar: 10000 }),
          } as Response;
        }
        throw new Error(`Unexpected fetch call: ${u}`);
      }),
    );

    renderPanel();

    // Core hub status renders — the API service card is present.
    await screen.findByText("API");
    expect(screen.getByText("Operational")).toBeInTheDocument();

    // Users Online card is present.
    expect(screen.getByText("Users Online")).toBeInTheDocument();

    // AdMob alerts section is hidden because the alerts request failed.
    expect(
      screen.queryByText("AdMob Reporting Alerts"),
    ).not.toBeInTheDocument();

    // Alerts failure is soft — it does NOT surface as a top-level error overlay.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("still renders core hub status when alert-email returns a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.startsWith(HUB_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => HUB_DATA,
          } as Response;
        }
        if (u.startsWith(ALERTS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ admobAlerts: [] }),
          } as Response;
        }
        if (u.startsWith(ALERT_EMAIL_URL)) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "internal server error" }),
          } as Response;
        }
        if (u.startsWith(AD_STATUS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => AD_STATUS_DEFAULT,
          } as Response;
        }
        if (u.startsWith(ECONOMY_RATE_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ displayPointsPerDollar: 10000 }),
          } as Response;
        }
        throw new Error(`Unexpected fetch call: ${u}`);
      }),
    );

    renderPanel();

    // Core hub status renders — the API service card is present.
    await screen.findByText("API");
    expect(screen.getByText("Operational")).toBeInTheDocument();

    // Users Online card is present.
    expect(screen.getByText("Users Online")).toBeInTheDocument();

    // Alert-email failure is soft — it does NOT surface as a top-level error overlay.
    expect(
      screen.queryByText(/showing the last known values where available/i),
    ).not.toBeInTheDocument();
  });

  it("calls onLogout when integration-hub returns 401", async () => {
    const onLogout = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.startsWith(HUB_URL)) {
          return { ok: false, status: 401, json: async () => ({}) } as Response;
        }
        if (u.startsWith(ALERTS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ admobAlerts: [] }),
          } as Response;
        }
        if (u.startsWith(ALERT_EMAIL_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              enabled: false,
              recipient: "",
              persistedRecipient: null,
              recipientSource: "default",
              enabledSource: "setting",
              defaultRecipient: "",
            }),
          } as Response;
        }
        if (u.startsWith(AD_STATUS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => AD_STATUS_DEFAULT,
          } as Response;
        }
        if (u.startsWith(ECONOMY_RATE_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ displayPointsPerDollar: 10000 }),
          } as Response;
        }
        throw new Error(`Unexpected fetch call: ${u}`);
      }),
    );

    render(<IntegrationHubPanel token={TOKEN} onLogout={onLogout} />);

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it("calls onLogout when webhook-alerts returns 403", async () => {
    const onLogout = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.startsWith(HUB_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => HUB_DATA,
          } as Response;
        }
        if (u.startsWith(ALERTS_URL)) {
          return {
            ok: false,
            status: 403,
            json: async () => ({}),
          } as Response;
        }
        if (u.startsWith(ALERT_EMAIL_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              enabled: false,
              recipient: "",
              persistedRecipient: null,
              recipientSource: "default",
              enabledSource: "setting",
              defaultRecipient: "",
            }),
          } as Response;
        }
        if (u.startsWith(AD_STATUS_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => AD_STATUS_DEFAULT,
          } as Response;
        }
        if (u.startsWith(ECONOMY_RATE_URL)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ displayPointsPerDollar: 10000 }),
          } as Response;
        }
        throw new Error(`Unexpected fetch call: ${u}`);
      }),
    );

    render(<IntegrationHubPanel token={TOKEN} onLogout={onLogout} />);

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });
});
