import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { InboxPanel } from "./Admin";

const TOKEN = "test-admin-token";

const message = {
  uid: 1,
  messageId: "msg-thread-1",
  subject: "Need help with my withdrawal",
  from: "Jane Doe",
  fromEmail: "jane@example.com",
  to: "Support",
  toEmail: "support@absustaininvest.com",
  date: new Date("2026-06-01T10:00:00Z").toISOString(),
  preview: "Hi, I have a question…",
  body: "Hi, I have a question about my withdrawal.",
  seen: false,
  category: "support" as const,
};

const olderReply = {
  id: "reply-older",
  adminUserId: "admin-1",
  adminUsername: "alice",
  adminEmail: "alice@absustaininvest.com",
  recipient: "jane@example.com",
  subject: "Re: Need help with my withdrawal",
  body: "Thanks for reaching out — looking into it now.",
  inReplyTo: "msg-thread-1",
  createdAt: new Date("2026-06-01T11:00:00Z").toISOString(),
};

const newerReply = {
  id: "reply-newer",
  adminUserId: "admin-2",
  adminUsername: "bob",
  adminEmail: "bob@absustaininvest.com",
  recipient: "jane@example.com",
  subject: "Re: Need help with my withdrawal",
  body: "Your withdrawal has now been approved.",
  inReplyTo: "msg-thread-1",
  createdAt: new Date("2026-06-02T09:30:00Z").toISOString(),
};

type RepliesBehavior =
  | { kind: "list"; replies: any[] }
  | { kind: "error" };

type ReplyBehavior =
  | { kind: "ok" }
  | { kind: "error"; status?: number; error?: string };

