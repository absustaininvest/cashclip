import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Platform,
  SafeAreaView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import type { Translations } from "@/lib/i18n";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  AppNotification,
} from "@/lib/storage";

function formatTimeAgo(timestamp: number, tNotif: Translations["notifications"]): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSecs < 60) return tNotif.now;
  if (diffMins < 60) return `${diffMins}${tNotif.mAgo}`;
  if (diffHours < 24) return `${diffHours}${tNotif.hAgo}`;
  if (diffDays < 7) return `${diffDays}${tNotif.dAgo}`;
  if (diffWeeks < 4) return `${diffWeeks}${tNotif.wAgo}`;
  if (diffMonths < 12) return `${diffMonths}${tNotif.moAgo}`;
  return tNotif.longAgo;
}

function getNotificationIcon(type: AppNotification["type"]): string {
  switch (type) {
    case "reward":
      return "gift";
    case "referral":
      return "user-plus";
    case "milestone":
      return "award";
    case "reminder":
      return "bell";
    case "promo":
      return "tag";
    default:
      return "info";
  }
}

function getNotificationColor(type: AppNotification["type"]): string {
  switch (type) {
    case "reward":
      return "#00E676";
    case "referral":
      return "#4ECDC4";
    case "milestone":
      return "#FFD600";
    case "reminder":
      return "#45B7D1";
    case "promo":
      return "#FF6B6B";
    default:
      return Colors.textSecondary;
  }
}

interface NotificationItemProps {
  notification: AppNotification;
  onPress: () => void;
  tNotif: Translations["notifications"];
}

function NotificationItem({ notification, onPress, tNotif }: NotificationItemProps) {
  const iconName = getNotificationIcon(notification.type);
  const iconColor = getNotificationColor(notification.type);
  const timeAgo = formatTimeAgo(notification.timestamp, tNotif);

  return (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !notification.read && styles.unreadNotification,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
        <Feather name={iconName as any} size={20} color={iconColor} />
      </View>

      <View style={styles.contentContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {notification.title}
        </Text>
        <Text style={styles.message} numberOfLines={2}>
          {notification.message}
        </Text>
        <Text style={styles.timestamp}>{timeAgo}</Text>
      </View>

      {!notification.read && (
        <View style={styles.unreadDot} />
      )}
    </TouchableOpacity>
  );
}

interface EmptyStateProps {
  insets: ReturnType<typeof useSafeAreaInsets>;
  tNotif: Translations["notifications"];
}

function EmptyState({ insets, tNotif }: EmptyStateProps) {
  return (
    <View
      style={[
        styles.emptyContainer,
        {
          paddingTop: Math.max(insets.top, 20),
          paddingBottom: insets.bottom + 20,
        },
      ]}
    >
      <View style={styles.emptyIconContainer}>
        <Ionicons name="notifications" size={48} color={Colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{tNotif.noNotificationsYet}</Text>
      <Text style={styles.emptyMessage}>
        {tNotif.checkBackLater}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
  }, [loadNotifications]);

  const handleNotificationPress = useCallback(
    async (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      await markNotificationRead(notificationId);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    []
  );

  const handleMarkAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllNotificationsRead();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const topPadding = Platform.OS === "web" ? 67 : 0;
  const bottomPadding = 34;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: Colors.background, paddingTop: insets.top },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
            paddingHorizontal: 16,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{t.notifications.notifications}</Text>

        {notifications.length > 0 && (
          <TouchableOpacity
            onPress={handleMarkAllRead}
            style={styles.markAllButton}
          >
            <Text style={styles.markAllButtonText}>{t.notifications.markAllRead}</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading && notifications.length === 0 ? (
        <EmptyState insets={insets} tNotif={t.notifications} />
      ) : notifications.length === 0 ? (
        <EmptyState insets={insets} tNotif={t.notifications} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationItem
              notification={item}
              onPress={() => handleNotificationPress(item.id)}
              tNotif={t.notifications}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          scrollEnabled={notifications.length > 0}
          contentContainerStyle={{
            paddingBottom: insets.bottom + bottomPadding,
          }}
          ItemSeparatorComponent={() => (
            <View style={styles.separator} />
          )}
        />
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
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    marginLeft: 12,
    fontSize: 20,
    fontFamily: "Outfit_700Bold",
    color: Colors.text,
  },
  markAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  markAllButtonText: {
    fontSize: 12,
    fontFamily: "Outfit_600SemiBold",
    color: Colors.primary,
  },
  notificationItem: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.background,
    alignItems: "flex-start",
  },
  unreadNotification: {
    backgroundColor: `${Colors.primary}08`,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    marginTop: 2,
  },
  contentContainer: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
    color: Colors.text,
    marginBottom: 4,
  },
  message: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  timestamp: {
    fontSize: 11,
    fontFamily: "Outfit_400Regular",
    color: Colors.textMuted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginTop: 4,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 68,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Outfit_700Bold",
    color: Colors.text,
    marginBottom: 8,
    textAlign: "center",
  },
  emptyMessage: {
    fontSize: 14,
    fontFamily: "Outfit_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});
