import { Router } from "express";
import { simpleRateLimit } from "../rateLimit.js";

export const geocodeRouter = Router();

// Address search (Form System Audit, Phase 4) — proxies OpenStreetMap's
// free Nominatim geocoder rather than calling it directly from the
// browser: Nominatim's usage policy (https://operations.osmfoundation.org/
// policies/nominatim/) requires a real identifying User-Agent (browsers
// can't set that on outgoing fetch) and caps usage at ~1 request/second
// *per application*, not per end user — the queue below enforces that
// server-wide, on top of the existing per-IP limiter every other
// rate-limited route in this app already uses.

const geocodeLimiter = simpleRateLimit({ windowMs: 60 * 1000, max: 20 });

// Serialises every outgoing Nominatim request behind a single chain with a
// minimum 1.1s gap, regardless of how many vendors are searching at once —
// a per-IP limiter alone doesn't stop two different vendors' concurrent
// searches from together exceeding Nominatim's shared 1 req/sec policy.
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

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: { town?: string; city?: string; village?: string; suburb?: string; county?: string; state?: string };
}

geocodeRouter.get("/search", geocodeLimiter, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 3) return res.json([]);

  try {
    const results = await throttled(async () => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("countrycodes", "ie");
      url.searchParams.set("limit", "5");
      url.searchParams.set("q", q);
      const r = await fetch(url, { headers: { "User-Agent": "HelloCircle/1.0 (community activity platform, contact: admin@hellocircle.ie)" } });
      if (!r.ok) throw new Error(`Nominatim returned ${r.status}`);
      return (await r.json()) as NominatimResult[];
    });

    res.json(
      results.map((r) => ({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        area: r.address?.suburb ?? r.address?.town ?? r.address?.city ?? r.address?.village ?? "",
        county: (r.address?.county ?? r.address?.state ?? "").replace(/^County\s+/i, ""),
      }))
    );
  } catch {
    // A geocoding hiccup shouldn't block the form — the vendor can still
    // type Area/County by hand, same as before this feature existed.
    res.json([]);
  }
});
