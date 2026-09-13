// Firebase Analytics, reusing the hello-circle-e5e05 project already set up
// for push (see google-services.json/GoogleService-Info.plist at the repo
// root of this app). @react-native-firebase is a native module — it only
// works in a development build/EAS build, not in Expo Go. This version of
// @react-native-firebase/analytics uses the modular API (getAnalytics()/
// logEvent(instance, ...)), not the older analytics().logEvent(...).
//
// Merely `require()`-ing it registers a native event emitter, which throws
// in Expo Go, and Metro treats a failed module factory as a permanent,
// dev-visible fault (red screen) even inside a try/catch — so this bails
// out on isExpoGo() BEFORE ever calling require(), same fix as
// src/lib/push.ts.
import { isExpoGo } from '@/lib/runtimeEnvironment';

export async function logEvent(name: string, params?: Record<string, unknown>): Promise<void> {
  if (isExpoGo()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAnalytics, logEvent: firebaseLogEvent } = require('@react-native-firebase/analytics') as typeof import('@react-native-firebase/analytics');
    await firebaseLogEvent(getAnalytics(), name, params);
  } catch (err) {
    console.log('[analytics] logEvent skipped:', name, err);
  }
}
