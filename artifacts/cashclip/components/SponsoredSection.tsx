import React, { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { APP_VERSION } from "@/constants/app";

interface SponsoredCampaign {
  id: string;
  title: string;
  description: string;
  targetUrl: string;
  rewardPerVisit: number;
  publisherName: string;
  alreadyVisited: boolean;
}

// Total server-enforced minimum: MIN_INTERSTITIAL_DWELL_MS (5 s, /r→/c gap)
// + MIN_SPONSORED_VISIT_MS (10 s, /c→/visit gap) = 15 s.
// Add a 1 s buffer so the client never hits the /visit dwell gate.
const MIN_VISIT_MS = 16000;

export default function SponsoredSection() {
  const [campaigns, setCampaigns] = useState<SponsoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [visitingId, setVisitingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { secureGet } = await import("@/lib/secure-store");
        const token = await secureGet("cashclip_auth_token");
        if (!token) { setLoading(false); return; }
        const { getApiUrl } = await import("@/lib/query-client");
        const res = await globalThis.fetch(
          new URL("/api/earn/sponsored", getApiUrl()).toString(),
          { headers: { Authorization: `Bearer ${token}`, "X-App-Version": APP_VERSION } },
        );
        if (res.ok) { const d = await res.json(); setCampaigns(d.campaigns ?? []); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const handleVisit = useCallback(async (c: SponsoredCampaign) => {
    if (c.alreadyVisited || visitingId) return;
    setVisitingId(c.id);

    try {
      const { secureGet } = await import("@/lib/secure-store");
      const token = await secureGet("cashclip_auth_token");
      const { getApiUrl } = await import("@/lib/query-client");
      const { getDeviceId } = await import("@/lib/deviceId");
      const { getOrRegisterInstallToken } = await import("@/lib/installToken");
      const base = getApiUrl();
      const deviceId = await getDeviceId();

      // Fetch (or register) the server-issued install token for this device.
      // The token is server-generated, rate-limited at issuance, and stored in
      // secure storage. It replaces the raw device ID as the Sybil key header.
      const installToken = await getOrRegisterInstallToken(token ?? "", deviceId, base);
      if (!installToken) {
        Alert.alert("Error", "Could not verify device. Please try again.");
        return;
      }

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-App-Version": APP_VERSION,
        "X-Install-Token": installToken,
      };

      // Step 1: Begin the visit.
      // Server checks eligibility and issues attemptToken + redirectUrl.
      const beginRes = await globalThis.fetch(
        new URL(`/api/earn/sponsored/${c.id}/begin`, base).toString(),
        { method: "POST", headers: authHeaders, body: "{}" },
      );
      const beginData = await beginRes.json();

      if (!beginRes.ok) {
        if (beginData.alreadyVisited) {
          setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, alreadyVisited: true } : x));
        } else {
          Alert.alert("Error", beginData.error || "Failed to start visit");
        }
        return;
      }

      const { attemptToken, redirectUrl } =
        beginData as { attemptToken: string; redirectUrl: string };

      // Step 2: Open the server interstitial URL (includes VST in query string).
      // The interstitial counts down MIN_INTERSTITIAL_DWELL_MS then navigates
      // to /c, which records witnessedAt server-side and redirects to the
      // advertiser. An optional <img> tracking pixel is appended as ?cashclip_cb
      // for advertiser-side corroboration (not required for settlement).
      await Linking.openURL(redirectUrl).catch(() => {});

      // Step 3: Wait for combined dwell (interstitial + sponsor page).
      // The server enforces dwell from witnessedAt; this client-side wait
      // avoids the retryAfterMs response on first /visit attempt.
      await new Promise<void>((resolve) => setTimeout(resolve, MIN_VISIT_MS + 500));

      // Step 4: Claim the reward.
      // Server validates: witnessedAt set (by /c), dwell elapsed, attempt not
      // yet settled, device hash consistent with /begin, VST + IP/UA binding.
      const visitRes = await globalThis.fetch(
        new URL(`/api/earn/sponsored/${c.id}/visit`, base).toString(),
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ attemptToken }),
        },
      );
      const visitData = await visitRes.json();

      if (visitRes.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Earned!", visitData.message || `+$${c.rewardPerVisit.toFixed(2)} added to your balance.`);
        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, alreadyVisited: true } : x));
      } else if (visitData.alreadyVisited) {
        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, alreadyVisited: true } : x));
      } else {
        Alert.alert("Error", visitData.error || "Failed to record visit");
      }
    } catch {
      Alert.alert("Error", "Could not open link");
    } finally {
      setVisitingId(null);
    }
  }, [visitingId]);

  if (loading || campaigns.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Sponsored</Text>
        <View style={styles.earlyBadge}>
          <Feather name="award" size={11} color={Colors.primary} />
          <Text style={styles.earlyBadgeText}>Early Access</Text>
        </View>
      </View>
      {campaigns.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => handleVisit(c)}
          disabled={c.alreadyVisited || visitingId === c.id}
          style={[styles.card, c.alreadyVisited && styles.cardVisited]}
        >
          <View style={styles.left}>
            <View style={styles.iconBg}>
              <Feather name="external-link" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{c.title}</Text>
              <Text style={styles.desc} numberOfLines={2}>{c.description}</Text>
              <Text style={styles.byLine}>by {c.publisherName}</Text>
            </View>
          </View>
          <View style={styles.right}>
            {visitingId === c.id ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : c.alreadyVisited ? (
              <View style={styles.visitedBadge}>
                <Feather name="check" size={12} color={Colors.primary} />
                <Text style={styles.visitedText}>Visited</Text>
              </View>
            ) : (
              <View style={styles.reward}>
                <Text style={styles.rewardAmt}>+${c.rewardPerVisit.toFixed(2)}</Text>
                <Text style={styles.visitBtn}>Visit →</Text>
              </View>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.text,
  },
  earlyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,230,118,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  earlyBadgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    gap: 12,
  },
  cardVisited: { opacity: 0.55 },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0,230,118,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: Colors.text,
    marginBottom: 3,
  },
  desc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  byLine: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  right: { alignItems: "flex-end", gap: 4 },
  reward: { alignItems: "flex-end" },
  rewardAmt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.primary,
  },
  visitBtn: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  visitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,230,118,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  visitedText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.primary,
  },
});
