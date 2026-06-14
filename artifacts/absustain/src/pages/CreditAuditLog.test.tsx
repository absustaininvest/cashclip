import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashClipUsersPanel } from "./Admin";

type AdjustmentRow = {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  amount: string;
  description: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  createdAt: string;
};

const aliceRow: AdjustmentRow = {
  id: "adj-1",
  userId: "user-1",
  username: "jane",
  email: "jane@example.com",
  amount: "5.00",
  description: "Goodwill credit",
  actorUserId: "admin-1",
  actorUsername: "alice",
  createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
};

const bobRow: AdjustmentRow = {
  id: "adj-2",
  userId: "user-2",
  username: "john",
  email: "john@example.com",
  amount: "-2.50",
  description: "Correction",
  actorUserId: "admin-2",
  actorUsername: "bob",
  createdAt: new Date("2026-06-02T10:00:00Z").toISOString(),
};

function jsonRes(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

/**
 * Builds a fetch mock that routes by pathname. The audit-log adjustments
 * endpoint reads the `actor` query param so tests can simulate the
 * server-side narrowing the "Issued by" dropdown triggers.
 */
function installFetchMock(opts: {
  adjustments?: (actor: string) => AdjustmentRow[];
  adjustmentsPending?: boolean;
}) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (path === "/api/admin/users") return jsonRes({ users: [], total: 0 });
    if (path === "/api/admin/payout-per-user") return jsonRes({ perUser: [] });
    if (path === "/api/admin/adjustments") {
      if (opts.adjustmentsPending) return new Promise<Response>(() => {});
      const actor = url.searchParams.get("actor") ?? "";
      return jsonRes({ adjustments: opts.adjustments ? opts.adjustments(actor) : [] });
    }
    return jsonRes({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const testUser = {
  id: "user-1",
  username: "jane",
  email: "jane@example.com",
  role: "user",
  balance: "5.50",
  totalEarned: "10.00",
  pending: 0,
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  profileComplete: true,
  country: "US",
  zipCode: null,
  dateOfBirth: null,
  gender: null,
  employmentStatus: null,
  householdIncome: null,
  educationLevel: null,
  ethnicity: null,
  referredBy: null,
};

function installCreditFetchMock(opts: {
  creditResponse?: { ok: boolean; body: object };
}) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    if (path === "/api/admin/users") return jsonRes({ users: [testUser], total: 1 });
    if (path === "/api/admin/payout-per-user") return jsonRes({ perUser: [] });
    if (path === "/api/admin/adjustments") return jsonRes({ adjustments: [] });
    if (path === "/api/admin/credit" && method === "POST") {
      const res = opts.creditResponse ?? { ok: true, body: { balance: "10.50" } };
      return Promise.resolve({
        ok: res.ok,
        json: () => Promise.resolve(res.body),
      } as Response);
    }
    return jsonRes({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("CashClipUsersPanel — Manual Credit write path", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Expand the jane user row so the credit form inputs become visible. */
  async function expandJaneRow(user: ReturnType<typeof userEvent.setup>) {
    const janeText = await screen.findByText("jane");
    // Walk up to the clickable row container (the grid div with cursor-pointer).
    const row = janeText.closest<HTMLElement>('[class*="cursor-pointer"]');
    expect(row).toBeTruthy();
    await user.click(row!);
    // Credit form is now mounted; wait for one of its inputs to appear.
    await screen.findByPlaceholderText("$ (e.g. 5 or -2.50)");
  }

  it("POSTs the expected payload to /api/admin/credit when the operator submits the credit form", async () => {
    const fetchMock = installCreditFetchMock({});
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    await user.type(
      screen.getByPlaceholderText("$ (e.g. 5 or -2.50)"),
      "5",
    );
    await user.type(
      screen.getByPlaceholderText("Reason (required for audit log)"),
      "Goodwill credit",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await waitFor(() => {
      const creditCall = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), "http://localhost");
        return (
          url.pathname === "/api/admin/credit" &&
          ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
            "POST"
        );
      });
      expect(creditCall).toBeDefined();
      const body = JSON.parse(
        (creditCall![1] as RequestInit).body as string,
      );
      expect(body).toEqual({
        username: "jane",
        amount: 5,
        note: "Goodwill credit",
      });
    });
  });

  it("shows a success toast and re-fetches the audit log after a successful credit", async () => {
    const fetchMock = installCreditFetchMock({
      creditResponse: { ok: true, body: { balance: "10.50" } },
    });
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    const adjustmentsBefore = fetchMock.mock.calls.filter(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/admin/adjustments";
    }).length;

    await user.type(
      screen.getByPlaceholderText("$ (e.g. 5 or -2.50)"),
      "5",
    );
    await user.type(
      screen.getByPlaceholderText("Reason (required for audit log)"),
      "Goodwill credit",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await screen.findByText("Credited jane — new balance $10.50");

    await waitFor(() => {
      const adjustmentsAfter = fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/admin/adjustments";
      }).length;
      expect(adjustmentsAfter).toBeGreaterThan(adjustmentsBefore);
    });
  });

  it("shows an error toast and does not fire a POST when the amount field is empty", async () => {
    const fetchMock = installCreditFetchMock({});
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    // Leave amount blank, fill in a reason, then try to submit.
    await user.type(
      screen.getByPlaceholderText("Reason (required for audit log)"),
      "Goodwill credit",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await screen.findByText(
      "Enter a non-zero amount (use a minus sign to correct down)",
    );

    const creditCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/admin/credit" &&
        ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
          "POST"
      );
    });
    expect(creditCall).toBeUndefined();
  });

  it("shows an error toast and does not fire a POST when the reason field is blank", async () => {
    const fetchMock = installCreditFetchMock({});
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    // Fill in an amount but leave the reason blank.
    await user.type(
      screen.getByPlaceholderText("$ (e.g. 5 or -2.50)"),
      "5",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await screen.findByText("Add a reason — it's recorded in the audit log");

    const creditCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/admin/credit" &&
        ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
          "POST"
      );
    });
    expect(creditCall).toBeUndefined();
  });

  it("shows an error toast and does not fire a POST when the amount exceeds ±1000", async () => {
    const fetchMock = installCreditFetchMock({});
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    await user.type(
      screen.getByPlaceholderText("$ (e.g. 5 or -2.50)"),
      "1001",
    );
    await user.type(
      screen.getByPlaceholderText("Reason (required for audit log)"),
      "Goodwill credit",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await screen.findByText("Amount must be between -1000 and 1000");

    const creditCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(String(input), "http://localhost");
      return (
        url.pathname === "/api/admin/credit" &&
        ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() ===
          "POST"
      );
    });
    expect(creditCall).toBeUndefined();
  });

  it("shows an error toast and does not falsely report success when the credit request fails", async () => {
    installCreditFetchMock({
      creditResponse: {
        ok: false,
        body: { error: "Insufficient permissions" },
      },
    });
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await expandJaneRow(user);

    await user.type(
      screen.getByPlaceholderText("$ (e.g. 5 or -2.50)"),
      "5",
    );
    await user.type(
      screen.getByPlaceholderText("Reason (required for audit log)"),
      "Goodwill credit",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Credit / Correction" }),
    );

    await screen.findByText("Insufficient permissions");
    expect(screen.queryByText(/Credited jane/)).not.toBeInTheDocument();
  });
});

