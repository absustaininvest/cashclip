import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { APP_VERSION } from "@/constants/app";
import { secureGet, secureSet, secureMultiDelete } from "./secure-store";

const AUTH_TOKEN_KEY = "cashclip_auth_token";
const REFRESH_TOKEN_KEY = "cashclip_refresh_token";

export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/";
  }

  const host = process.env.EXPO_PUBLIC_DOMAIN || "cash-clip.app";
  return new URL(`https://${host}`).href;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

async function buildHeaders(data?: unknown): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "X-App-Version": APP_VERSION };
  if (data) headers["Content-Type"] = "application/json";
  const token = await secureGet(AUTH_TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function tryRefreshToken(): Promise<boolean> {
  try {
    const refreshToken = await secureGet(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/refresh", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await secureMultiDelete([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
      return false;
    }
    const data = await res.json();
    if (typeof data.token !== "string" || !data.token) return false;
    await secureSet(AUTH_TOKEN_KEY, data.token);
    if (typeof data.refreshToken === "string" && data.refreshToken) {
      await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
    }
    return true;
  } catch {
    return false;
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: await buildHeaders(data),
    body: data ? JSON.stringify(data) : undefined,
  });

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      const retryRes = await fetch(url.toString(), {
        method,
        headers: await buildHeaders(data),
        body: data ? JSON.stringify(data) : undefined,
      });
      await throwIfResNotOk(retryRes);
      return retryRes;
    }
  }

  await throwIfResNotOk(res);
  return res;
}

// Like apiRequest, but never throws on a non-2xx status — it returns the raw
// Response so callers can branch on the status code and body (e.g. honor a
// retryable 503 by quietly retrying). The 401 refresh-and-retry handshake is
// still performed.
export async function apiRequestSafe(
  method: string,
  route: string,
  data?: unknown,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: await buildHeaders(data),
    body: data ? JSON.stringify(data) : undefined,
  });

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return fetch(url.toString(), {
        method,
        headers: await buildHeaders(data),
        body: data ? JSON.stringify(data) : undefined,
      });
    }
  }

  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url.toString(), { headers: await buildHeaders() });

    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const retryRes = await fetch(url.toString(), { headers: await buildHeaders() });
        if (unauthorizedBehavior === "returnNull" && retryRes.status === 401) return null;
        await throwIfResNotOk(retryRes);
        return await retryRes.json();
      }
      if (unauthorizedBehavior === "returnNull") return null;
      throw new Error(`401: Unauthorized`);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
