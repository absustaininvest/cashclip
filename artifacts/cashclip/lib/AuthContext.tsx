import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getApiUrl } from "./query-client";
import { secureGet, secureSet, secureMultiDelete } from "./secure-store";
import { setAdMobUserId } from "./admob";

const AUTH_TOKEN_KEY = "cashclip_auth_token";
const REFRESH_TOKEN_KEY = "cashclip_refresh_token";

interface AuthUser {
  id: string;
  username: string;
  role: string;
  paypalEmail: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string, email: string, referralCode?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  isAdmin: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => {},
  refreshSession: async () => false,
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    restoreSession();
  }, []);

  // Keep AdMob's Server-Side Verification identity in lockstep with the logged-in
  // user so rewarded-ad rewards are credited to — and only to — the current
  // account. Setting it here (rather than per-screen) means it is in place before
  // any screen can request or show a rewarded ad.
  useEffect(() => {
    setAdMobUserId(user?.id ?? null);
  }, [user?.id]);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const storedRefreshToken = await secureGet(REFRESH_TOKEN_KEY);
      if (!storedRefreshToken) return false;
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/refresh", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
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
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  async function restoreSession() {
    try {
      const savedToken = await secureGet(AUTH_TOKEN_KEY);
      if (savedToken) {
        const baseUrl = getApiUrl();
        const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setToken(savedToken);
          setIsLoading(false);
          return;
        }
      }
      const refreshed = await refreshSession();
      if (!refreshed) {
        await secureMultiDelete([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
      }
    } catch (err: any) {
      console.error("Session restore error:", err?.message || String(err));
      await secureMultiDelete([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(async (username: string, password: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/login", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || "Login failed", code: data.code };
      }
      if (typeof data.token !== "string" || !data.token) {
        return { success: false, error: "Server did not return a session token. Please try again." };
      }
      await secureSet(AUTH_TOKEN_KEY, data.token);
      if (typeof data.refreshToken === "string" && data.refreshToken) {
        await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
      }
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Network error" };
    }
  }, []);

  const register = useCallback(async (username: string, password: string, email: string, referralCode?: string) => {
    try {
      const baseUrl = getApiUrl();
      const regRes = await fetch(new URL("/api/auth/register", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, email, referralCode: referralCode || undefined, agreedToTerms: true }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        return { success: false, error: regData.error || "Registration failed" };
      }
      // Registration succeeded — the API sends a verification email. Do NOT
      // attempt auto-login here because the login gate blocks unverified accounts
      // with a 403. The register screen handles the "check your email" UI when
      // success is true.
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Network error" };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const savedToken = await secureGet(AUTH_TOKEN_KEY);
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // fail silently — stale user state is acceptable here
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const storedToken = await secureGet(AUTH_TOKEN_KEY);
      const storedRefreshToken = await secureGet(REFRESH_TOKEN_KEY);
      const baseUrl = getApiUrl();
      await fetch(new URL("/api/auth/logout", baseUrl).toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
        },
        body: JSON.stringify(storedRefreshToken ? { refreshToken: storedRefreshToken } : {}),
      });
    } catch {
      // Best-effort: always clear local state regardless of network failure
    }
    await secureMultiDelete([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isAdmin, login, register, logout, refreshSession, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
