// Thin wrapper around expo-haptics — every call defensively try/catches
// since haptics can throw on unsupported hardware/simulators, and a missed
// buzz should never break the action it's attached to.
import * as Haptics from 'expo-haptics';

export function hapticSuccess(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function hapticLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function hapticSelection(): void {
  Haptics.selectionAsync().catch(() => undefined);
}
