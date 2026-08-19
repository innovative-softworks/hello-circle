import { Router } from "express";
import { db } from "../db/index.js";
import { listClubs, listCentres, listScheduledActivities, type ScheduledActivity } from "../db/queries.js";
import { parseSearchQuery, type ParsedQuery } from "../searchParser.js";

export const searchRouter = Router();

// Natural-language-ish search (FUTURE, best-effort — "AI search" without an
// LLM). Parses a handful of structured signals out of the query
// (county/free/price/time-of-day) via searchParser.ts, then filters the
// existing centre/club lists plus every scheduled activity (games, program
// sessions, club sessions — via db/queries.ts's listScheduledActivities,
// shared with routes/discover.ts) — Phase 6 of the roadmap explicitly wants
// search to cover activities/sessions, not just places. No new index, no
// vector store, just rules over data that already exists. Zero-result
// queries are logged to search_misses for demand intelligence (see
// routes/vendor.ts GET /demand, routes/admin.ts GET /demand) — unchanged,
// still only tracks the centre/club signal it always has.

const SEARCH_WINDOW_DAYS = 60;

/** Buckets a "HH:MM" clock time into the same three-way taxonomy
 * searchParser.ts's TIME_WORDS produces from the query text, so "evening"
 * in the query actually matches something. */
function bucketTimeOfDay(time: string): ParsedQuery["timeOfDay"] {
  const hour = Number(time.split(":")[0]);
  if (Number.isNaN(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

searchRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) return res.json({ parsed: null, centres: [], clubs: [], activities: [] });

  const parsed = parseSearchQuery(q);
  const matchesKeywords = (haystack: string) => parsed.keywords.length === 0 || parsed.keywords.some((k) => haystack.toLowerCase().includes(k));

  const [allCentres, allClubs] = await Promise.all([listCentres(parsed.county ?? undefined), listClubs(parsed.county ?? undefined)]);

  const centres = allCentres.filter((c) => matchesKeywords(`${c.name} ${c.blurb} ${c.amenities.join(" ")} ${c.accessibility.join(" ")}`));
  const clubs = allClubs
    .filter((c) => matchesKeywords(`${c.name} ${c.sport} ${c.blurb} ${c.accessibility.join(" ")}`))
    .filter((c) => !parsed.free || c.trial || c.price === 0)
    .filter((c) => parsed.maxPriceEuro === null || c.price <= parsed.maxPriceEuro);

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setUTCDate(now.getUTCDate() + SEARCH_WINDOW_DAYS);
  const allActivities = await listScheduledActivities({ county: parsed.county ?? undefined, from: now, to: windowEnd });

  const activities = allActivities
    .filter((a: ScheduledActivity) => matchesKeywords(`${a.title} ${a.centreName ?? ""} ${a.clubName ?? ""}`))
    .filter((a) => !parsed.free || !a.priceCents)
    .filter((a) => parsed.maxPriceEuro === null || a.priceCents === null || a.priceCents <= parsed.maxPriceEuro * 100)
    .filter((a) => parsed.timeOfDay === null || bucketTimeOfDay(a.time) === parsed.timeOfDay)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  // Logged per listing type independently, not just when both are empty —
  // one query box searches centres and clubs simultaneously, so "no clubs
  // matched" and "no centres matched" are two different demand signals
  // (see routes/vendor.ts GET /demand, which scopes by vendor_type/county).
  // Deliberately not extended to activities yet — the vendor/admin Demand
  // tab's scope is centre/club vendor_type, which doesn't have an
  // equivalent for a zero-result activity search.
  const queryText = q.trim().slice(0, 500);
  const county = parsed.county ?? "";
  if (centres.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'centre', ?)`).run(queryText, county).catch(() => {});
  }
  if (clubs.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'club', ?)`).run(queryText, county).catch(() => {});
  }

  res.json({ parsed, centres, clubs, activities });
});
