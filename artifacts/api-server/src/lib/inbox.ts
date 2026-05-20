import { ImapFlow } from "imapflow";
import { logger } from "./logger";

export interface InboxMessage {
  uid: number;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  toEmail: string;
  date: string;
  preview: string;
  body: string;
  seen: boolean;
  category: "corporate" | "app" | "support" | "other";
}

interface CacheEntry {
  messages: InboxMessage[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function categorize(toEmail: string): InboxMessage["category"] {
  const addr = toEmail.toLowerCase();
  if (addr.includes("support@absustaininvest")) return "support";
  if (addr.includes("@cash-clip.app")) return "app";
  if (addr.includes("@absustaininvest.com")) return "corporate";
  return "other";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchInbox(folder = "INBOX"): Promise<InboxMessage[]> {
  const cacheKey = folder;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.messages;
  }

  const password = process.env["ZOHO_IMAP_PASSWORD"] ?? process.env["ZOHO_SMTP_PASSWORD"];
  if (!password) throw new Error("ZOHO_IMAP_PASSWORD not configured");

  const client = new ImapFlow({
    host: "imap.zoho.com",
    port: 993,
    secure: true,
    auth: {
      user: "support@absustaininvest.com",
      pass: password,
    },
    logger: false,
  });

  const messages: InboxMessage[] = [];

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(folder);
    const total = mailbox.exists;

    if (total === 0) {
      await client.logout();
      cache.set(cacheKey, { messages: [], fetchedAt: Date.now() });
      return [];
    }

    const fetchFrom = Math.max(1, total - 49);
    const fetchRange = `${fetchFrom}:${total}`;

    for await (const msg of client.fetch(fetchRange, {
      envelope: true,
      bodyStructure: true,
      flags: true,
      bodyParts: ["TEXT"],
    })) {
      try {
        const env = msg.envelope;
        if (!env) continue;
        const from = env.from?.[0];
        const to = env.to?.[0];

        const fromName = from?.name ?? from?.address ?? "Unknown";
        const fromAddr = from?.address ?? "";
        const toAddr = to?.address ?? "";

        let bodyText = "";
        const rawText = msg.bodyParts?.get("TEXT");
        if (rawText) {
          const raw = rawText.toString();
          bodyText = raw.includes("<") ? stripHtml(raw) : raw;
        }

        const preview = bodyText.slice(0, 200).replace(/\s+/g, " ").trim();

        messages.push({
          uid: msg.uid,
          subject: env.subject ?? "(no subject)",
          from: fromName,
          fromEmail: fromAddr,
          to: toAddr,
          toEmail: toAddr,
          date: (env.date ?? new Date()).toISOString(),
          preview,
          body: bodyText.slice(0, 4000),
          seen: msg.flags?.has("\\Seen") ?? false,
          category: categorize(toAddr),
        });
      } catch (msgErr) {
        logger.warn({ msgErr }, "Skipped malformed message");
      }
    }

    await client.logout();
  } catch (err) {
    logger.error({ err }, "IMAP fetch failed");
    try { await client.logout(); } catch {}
    throw err;
  }

  messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  cache.set(cacheKey, { messages, fetchedAt: Date.now() });
  return messages;
}

export function invalidateInboxCache() {
  cache.clear();
}
