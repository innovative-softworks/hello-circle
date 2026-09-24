import { Router } from "express";
import { db } from "../db/index.js";
import { haversineKm, resolveRadiusFilter } from "../geo.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { getLocalMomentum, getMarketCategories, listMapMarkers, listScheduledActivities, type MapMarkerType, type ScheduledActivity } from "../db/queries.js";
import { personalizeActivity } from "../personalization.js";

export const discoverRouter = Router();

// "Happening today" / "This weekend" homepage feeds (Phase 5 gap) — the
// first platform-wide aggregate across the three scheduled-activity
// sources (games, program_sessions, club_sessions). The actual fetch/join/
// status-filter logic lives in db/queries.ts's listScheduledActivities
// (shared with routes/search.ts's Phase 6 search) — this file only owns
// ranking + today/weekend bucketing. Deliberately read-only and public — no
// capacity/checkout logic here, just "what's on."

export type DiscoverItem = ScheduledActivity & { matchReasons: string[] };

export interface DiscoverFeed {
  today: DiscoverItem[];
  weekend: DiscoverItem[];
}

/** Ranking, not just chronological sort — deliberately rule-based (no ML,
 * same "start simple" spirit as searchParser.ts elsewhere in this
 * codebase). Five signals, in priority order:
 *   1. Live beats everything — something happening right now is the most
 *      compelling thing to surface first, full stop.
 *   2. Starting soon beats starting later — decays smoothly rather than a
 *      hard cutoff, so "in 20 minutes" clearly outranks "in 6 hours".
 *   3. Filling up (games only, real capacity/joined data) signals real
 *      demand — genuine social proof, not urgency theatre, since it's
 *      backed by actual joins.
 *   4. Personalization (implementation plan Phase 12) — a signed-in
 *      resident's own interests/home county/familiar co-players, via
 *      personalization.ts. Zero for a signed-out visitor.
 *   5. Small, deliberately minor boosts for free (lower friction to act
 *      on) and for having a real photo (more compelling in a photo-driven
 *      feed) — tie-breakers, not primary signals.
 * `minutesUntilStart` is negative once a (non-live, already-ended) item
 * has passed — those still sort last naturally since every term is >= 0. */
export function rankScore(params: { isLive: boolean; minutesUntilStart: number; fillRatio: number | null; isFree: boolean; hasPhoto: boolean; personalizationBonus?: number }): number {
  let score = 0;
  if (params.isLive) score += 1000;
  else score += Math.max(0, 300 - Math.max(0, params.minutesUntilStart) / 10);
  if (params.fillRatio !== null && params.fillRatio >= 0.5) score += params.fillRatio * 100;
  score += params.personalizationBonus ?? 0;
  if (params.isFree) score += 20;
  if (params.hasPhoto) score += 10;
  return score;
}

function minutesUntil(now: Date, date: string, time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (irelandWallTimeToUtc(date, hour, minute).getTime() - now.getTime()) / 60000;
}

/** Scores + attaches matchReasons for a batch of activities against one
 * (possibly signed-out) resident — shared by "/", "/free-time" below, and
 * routes/search.ts so all three surfaces rank/explain consistently. */
export async function scoreActivities(
  activities: ScheduledActivity[],
  now: Date,
  residentId: string | null,
  residentHomeCounty: string | null
): Promise<{ item: DiscoverItem; score: number }[]> {
  return Promise.all(
    activities.map(async (item) => {
      const personalization = await personalizeActivity(item, residentId, residentHomeCounty);
      const score = rankScore({
        isLive: item.isLive,
        minutesUntilStart: minutesUntil(now, item.date, item.time),
        fillRatio: item.kind === "game" && item.joined !== null && item.spotsLeft !== null && item.joined + item.spotsLeft > 0 ? item.joined / (item.joined + item.spotsLeft) : null,
        isFree: !item.priceCents,
        hasPhoto: !!item.imageUrl,
        personalizationBonus: personalization.bonus,
      });
      return { item: { ...item, matchReasons: personalization.reasons }, score };
    })
  );
}

const VALID_MARKER_TYPES: ReadonlySet<MapMarkerType> = new Set(["centre", "club", "experience"]);
const DEFAULT_MARKER_TYPES: MapMarkerType[] = ["centre", "club", "experience"];

