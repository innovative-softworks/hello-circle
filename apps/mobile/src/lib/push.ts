// Wraps @react-native-firebase/messaging's device-token lifecycle,
// mirroring (not porting) client/src/native.ts's registerForPush/
// setupPushTapListener shape. Every call defensively try/catches, same as
// src/lib/analytics.ts, since this module only works in a dev-client/EAS
// build, not Expo Go. Uses the modular API (getMessaging()/getToken(instance,
// ...)), same pattern as analytics.ts — not the old messaging().getToken().
import { getInitialNotification, getMessaging, getToken, onMessage, onNotificationOpenedApp, onTokenRefresh as fbOnTokenRefresh } from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';

export async function getFcmToken(): Promise<string | null> {
  try {
    return await getToken(getMessaging());
  } catch (err) {
    console.log('[push] getFcmToken failed:', err);
    return null;
  }
}

export function onTokenRefresh(cb: (token: string) => void): () => void {
  try {
    return fbOnTokenRefresh(getMessaging(), cb);
  } catch (err) {
    console.log('[push] onTokenRefresh failed:', err);
    return () => undefined;
  }
}

// FCM does not auto-display a system notification while the app is
// foregrounded — only this listener fires, silently. Bridge it into an
// immediate local notification so a foreground push is actually visible.
export function onForegroundMessage(cb: (msg: { title?: string; body?: string; path?: string }) => void): () => void {
  try {
    return onMessage(getMessaging(), async (message) => {
      const title = message.notification?.title;
      const body = message.notification?.body;
      const path = typeof message.data?.path === 'string' ? message.data.path : undefined;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { path } },
        trigger: null,
      }).catch(() => undefined);
      cb({ title, body, path });
    });
  } catch (err) {
    console.log('[push] onForegroundMessage failed:', err);
    return () => undefined;
  }
}

// Merges two tap sources into one callback: a tap on an OS-displayed
// background/quit-state notification (RNFB) and a tap on the
// foreground-bridged local notification above (expo-notifications).
export function onNotificationTap(cb: (path: string) => void): () => void {
  const unsubscribers: (() => void)[] = [];
  try {
    unsubscribers.push(
      onNotificationOpenedApp(getMessaging(), (message) => {
        const path = typeof message.data?.path === 'string' ? message.data.path : undefined;
        if (path) cb(path);
      })
    );
  } catch (err) {
    console.log('[push] onNotificationOpenedApp failed:', err);
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const path = response.notification.request.content.data?.path;
    if (typeof path === 'string') cb(path);
  });
  unsubscribers.push(() => subscription.remove());

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

// Cold-start tap detection — joined into _layout.tsx's single boot sequence
// alongside getInitialDeepLink(), for the same race-avoidance reason.
export async function getInitialNotificationPath(): Promise<string | null> {
  try {
    const message = await getInitialNotification(getMessaging());
    const path = typeof message?.data?.path === 'string' ? message.data.path : undefined;
    return path ?? null;
  } catch {
    return null;
  }
}
