// Same anonymous-identity mechanism as client/src/clientId.ts's
// localStorage version, backed by SecureStore + expo-crypto instead (RN has
// no global crypto.randomUUID()). Sent as X-Client-Id on every request —
// server/src/util.ts's clientIdFrom() hard-requires this header.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

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