/** Bounds-scoped map discovery (Maps & Geographic Discovery spec, Phase E).
 * Deliberately separate from "/" above — that feed is a ranked today/
 * weekend list with no geographic viewport concept; this is a flat,
 * unranked marker list for a specific lat/lng box, matching what
 * DiscoveryMap.tsx's client-side clustering needs. Server enforces the
 * exact same "approved only" gate every other public centre/club/experience
 * route already uses (listMapMarkers) — the client never receives a
 * restricted listing's coordinates merely because it knows not to draw it. */
discoverRouter.get("/map", async (req, res) => {
  const north = Number(req.query.north);
  const south = Number(req.query.south);
  const east = Number(req.query.east);
  const west = Number(req.query.west);
  if ([north, south, east, west].some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: "north, south, east, and west are required numeric bounds" });
  }
  if (north < -90 || north > 90 || south < -90 || south > 90 || east < -180 || east > 180 || west < -180 || west > 180) {
    return res.status(400).json({ error: "coordinates out of range" });
  }
  if (south > north || west > east) {
    return res.status(400).json({ error: "invalid bounds: south must be <= north and west must be <= east" });
  }

  const requestedTypes = typeof req.query.types === "string" ? req.query.types.split(",").map((t) => t.trim()) : undefined;
  const types = new Set(
    (requestedTypes && requestedTypes.length ? requestedTypes : DEFAULT_MARKER_TYPES).filter((t): t is MapMarkerType => VALID_MARKER_TYPES.has(t as MapMarkerType))
  );
  if (types.size === 0) return res.json({ markers: [] });

  // Filter consistency (Maps cost-control follow-up pass, review point #2)
  // — "Search this area" must respect the same text/price filters the
  // list panel already applies, not just entity type, so e.g. a "free
  // activities" filter can't suddenly show paid results just because the
  // map was panned. See listMapMarkers' own comment for what's NOT covered
  // (amenities/accessibility — the minimal marker payload has no room for
  // those fields).
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
  const minPriceCents = typeof req.query.minPriceCents === "string" && !Number.isNaN(Number(req.query.minPriceCents)) ? Number(req.query.minPriceCents) : undefined;
  const maxPriceCents = typeof req.query.maxPriceCents === "string" && !Number.isNaN(Number(req.query.maxPriceCents)) ? Number(req.query.maxPriceCents) : undefined;

  const markers = await listMapMarkers({ north, south, east, west }, types, { q, minPriceCents, maxPriceCents });
  res.json({ markers });
});

// Discovery-radius filtering (master-prompt punch list #2) — see
// resolveRadiusFilter's own comment; strictly opt-in via ?radiusKm=, zero
// change to the default nationwide/by-county feed otherwise.
discoverRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" && req.query.county !== "All" ? req.query.county : undefined;
  const radius = resolveRadiusFilter(req.query, req.resident?.homeCounty ?? null);
  const now = new Date();
  const todayIso = irelandTodayIso();
  const weekFromNow = new Date(now);
  weekFromNow.setUTCDate(now.getUTCDate() + 7);
  const weekFromNowIso = weekFromNow.toISOString().slice(0, 10);

  const activities = await listScheduledActivities({ county, from: now, to: weekFromNow, radius });
  const scored = await scoreActivities(activities, now, req.resident?.id ?? null, req.resident?.homeCounty ?? null);

  const today: { item: DiscoverItem; score: number }[] = [];
  const weekend: { item: DiscoverItem; score: number }[] = [];
  for (const entry of scored) {
    if (entry.item.date === todayIso) today.push(entry);
    const dow = new Date(`${entry.item.date}T12:00:00Z`).getUTCDay();
    if (entry.item.date >= todayIso && entry.item.date <= weekFromNowIso && (dow === 0 || dow === 6)) weekend.push(entry);
  }
  // Ranked, not chronological — see rankScore() above. Time remains the
  // tiebreaker among items the algorithm scores equally.
  const byScore = (a: { score: number; item: DiscoverItem }, b: { score: number; item: DiscoverItem }) => b.score - a.score || a.item.time.localeCompare(b.item.time);
  today.sort(byScore);
  weekend.sort(byScore);

  res.json({
    today: today.map((e) => e.item),
    weekend: weekend.map((e) => e.item),
  } satisfies DiscoverFeed);
});

