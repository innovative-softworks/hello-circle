import { create } from 'zustand';

import * as residentAuth from '@/api/residentAuth';
import { clearSession, getStoredEmail, getStoredResidentId, getToken, setSession } from '@/auth/secureStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

type AuthState = {
  email: string | null;
  residentId: string | null;
  status: Status;
  hydrate: () => Promise<void>;
  setSession: (token: string, email: string, residentId: string | null) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  email: null,
  residentId: null,
  status: 'loading',

  hydrate: async () => {
    const [token, email, residentId] = await Promise.all([getToken(), getStoredEmail(), getStoredResidentId()]);
    set(token && email ? { email, residentId, status: 'signedIn' } : { email: null, residentId: null, status: 'signedOut' });
  },

  setSession: async (token, email, residentId) => {
    await setSession(token, email, residentId);
    set({ email, residentId, status: 'signedIn' });
  },

  signOut: async () => {
    // Best-effort server-side revocation — a failed/offline logout call
    // still clears the local session so the app doesn't get stuck signed in.
    await residentAuth.logout().catch(() => undefined);
    await clearSession();
    set({ email: null, residentId: null, status: 'signedOut' });
  },
}));
