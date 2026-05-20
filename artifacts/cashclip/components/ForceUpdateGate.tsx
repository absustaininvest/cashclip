import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Linking,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { getApiUrl } from "@/lib/query-client";
import { APP_VERSION } from "@/constants/app";
import Colors from "@/constants/colors";

type GateState = "checking" | "ok" | "blocked";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = getApiUrl();
        const res = await fetch(new URL("/api/app/version", base).toString(), {
          headers: { "X-App-Version": APP_VERSION },
        });
        if (!cancelled) {
          if (res.status === 426) {
            setState("blocked");
          } else {
            setState("ok");
          }
        }
      } catch {
        // Network error — let the app through; the main screens handle errors.
        if (!cancelled) setState("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (state === "blocked") {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.body}>
          A newer version of CashClip is available. Please update to continue
          earning.
        </Text>
        <Pressable
          style={styles.btn}
          onPress={() =>
            Linking.openURL(
              "https://apps.apple.com/app/cashclip-earn-real-money/id6737228316",
            )
          }
        >
          <Text style={styles.btnText}>Update Now</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: {
    fontSize: 26,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 16,
    textAlign: "center",
  },
  body: {
    fontSize: 16,
    fontFamily: "Outfit_400Regular",
    color: "#AAAAAA",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },
  btn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  btnText: {
    color: "#000000",
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
  },
});