// Local Momentum (implementation plan Phase 7) — a resident-facing "picking
// up near you" signal, the positive-growth counterpart to admin/vendor-only
// getDemandSignals() (unmet demand). Deliberately its own small endpoint
// rather than folded into "/" above — a homepage strip, not a per-activity
// feed, and cheap enough not to need the same today/weekend bucketing.
// Market/category launch config (participation-intent plan Phase 4) —
// public, read-only. Lets the client know which categories are "live" in a
// given county (e.g. to show a "Not yet here" affordance in Onboarding
// instead of hiding a disabled category outright).
discoverRouter.get("/market-categories", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : "";
  if (!county) return res.status(400).json({ error: "county is required" });
  const flags = await getMarketCategories(county);
  res.json(flags);
});

discoverRouter.get("/momentum", async (req, res) => {
  const county = typeof req.query.county === "string" && req.query.county !== "All" ? req.query.county : undefined;
  const signals = await getLocalMomentum({ county, limit: 6 });
  res.json(signals);
});

// Free Time Mode (implementation plan Phase 9) — duration → distance →
// mood → 3 options. Deliberately reuses listScheduledActivities() and the
// exact same rankScore() as "/" above rather than a new ranking algorithm —
// this endpoint is only a different, narrower front door onto the same
// underlying "what's on" pool, matching the phase's own stated scope.
// haversineKm now lives in geo.ts (shared with queries.ts's discovery-
// radius filtering, master-prompt punch list #2).

// Mood is a lightweight keyword filter over each activity's own title, not a
// new taxonomy/column — a reasonable, documented assumption in the same
// spirit as queries.ts's ASSUMED_DURATION_MINUTES, not real tagged data.
export const MOOD_KEYWORDS: Record<string, string[]> = {
  // "active" stays as-is (team/ball sports) — Home's mood tile for this
  // bucket is now labelled "Play"; keeping the key name unchanged avoids
  // touching any other caller (see searchAlerts.ts) that might reference it.
  active: ["football", "soccer", "gaa", "rugby", "basketball", "tennis", "badminton", "hockey", "sport"],
  // Split out from "active" (landing/homepage repositioning) — Home's
  // mood-tile taxonomy wants "Play" (team/ball sports, above) distinct from
  // "Move" (individual fitness/cardio) rather than one combined bucket.
  move: ["run", "parkrun", "gym", "swim", "athletics", "cycling", "cycle", "walk", "fitness", "martial"],
  chill: ["yoga", "meditation", "chess", "walk", "book", "reading"],
  social: ["meetup", "club", "circle", "social", "coffee", "chat", "board game"],
  creative: ["art", "craft", "music", "paint", "dance", "drama", "photography"],
  // Home's intent selector (IA spec §3) — "Learn" is the one chip label with
  // no existing mood bucket to reuse.
  learn: ["class", "course", "workshop", "language", "coding", "cookery", "cooking"],
};

discoverRouter.get("/free-time", async (req, res) => {
  const county = typeof req.query.county === "string" && req.query.county !== "All" ? req.query.county : undefined;
  const maxMinutes = typeof req.query.maxMinutes === "string" ? parseInt(req.query.maxMinutes, 10) : undefined;
  const mood = typeof req.query.mood === "string" && req.query.mood !== "any" ? req.query.mood : undefined;
  const lat = typeof req.query.lat === "string" ? parseFloat(req.query.lat) : undefined;
  const lng = typeof req.query.lng === "string" ? parseFloat(req.query.lng) : undefined;
  const radiusKm = typeof req.query.radiusKm === "string" ? parseFloat(req.query.radiusKm) : undefined;

  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setUTCDate(now.getUTCDate() + 7);

  let activities = await listScheduledActivities({ county, from: now, to: weekFromNow });

  if (maxMinutes !== undefined && !Number.isNaN(maxMinutes)) {
    activities = activities.filter((a) => a.durationMinutes <= maxMinutes);
  }
  if (mood) {
    const keywords = MOOD_KEYWORDS[mood] ?? [];
    activities = activities.filter((a) => keywords.some((k) => a.title.toLowerCase().includes(k)));
  }
  if (lat !== undefined && lng !== undefined && radiusKm !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng) && !Number.isNaN(radiusKm)) {
    // Only a 'confirmed' coordinate can honestly support a "within Xkm"
    // distance claim — see queries.ts's applyRadiusFilter for the full
    // rationale (Maps cost-control follow-up pass, review point #4).
    activities = activities.filter((a) => a.lat !== null && a.lng !== null && a.locationSource === "confirmed" && haversineKm(lat, lng, a.lat, a.lng) <= radiusKm);
  }

  const scored = await scoreActivities(activities, now, req.resident?.id ?? null, req.resident?.homeCounty ?? null);
  scored.sort((a, b) => b.score - a.score || a.item.time.localeCompare(b.item.time));

  res.json(scored.slice(0, 3).map((e) => e.item));
});

