import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/auth/store';
import { mapNotificationPath } from '@/lib/notificationPath';
import { handleTokenRefresh, registerPushToken, unregisterPushToken } from '@/lib/notifications';
import { onForegroundMessage, onNotificationTap, onTokenRefresh } from '@/lib/push';

// Mirrors client/src/components/NativePushSync.tsx's shape: registers on
// sign-in (which is also when permission is first requested — never on
// cold boot, to avoid an unwanted prompt before the user has any reason to
// want notifications), unregisters on sign-out. No unregister on unmount,
// same deliberate omission as the Capacitor version.
export function PushSync() {
  const status = useAuthStore((state) => state.status);
  const hasRegisteredRef = useRef(false);

  useEffect(() => {
    if (status === 'signedIn') {
      if (!hasRegisteredRef.current) {
        hasRegisteredRef.current = true;
        registerPushToken().catch(() => undefined);
      }
    } else if (status === 'signedOut') {
      if (hasRegisteredRef.current) {
        hasRegisteredRef.current = false;
        unregisterPushToken().catch(() => undefined);
      }
    }
  }, [status]);

  useEffect(() => onTokenRefresh((token) => handleTokenRefresh(token).catch(() => undefined)), []);
  useEffect(() => onForegroundMessage(() => undefined), []);
  useEffect(
    () =>
      onNotificationTap((path) => {
        const route = mapNotificationPath(path);
        if (route) router.push(route as never);
      }),
    []
  );

  return null;
}
