import { useEffect, useState } from "react";
import { fetchOrgProfile } from "./api";
import { useAuth } from "./AuthContext";

// Configuration framework Phase D — the signed-in partner's organisation
// capabilities (effective: platform switch + organisation setting +
// dependencies), from GET /api/vendor/org. Display only: every module's API
// refuses itself when its capability is off. null = not known (still loading,
// or a role that can't read the organisation, e.g. Check-in only) — callers
// then fall back to role-only filtering, never to showing more.

let cache: { userId: string; promise: Promise<Record<string, boolean> | null> } | null = null;

export function useOrgCapabilities(): Record<string, boolean> | null {
  const { user } = useAuth();
  const [caps, setCaps] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!user || user.role !== "vendor") return setCaps(null);
    if (!cache || cache.userId !== user.id) {
      cache = { userId: user.id, promise: fetchOrgProfile().then((p) => p.capabilities ?? null).catch(() => null) };
    }
    let live = true;
    cache.promise.then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, [user]);
  return caps;
}

/** After an admin change in the same browser session (tests, admin acting as partner). */
export function forgetOrgCapabilities() {
  cache = null;
}
