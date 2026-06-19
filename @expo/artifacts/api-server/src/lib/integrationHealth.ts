import type { IntegrationStatus } from "../integrations";

/**
 * Returns a public, unauthenticated URL we can probe to confirm a provider's
 * API is reachable, or null when the provider has no cheap public endpoint
 * (in which case "configured" is treated as the best available signal).
 */
export function getHealthCheckUrl(integrationId: string): string | null {
  const urls: Record<string, string> = {
    paypal:
      process.env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com/v1/oauth2/token"
        : "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    pollfish: "https://api.pollfish.com/v2",
    cint: "https://api.cint.com/v1",
    lucid: "https://api.samplicio.us/supply/v1",
    tapjoy: "https://app.tapjoy.com/publisher/v1",
    adgate: "https://wall.adgaterewards.com/api/v1",
    offertoro: "https://www.offertoro.com/api/v1",
  };
  return urls[integrationId] ?? null;
}

export interface HealthCheckResult {
  id: string;
  name: string;
  category: string;
  reachable: boolean;
  httpStatus: number | undefined;
  latencyMs: number;
  error: string | undefined;
}

/**
 * Probe the live reachability of each configured integration in parallel.
 * Each probe is a HEAD request with a 5s timeout; failures degrade to
 * `reachable: false` rather than throwing. Providers without a known public
 * health URL are reported reachable (the credentials are present and there is
 * nothing cheap to probe).
 */
export async function checkIntegrationsHealth(
  configured: IntegrationStatus[],
): Promise<HealthCheckResult[]> {
  const checks = await Promise.allSettled(
    configured.map(async (integration): Promise<HealthCheckResult> => {
      const start = Date.now();
      let reachable = false;
      let error: string | undefined;
      let httpStatus: number | undefined;

      try {
        const testUrl = getHealthCheckUrl(integration.id);
        if (testUrl) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(testUrl, {
            method: "HEAD",
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeout);
          if (resp) {
            httpStatus = resp.status;
            reachable = resp.status < 500;
          }
        } else {
          reachable = true;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : "Connection failed";
      }

      return {
        id: integration.id,
        name: integration.name,
        category: integration.category,
        reachable,
        httpStatus,
        latencyMs: Date.now() - start,
        error,
      };
    }),
  );

  return checks
    .filter(
      (r): r is PromiseFulfilledResult<HealthCheckResult> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}
