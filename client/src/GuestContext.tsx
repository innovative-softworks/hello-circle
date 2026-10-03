import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, fetchGuestSession, fetchResidentMe } from "./api";
import type { Resident } from "./types";

interface GuestContextValue {
  email: string | null;
  /** The persistent profile behind a verified email (MVP) — created the
   * first time that email verifies a magic link (see
   * server/src/routes/guestAuth.ts). Present whenever `email` is, once the
   * resident-lookup call resolves; null before then or if never verified. */
  resident: Resident | null;
  loading: boolean;
  /** HC-QA-064 — the last session/profile check failed for a reason other
   * than "not signed in" (server error, network, timeout). The session is
   * kept; screens show a retryable error instead of a signed-out prompt. */
  loadError: boolean;
  refresh: () => Promise<void>;
}

const GuestContext = createContext<GuestContextValue>({ email: null, resident: null, loading: true, loadError: false, refresh: async () => {} });

const isAuthFailure = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

/** Tracks the magic-link guest session (see server/src/guestAuth.ts) —
 * separate from AuthContext, which is vendor/admin-only. A signed-in guest
 * never gets a users row/password, just a verified email plus (MVP) the
 * resident profile that email resolves to. */
export function GuestProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [resident, setResident] = useState<Resident | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { email } = await fetchGuestSession();
      setEmail(email);
      if (email) {
        const { resident } = await fetchResidentMe();
        setResident(resident);
      } else {
        setResident(null);
      }
      setLoadError(false);
    } catch (e) {
      if (isAuthFailure(e)) {
        // Genuinely not signed in (expired/revoked session).
        setEmail(null);
        setResident(null);
        setLoadError(false);
      } else {
        // A transient failure must not sign the person out: keep whatever
        // session/profile we already knew and let the screen offer a retry.
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <GuestContext.Provider value={{ email, resident, loading, loadError, refresh }}>{children}</GuestContext.Provider>;
}

export function useGuest() {
  return useContext(GuestContext);
}