function installFetchMock(
  repliesBehavior: RepliesBehavior,
  replyBehavior: ReplyBehavior = { kind: "ok" },
) {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const path = u.split("?")[0];

    // The send-reply endpoint (POST) is an exact path; it must be matched
    // before the generic "/api/admin/inbox" branch because it shares that
    // prefix. Note it is distinct from "/api/admin/inbox/replies" (history).
    if (path === "/api/admin/inbox/reply") {
      if (replyBehavior.kind === "error") {
        return {
          ok: false,
          status: replyBehavior.status ?? 500,
          json: async () => ({
            error: replyBehavior.error ?? "Failed to send reply",
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    }

    if (path === "/api/admin/inbox/replies") {
      if (repliesBehavior.kind === "error") {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Failed to load reply history" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ replies: repliesBehavior.replies }),
      } as Response;
    }

    if (path === "/api/admin/inbox") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [message],
          fetchedAt: new Date("2026-06-04T00:00:00Z").toISOString(),
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function countCalls(fetchMock: ReturnType<typeof installFetchMock>, path: string) {
  return fetchMock.mock.calls.filter((call) => {
    const url = call[0];
    const u = typeof url === "string" ? url : (url as URL).toString();
    return u.split("?")[0] === path;
  }).length;
}

async function openComposerAndType(text: string) {
  const replyButton = screen.getByRole("button", { name: /^Reply$/ });
  fireEvent.click(replyButton);
  const textarea = (await screen.findByPlaceholderText(
    "Write your reply…",
  )) as HTMLTextAreaElement;
  if (text) fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

async function renderAndSelectMessage() {
  render(<InboxPanel token={TOKEN} />);
  const messageButton = await screen.findByText("Need help with my withdrawal");
  fireEvent.click(messageButton);
  // Detail pane opens once a message is selected.
  await screen.findByText("Reply History");
}

describe("InboxPanel reply history", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders prior replies oldest-first with sender attribution and timestamp", async () => {
    installFetchMock({ kind: "list", replies: [olderReply, newerReply] });
    await renderAndSelectMessage();

    // Both replies' bodies are visible.
    const olderBody = await screen.findByText(
      "Thanks for reaching out — looking into it now.",
    );
    const newerBody = await screen.findByText(
      "Your withdrawal has now been approved.",
    );
    expect(olderBody).toBeInTheDocument();
    expect(newerBody).toBeInTheDocument();

    // Sender attribution shows for each reply.
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();

    // A formatted timestamp is rendered for the older reply.
    const expectedStamp = new Date(olderReply.createdAt).toLocaleString(
      "en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
    );
    expect(screen.getByText(expectedStamp)).toBeInTheDocument();

    // Oldest-first ordering: the older reply appears before the newer one in
    // document order.
    const position = olderBody.compareDocumentPosition(newerBody);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the empty state after a successful fetch returning zero replies", async () => {
    installFetchMock({ kind: "list", replies: [] });
    await renderAndSelectMessage();

    expect(
      await screen.findByText("No prior replies to this thread yet."),
    ).toBeInTheDocument();
  });

  it("shows an inline error notice when the history fetch fails", async () => {
    installFetchMock({ kind: "error" });
    await renderAndSelectMessage();

    expect(
      await screen.findByText("Couldn't load prior replies for this thread."),
    ).toBeInTheDocument();
    // The empty-state message must NOT appear when loading failed.
    expect(
      screen.queryByText("No prior replies to this thread yet."),
    ).not.toBeInTheDocument();
  });

  it("keeps the reply box usable even when history loading fails", async () => {
    installFetchMock({ kind: "error" });
    await renderAndSelectMessage();

    await screen.findByText("Couldn't load prior replies for this thread.");

    // Operator can still open the reply composer and type a message.
    const replyButton = screen.getByRole("button", { name: /^Reply$/ });
    fireEvent.click(replyButton);

    const textarea = (await screen.findByPlaceholderText(
      "Write your reply…",
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Following up here." } });
    expect(textarea.value).toBe("Following up here.");

    // The Send Reply action is available and enabled with content present.
    const sendButton = screen.getByRole("button", { name: /Send Reply/ });
    expect(sendButton).toBeEnabled();
  });
});

describe("InboxPanel sending a reply", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("on a successful send shows the confirmation and re-fetches history", async () => {
    const fetchMock = installFetchMock(
      { kind: "list", replies: [] },
      { kind: "ok" },
    );
    await renderAndSelectMessage();

    // History is fetched once when the message is selected.
    await waitFor(() =>
      expect(countCalls(fetchMock, "/api/admin/inbox/replies")).toBe(1),
    );

    await openComposerAndType("Thanks — your withdrawal is approved.");
    fireEvent.click(screen.getByRole("button", { name: /Send Reply/ }));

    // The send POST is issued to the reply endpoint.
    await waitFor(() =>
      expect(countCalls(fetchMock, "/api/admin/inbox/reply")).toBe(1),
    );

    // Success confirmation appears and the composer closes.
    expect(
      await screen.findByText("Reply sent to jane@example.com"),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Write your reply…"),
    ).not.toBeInTheDocument();

    // History is re-fetched after a successful send (second call).
    await waitFor(() =>
      expect(
        countCalls(fetchMock, "/api/admin/inbox/replies"),
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("on a failed send shows the inline error and keeps the composer open", async () => {
    installFetchMock(
      { kind: "list", replies: [] },
      { kind: "error", status: 502, error: "SMTP server unavailable" },
    );
    await renderAndSelectMessage();

    const textarea = await openComposerAndType("Following up on your ticket.");
    fireEvent.click(screen.getByRole("button", { name: /Send Reply/ }));

    // The server's error message is surfaced inline.
    expect(
      await screen.findByText("SMTP server unavailable"),
    ).toBeInTheDocument();

    // The composer stays open with the typed text preserved so the operator
    // can retry; no success confirmation is shown.
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe("Following up on your ticket.");
    expect(
      screen.queryByText("Reply sent to jane@example.com"),
    ).not.toBeInTheDocument();
  });

  it("blocks an empty-body submission from sending a reply", async () => {
    const fetchMock = installFetchMock(
      { kind: "list", replies: [] },
      { kind: "ok" },
    );
    await renderAndSelectMessage();

    // Open the composer but leave the body empty.
    const textarea = await openComposerAndType("");
    const sendButton = screen.getByRole("button", { name: /Send Reply/ });

    // With no content the Send Reply action is disabled, guarding against the
    // empty submission the "Reply message cannot be empty." validation backs.
    expect(sendButton).toBeDisabled();

    // Whitespace-only content is treated the same as empty.
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(sendButton).toBeDisabled();

    // Attempting to send does not issue a request to the reply endpoint.
    fireEvent.click(sendButton);
    expect(countCalls(fetchMock, "/api/admin/inbox/reply")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sent Replies audit log view
// ---------------------------------------------------------------------------

const sentReply1 = {
  id: "sent-1",
  adminUserId: "admin-1",
  adminUsername: "alice",
  adminEmail: "alice@absustaininvest.com",
  recipient: "jane@example.com",
  subject: "Re: Withdrawal question",
  body: "Your withdrawal has been processed.",
  inReplyTo: "msg-thread-1",
  createdAt: new Date("2026-06-03T14:30:00Z").toISOString(),
};

const sentReply2 = {
  id: "sent-2",
  adminUserId: "admin-2",
  adminUsername: "bob",
  adminEmail: "bob@absustaininvest.com",
  recipient: "john@example.com",
  subject: "Re: Account issue",
  body: "We have resolved your account issue.",
  inReplyTo: "msg-thread-2",
  createdAt: new Date("2026-06-04T09:00:00Z").toISOString(),
};

type SentBehavior =
  | { kind: "list"; replies: any[]; total: number }
  | { kind: "error"; message?: string };

function installSentFetchMock(sentBehavior: SentBehavior) {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const path = u.split("?")[0];

    if (path === "/api/admin/inbox/replies/all") {
      if (sentBehavior.kind === "error") {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            error: sentBehavior.message ?? "Failed to load sent replies",
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          replies: sentBehavior.replies,
          total: sentBehavior.total,
        }),
      } as Response;
    }

    // Admin user list for the admin-filter dropdown — return empty list.
    if (path === "/api/admin/users") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ users: [] }),
      } as Response;
    }

    // Initial inbox fetch — return no messages so no thread is selected.
    if (path === "/api/admin/inbox") {
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
  return fetchMock;
}

function urlsFor(
  fetchMock: ReturnType<typeof installSentFetchMock>,
  path: string,
): string[] {
  return fetchMock.mock.calls
    .map((c) => {
      const u = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
      return u;
    })
    .filter((u) => u.split("?")[0] === path);
}

async function switchToSentView() {
  render(<InboxPanel token={TOKEN} />);
  const sentBtn = await screen.findByRole("button", { name: /Sent Replies/ });
  fireEvent.click(sentBtn);
}

describe("InboxPanel sent replies view", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders sent replies with admin attribution, recipient, and timestamp", async () => {
    installSentFetchMock({
      kind: "list",
      replies: [sentReply1, sentReply2],
      total: 2,
    });
    await switchToSentView();

    // Admin attribution (green username) is visible for each reply.
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();

    // Recipient addresses appear next to the attribution arrow.
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("john@example.com")).toBeInTheDocument();

    // Reply bodies are rendered.
    expect(
      screen.getByText("Your withdrawal has been processed."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We have resolved your account issue."),
    ).toBeInTheDocument();

    // A formatted timestamp (including year) appears for the first reply.
    const expectedStamp = new Date(sentReply1.createdAt).toLocaleString(
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
  });

  it("requests the next page with the correct offset params and replaces the list with page-2 content", async () => {
    // Page 0 has 25 replies; page 1 has one unique reply. Total = 26 triggers pagination.
    const page0Replies = Array.from({ length: 25 }, (_, i) => ({
      ...sentReply1,
      id: `sent-p0-${i}`,
      recipient: `page0user${i}@example.com`,
      body: `Page 0 reply ${i}`,
      adminUsername: "alice",
    }));
    const page1Reply = {
      ...sentReply2,
      id: "sent-p1-0",
      recipient: "page1user@example.com",
      body: "Page 1 only reply",
      adminUsername: "charlie",
    };

    // Use a custom fetch mock that returns different data depending on offset.
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      const path = u.split("?")[0];
      const params = new URLSearchParams(u.includes("?") ? u.split("?")[1] : "");

      if (path === "/api/admin/inbox/replies/all") {
        const offset = parseInt(params.get("offset") ?? "0", 10);
        if (offset === 0) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ replies: page0Replies, total: 26 }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ replies: [page1Reply], total: 26 }),
        } as Response;
      }
      if (path === "/api/admin/users") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [] }),
        } as Response;
      }
      if (path === "/api/admin/inbox") {
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

    render(<InboxPanel token={TOKEN} />);
    const sentBtn = await screen.findByRole("button", { name: /Sent Replies/ });
    fireEvent.click(sentBtn);

    // Page 0 content is visible initially.
    await screen.findByText("Page 0 reply 0");

    // "Next" button is enabled and we navigate to page 1.
    const nextButton = await screen.findByRole("button", { name: /^Next$/ });
    expect(nextButton).toBeEnabled();
    fireEvent.click(nextButton);

    // Page 1's unique reply appears and the page-0 content is gone.
    expect(await screen.findByText("Page 1 only reply")).toBeInTheDocument();
    expect(screen.queryByText("Page 0 reply 0")).not.toBeInTheDocument();

    // The request for page 1 carried limit=25 and offset=25.
    const allUrls = fetchMock.mock.calls
      .map((c) => (typeof c[0] === "string" ? c[0] : (c[0] as URL).toString()))
      .filter((u) => u.split("?")[0] === "/api/admin/inbox/replies/all");
    expect(
      allUrls.some((u) => u.includes("offset=25") && u.includes("limit=25")),
    ).toBe(true);
  });

  it("applies the recipient filter to the request URL", async () => {
    const fetchMock = installSentFetchMock({
      kind: "list",
      replies: [sentReply1],
      total: 1,
    });
    await switchToSentView();

    // Wait for the initial (unfiltered) load.
    await waitFor(() =>
      expect(urlsFor(fetchMock, "/api/admin/inbox/replies/all").length).toBeGreaterThan(0),
    );

    // Type a recipient address and submit via the Search button.
    const filterInput = screen.getByPlaceholderText("Filter by recipient email…");
    fireEvent.change(filterInput, { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

    // A new request must include the encoded recipient query parameter.
    await waitFor(() =>
      expect(
        urlsFor(fetchMock, "/api/admin/inbox/replies/all").some((u) =>
          u.includes("recipient=jane%40example.com"),
        ),
      ).toBe(true),
    );
  });

  it("also applies the recipient filter when submitted by pressing Enter", async () => {
    const fetchMock = installSentFetchMock({
      kind: "list",
      replies: [sentReply1],
      total: 1,
    });
    await switchToSentView();

    await waitFor(() =>
      expect(urlsFor(fetchMock, "/api/admin/inbox/replies/all").length).toBeGreaterThan(0),
    );

    const filterInput = screen.getByPlaceholderText("Filter by recipient email…");
    fireEvent.change(filterInput, { target: { value: "jane@example.com" } });
    fireEvent.keyDown(filterInput, { key: "Enter" });

    await waitFor(() =>
      expect(
        urlsFor(fetchMock, "/api/admin/inbox/replies/all").some((u) =>
          u.includes("recipient=jane%40example.com"),
        ),
      ).toBe(true),
    );
  });

  it("shows the unfiltered empty state when no replies have been sent", async () => {
    installSentFetchMock({ kind: "list", replies: [], total: 0 });
    await switchToSentView();

    expect(
      await screen.findByText("No replies have been sent yet"),
    ).toBeInTheDocument();
  });

  it("shows the filtered empty state when active filters return no results", async () => {
    installSentFetchMock({ kind: "list", replies: [], total: 0 });
    await switchToSentView();

    // Apply a recipient filter so the component enters the "filtered" branch.
    const filterInput = screen.getByPlaceholderText("Filter by recipient email…");
    fireEvent.change(filterInput, { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

    expect(
      await screen.findByText("No replies match the selected filters"),
    ).toBeInTheDocument();
    // The unfiltered empty-state copy must NOT appear simultaneously.
    expect(
      screen.queryByText("No replies have been sent yet"),
    ).not.toBeInTheDocument();
  });

  it("shows the server error message when GET /api/admin/inbox/replies/all returns non-OK", async () => {
    installSentFetchMock({ kind: "error" });
    await switchToSentView();

    expect(
      await screen.findByText("Failed to load sent replies"),
    ).toBeInTheDocument();
    // Neither empty-state variant should appear alongside the error.
    expect(
      screen.queryByText("No replies have been sent yet"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No replies match the selected filters"),
    ).not.toBeInTheDocument();
  });

  it("shows a custom server error message when the API response includes one", async () => {
    installSentFetchMock({
      kind: "error",
      message: "Database connection lost",
    });
    await switchToSentView();

    expect(
      await screen.findByText("Database connection lost"),
    ).toBeInTheDocument();
  });
});
