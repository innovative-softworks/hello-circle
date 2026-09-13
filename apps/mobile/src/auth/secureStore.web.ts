// Web sibling of secureStore.ts — see src/lib/secureStoreWeb.ts for why.
// Identical to the native file except for the import.
import * as SecureStore from '@/lib/secureStoreWeb';

const TOKEN_KEY = 'hello_circle_resident_token';
const EMAIL_KEY = 'hello_circle_resident_email';
const RESIDENT_ID_KEY = 'hello_circle_resident_id';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setSession(token: string, email: string, residentId: string | null): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(EMAIL_KEY, email),
    residentId ? SecureStore.setItemAsync(RESIDENT_ID_KEY, residentId) : SecureStore.deleteItemAsync(RESIDENT_ID_KEY),
  ]);
}

export async function getStoredEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(EMAIL_KEY);
}

export async function getStoredResidentId(): Promise<string | null> {
  return SecureStore.getItemAsync(RESIDENT_ID_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(EMAIL_KEY),
    SecureStore.deleteItemAsync(RESIDENT_ID_KEY),
  ]);
}
