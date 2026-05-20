import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "./query-client";

const AUTH_TOKEN_KEY = "cashclip_auth_token";
const REFRESH_TOKEN_KEY = "cashclip_refresh_token";

interface AuthUser {
  id: string;
  username: string;
  role: string;
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
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    restoreSession();
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const storedRefreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      if (!storedRefreshToken) return false;
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/refresh", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });
      if (!res.ok) {
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
        return false;
      }
      const data = await res.json();
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      setToken(data.token);
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  async function restoreSession() {
    try {
      const savedToken = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
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
      // JWT missing or expired — try silent refresh via RIPRENDERE
      const refreshed = await refreshSession();
      if (!refreshed) {
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
      }
    } catch (err: any) {
      console.error("Session restore error:", err?.message || String(err));
      await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
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
        return { success: false, error: data.error || "Login failed" };
      }
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
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
      const loginRes = await fetch(new URL("/api/auth/login", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) {
        return { success: false, error: loginData.error || "Login after registration failed" };
      }
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, loginData.token);
      if (loginData.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, loginData.refreshToken);
      setToken(loginData.token);
      setUser(loginData.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Network error" };
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isAdmin, login, register, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
