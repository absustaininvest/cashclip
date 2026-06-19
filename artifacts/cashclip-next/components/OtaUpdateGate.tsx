import React, { useCallback, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as Updates from "expo-updates";

/**
 * Silent over-the-air update applier.
 *
 * On every cold start and foreground return, checks Expo Updates for a newer
 * JS bundle. If one is available it is fetched and applied immediately with
 * no prompt — the app reloads silently so users always run the latest code.
 *
 * No-ops in development / Expo Go where Updates.isEnabled is false.
 */
export function OtaUpdateGate({ children }: { children: React.ReactNode }) {
  const checking = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled || checking.current) return;
    checking.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      }
    } catch {
      // Offline or update service unreachable — retry on next foreground.
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") checkForUpdate();
    });
    return () => sub.remove();
  }, [checkForUpdate]);

  return <>{children}</>;
}