// "Next Best Participation" (implementation backlog #4, P3 intelligence
// tier) — the one thing Free Time Mode/Ask HelloCircle/Phase 12
// personalization never did on their own: blend them into a single ranked
// "what should I do next" list, proactively, with no query or mood/duration
// picker required from the resident. Built on top of the exact same
// scoreActivities() every other feed already uses (not a new algorithm)
// plus two additional signals neither Free Time Mode nor plain
// personalization reads: active Routines (§9) and Circle membership (§10)
// — both genuinely new blending, not a rename of an existing feed.

async function personalBoostSignals(residentId: string | null): Promise<{
  routines: { activityLabel: string; dayOfWeek: number }[];
  circleActivityLabels: Set<string>;
  followedHostIds: Set<string>;
  followedVendorIds: Set<string>;
}> {
  if (!residentId) return { routines: [], circleActivityLabels: new Set(), followedHostIds: new Set(), followedVendorIds: new Set() };
  const [routines, circles, follows] = await Promise.all([
    db.prepare(`SELECT activity_label as activityLabel, day_of_week as dayOfWeek FROM routines WHERE resident_id = ? AND status = 'active'`).all(residentId) as Promise<
      { activityLabel: string; dayOfWeek: number }[]
    >,
    db
      .prepare(`SELECT c.activity_label as activityLabel FROM circle_members cm JOIN circles c ON c.id = cm.circle_id WHERE cm.resident_id = ? AND c.status = 'active'`)
      .all(residentId) as Promise<{ activityLabel: string }[]>,
    db.prepare(`SELECT followed_type as followedType, followed_id as followedId FROM follows WHERE resident_id = ?`).all(residentId) as Promise<
      { followedType: "vendor" | "host"; followedId: string }[]
    >,
  ]);
  return {
    routines,
    circleActivityLabels: new Set(circles.map((c) => c.activityLabel.toLowerCase()).filter(Boolean)),
    followedHostIds: new Set(follows.filter((f) => f.followedType === "host").map((f) => f.followedId)),
    followedVendorIds: new Set(follows.filter((f) => f.followedType === "vendor").map((f) => f.followedId)),
  };
}

/** Resolves the host resident (games) or owning vendor (program/club
 * sessions) behind a batch of items — a single extra IN-query per kind
 * rather than widening ScheduledActivity/DiscoverItem with fields every
 * other consumer of that shared shape would have to ignore. */
async function ownerIdsFor(items: { kind: DiscoverItem["kind"]; id: string }[]): Promise<{ hostByItemId: Map<string, string>; vendorByItemId: Map<string, string> }> {
  const gameIds = items.filter((i) => i.kind === "game").map((i) => i.id);
  const programSessionIds = items.filter((i) => i.kind === "program_session").map((i) => i.id);
  const clubSessionIds = items.filter((i) => i.kind === "club_session").map((i) => i.id);

  const hostByItemId = new Map<string, string>();
  const vendorByItemId = new Map<string, string>();

  await Promise.all([
    gameIds.length
      ? (db.prepare(`SELECT id, host_resident_id as hostResidentId FROM games WHERE id IN (${gameIds.map(() => "?").join(",")})`).all(...gameIds) as Promise<
          { id: string; hostResidentId: string }[]
        >).then((rows) => rows.forEach((r) => hostByItemId.set(r.id, r.hostResidentId)))
      : Promise.resolve(),
    programSessionIds.length
      ? (db
          .prepare(
            `SELECT ps.id, p.vendor_id as vendorId FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE ps.id IN (${programSessionIds.map(() => "?").join(",")})`
          )
          .all(...programSessionIds) as Promise<{ id: string; vendorId: string }[]>
        ).then((rows) => rows.forEach((r) => vendorByItemId.set(r.id, r.vendorId)))
      : Promise.resolve(),
    clubSessionIds.length
      ? (db
          .prepare(`SELECT cs.id, cl.vendor_id as vendorId FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id WHERE cs.id IN (${clubSessionIds.map(() => "?").join(",")})`)
          .all(...clubSessionIds) as Promise<{ id: string; vendorId: string }[]>
        ).then((rows) => rows.forEach((r) => vendorByItemId.set(r.id, r.vendorId)))
      : Promise.resolve(),
  ]);

  return { hostByItemId, vendorByItemId };
}