describe("CashClipUsersPanel — Manual Credit Audit Log", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the loading state while the audit log is fetching", () => {
    installFetchMock({ adjustmentsPending: true });
    render(<CashClipUsersPanel token="t" />);
    expect(screen.getByText("Loading audit log…")).toBeInTheDocument();
  });

  it("shows the generic empty state when no credits exist (no filter)", async () => {
    installFetchMock({ adjustments: () => [] });
    render(<CashClipUsersPanel token="t" />);
    expect(
      await screen.findByText("No manual credits or corrections recorded yet."),
    ).toBeInTheDocument();
  });

  it("shows the filtered empty state naming the admin when a filter matches nothing", async () => {
    installFetchMock({
      adjustments: (actor) => (actor ? [] : [aliceRow, bobRow]),
    });
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="t" />);

    // Wait for the initial unfiltered rows so the dropdown is populated.
    await screen.findByText("Goodwill credit");

    await user.selectOptions(screen.getByRole("combobox"), "alice");

    expect(
      await screen.findByText(
        "No manual credits or corrections issued by alice.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No manual credits or corrections recorded yet."),
    ).not.toBeInTheDocument();
  });

  it("narrows the displayed rows when an admin is chosen in the 'Issued by' filter", async () => {
    installFetchMock({
      adjustments: (actor) => {
        const all = [aliceRow, bobRow];
        if (!actor) return all;
        return all.filter((r) => r.actorUsername === actor);
      },
    });
    const user = userEvent.setup();
    render(<CashClipUsersPanel token="t" />);

    const getTable = () =>
      screen.getByText("Correction").closest("table") as HTMLTableElement;

    await screen.findByText("Goodwill credit");
    // Both admins' rows present initially.
    expect(within(getTable()).getByText("Goodwill credit")).toBeInTheDocument();
    expect(within(getTable()).getByText("Correction")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "bob");

    await waitFor(() => {
      expect(
        within(getTable()).queryByText("Goodwill credit"),
      ).not.toBeInTheDocument();
    });
    expect(within(getTable()).getByText("Correction")).toBeInTheDocument();
  });
});
