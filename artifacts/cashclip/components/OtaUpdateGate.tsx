import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Updates from "expo-updates";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";

/**
 * Non-blocking over-the-air (OTA) update prompt.
 *
 * On launch and whenever the app returns to the foreground, it checks Expo
 * Updates for a newer JS bundle. If one is available it is fetched in the
 * background and the user is offered a "Reload Now" prompt so stale sessions
 * pick up the latest code (e.g. updated cash-value display) instead of sitting
 * on an old bundle until a natural cold start.
 *
 * No-ops in development / Expo Go where Updates.isEnabled is false.
 */
export function OtaUpdateGate({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [available, setAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
  const checking = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled || checking.current) return;
    checking.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
        setAvailable(true);
      }
    } catch {
      // Offline or update service unreachable — ignore and retry on next foreground.
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

  const onReload = useCallback(async () => {
    setReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  }, []);

  return (
    <>
      {children}
      <Modal
        visible={available}
        transparent
        animationType="fade"
        onRequestClose={() => setAvailable(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{t.update.title}</Text>
            <Text style={styles.body}>{t.update.message}</Text>
            <Pressable
              style={styles.btn}
              onPress={onReload}
              disabled={reloading}
            >
              {reloading ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <Text style={styles.btnText}>{t.update.reloadNow}</Text>
              )}
            </Pressable>
            <Pressable
              style={styles.later}
              onPress={() => setAvailable(false)}
              disabled={reloading}
            >
              <Text style={styles.laterText}>{t.update.later}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#16161D",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    color: "#AAAAAA",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  btnText: {
    color: "#000000",
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
  },
  later: {
    paddingVertical: 12,
    marginTop: 4,
  },
  laterText: {
    color: "#888888",
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
  },
});
