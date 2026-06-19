import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const NOTIF_ID_KEY = "cashclip_streak_reminder_id";

// The streak resets at UTC midnight. This buffer (in hours) determines how far
// before that cutoff the reminder fires. 2 hours = 22:00 UTC, which is always
// before the streak can break regardless of the user's local timezone.
const REMINDER_BUFFER_HOURS = 2;
const REMINDER_BUFFER_MS = REMINDER_BUFFER_HOURS * 60 * 60 * 1000;

// ── FOREGROUND HANDLER ────────────────────────────────────────────────────────
// Called once at app start (from _layout.tsx). Sets how notifications look when
// the app is already in the foreground. We show a banner + play the default
// sound so the user sees the reminder even mid-session.
export function configureNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Fail open — never block launch
  }
}

// ── PERMISSION REQUEST ────────────────────────────────────────────────────────
// Call after the user is authenticated. Returns true when granted. Fails open
// so a permission denial never crashes or blocks any feature.
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return false;
    // expo-notifications v56 extends expo-modules-core PermissionResponse which
    // carries `granted` and `canAskAgain`. The TS project config here can't
    // resolve the base-class fields, so we cast to access them safely.
    const existing = (await Notifications.getPermissionsAsync()) as any;
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    const result = (await Notifications.requestPermissionsAsync()) as any;
    return !!result.granted;
  } catch {
    return false;
  }
}

// ── SCHEDULE STREAK REMINDER ──────────────────────────────────────────────────
// Schedules a local notification at REMINDER_BUFFER_HOURS before UTC midnight
// (the streak cutoff). Because the cutoff is UTC-based, using local clock hours
// would fire the notification AFTER the streak breaks for users west of UTC.
// Instead we anchor to the UTC deadline and subtract the buffer, so the
// notification always fires before the user can lose their streak in any timezone.
//
// If the reminder window for today has already passed (i.e. it is already within
// REMINDER_BUFFER_HOURS of tomorrow's UTC midnight), no notification is scheduled —
// the user has very little time left and a last-second ping is not useful.
//
// Notification text is passed in by the caller so it reflects the user's chosen
// in-app language (t.earn.streakWarningTitle / t.earn.streakWarningSubtext).
export async function scheduleStreakReminder(
  streakDays: number,
  title: string,
  body: string,
): Promise<void> {
  try {
    if (Platform.OS === "web") return;

    // Always cancel any stale pending reminder before scheduling a new one.
    await cancelStreakReminder();

    const perm = (await Notifications.getPermissionsAsync()) as any;
    if (!perm.granted) return;

    // Compute the reminder time: next UTC midnight minus the buffer.
    //   nextUtcMidnight = start of tomorrow in UTC
    //   reminderAt      = nextUtcMidnight - REMINDER_BUFFER_MS  (e.g. 22:00 UTC)
    const now = Date.now();
    const todayUtcMidnight = new Date();
    todayUtcMidnight.setUTCHours(24, 0, 0, 0); // tomorrow 00:00 UTC
    const reminderAt = todayUtcMidnight.getTime() - REMINDER_BUFFER_MS;

    const secondsUntilFire = Math.floor((reminderAt - now) / 1000);

    // Already past the reminder window — don't schedule.
    if (secondsUntilFire <= 0) return;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { type: "streak_reminder", streakDays },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilFire,
        repeats: false,
      },
    });

    await AsyncStorage.setItem(NOTIF_ID_KEY, id);
  } catch {
    // Fail open — a scheduling failure must never crash or block anything.
  }
}

// ── CANCEL STREAK REMINDER ────────────────────────────────────────────────────
// Cancels the pending reminder. Called automatically via the checkedInToday
// useEffect in earn.tsx when state flips to checked-in for today.
export async function cancelStreakReminder(): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    const id = await AsyncStorage.getItem(NOTIF_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(NOTIF_ID_KEY);
    }
  } catch {
    // Fail open
  }
}
