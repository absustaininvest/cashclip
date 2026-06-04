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
