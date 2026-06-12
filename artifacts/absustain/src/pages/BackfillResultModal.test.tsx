import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashClipUsersPanel } from "./Admin";

function jsonRes(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response);
}

type BackfillBody = { dryRun: boolean };

type BackfillResultData = {
  candidates: number;
  credited: number;
  skipped: number;
  failed: number;
  bonusPerReferral: number;
  creditedReferrers: { referrer: string; referredFriend: string; amount: number }[];
  skippedReferrals: { referrer: string; referredFriend: string }[];
  failedReferrals: { referrer: string; referredFriend: string; error?: string }[];
};

function installFetchMock(resultData: BackfillResultData) {
  const preview = {
    candidates: resultData.candidates,
    qualifyAmount: 3,
    bonusPerReferral: resultData.bonusPerReferral,
  };

  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    if (path === "/api/admin/users") return jsonRes({ users: [], total: 0 });
    if (path === "/api/admin/payout-per-user") return jsonRes({ perUser: [] });
    if (path === "/api/admin/adjustments") return jsonRes({ adjustments: [] });
    if (path === "/api/admin/adjustments/actors") return jsonRes({ actors: [] });

    if (path === "/api/admin/referrals/backfill" && method === "POST") {
      const body: BackfillBody = JSON.parse((init?.body as string) ?? "{}");
      return jsonRes(body.dryRun ? preview : resultData);
    }

    return jsonRes({});
  });

  vi.stubGlobal("fetch", mock);
  return mock;
}

async function openAndRunBackfill(user: ReturnType<typeof userEvent.setup>) {
  const btn = await screen.findByRole("button", { name: /Credit Past Referrers/i });
  await user.click(btn);

  const passInput = await screen.findByPlaceholderText("Master passphrase");
  await user.type(passInput, "secret123");

  await user.click(screen.getByRole("button", { name: /Preview/i }));
  // "before the feature shipped." only appears in the dynamic preview result note,
  // not in the static description — safe to use as the ready signal.
  await screen.findByText(/before the feature shipped/i);

  await user.click(screen.getByRole("button", { name: /Run/i }));
  await screen.findByText("Backfill Complete ✓");
}

/** Returns the itemized list container (the scrollable div below the stat grid). */
function getItemizedList() {
  return document.querySelector(
    ".max-h-60.overflow-y-auto",
  ) as HTMLElement | null;
}

