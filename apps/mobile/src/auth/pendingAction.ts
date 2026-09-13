// Preserves "what the user was trying to do" across the magic-link round
// trip — the emailed link opens in a browser (server's /mobile-verify),
// which deep-links back into the app, so the process can be backgrounded
// or killed in between. In-memory state alone can't survive that; this is
// the mobile equivalent of client/src/authRedirect.ts's signInHref()/
// safeReturnTo() pattern (master-prompt §7's "preserve original intent").
import * as SecureStore from 'expo-secure-store';

const KEY = 'hello_circle_pending_action';

export type PendingAction =
  | { kind: 'favourite'; listingType: string; listingId: string; screenPath: string }
  | { kind: 'follow'; followedType: string; followedId: string; screenPath: string }
  // A resident-only action this app can't safely auto-replay (game join can
  // open a Stripe checkout — firing that automatically right after the
  // magic-link round trip would be a jarring surprise) — just returns the
  // user to where they were so they can tap the action again themselves.
  | { kind: 'returnTo'; screenPath: string };

export async function setPendingAction(action: PendingAction): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(action));
}

export async function getPendingAction(): Promise<PendingAction | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAction;
  } catch {
    return null;
  }
}

export async function clearPendingAction(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
