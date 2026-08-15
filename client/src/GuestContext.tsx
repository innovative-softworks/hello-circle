import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchGuestSession } from "./api";

interface GuestContextValue {
  email: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const GuestContext = createContext<GuestContextValue>({ email: null, loading: true, refresh: async () => {} });

/** Tracks the magic-link guest session (see server/src/guestAuth.ts) —
 * separate from AuthContext, which is vendor/admin-only. A signed-in guest
 * never gets a users row/password, just a verified email. */
export function GuestProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { email } = await fetchGuestSession();
      setEmail(email);
    } catch {
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <GuestContext.Provider value={{ email, loading, refresh }}>{children}</GuestContext.Provider>;
}

export function useGuest() {
  return useContext(GuestContext);
}
