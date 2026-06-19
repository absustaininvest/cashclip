import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { CashClipUsersPanel } from "./Admin";

const TOKEN = "test-admin-token";

const SEARCH_PER_USER_URL = "/api/admin/search-per-user";

const SAMPLE_ROWS = [
  { userId: "u1", username: "alice", queryCount: 42 },
  { userId: "u2", username: "bob", queryCount: 17 },
];

function jsonRes(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

/**
 * Install a fetch mock routing all endpoints CashClipUsersPanel hits on mount.
 * Returns the underlying vi.fn() so tests can inspect call counts.
 */
function installFetchMock(opts: {
  searchPerUserRows?: typeof SAMPLE_ROWS;
  searchPerUserPending?: boolean;
}) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (path === "/api/admin/users")
      return jsonRes({ users: [], total: 0 });
    if (path === "/api/admin/payout-per-user")
      return jsonRes({ perUser: [] });
    if (path === "/api/admin/adjustments")
      return jsonRes({ adjustments: [] });
    if (path === SEARCH_PER_USER_URL) {
      if (opts.searchPerUserPending) return new Promise<Response>(() => {});
      return jsonRes({ rows: opts.searchPerUserRows ?? [] });
    }

    return jsonRes({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Return only the calls that hit the search-per-user endpoint. */
function searchCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([input]) => {
    const url = new URL(String(input), "http://localhost");
    return url.pathname === SEARCH_PER_USER_URL;
  });
}

describe("Top Searchers table — auto-refresh interval", () => {
  /**
   * Only fake setInterval/clearInterval so that waitFor (which uses setTimeout
   * for its polling) continues to work. This lets us control the 60-second
   * repeat cycle while keeping real-time promise resolution intact.
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls fetchSearchPerUser on initial mount", async () => {
    const mock = installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("calls fetchSearchPerUser again after 60 seconds (same cycle as search stats)", async () => {
    const mock = installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(1);
    });

    const callsAfterMount = searchCalls(mock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThan(callsAfterMount);
    });
  });

  it("calls fetchSearchPerUser again after a second 60-second tick", async () => {
    const mock = installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(2);
    });

    const callsAfterFirstTick = searchCalls(mock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThan(callsAfterFirstTick);
    });
  });

  it("does not call fetchSearchPerUser again before 60 seconds have elapsed", async () => {
    const mock = installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(1);
    });

    const callsAfterMount = searchCalls(mock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });

    expect(searchCalls(mock).length).toBe(callsAfterMount);
  });

  it("stops auto-refreshing after the component unmounts", async () => {
    const mock = installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    const { unmount } = render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      expect(searchCalls(mock).length).toBeGreaterThanOrEqual(1);
    });

    unmount();
    const callsAtUnmount = searchCalls(mock).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(searchCalls(mock).length).toBe(callsAtUnmount);
  });
});

describe("Top Searchers table — rendering", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the Top Searchers section heading", async () => {
    installFetchMock({ searchPerUserRows: [] });
    render(<CashClipUsersPanel token={TOKEN} />);

    expect(await screen.findByText("Top Searchers")).toBeInTheDocument();
  });

  it("shows a loading state while the request is in-flight", () => {
    installFetchMock({ searchPerUserPending: true });
    render(<CashClipUsersPanel token={TOKEN} />);

    expect(screen.getAllByText("Loading…").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an empty-state message when there is no search data", async () => {
    installFetchMock({ searchPerUserRows: [] });
    render(<CashClipUsersPanel token={TOKEN} />);

    expect(await screen.findByText("No search data yet")).toBeInTheDocument();
  });

  it("renders the top-searcher rows with username and query count", async () => {
    installFetchMock({ searchPerUserRows: SAMPLE_ROWS });
    render(<CashClipUsersPanel token={TOKEN} />);

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("42 searches")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("17 searches")).toBeInTheDocument();
  });

  it("uses singular 'search' for a query count of 1", async () => {
    installFetchMock({
      searchPerUserRows: [{ userId: "u1", username: "solo", queryCount: 1 }],
    });
    render(<CashClipUsersPanel token={TOKEN} />);

    expect(await screen.findByText("1 search")).toBeInTheDocument();
  });

  it("requests the search-per-user endpoint with the correct limit param", async () => {
    const mock = installFetchMock({ searchPerUserRows: [] });
    render(<CashClipUsersPanel token={TOKEN} />);

    await waitFor(() => {
      const calls = searchCalls(mock);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = new URL(String(calls[0][0]), "http://localhost");
      expect(url.searchParams.get("limit")).toBe("10");
    });
  });
});
