import { Platform } from "react-native";
import { getApiUrl } from "./query-client";

/**
 * Registers this device for Expo push notifications and uploads the token to
 * the API server so the backend can send threshold-crossing alerts.
 *
 * Best-effort: silently no-ops when:
 *   - Running on web (Web Push is a different flow)
 *   - The native expo-notifications module is unavailable (old native builds)
 *   - The user denies permission
 *   - The network request fails
 *
 * IMPORTANT: expo-notifications requires a native build. This code activates
 * automatically once the app is built with expo-notifications included.
 */
export async function registerAndUploadPushToken(accessToken: string): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const [Notifications, Device] = await Promise.all([
      import("expo-notifications"),
      import("expo-device"),
    ]);

    if (!Device.default.isDevice) return;

    type PermResult = { granted: boolean; canAskAgain: boolean };

    const existingPerms = (await Notifications.getPermissionsAsync()) as unknown as PermResult;
    if (!existingPerms.granted && !existingPerms.canAskAgain) return;

    const finalPerms: PermResult = existingPerms.granted
      ? existingPerms
      : ((await Notifications.requestPermissionsAsync()) as unknown as PermResult);

    if (!finalPerms.granted) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "CashClip",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    if (!token) return;

    const baseUrl = getApiUrl();
    await fetch(new URL("/api/user/push-token", baseUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    // Best-effort: never throw — old builds without the native module will
    // get a "Cannot find native module" error which we intentionally swallow.
  }
}
