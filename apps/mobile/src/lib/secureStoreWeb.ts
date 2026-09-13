// Dev-only web fallback for expo-secure-store, which has no web
// implementation at all — its own ExpoSecureStore.web.ts is a literal
// `export default {}`. Backed by localStorage: fine for local browser
// testing, NOT secure storage, never for anything resembling production.
// Only ever imported by this project's own *.web.ts siblings — native
// builds (iOS/Android) never touch this file.
export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage disabled/unavailable (private browsing, quota) — silently
    // no-op, same fail-open convention SecureStore itself uses elsewhere.
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See setItemAsync.
  }
}
