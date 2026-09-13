// Wraps @react-native-firebase/messaging's device-token lifecycle,
// mirroring (not porting) client/src/native.ts's registerForPush/
// setupPushTapListener shape. Uses the modular API (getMessaging()/
// getToken(instance, ...)), same pattern as analytics.ts — not the old
// messaging().getToken().
//
// @react-native-firebase/messaging only works in a dev-client/EAS build,
// never Expo Go — merely `require()`-ing it registers a native event
// emitter, which throws in Expo Go ("Native module NativeRNFBTurboApp is
// not registered"). Worse, Metro treats a failed module factory as a
// permanent, dev-visible fault (red screen) even when the caller wraps the
// require in try/catch — so every function below checks isExpoGo() via
// `loadMessaging()` and bails out BEFORE ever calling require(), rather
// than requiring-and-catching.
import * as Notifications from 'expo-notifications';

import { isExpoGo } from '@/lib/runtimeEnvironment';

function loadMessaging(): typeof import('@react-native-firebase/messaging') | null {
  if (isExpoGo()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-firebase/messaging');
}

export async function getFcmToken(): Promise<string | null> {
  const messaging = loadMessaging();
  if (!messaging) return null;
  try {
    return await messaging.getToken(messaging.getMessaging());
  } catch (err) {
    console.log('[push] getFcmToken failed:', err);
    return null;
  }
}

export function onTokenRefresh(cb: (token: string) => void): () => void {
  const messaging = loadMessaging();
  if (!messaging) return () => undefined;
  try {
    return messaging.onTokenRefresh(messaging.getMessaging(), cb);
  } catch (err) {
    console.log('[push] onTokenRefresh failed:', err);
    return () => undefined;
  }
}

// FCM does not auto-display a system notification while the app is
// foregrounded — only this listener fires, silently. Bridge it into an
// immediate local notification so a foreground push is actually visible.
export function onForegroundMessage(cb: (msg: { title?: string; body?: string; path?: string }) => void): () => void {
  const messaging = loadMessaging();
  if (!messaging) return () => undefined;
  try {
    return messaging.onMessage(messaging.getMessaging(), async (message) => {
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
  const messaging = loadMessaging();
  if (messaging) {
    try {
      unsubscribers.push(
        messaging.onNotificationOpenedApp(messaging.getMessaging(), (message) => {
          const path = typeof message.data?.path === 'string' ? message.data.path : undefined;
          if (path) cb(path);
        })
      );
    } catch (err) {
      console.log('[push] onNotificationOpenedApp failed:', err);
    }
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
  const messaging = loadMessaging();
  if (!messaging) return null;
  try {
    const message = await messaging.getInitialNotification(messaging.getMessaging());
    const path = typeof message?.data?.path === 'string' ? message.data.path : undefined;
    return path ?? null;
  } catch {
    return null;
  }
}
