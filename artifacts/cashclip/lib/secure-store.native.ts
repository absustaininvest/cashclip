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

export async function secureGet(key: string): Promise<string | null> {
  if (_SecureStore) {
    try { return await _SecureStore.getItemAsync(key); } catch {}
  }
  const AS = getAsyncStorage();
  if (AS) {
    try { return await AS.getItem(key); } catch {}
  }
  return null;
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (_SecureStore) {
    try { await _SecureStore.setItemAsync(key, value); return; } catch {}
  }
  const AS = getAsyncStorage();
  if (AS) {
    try { await AS.setItem(key, value); } catch {}
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (_SecureStore) {
    try { await _SecureStore.deleteItemAsync(key); return; } catch {}
  }
  const AS = getAsyncStorage();
  if (AS) {
    try { await AS.removeItem(key); } catch {}
  }
}

export async function secureMultiDelete(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => secureDelete(k)));
}
