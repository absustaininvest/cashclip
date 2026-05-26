const PAYPAL_API_BASE = process.env.PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

interface PayPalAccessToken {
  access_token: string;
  expires_in: number;
}

interface PayPalPayoutItem {
  recipient_type: "EMAIL";
  amount: { value: string; currency: string };
  receiver: string;
  note: string;
  sender_item_id: string;
}

interface PayPalPayoutResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
  };
}

function getPayPalSecret(): string | undefined {
  return process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET;
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = getPayPalSecret();

  if (!clientId || !secret) {
    throw new Error("PayPal credentials not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET (or PAYPAL_CLIENT_SECRET).");
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as PayPalAccessToken;
  return data.access_token;
}

export interface PayPalPayoutResult {
  success: boolean;
  batchId?: string;
  error?: string;
  /**
   * True when the outcome is uncertain — e.g. a network timeout or connection
   * drop that occurred after the request was dispatched to PayPal. In these
   * cases PayPal may have already queued the payment even though no success
   * response was observed. Callers MUST NOT re-open the withdrawal for retry
   * when this flag is true.
   */
  ambiguous?: boolean;
}

export async function sendPayPalPayout(
  withdrawalId: string,
  paypalEmail: string,
  amount: string,
  note: string = "CashClip withdrawal payout",
  senderBatchId?: string
): Promise<PayPalPayoutResult> {
  let requestDispatched = false;
  try {
    const accessToken = await getAccessToken();

    const stableBatchId = senderBatchId ?? `cashclip_${withdrawalId}`;

    const payload = {
      sender_batch_header: {
        sender_batch_id: stableBatchId,
        email_subject: "You have a CashClip payout!",
        email_message: "You received a payout from CashClip. Thanks for being part of our community!",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: amount, currency: "USD" },
          receiver: paypalEmail,
          note,
          sender_item_id: withdrawalId,
        },
      ] as PayPalPayoutItem[],
    };

    requestDispatched = true;
    const res = await fetch(`${PAYPAL_API_BASE}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      // Attempt structured JSON parse of the PayPal error response so we can
      // match the machine-readable `name` field rather than doing a fragile
      // substring search on the raw body.
      let paypalErrorName: string | undefined;
      try {
        const errorBody = JSON.parse(text) as { name?: string; message?: string };
        paypalErrorName = errorBody.name;
      } catch {
        // Non-JSON body — fall through to raw status check
      }

      // PayPal uses SENDER_BATCH_ID_ALREADY_IN_USE when the same batch was
      // already accepted. This means the original request went through — treat
      // it as ambiguous so the caller does NOT reopen the withdrawal for retry.
      const isDuplicateBatch =
        paypalErrorName === "SENDER_BATCH_ID_ALREADY_IN_USE" ||
        (!paypalErrorName && res.status === 400 && text.includes("SENDER_BATCH_ID_ALREADY_IN_USE"));

      if (isDuplicateBatch) {
        return {
          success: false,
          error: "PayPal batch already submitted (SENDER_BATCH_ID_ALREADY_IN_USE). The payment may have been processed — verify with PayPal before retrying.",
          ambiguous: true,
        };
      }

      return { success: false, error: `PayPal API error: ${res.status}` };
    }

    const data = (await res.json()) as PayPalPayoutResponse;
    return {
      success: true,
      batchId: data.batch_header.payout_batch_id,
    };
  } catch (err: any) {
    // If the request was already dispatched before the exception (e.g. a
    // network timeout or connection reset), we cannot know whether PayPal
    // accepted the batch. Mark the result ambiguous so the caller leaves the
    // withdrawal locked rather than reopening it for a duplicate retry.
    return {
      success: false,
      error: err.message,
      ambiguous: requestDispatched,
    };
  }
}

export function isPayPalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && getPayPalSecret());
}

export function isPayPalWebhookConfigured(): boolean {
  return !!(process.env.PAYPAL_WEBHOOK_ID);
}

function headerStr(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return undefined;
}

export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer | string,
): Promise<{ ok: boolean; reason?: string }> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return { ok: false, reason: "PAYPAL_WEBHOOK_ID not configured — webhook verification disabled" };
  }

  const transmissionId = headerStr(headers, "paypal-transmission-id");
  const transmissionTime = headerStr(headers, "paypal-transmission-time");
  const certUrl = headerStr(headers, "paypal-cert-url");
  const authAlgo = headerStr(headers, "paypal-auth-algo");
  const transmissionSig = headerStr(headers, "paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { ok: false, reason: "Missing required PayPal webhook headers" };
  }

  let webhookEvent: unknown;
  try {
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    webhookEvent = JSON.parse(bodyStr);
  } catch {
    return { ok: false, reason: "Invalid JSON body" };
  }

  try {
    const accessToken = await getAccessToken();
    const verifyRes = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent,
      }),
    });

    if (!verifyRes.ok) {
      const text = await verifyRes.text();
      return { ok: false, reason: `PayPal verification API error: ${verifyRes.status} ${text}` };
    }

    const result = (await verifyRes.json()) as { verification_status: string };
    if (result.verification_status === "SUCCESS") {
      return { ok: true };
    }
    return { ok: false, reason: `PayPal verification_status: ${result.verification_status}` };
  } catch (err: any) {
    return { ok: false, reason: `PayPal verification request failed: ${err.message}` };
  }
}
