import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PublisherProgramPanel } from "./Admin";

const TOKEN = "test-admin-token";

const PUBLISHERS_URL = "/api/admin/publishers";
const CAMPAIGNS_URL = "/api/admin/campaigns";

const publisherWithCampaigns = {
  id: "pub-1",
  username: "acmeads",
  email: "acme@example.com",
  balance: "0.00",
  adCredits: "42.50",
  publisherGrantedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
  createdAt: new Date("2026-04-01T00:00:00Z").toISOString(),
  campaignCount: 2,
  totalBudget: "150.00",
  totalSpent: "50.00",
  totalClicks: 20,
};

const publisherWithoutCampaigns = {
  id: "pub-2",
  username: "lonelypub",
  email: "lonely@example.com",
  balance: "0.00",
  adCredits: "5.00",
  publisherGrantedAt: new Date("2026-05-10T00:00:00Z").toISOString(),
  createdAt: new Date("2026-05-09T00:00:00Z").toISOString(),
  campaignCount: 0,
  totalBudget: "0.00",
  totalSpent: "0.00",
  totalClicks: 0,
};

const campaignForPub1 = {
  id: "camp-1",
  title: "Spring Launch",
  description: "desc",
  targetUrl: "https://acme.example.com/spring",
  rewardPerVisit: "0.01",
  totalBudget: "100.00",
  spent: "30.00",
  clicks: 12,
  status: "active",
  adminNote: null,
  createdAt: new Date("2026-05-02T00:00:00Z").toISOString(),
  userId: "pub-1",
  username: "acmeads",
};

type JsonResponse = (body: unknown, ok?: boolean, status?: number) => Response;
const jsonResponse: JsonResponse = (body, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

/**
 * Installs a fetch mock routing the two endpoints the panel hits on mount:
 * the publisher rollup and the campaigns list. Either handler can be overridden
 * to drive empty/error states.
 */
function installFetchMock(opts: {
  publishers?: () => Response;
  campaigns?: () => Response;
}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push(u);

    if (u.startsWith(PUBLISHERS_URL)) {
      return (opts.publishers ?? (() => jsonResponse({ publishers: [] })))();
    }
    if (u.startsWith(CAMPAIGNS_URL)) {
      return (opts.campaigns ?? (() => jsonResponse({ campaigns: [] })))();
    }
    throw new Error(`Unexpected fetch call: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

describe("PublisherProgramPanel", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the panel header and summary stats from the loaded publishers", async () => {
    installFetchMock({
      publishers: () =>
        jsonResponse({ publishers: [publisherWithCampaigns, publisherWithoutCampaigns] }),
      campaigns: () => jsonResponse({ campaigns: [campaignForPub1] }),
    });

    render(<PublisherProgramPanel token={TOKEN} />);

    // Header renders.
    expect(await screen.findByText("Publisher Program")).toBeInTheDocument();

    // Both publishers populate the table.
    expect(await screen.findByText("acmeads")).toBeInTheDocument();
    expect(screen.getByText("lonelypub")).toBeInTheDocument();

    // Ad-credits-outstanding summary = 42.50 + 5.00.
    expect(screen.getByText("$47.50")).toBeInTheDocument();
  });

  it("shows a friendly empty state when there are no publishers", async () => {
    installFetchMock({});

    render(<PublisherProgramPanel token={TOKEN} />);

    expect(await screen.findByText("No publishers yet")).toBeInTheDocument();
  });

  it("expands a publisher row to reveal their campaigns", async () => {
    installFetchMock({
      publishers: () => jsonResponse({ publishers: [publisherWithCampaigns] }),
      campaigns: () => jsonResponse({ campaigns: [campaignForPub1] }),
    });

    render(<PublisherProgramPanel token={TOKEN} />);

    const publisherCell = await screen.findByText("acmeads");

    // Campaign detail is hidden until the row is expanded.
    expect(screen.queryByText("Spring Launch")).not.toBeInTheDocument();

    fireEvent.click(publisherCell);

    // Expanding reveals the publisher's campaign with its title and status.
    expect(await screen.findByText("Spring Launch")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows a no-campaigns message when an expanded publisher has none", async () => {
    installFetchMock({
      publishers: () => jsonResponse({ publishers: [publisherWithoutCampaigns] }),
      campaigns: () => jsonResponse({ campaigns: [] }),
    });

    render(<PublisherProgramPanel token={TOKEN} />);

    const publisherCell = await screen.findByText("lonelypub");
    fireEvent.click(publisherCell);

    expect(await screen.findByText("No campaigns created yet.")).toBeInTheDocument();
  });

  it("shows an error state instead of a blank screen when the publishers fetch fails", async () => {
    installFetchMock({
      publishers: () => jsonResponse({ error: "boom" }, false, 500),
    });

    render(<PublisherProgramPanel token={TOKEN} />);

    expect(await screen.findByText("Failed to load publishers")).toBeInTheDocument();
  });
});
