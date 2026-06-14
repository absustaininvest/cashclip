/**
 * Native (Metro-resolved) implementation of the secure-store API.
 * Uses expo-secure-store → iOS Keychain / Android Keystore.
 *
 * CONTRACT (read carefully before modifying):
 *   secureGet returns null in two situations:
 *     1. The key is absent from the Keychain (normal "not set yet" case).
 *     2. The Keychain is temporarily unavailable (error swallowed).
 *   In NEITHER case does secureGet fall back to AsyncStorage.
 *
 *   TrackingConsentGate depends on this guarantee: after reading secureGet
 *   it explicitly checks AsyncStorage as a separate migration step.  If
 *   secureGet fell back to AsyncStorage on read errors it could return an
 *   old-format value, treat the user as already migrated, and leave the key
 *   stuck in AsyncStorage-only — unprotected against future reinstalls.
 *
 *   secureSet: writes to Keychain.  Falls back to AsyncStorage only when the
 *   expo-secure-store native module is completely absent (bare dev simulator).
 *   This keeps consent persisted even in those edge cases.
 */

let _SecureStore: typeof import("expo-secure-store") | null = null;
try {
  _SecureStore = require("expo-secure-store");
} catch {
  _SecureStore = null;
}

let _AsyncStorage: any = null;
function getAsyncStorage(): any {
  if (_AsyncStorage) return _AsyncStorage;
  try {
    _AsyncStorage = require("@react-native-async-storage/async-storage").default;
  } catch {
    _AsyncStorage = null;
  }
  return _AsyncStorage;
}

/**
 * Read a value from the Keychain.
 * Returns null if the key is absent OR if the Keychain is unavailable.
 * Does NOT fall back to AsyncStorage (see contract above).
 */
export async function secureGet(key: string): Promise<string | null> {
  if (_SecureStore) {
    try {
      return await _SecureStore.getItemAsync(key);
    } catch {
      // Keychain temporarily unavailable (locked, simulator glitch, etc.).
      // Return null so the caller's explicit AsyncStorage migration check
      // can run — do NOT silently fall through to AsyncStorage here.
      return null;
    }
  }
  // expo-secure-store module completely absent (bare dev sim without native
  // module).  Fall back to AsyncStorage so consent is still gated.
  const AS = getAsyncStorage();
  if (AS) {
    try { return await AS.getItem(key); } catch {}
  }
  return null;
}

/**
 * Write a value to the Keychain.
 * Falls back to AsyncStorage only when expo-secure-store is completely absent
 * (development-only simulator scenario).  Swallows write errors so callers
 * using .catch(() => {}) receive a resolved promise regardless.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  if (_SecureStore) {
    try { await _SecureStore.setItemAsync(key, value); return; } catch {}
    // Keychain write failed — best-effort: do not persist to AsyncStorage
    // because a future secureGet would not find it there (no read fallback).
    return;
  }
  // No native module: fall back to AsyncStorage.
  const AS = getAsyncStorage();
  if (AS) {
    try { await AS.setItem(key, value); } catch {}
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (_SecureStore) {
    try { await _SecureStore.deleteItemAsync(key); } catch {}
    return;
  }
  const AS = getAsyncStorage();
  if (AS) {
    try { await AS.removeItem(key); } catch {}
  }
}

export async function secureMultiDelete(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => secureDelete(k)));
}
