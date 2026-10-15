import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchMe } from "./api";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await fetchMe();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // D-01 / D-08 — a partner API refused because the organisation is now
  // suspended (or the member was removed): re-read the session.
  // Ignored once the session already shows the restriction, so components that
  // keep polling partner APIs can't cause a refresh loop.
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  useEffect(() => {
    const onChange = () => {
      const u = userRef.current;
      if (u && (u.orgStatus === "suspended" || (u.invitedStaff && !u.orgId))) return;
      void refresh();
    };
    window.addEventListener("hc:partner-access-changed", onChange);
    return () => window.removeEventListener("hc:partner-access-changed", onChange);
  }, [refresh]);

  return <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
