import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { getSearchConfig, beginSearch, completeSearch } from "@/lib/earn-client";

const RECENT_SEARCHES_KEY = "cashclip_recent_searches_v1";
const MAX_RECENT_SEARCHES = 10;

// Minimum continuous successful viewing time (ms) after onLoad fires.
// The server also independently enforces a ≥5 s gap between begin→complete.
const REWARD_VIEW_MIN_MS = 5500;

// Search monetization architecture:
//   • The monetized partner is Yahoo OneSearch (rev-share via fr= publisher tag).
//   • The server (GET /api/earn/search/config) returns the base URL including all
//     required attribution params (fr=<publisherCode>, fr2=, type=cashclip-search).
//   • The publisher code is read from SEARCH_PUBLISHER_CODE in the deployment
//     environment — it is never embedded in the client bundle.
//   • This fallback is used only when SEARCH_PUBLISHER_CODE is not yet configured
//     (no revenue attribution until the owner enrolls and sets the secret).
const YAHOO_FALLBACK_BASE = "https://search.yahoo.com/search";

let WebViewComponent: React.ComponentType<any> | null = null;
if (Platform.OS !== "web") {
  try {
    WebViewComponent = require("react-native-webview").WebView;
  } catch {}
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const st = t.search;

  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isWebViewLoading, setIsWebViewLoading] = useState(false);

  // dailyCount / dailyCap are authoritative from the server:
  //   • loaded from /api/earn/search/config on mount (accurate after restarts)
  //   • updated from completeSearch() response after each earned search
  const [dailyCount, setDailyCount] = useState(0);
  const [dailyCap, setDailyCap]     = useState(20);

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Server-configured monetized search URL base (publisher code kept server-side)
  const [searchBaseUrl, setSearchBaseUrl] = useState<string>(YAHOO_FALLBACK_BASE);
  const [searchConfigured, setSearchConfigured] = useState(false);

  const toastOpacity = useSharedValue(0);

  // Active challenge token; set in handleSearch, consumed in handleWebViewLoad,
  // and explicitly cleared in handleWebViewError so a failed load never earns.
  const activeChallengeRef = useRef<string | null>(null);
  // Reward timer — starts from onLoad (page rendered) not from onLoadStart
  const rewardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadRecent();
    loadSearchConfig();
  }, []);

  const loadSearchConfig = async () => {
    const cfg = await getSearchConfig();
    if (cfg) {
      setSearchBaseUrl(cfg.searchBaseUrl);
      setSearchConfigured(cfg.configured);
      setDailyCount(cfg.dailyUsed);
      setDailyCap(cfg.dailyCap);
    }
  };

  const loadRecent = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (raw) setRecentSearches(JSON.parse(raw) as string[]);
    } catch {}
  };

  const saveRecent = async (q: string) => {
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, MAX_RECENT_SEARCHES);
    setRecentSearches(updated);
    try {
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch {}
  };

  const clearHistory = async () => {
    setRecentSearches([]);
    try { await AsyncStorage.removeItem(RECENT_SEARCHES_KEY); } catch {}
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    toastOpacity.value = withSequence(
      withTiming(1, { duration: 250 }),
      withTiming(1, { duration: 2200 }),
      withTiming(0, { duration: 400 }),
    );
    setTimeout(() => setToastMsg(null), 3000);
  };

  const toastStyle = useAnimatedStyle(() => ({ opacity: toastOpacity.value }));

  // Build the WebView URL using the server-provided base (includes monetized
  // attribution params when SEARCH_PUBLISHER_CODE is configured).
  const buildSearchUrl = useCallback((q: string): string => {
    const separator = searchBaseUrl.includes("?") ? "&" : "?";
    return `${searchBaseUrl}${separator}p=${encodeURIComponent(q)}`;
  }, [searchBaseUrl]);

  const cancelPendingReward = () => {
    if (rewardTimerRef.current) {
      clearTimeout(rewardTimerRef.current);
      rewardTimerRef.current = null;
    }
    activeChallengeRef.current = null;
  };

  const dailyLimitHit = dailyCount >= dailyCap;

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || dailyLimitHit) return;

    Keyboard.dismiss();
    setQuery(trimmed);
    setActiveQuery(trimmed);
    setIsWebViewLoading(true);
    saveRecent(trimmed);

    // Cancel any pending reward from the previous search
    cancelPendingReward();

    // Issue a fresh challenge for every search; server enforces daily cap
    const cToken = await beginSearch();
    activeChallengeRef.current = cToken;
    // Reward timer will start from handleWebViewLoad (onLoad = success only)
  }, [dailyLimitHit, recentSearches]);

  // ── onLoad: fires only on SUCCESSFUL page render ──────────────────────────
  // This is the correct trigger for the reward timer — guarantees the user
  // actually saw results. Uses `onLoad`, NOT `onLoadEnd` (which fires on both
  // success and failure in react-native-webview).
  const handleWebViewLoad = useCallback(() => {
    setIsWebViewLoading(false);

    const cToken = activeChallengeRef.current;
    if (!cToken || dailyLimitHit) return;

    if (rewardTimerRef.current) clearTimeout(rewardTimerRef.current);

    rewardTimerRef.current = setTimeout(async () => {
      // Guard: ensure this is still the same challenge
      if (activeChallengeRef.current !== cToken) return;

      const earned = await completeSearch(cToken);
      if (earned) {
        // Consume the token — prevents double-credit on back-navigation
        if (activeChallengeRef.current === cToken) activeChallengeRef.current = null;

        // Use authoritative server counts from the complete response
        setDailyCount(earned.dailyUsed);
        setDailyCap(earned.dailyCap);
        showToast(`+${earned.points} pts ${st.earned}`);
      }
    }, REWARD_VIEW_MIN_MS);
  }, [dailyLimitHit, st]);

  // ── onError: page failed to load — cancel challenge, no reward ────────────
  const handleWebViewError = useCallback(() => {
    setIsWebViewLoading(false);
    // Explicitly clear the challenge so a stale token cannot earn later
    cancelPendingReward();
  }, []);

  // onLoadEnd still used only to stop the spinner when the final event fires
  // (covers edge cases where onLoad might not fire, e.g. cached responses).
  // It does NOT schedule the reward.
  const handleWebViewLoadEnd = useCallback(() => {
    setIsWebViewLoading(false);
  }, []);

  const clearSearch = () => {
    setActiveQuery("");
    setQuery("");
    cancelPendingReward();
  };

  const searchUrl = buildSearchUrl(activeQuery);
  const isNative = Platform.OS !== "web";
  const searchesLeft = Math.max(0, dailyCap - dailyCount);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{st.title}</Text>
          <Text style={styles.subtitle}>
            {dailyLimitHit
              ? st.dailyLimitReached
              : st.searchesLeft.replace("{{count}}", String(searchesLeft))}
          </Text>
        </View>
        <View style={styles.earnBadge}>
          <Ionicons name="flash" size={12} color={Colors.primary} />
          <Text style={styles.earnBadgeText}>{st.earnPerSearch}</Text>
        </View>
      </View>

      {/* Dev-only banner: warns when revenue attribution is not yet configured */}
      {__DEV__ && !searchConfigured && (
        <View style={styles.configWarning}>
          <Ionicons name="warning-outline" size={14} color="#b45309" />
          <Text style={styles.configWarningText}>
            SEARCH_PUBLISHER_CODE not set — revenue attribution inactive
          </Text>
        </View>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={st.searchPlaceholder}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => handleSearch(query)}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!dailyLimitHit}
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.goBtn, dailyLimitHit && styles.goBtnDisabled]}
          onPress={() => handleSearch(query)}
          disabled={dailyLimitHit}
        >
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </Pressable>
      </View>

      {activeQuery && isNative && WebViewComponent ? (
        <View style={styles.webviewWrap}>
          {isWebViewLoading && (
            <View style={styles.webviewLoader}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}
          <WebViewComponent
            source={{ uri: searchUrl }}
            style={styles.webview}
            onLoadStart={() => setIsWebViewLoading(true)}
            onLoad={handleWebViewLoad}
            onLoadEnd={handleWebViewLoadEnd}
            onError={handleWebViewError}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures={Platform.OS === "ios"}
          />
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          {recentSearches.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="search" size={48} color={Colors.primary} style={{ opacity: 0.4 }} />
              </View>
              <Text style={styles.emptyTitle}>{st.noRecentSearches}</Text>
              <Text style={styles.emptySubtitle}>{st.subtitle}</Text>
            </View>
          ) : (
            <>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>{st.recentSearches}</Text>
                <Pressable onPress={clearHistory} hitSlop={8}>
                  <Text style={styles.clearText}>{st.clearHistory}</Text>
                </Pressable>
              </View>
              <FlatList
                data={recentSearches}
                keyExtractor={(item, i) => `${item}-${i}`}
                renderItem={({ item }) => (
                  <Pressable style={styles.recentItem} onPress={() => handleSearch(item)}>
                    <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
                    <Text style={styles.recentText} numberOfLines={1}>{item}</Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                  </Pressable>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                style={styles.recentList}
              />
            </>
          )}
        </View>
      )}

      {toastMsg && (
        <Animated.View style={[styles.toast, toastStyle]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  earnBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Colors.radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  earnBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.primary,
  },
  configWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fef3c7",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  configWarningText: {
    fontSize: 11,
    color: "#92400e",
    flex: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Colors.radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    height: "100%",
  },
  goBtn: {
    width: 44,
    height: 44,
    borderRadius: Colors.radius.md,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  goBtnDisabled: {
    opacity: 0.4,
  },
  webviewWrap: {
    flex: 1,
    position: "relative",
  },
  webview: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  webviewLoader: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  emptyWrap: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  clearText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: "500",
  },
  recentList: {
    flex: 1,
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: Colors.surface,
  },
  recentText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 46,
  },
  toast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Colors.radius.full,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
});
