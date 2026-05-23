import * as SecureStore from "expo-secure-store";

export async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function secureMultiDelete(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k)));
}
