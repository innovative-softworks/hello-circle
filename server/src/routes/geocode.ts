import { Router } from "express";
import { simpleRateLimit } from "../rateLimit.js";

export const geocodeRouter = Router();

// Address search (Form System Audit, Phase 4; hardened for policy compliance
// in the Maps cost-control follow-up pass) — proxies a Nominatim-compatible
// geocoder rather than calling it directly from the browser: the public
// OSMF instance's usage policy (https://operations.osmfoundation.org/
// policies/nominatim/) requires a real identifying User-Agent (browsers
// can't set that on outgoing fetch), caps usage at an absolute maximum of
// 1 request/second *per application* (not per end user), requires
// client-side caching of repeat queries, and — the one this route used to
// violate — explicitly FORBIDS autocomplete/search-as-you-type: "This is
// not yet supported by Nominatim and you must not implement such a service
// on the client side using the API." client/src/components/AddressSearch.tsx
// now only calls this on an explicit Search action or Enter, never on a
// keystroke-driven timer.
//
// GEOCODER_BASE_URL makes the upstream endpoint swappable (a self-hosted or
// third-party Nominatim-compatible instance) without a code change, per the
// same policy's spirit of not building single-provider lock-in into a paid-
// API-adjacent integration point. Defaults to the public OSMF instance.
const GEOCODER_BASE_URL = (process.env.GEOCODER_BASE_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");

const geocodeLimiter = simpleRateLimit({ windowMs: 60 * 1000, max: 20 });

// Serialises every outgoing request behind a single chain with a minimum
// 1.1s gap, regardless of how many vendors are searching at once — a per-IP
// limiter alone doesn't stop two different vendors' concurrent searches
// from together exceeding the shared 1 req/sec policy. NOTE (honest limit,
// not a guarantee): this queue is in-process memory, so it only enforces
// the aggregate rate *within one server process*. HelloCircle currently
// deploys as a single systemd instance (see DEPLOYMENT.md) — correct today,
// but this would under-count real request volume if ever scaled to
// multiple instances/processes without a shared (e.g. Redis-backed) queue.
let queue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const result = await fn();
    await new Promise((r) => setTimeout(r, 1100));
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export interface GeocodeSuggestion {
  label: string;
  lat: number;
  lng: number;
  area: string;
  county: string;
}

// Repeat-query caching (policy requirement, not just a performance nice-to-
// have — "results must be cached on your side... repeatedly sending
// identical queries may result in blocking"). A plain in-memory Map is
// enough at this app's scale/single-instance deployment — no need to stand
// up Redis solely for this. Keyed on the normalized (trimmed, lowercased)
// query string; a fixed TTL rather than an LRU eviction policy since the
// working set (vendors typing venue addresses) is small and short-lived.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; results: GeocodeSuggestion[] }>();

function cacheKey(q: string): string {
  return q.trim().toLowerCase();
}

function getCached(q: string): GeocodeSuggestion[] | undefined {
  const entry = cache.get(cacheKey(q));
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(cacheKey(q));
    return undefined;
  }
  return entry.results;
}

function setCached(q: string, results: GeocodeSuggestion[]): void {
  cache.set(cacheKey(q), { expiresAt: Date.now() + CACHE_TTL_MS, results });
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: { town?: string; city?: string; village?: string; suburb?: string; county?: string; state?: string };
}

geocodeRouter.get("/search", geocodeLimiter, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 3) return res.json([]);

  const cached = getCached(q);
  if (cached) return res.json(cached);

  try {
    const results = await throttled(async () => {
      const url = new URL("/search", GEOCODER_BASE_URL);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("countrycodes", "ie");
      url.searchParams.set("limit", "5");
      url.searchParams.set("q", q);
      const r = await fetch(url, { headers: { "User-Agent": "HelloCircle/1.0 (community activity platform, contact: admin@hellocircle.ie)" } });
      if (!r.ok) throw new Error(`Geocoder returned ${r.status}`);
      return (await r.json()) as NominatimResult[];
    });

    const mapped: GeocodeSuggestion[] = results.map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      area: r.address?.suburb ?? r.address?.town ?? r.address?.city ?? r.address?.village ?? "",
      county: (r.address?.county ?? r.address?.state ?? "").replace(/^County\s+/i, ""),
    }));
    setCached(q, mapped);
    res.json(mapped);
  } catch {
    // A geocoding hiccup shouldn't block the form — the vendor can still
    // type Area/County by hand, same as before this feature existed.
    res.json([]);
  }
});
