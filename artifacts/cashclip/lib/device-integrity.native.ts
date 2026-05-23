import * as Device from "expo-device";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

export type IntegrityResult = {
  clean: boolean;
  reason: string | null;
};

let _cached: IntegrityResult | null = null;

async function _runChecks(): Promise<IntegrityResult> {
  const isProductionBuild = process.env.EXPO_PUBLIC_ENV === "production";

  if (isProductionBuild && !Device.isDevice) {
    return { clean: false, reason: "simulator_blocked_in_production" };
  }

  if (Platform.OS === "android") {
    try {
      const rooted = await Device.isRootedExperimentalAsync();
      if (rooted) {
        return { clean: false, reason: "rooted_android" };
      }
    } catch {
    }
  }

  if (Platform.OS === "ios") {
    const jailbreakSchemes = [
      "cydia://",
      "sileo://",
      "zbra://",
      "filza://",
    ];
    for (const scheme of jailbreakSchemes) {
      try {
        const can = await Linking.canOpenURL(scheme);
        if (can) {
          return { clean: false, reason: "jailbroken_ios" };
        }
      } catch {
      }
    }
  }

  return { clean: true, reason: null };
}

export async function checkDeviceIntegrity(): Promise<IntegrityResult> {
  if (_cached !== null) return _cached;
  _cached = await _runChecks();
  return _cached;
}

export function getCachedIntegrity(): IntegrityResult | null {
  return _cached;
}
