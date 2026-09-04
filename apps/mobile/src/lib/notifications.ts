// Permission-request + registration plumbing, per the Phase 1 plan — actual
// server registration (Phase 4) mirrors client/src/components/
// NativePushSync.tsx's lifecycle: register on sign-in, unregister on
// sign-out, no unregister on unmount (deliberate, same as the Capacitor
// version).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { registerPushToken as apiRegisterPushToken, unregisterPushToken as apiUnregisterPushToken } from '@/api/push';
import { getFcmToken } from '@/lib/push';

export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

let lastRegisteredToken: string | null = null;

export async function registerPushToken(): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  const token = await getFcmToken();
  if (!token) return;
  lastRegisteredToken = token;
  await apiRegisterPushToken({ token, platform: Platform.OS }).catch(() => undefined);
}

export async function unregisterPushToken(): Promise<void> {
  if (!lastRegisteredToken) return;
  await apiUnregisterPushToken(lastRegisteredToken).catch(() => undefined);
  lastRegisteredToken = null;
}

export async function handleTokenRefresh(token: string): Promise<void> {
  lastRegisteredToken = token;
  await apiRegisterPushToken({ token, platform: Platform.OS }).catch(() => undefined);
}
