import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { secureGet } from "@/lib/secure-store";

interface AdSummary {
  totalImpressions: number;
  totalCompletions: number;
  totalRewardsEarned: number;
  totalFailures: number;
  noFillCount: number;
  completionRate: number;
  avgRewardAmount: number;
  uniqueUsers: number;
}

interface TimelineDay {
  date: string;
  impressions: number;
  completions: number;
  rewards: number;
  failures: number;
  revenue: number;
}

interface PerUserRow {
  userId: string;
  username: string;
  impressions: number;
  completions: number;
  rewards: number;
  totalRevenue: number;
}

type DateRange = "7d" | "30d" | "90d" | "all";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDateRange(range: DateRange): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const from = new Date(now.getTime() - days * 86400000);
  return { from: formatDate(from), to: formatDate(now) };
}

function MiniBarChart({
  data,
  dataKey,
  computeValue,
  color,
  label,
  yAxisSuffix,
}: {
  data: TimelineDay[];
  dataKey?: keyof TimelineDay;
  computeValue?: (day: TimelineDay) => number;
  color: string;
  label: string;
  yAxisSuffix?: string;
}) {
  const sorted = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const getValue = (day: TimelineDay): number =>
    computeValue ? computeValue(day) : Number(day[dataKey!]) || 0;
  const maxVal = Math.max(...sorted.map(getValue), 1);
  const chartWidth = Dimensions.get("window").width - 72;
  const barCount = Math.min(sorted.length, 30);
  const visible = sorted.slice(-barCount);
  const barWidth = Math.max(
    2,
    Math.floor((chartWidth - barCount * 2) / barCount),
  );
  const chartHeight = 80;
  const suffix = yAxisSuffix ?? "";

  return (
    <View style={chartStyles.chartContainer}>
      <Text style={chartStyles.chartLabel}>{label}</Text>
      <View style={[chartStyles.chartArea, { height: chartHeight }]}>
        <View style={chartStyles.barsRow}>
          {visible.map((day, i) => {
            const val = getValue(day);
            const h = Math.max(2, (val / maxVal) * (chartHeight - 16));
            return (
              <View
                key={day.date + i}
                style={[
                  chartStyles.bar,
                  {
                    width: barWidth,
                    height: h,
                    backgroundColor: color,
                    borderRadius: barWidth > 4 ? 3 : 1,
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={chartStyles.yAxis}>
          <Text style={chartStyles.yLabel}>{Math.round(maxVal * 10) / 10}{suffix}</Text>
          <Text style={chartStyles.yLabel}>0{suffix}</Text>
        </View>
      </View>
      {visible.length > 0 && (
        <View style={chartStyles.xAxis}>
          <Text style={chartStyles.xLabel}>
            {visible[0].date.slice(5)}
          </Text>
          <Text style={chartStyles.xLabel}>
            {visible[visible.length - 1].date.slice(5)}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function AdAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  const [summary, setSummary] = useState<AdSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineDay[]>([]);
  const [perUser, setPerUser] = useState<PerUserRow[]>([]);

  useEffect(() => {
    if (!isAdmin) {
      router.back();
    }
  }, [isAdmin]);

  const fetchAnalytics = useCallback(async () => {
    try {
      setError(null);
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) {
        setError(adLabels.notAuthenticated);
        return;
      }
      const baseUrl = getApiUrl();
      const { from, to } = getDateRange(dateRange);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await globalThis.fetch(
        new URL(`/api/admin/ad-analytics${qs}`, baseUrl).toString(),
        { headers: { Authorization: `Bearer ${savedToken}` } },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setSummary(data.summary);
      setTimeline(data.timeline || []);
      setPerUser(data.perUser || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    setLoading(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  }, [fetchAnalytics]);

  const adLabels = t.adAnalytics;

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const fillRate = summary
    ? summary.totalImpressions + summary.totalFailures > 0
      ? (
          (summary.totalImpressions /
            (summary.totalImpressions + summary.totalFailures)) *
          100
        ).toFixed(1)
      : "0"
    : "0";

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPad + insets.top }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>{adLabels.title}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
        >
          {(["7d", "30d", "90d", "all"] as DateRange[]).map((range) => (
            <Pressable
              key={range}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setDateRange(range);
              }}
              style={[
                styles.filterChip,
                dateRange === range && styles.filterChipActive,
              ]}
              testID={`range-${range}`}
            >
              <Text
                style={[
                  styles.filterChipText,
                  dateRange === range && styles.filterChipTextActive,
                ]}
              >
                {range === "all"
                  ? adLabels.all
                  : range === "7d"
                    ? adLabels.days7
                    : range === "30d"
                      ? adLabels.days30
                      : adLabels.days90}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Feather name="alert-circle" size={28} color="#FF5252" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={fetchAnalytics}>
              <Text style={styles.retryText}>{adLabels.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <View style={styles.statCardTop}>
                  <View
                    style={[
                      styles.statIconBg,
                      { backgroundColor: "rgba(66,165,245,0.15)" },
                    ]}
                  >
                    <Feather name="eye" size={18} color="#42A5F5" />
                  </View>
                </View>
                <Text style={styles.statValue}>
                  {(summary?.totalImpressions ?? 0).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>{adLabels.impressions}</Text>
              </View>

              <View style={styles.statCard}>
                <View style={styles.statCardTop}>
                  <View
                    style={[
                      styles.statIconBg,
                      { backgroundColor: "rgba(0,230,118,0.15)" },
                    ]}
                  >
                    <Feather
                      name="check-circle"
                      size={18}
                      color={Colors.primary}
                    />
                  </View>
                </View>
                <Text style={styles.statValue}>
                  {(summary?.totalCompletions ?? 0).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>{adLabels.completions}</Text>
              </View>

              <View style={styles.statCard}>
                <View style={styles.statCardTop}>
                  <View
                    style={[
                      styles.statIconBg,
                      { backgroundColor: "rgba(255,214,0,0.15)" },
                    ]}
                  >
                    <Feather name="dollar-sign" size={18} color="#FFD600" />
                  </View>
                </View>
                <Text style={styles.statValue}>
                  ${(summary?.totalRewardsEarned ?? 0).toFixed(2)}
                </Text>
                <Text style={styles.statLabel}>{adLabels.revenue}</Text>
              </View>

              <View style={styles.statCard}>
                <View style={styles.statCardTop}>
                  <View
                    style={[
                      styles.statIconBg,
                      { backgroundColor: "rgba(255,82,82,0.12)" },
                    ]}
                  >
                    <Feather name="alert-triangle" size={18} color="#FF5252" />
                  </View>
                </View>
                <Text style={styles.statValue}>
                  {(summary?.totalFailures ?? 0).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>{adLabels.failures}</Text>
              </View>

              <View style={styles.statCard}>
                <View style={styles.statCardTop}>
                  <View
                    style={[
                      styles.statIconBg,
                      { backgroundColor: "rgba(255,152,0,0.12)" },
                    ]}
                  >
                    <Feather name="wifi-off" size={18} color="#FF9800" />
                  </View>
                </View>
                <Text style={styles.statValue}>
                  {(summary?.noFillCount ?? 0).toLocaleString()}
                </Text>
                <Text style={styles.statLabel}>{adLabels.noFill}</Text>
              </View>
            </View>

            <LinearGradient
              colors={["#0D2818", "#0A1A12"]}
              style={styles.rateCard}
            >
              <View style={styles.rateRow}>
                <View style={styles.rateItem}>
                  <Text style={styles.rateValue}>
                    {summary?.completionRate ?? 0}%
                  </Text>
                  <Text style={styles.rateLabel}>
                    {adLabels.completionRate}
                  </Text>
                </View>
                <View style={styles.rateDivider} />
                <View style={styles.rateItem}>
                  <Text style={styles.rateValue}>
                    ${summary?.avgRewardAmount?.toFixed(4) ?? "0.00"}
                  </Text>
                  <Text style={styles.rateLabel}>{adLabels.avgReward}</Text>
                </View>
                <View style={styles.rateDivider} />
                <View style={styles.rateItem}>
                  <Text style={styles.rateValue}>
                    {summary?.uniqueUsers ?? 0}
                  </Text>
                  <Text style={styles.rateLabel}>{adLabels.uniqueUsers}</Text>
                </View>
                <View style={styles.rateDivider} />
                <View style={styles.rateItem}>
                  <Text style={styles.rateValue}>{fillRate}%</Text>
                  <Text style={styles.rateLabel}>{adLabels.fillRate}</Text>
                </View>
              </View>
            </LinearGradient>

            {timeline.length > 0 ? (
              <View style={styles.chartsSection}>
                <Text style={styles.sectionTitle}>
                  {adLabels.dailyImpressions}
                </Text>
                <View style={styles.chartCard}>
                  <MiniBarChart
                    data={timeline}
                    dataKey="impressions"
                    color="#42A5F5"
                    label={adLabels.impressions}
                  />
                </View>

                <Text style={styles.sectionTitle}>
                  {adLabels.dailyCompletions}
                </Text>
                <View style={styles.chartCard}>
                  <MiniBarChart
                    data={timeline}
                    dataKey="completions"
                    color={Colors.primary}
                    label={adLabels.completions}
                  />
                </View>

                <Text style={styles.sectionTitle}>
                  {adLabels.dailyRevenue}
                </Text>
                <View style={styles.chartCard}>
                  <MiniBarChart
                    data={timeline}
                    dataKey="revenue"
                    color="#FFD600"
                    label={adLabels.revenue}
                  />
                </View>

                <Text style={styles.sectionTitle}>
                  {adLabels.dailyFailureRate}
                </Text>
                <View style={styles.chartCard}>
                  <MiniBarChart
                    data={timeline}
                    computeValue={(day) => {
                      const total = day.impressions + day.failures;
                      return total > 0
                        ? parseFloat(((day.failures / total) * 100).toFixed(1))
                        : 0;
                    }}
                    color="#FF5252"
                    label={adLabels.failureRate}
                    yAxisSuffix="%"
                  />
                </View>
              </View>
            ) : (
              <View style={styles.emptyChart}>
                <Feather
                  name="bar-chart-2"
                  size={28}
                  color={Colors.textMuted}
                />
                <Text style={styles.emptyChartText}>{adLabels.noData}</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>{adLabels.topEarners}</Text>
            <View style={styles.tableCard}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { flex: 1.5 }]}>
                  {adLabels.user}
                </Text>
                <Text style={[styles.tableHeaderText, { flex: 0.7 }]}>
                  {adLabels.impr}
                </Text>
                <Text style={[styles.tableHeaderText, { flex: 0.7 }]}>
                  {adLabels.compl}
                </Text>
                <Text style={[styles.tableHeaderText, { flex: 0.6 }]}>
                  {adLabels.rwds}
                </Text>
                <Text
                  style={[
                    styles.tableHeaderText,
                    { flex: 0.8, textAlign: "right" },
                  ]}
                >
                  {adLabels.rev}
                </Text>
              </View>
              {perUser.length === 0 ? (
                <View style={styles.emptyTable}>
                  <Feather
                    name="users"
                    size={22}
                    color={Colors.textMuted}
                  />
                  <Text style={styles.emptyTableText}>{adLabels.noData}</Text>
                </View>
              ) : (
                perUser.slice(0, 20).map((user, i) => (
                  <View
                    key={user.userId}
                    style={[
                      styles.tableRow,
                      i < Math.min(perUser.length, 20) - 1 &&
                        styles.tableRowBorder,
                    ]}
                  >
                    <View style={[styles.tableCell, { flex: 1.5 }]}>
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankText}>{i + 1}</Text>
                      </View>
                      <Text
                        style={styles.usernameText}
                        numberOfLines={1}
                      >
                        {user.username}
                      </Text>
                    </View>
                    <Text style={[styles.cellText, { flex: 0.7 }]}>
                      {user.impressions}
                    </Text>
                    <Text style={[styles.cellText, { flex: 0.7 }]}>
                      {user.completions}
                    </Text>
                    <Text style={[styles.cellText, { flex: 0.6 }]}>
                      {user.rewards}
                    </Text>
                    <Text
                      style={[
                        styles.cellText,
                        {
                          flex: 0.8,
                          textAlign: "right",
                          color: Colors.primary,
                          fontFamily: "Outfit_700Bold",
                        },
                      ]}
                    >
                      ${user.totalRevenue.toFixed(2)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const chartStyles = StyleSheet.create({
  chartContainer: {
    paddingVertical: 4,
  },
  chartLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 6,
  },
  chartArea: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  barsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  bar: {
    minHeight: 2,
  },
  yAxis: {
    width: 30,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingLeft: 4,
    height: "100%",
  },
  yLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },
  xAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  xLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: Colors.text,
  },

  filterRow: { marginBottom: 4 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: "rgba(0,230,118,0.12)",
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
  },
  filterChipTextActive: { color: Colors.primary },

  loadingContainer: {
    padding: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.primary,
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  statIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },

  rateCard: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.15)",
    marginBottom: 16,
  },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  rateItem: { flex: 1, alignItems: "center" },
  rateValue: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.text,
    marginBottom: 2,
  },
  rateLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: "center",
  },
  rateDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  sectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.text,
    marginBottom: 10,
    marginTop: 4,
  },

  chartsSection: { marginBottom: 8 },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },

  emptyChart: {
    padding: 40,
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  emptyChartText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
  },

  tableCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surfaceHighlight,
  },
  tableHeaderText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: Colors.textMuted,
  },
  usernameText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  cellText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  emptyTable: {
    padding: 32,
    alignItems: "center",
    gap: 8,
  },
  emptyTableText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
  },
});
