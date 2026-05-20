import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_VERSION } from "@/constants/app";

const AUTH_TOKEN_KEY = "cashclip_auth_token";
const REFRESH_TOKEN_KEY = "cashclip_refresh_token";

export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/";
  }

  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

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
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function tryRefreshToken(): Promise<boolean> {
  try {
    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/refresh", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
      return false;
    }
    const data = await res.json();
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
    if (data.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
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

  // On 401, attempt silent token refresh (RIPRENDERE) then retry once
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
      // Attempt silent refresh, then retry
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
