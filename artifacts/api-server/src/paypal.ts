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
