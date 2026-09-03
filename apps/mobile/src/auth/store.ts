import { create } from 'zustand';

import * as residentAuth from '@/api/residentAuth';
import { clearSession, getStoredEmail, getToken, setSession } from '@/auth/secureStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

type AuthState = {
  email: string | null;
  status: Status;
  hydrate: () => Promise<void>;
  setSession: (token: string, email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  email: null,
  status: 'loading',

  hydrate: async () => {
    const [token, email] = await Promise.all([getToken(), getStoredEmail()]);
    set(token && email ? { email, status: 'signedIn' } : { email: null, status: 'signedOut' });
  },

  setSession: async (token, email) => {
    await setSession(token, email);
    set({ email, status: 'signedIn' });
  },

  signOut: async () => {
    // Best-effort server-side revocation — a failed/offline logout call
    // still clears the local session so the app doesn't get stuck signed in.
    await residentAuth.logout().catch(() => undefined);
    await clearSession();
    set({ email: null, status: 'signedOut' });
  },
}));
