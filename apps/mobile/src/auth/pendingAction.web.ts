// Web sibling of pendingAction.ts — see src/lib/secureStoreWeb.ts for why.
// Identical to the native file except for the import.
import * as SecureStore from '@/lib/secureStoreWeb';

const KEY = 'hello_circle_pending_action';

export type PendingAction =
  | { kind: 'favourite'; listingType: string; listingId: string; screenPath: string }
  | { kind: 'follow'; followedType: string; followedId: string; screenPath: string };

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
