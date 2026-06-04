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

function installFetchMock(repliesBehavior: RepliesBehavior) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();

    if (u.startsWith("/api/admin/inbox/replies")) {
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

    if (u.startsWith("/api/admin/inbox")) {
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