describe("Backfill result modal — itemized referrer lists", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the stat grid summary with correct candidate / credited / skipped / failed counts", async () => {
    installFetchMock({
      candidates: 3,
      credited: 1,
      skipped: 1,
      failed: 1,
      bonusPerReferral: 2,
      creditedReferrers: [{ referrer: "alice", referredFriend: "bob", amount: 2 }],
      skippedReferrals: [{ referrer: "carol", referredFriend: "dave" }],
      failedReferrals: [{ referrer: "eve", referredFriend: "frank", error: "DB timeout" }],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    const modal = screen.getByText("Backfill Complete ✓").closest("div")!;

    const candidatesCell = within(modal).getByText("Candidates").closest("div")!;
    expect(within(candidatesCell).getByText("3")).toBeInTheDocument();

    const creditedCell = within(modal)
      .getAllByText("Credited")[0]
      .closest("div")!;
    expect(within(creditedCell).getByText("1")).toBeInTheDocument();
  });

  it("renders each credited referrer's name, friend, and green +$amount badge", async () => {
    installFetchMock({
      candidates: 2,
      credited: 2,
      skipped: 0,
      failed: 0,
      bonusPerReferral: 5,
      creditedReferrers: [
        { referrer: "userA", referredFriend: "friendX", amount: 5 },
        { referrer: "userB", referredFriend: "friendY", amount: 5 },
      ],
      skippedReferrals: [],
      failedReferrals: [],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    const list = getItemizedList()!;
    expect(list).not.toBeNull();

    expect(within(list).getByText("userA")).toBeInTheDocument();
    expect(within(list).getByText("for friendX")).toBeInTheDocument();
    expect(within(list).getByText("userB")).toBeInTheDocument();
    expect(within(list).getByText("for friendY")).toBeInTheDocument();

    const amountBadges = within(list).getAllByText("+$5");
    expect(amountBadges).toHaveLength(2);
  });

  it("renders each skipped referrer with the muted 'Skipped' badge and no dollar amount", async () => {
    installFetchMock({
      candidates: 1,
      credited: 0,
      skipped: 1,
      failed: 0,
      bonusPerReferral: 1,
      creditedReferrers: [],
      skippedReferrals: [{ referrer: "mia", referredFriend: "leo" }],
      failedReferrals: [],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    const list = getItemizedList()!;
    expect(list).not.toBeNull();

    expect(within(list).getByText("mia")).toBeInTheDocument();
    expect(within(list).getByText("for leo")).toBeInTheDocument();
    expect(within(list).getByText("Skipped")).toBeInTheDocument();
    expect(within(list).queryByText(/\+\$/)).toBeNull();
  });

  it("renders failed entries in red with the error message appended to the friend line", async () => {
    installFetchMock({
      candidates: 1,
      credited: 0,
      skipped: 0,
      failed: 1,
      bonusPerReferral: 1,
      creditedReferrers: [],
      skippedReferrals: [],
      failedReferrals: [{ referrer: "zed", referredFriend: "nate", error: "Insufficient funds" }],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    const list = getItemizedList()!;
    expect(list).not.toBeNull();

    expect(within(list).getByText("zed")).toBeInTheDocument();
    const detail = within(list).getByText(/for nate/);
    expect(detail.textContent).toContain("Insufficient funds");
    expect(within(list).getByText("Failed")).toBeInTheDocument();
    expect(within(list).queryByText(/\+\$/)).toBeNull();
  });

  it("renders a mixed set — credited green, skipped muted, failed red — each with correct label", async () => {
    installFetchMock({
      candidates: 3,
      credited: 1,
      skipped: 1,
      failed: 1,
      bonusPerReferral: 2,
      creditedReferrers: [{ referrer: "alice", referredFriend: "bob", amount: 2 }],
      skippedReferrals: [{ referrer: "carol", referredFriend: "dave" }],
      failedReferrals: [{ referrer: "eve", referredFriend: "frank", error: "DB timeout" }],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    const list = getItemizedList()!;
    expect(list).not.toBeNull();

    expect(within(list).getByText("alice")).toBeInTheDocument();
    expect(within(list).getByText("for bob")).toBeInTheDocument();
    expect(within(list).getByText("+$2")).toBeInTheDocument();

    expect(within(list).getByText("carol")).toBeInTheDocument();
    expect(within(list).getByText("for dave")).toBeInTheDocument();
    expect(within(list).getByText("Skipped")).toBeInTheDocument();

    expect(within(list).getByText("eve")).toBeInTheDocument();
    const frankDetail = within(list).getByText(/for frank/);
    expect(frankDetail.textContent).toContain("DB timeout");
    expect(within(list).getByText("Failed")).toBeInTheDocument();
  });

  it("does not render the itemized list container when all three arrays are empty", async () => {
    installFetchMock({
      candidates: 0,
      credited: 0,
      skipped: 0,
      failed: 0,
      bonusPerReferral: 1,
      creditedReferrers: [],
      skippedReferrals: [],
      failedReferrals: [],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    expect(getItemizedList()).toBeNull();
  });

  it("dismisses the modal and clears state when Done is clicked", async () => {
    installFetchMock({
      candidates: 1,
      credited: 1,
      skipped: 0,
      failed: 0,
      bonusPerReferral: 2,
      creditedReferrers: [{ referrer: "tom", referredFriend: "jerry", amount: 2 }],
      skippedReferrals: [],
      failedReferrals: [],
    });

    const user = userEvent.setup();
    render(<CashClipUsersPanel token="admin-token" />);

    await openAndRunBackfill(user);

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByText("Backfill Complete ✓")).not.toBeInTheDocument();
    });
  });
});
