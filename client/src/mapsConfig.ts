import { useEffect, useState } from "react";

// Real runtime maps kill switch (Maps cost-control follow-up pass, review
// point #3 — the previous VITE_MAPBOX_ENABLED build-time env var cannot
// actually be flipped without a rebuild+redeploy, so it doesn't give an
// operator anything close to an "immediate" shutoff during a real cost/
// outage incident). GET /api/config reads a DB-backed setting an admin can
// change via PUT /api/admin/config/maps-enabled with no rebuild, no
// redeploy, and no server restart — a new page load picks it up within one
// fetch. VITE_MAPBOX_ENABLED still exists as a defense-in-depth build-time
// hard-disable; this is the actually-immediate lever.
//
// One shared in-flight/cached promise so every DiscoveryMap/SinglePinMap
// instance on a page triggers exactly one fetch, not one each.
let cachedPromise: Promise<boolean> | null = null;

function fetchMapsEnabled(): Promise<boolean> {
  if (!cachedPromise) {
    cachedPromise = fetch("/api/config")
      .then((r) => r.json())
      .then((d) => d.mapsEnabled !== false)
      // Fail OPEN on a network hiccup — a flaky /api/config call must not
      // itself take down the map experience (same "don't hard-block"
      // principle as everywhere else this app fails gracefully).
      .catch(() => true);
  }
  return cachedPromise;
}

/** null = not yet known (first render, fetch in flight) — callers should
 * render a neutral loading state, not the interactive map, until this
 * resolves to true/false, to avoid a flash of enabled-then-disabled. */
export function useMapsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMapsEnabled().then((v) => {
      if (alive) setEnabled(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
