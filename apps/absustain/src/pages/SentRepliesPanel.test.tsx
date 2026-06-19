import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InboxPanel } from "./Admin";

const TOKEN = "test-admin-token";

const ALL_URL = "/api/admin/inbox/replies/all";

const replyNewer = {
  id: "reply-newer",
  adminUserId: "admin-2",
  adminUsername: "bob",
  adminEmail: "bob@absustaininvest.com",
  recipient: "newer@example.com",
  subject: "Re: Newest withdrawal question",
  body: "Your withdrawal has now been approved.",
  inReplyTo: "msg-thread-2",
  createdAt: new Date("2026-06-03T09:30:00Z").toISOString(),
};

const replyOlder = {
  id: "reply-older",
  adminUserId: "admin-1",
  adminUsername: "alice",
  adminEmail: "alice@absustaininvest.com",
  recipient: "older@example.com",
  subject: "Re: Oldest account question",
  body: "Thanks for reaching out — looking into it now.",
  inReplyTo: "msg-thread-1",
  createdAt: new Date("2026-06-01T08:00:00Z").toISOString(),
};

type AllHandler = (url: URL) => Response;

/**
 * Installs a fetch mock that records every call and routes the global
 * "Sent Replies" audit-log endpoint to a supplied handler. The inbox-message
 * endpoint (hit on mount) returns an empty inbox so we can drive the component
 * straight into the Sent Replies view.
 */
function installFetchMock(allHandler: AllHandler) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push(u);

    if (u.startsWith(ALL_URL)) {
      return allHandler(new URL(u, "http://localhost"));
    }

    if (u.startsWith("/api/admin/inbox")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [],
          fetchedAt: new Date("2026-06-04T00:00:00Z").toISOString(),
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

function okReplies(replies: any[], total = replies.length) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ replies, total }),
  } as Response;
}

const allCalls = (calls: string[]) =>
  calls.filter((c) => c.startsWith(ALL_URL));

async function switchToSentView() {
  render(<InboxPanel token={TOKEN} />);
  const sentTab = await screen.findByRole("button", { name: /Sent Replies/i });
  fireEvent.click(sentTab);
}

describe("InboxPanel — Sent Replies audit log", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a friendly empty state when no replies have been sent", async () => {
    installFetchMock(() => okReplies([], 0));
    await switchToSentView();

    expect(
      await screen.findByText("No replies have been sent yet"),
    ).toBeInTheDocument();
  });

  it("renders the loaded list newest-first with sender, recipient, subject and timestamp", async () => {
    installFetchMock(() => okReplies([replyNewer, replyOlder], 2));
    await switchToSentView();

    // Subjects from both replies render.
    const newerSubject = await screen.findByText(
      "Re: Newest withdrawal question",
    );
    const olderSubject = await screen.findByText(
      "Re: Oldest account question",
    );
    expect(newerSubject).toBeInTheDocument();
    expect(olderSubject).toBeInTheDocument();

    // Sender attribution (username) for each reply.
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();

    // Recipient for each reply.
    expect(screen.getByText("newer@example.com")).toBeInTheDocument();
    expect(screen.getByText("older@example.com")).toBeInTheDocument();

    // A formatted timestamp is rendered for the newer reply.
    const expectedStamp = new Date(replyNewer.createdAt).toLocaleString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      },
    );
    expect(screen.getByText(expectedStamp)).toBeInTheDocument();

    // Newest-first ordering: the newer reply appears before the older one in
    // document order.
    const position = newerSubject.compareDocumentPosition(olderSubject);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("re-queries the endpoint with the recipient filter and narrows the list", async () => {
    const { calls } = installFetchMock((url) => {
      const recipient = url.searchParams.get("recipient");
      if (recipient === "older@example.com") {
        return okReplies([replyOlder], 1);
      }
      return okReplies([replyNewer, replyOlder], 2);
    });
    await switchToSentView();

    // Both replies present before filtering.
    await screen.findByText("Re: Newest withdrawal question");
    expect(
      screen.getByText("Re: Oldest account question"),
    ).toBeInTheDocument();

    // Apply the recipient filter and submit via the Search button.
    const input = screen.getByPlaceholderText("Filter by recipient email…");
    fireEvent.change(input, { target: { value: "older@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // List narrows to just the matching recipient.
    await waitFor(() => {
      expect(
        screen.queryByText("Re: Newest withdrawal question"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Re: Oldest account question"),
    ).toBeInTheDocument();

    // The endpoint was re-queried with the recipient param.
    await waitFor(() => {
      expect(
        allCalls(calls).some((c) =>
          c.includes("recipient=older%40example.com"),
        ),
      ).toBe(true);
    });
  });

  it("requests the next page with the right offset when paginating", async () => {
    const { calls } = installFetchMock((url) => {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (offset >= 25) {
        return okReplies(
          [{ ...replyOlder, id: "p2", subject: "Page two reply" }],
          30,
        );
      }
      return okReplies(
        [{ ...replyNewer, id: "p1", subject: "Page one reply" }],
        30,
      );
    });
    await switchToSentView();

    // First page content and pagination controls (total 30 > page size 25).
    await screen.findByText("Page one reply");
    const nextButton = await screen.findByRole("button", { name: "Next" });

    // First fetch used offset=0.
    await waitFor(() => {
      expect(allCalls(calls).some((c) => c.includes("offset=0"))).toBe(true);
    });

    fireEvent.click(nextButton);

    // Second page is fetched with offset=25 and its content renders.
    await screen.findByText("Page two reply");
    await waitFor(() => {
      expect(allCalls(calls).some((c) => c.includes("offset=25"))).toBe(true);
    });
    expect(screen.getByText("Showing 26–30 of 30")).toBeInTheDocument();
  });

  it("shows an error state instead of a blank screen when the fetch fails", async () => {
    installFetchMock(
      () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ error: "Failed to load sent replies" }),
        }) as Response,
    );
    await switchToSentView();

    expect(
      await screen.findByText("Failed to load sent replies"),
    ).toBeInTheDocument();

    expect(
      screen.queryByText("No replies have been sent yet"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No replies match the selected filters"),
    ).not.toBeInTheDocument();
  });
});
