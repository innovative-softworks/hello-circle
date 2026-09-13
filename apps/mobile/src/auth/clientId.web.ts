// Web sibling of clientId.ts — see src/lib/secureStoreWeb.ts for why.
// expo-crypto has a real web implementation (delegates to window.crypto),
// so only the SecureStore import differs from the native file.
import * as Crypto from 'expo-crypto';
import * as SecureStore from '@/lib/secureStoreWeb';

const KEY = 'hello_circle_client_id';

let cached: string | null = null;

export async function getClientId(): Promise<string> {
  if (cached) return cached;
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, id);
  }
  cached = id;
  return id;
}