export async function getNextBestParticipation(residentId: string | null, homeCounty: string | null, limit: number): Promise<DiscoverItem[]> {
  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setUTCDate(now.getUTCDate() + 7);

  const activities = await listScheduledActivities({ county: homeCounty ?? undefined, from: now, to: weekFromNow });
  const scored = await scoreActivities(activities, now, residentId, homeCounty);
  const { routines, circleActivityLabels, followedHostIds, followedVendorIds } = await personalBoostSignals(residentId);
  const { hostByItemId, vendorByItemId } = followedHostIds.size || followedVendorIds.size ? await ownerIdsFor(scored.map(({ item }) => item)) : { hostByItemId: new Map(), vendorByItemId: new Map() };

  const blended = scored.map(({ item, score }) => {
    let bonus = 0;
    const extraReasons: string[] = [];
    // Same UTC-noon-anchored day-of-week convention discover.ts's own
    // weekend bucketing above already uses, +1 to convert JS's 0=Sunday
    // convention to MySQL's DAYOFWEEK() 1=Sunday convention (routines.day_
    // of_week is written by getRoutineSuggestions() using DAYOFWEEK()).
    const itemDow = new Date(`${item.date}T12:00:00Z`).getUTCDay() + 1;
    for (const r of routines) {
      if (r.dayOfWeek === itemDow && item.title.toLowerCase().includes(r.activityLabel.toLowerCase())) {
        bonus += 150;
        extraReasons.push(`Fits your ${r.activityLabel} routine`);
        break;
      }
    }
    if (circleActivityLabels.has(item.title.toLowerCase())) {
      bonus += 100;
      extraReasons.push("From a Circle you're in");
    }
    const hostId = hostByItemId.get(item.id);
    const vendorId = vendorByItemId.get(item.id);
    if (hostId && followedHostIds.has(hostId)) {
      bonus += 120;
      extraReasons.push("Hosted by someone you follow");
    } else if (vendorId && followedVendorIds.has(vendorId)) {
      bonus += 120;
      extraReasons.push("From a provider you follow");
    }
    return { item: { ...item, matchReasons: [...item.matchReasons, ...extraReasons] }, score: score + bonus };
  });
  blended.sort((a, b) => b.score - a.score || a.item.time.localeCompare(b.item.time));
  return blended.slice(0, limit).map((b) => b.item);
}

discoverRouter.get("/next-best", async (req, res) => {
  const items = await getNextBestParticipation(req.resident?.id ?? null, req.resident?.homeCounty ?? null, 8);
  res.json(items);
});

// Local SEO landing pages (participation-intent plan Phase 3) — deterministic
// county+activity filtering (case-insensitive substring on title, same idiom
// participationIntents.ts's game-matching already uses), not the NLP-ish
// search.ts parser. Reuses listScheduledActivities/scoreActivities exactly
// like every other feed here — this is just a narrower, county-pinned front
// door onto the same underlying pool, not a new data source.
discoverRouter.get("/local/:county/:activity", async (req, res) => {
  const county = req.params.county;
  const activityQuery = req.params.activity.replace(/-/g, " ").trim();
  if (!activityQuery) return res.status(400).json({ error: "activity is required" });

  const now = new Date();
  const monthFromNow = new Date(now);
  monthFromNow.setUTCDate(now.getUTCDate() + 30);

  const activities = await listScheduledActivities({ county, from: now, to: monthFromNow });
  const matched = activities.filter((a) => a.title.toLowerCase().includes(activityQuery.toLowerCase()));

  const scored = await scoreActivities(matched, now, req.resident?.id ?? null, req.resident?.homeCounty ?? null);
  scored.sort((a, b) => b.score - a.score || a.item.time.localeCompare(b.item.time));

  res.json({ county, activityQuery, count: scored.length, items: scored.map((e) => e.item) });
});
