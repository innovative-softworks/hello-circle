// Firebase Analytics, reusing the hello-circle-e5e05 project already set up
// for push (see google-services.json/GoogleService-Info.plist at the repo
// root of this app). @react-native-firebase is a native module — it only
// works in a development build/EAS build, not in Expo Go, so every call
// here is wrapped defensively rather than crashing a Go-based dev session.
// This version of @react-native-firebase/analytics uses the modular API
// (getAnalytics()/logEvent(instance, ...)), not the older analytics().logEvent(...).
import { getAnalytics, logEvent as firebaseLogEvent } from '@react-native-firebase/analytics';

export async function logEvent(name: string, params?: Record<string, unknown>): Promise<void> {
  try {
    await firebaseLogEvent(getAnalytics(), name, params);
  } catch (err) {
    console.log('[analytics] logEvent skipped:', name, err);
  }
}
