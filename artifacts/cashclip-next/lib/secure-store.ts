/**
 * Thin wrapper around expo-secure-store (iOS Keychain / Android Keystore) for
 * native, with an AsyncStorage fallback only for the web build.
 *
 * IMPORTANT — on native (iOS/Android) secureGet/secureSet NEVER touch
 * AsyncStorage.  The migration logic in TrackingConsentGate relies on this
 * guarantee: it reads AsyncStorage explicitly as a separate step so it can
 * detect and promote old-build keys.  Do not add an AsyncStorage fallback
 * here without updating that migration logic.
 */
import * as ExpoSecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Read a value from the secure store.
 * Native: reads from iOS Keychain / Android Keystore (survives reinstalls).
 * Web:    reads from AsyncStorage (no native Keychain available).
 * Returns null if the key is absent or on any storage error.
 */
export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key).catch(() => null);
  }
  // Native: Keychain / Keystore only.  No AsyncStorage fallback.
  return ExpoSecureStore.getItemAsync(key).catch(() => null);
}

/**
 * Write a value to the secure store.
 * Native: writes to iOS Keychain / Android Keystore.
 * Web:    writes to AsyncStorage.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await ExpoSecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await ExpoSecureStore.deleteItemAsync(key).catch(() => {});
}

export async function secureMultiDelete(keys: string[]): Promise<void> {
  await Promise.all(keys.map(secureDelete));
}
