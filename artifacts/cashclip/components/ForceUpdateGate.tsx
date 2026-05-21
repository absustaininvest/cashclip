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

type GateState = "checking" | "ok" | "blocked" | "maintenance";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>(
    "We're upgrading our systems to serve you better. We'll be back shortly — thank you for your patience!"
  );

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
            const data = await res.json();
            if (data?.maintenance === true) {
              if (data?.maintenanceMessage) setMaintenanceMessage(data.maintenanceMessage);
              setState("maintenance");
            } else {
              setState("ok");
            }
          }
        }
      } catch {
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

  if (state === "maintenance") {
    return (
      <View style={styles.centered}>
        <Text style={styles.icon}>🔧</Text>
        <Text style={styles.title}>System Upgrade</Text>
        <Text style={styles.body}>{maintenanceMessage}</Text>
        <Text style={styles.sub}>Your balance and earnings are safe.</Text>
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
  icon: {
    fontSize: 48,
    marginBottom: 20,
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
    marginBottom: 16,
    lineHeight: 24,
  },
  sub: {
    fontSize: 14,
    fontFamily: "Outfit_400Regular",
    color: Colors.primary,
    textAlign: "center",
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
