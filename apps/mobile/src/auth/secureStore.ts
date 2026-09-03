import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'hello_circle_resident_token';
const EMAIL_KEY = 'hello_circle_resident_email';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setSession(token: string, email: string): Promise<void> {
  await Promise.all([SecureStore.setItemAsync(TOKEN_KEY, token), SecureStore.setItemAsync(EMAIL_KEY, email)]);
}

export async function getStoredEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(EMAIL_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(EMAIL_KEY)]);
}
