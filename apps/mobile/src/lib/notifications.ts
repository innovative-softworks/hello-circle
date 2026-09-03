// Permission-request + registration plumbing only, per the Phase 1 plan —
// actually POSTing a push token to the server (mirroring
// client/src/api/resident.ts's registerPushToken, Capacitor Phase 5) is
// deferred to Phase 4/5. This exists now so the dependency, permission-
// prompt copy, and Firebase project wiring aren't deferred to a later phase
// from scratch.
import * as Notifications from 'expo-notifications';

export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}
