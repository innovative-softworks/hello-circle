import { db } from "./db/index.js";
import type { ScheduledActivity } from "./db/queries.js";
import { haversineKm } from "./geo.js";
import { getRecommendationWeights, type RecommendationWeights, type WeightKey } from "./recommendationWeights.js";

// Personalisation — deterministic, explainable "For You" scoring (Phase 12,
// rebuilt in the community participation upgrade's Release 4). No ML: seven
// signals the resident has actually told us (or that we can observe without
// profiling them), each weighted by recommendationWeights.ts and each
// producing a plain-language reason. A signal the resident hasn't given us
// anything for (say, no availability set) simply doesn't count for or
// against them — the fit score is earned ÷ possible, so a sparse profile
// isn't punished for being sparse.
//
// Everything a scoring pass needs is loaded ONCE per request
// (loadScoringContext), not once per activity — the previous version ran a
// residents query per item plus a familiarity query per game.

export type FitLabel = "Great fit" | "Good fit" | "Worth exploring";

export interface ResidentProfile {
  id: string;
  homeCounty: string | null;
  interests: string[];
  availability: Set<string>;
  goals: string[];
  prefSolo: boolean;
  prefBeginner: boolean;
  prefFirstTimer: boolean;
  prefFamily: boolean;
  prefGroupSize: string;
  prefBudget: string;
  home: { lat: number; lng: number } | null;
  radiusKm: number;
  circleIds: Set<string>;
}

export interface ScoringContext {
  profile: ResidentProfile | null;
  weights: RecommendationWeights;
  /** listing_attributes by `${listingType}:${listingId}`. */
  attributes: Map<string, string[]>;
  /** Games only — familiar co-participants by game id. */
  familiar: Map<string, number>;
}

export interface FitResult {
  /** Raw points earned (0–sum of weights), used as the ranking bonus. */
  earned: number;
  /** earned ÷ possible × 100, for the label. */
  score: number;
  label: FitLabel | null;
  reasons: string[];
}

const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

function slotOf(time: string): "morning" | "afternoon" | "evening" {
  const hour = Number(time.split(":")[0]);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function dayCode(date: string): string {
  return DAY_CODES[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

const ACTIVE_WORDS = ["badminton", "football", "soccer", "swim", "fitness", "yoga", "walk", "hike", "hiking", "run", "cycle", "cycling", "tennis", "padel", "basketball", "gym", "climb", "kayak", "surf", "dance", "pilates", "rugby", "hurling", "gaa"];
const LEARN_WORDS = ["class", "workshop", "lesson", "course", "learn", "beginners", "coaching", "school"];
const FAMILY_WORDS = ["kids", "family", "junior", "children", "toddler", "parent"];

function titleHas(activity: ScheduledActivity, words: string[]): boolean {
  const t = activity.title.toLowerCase();
  return words.some((w) => t.includes(w));
}

// Budget buckets (BUDGET_OPTIONS on the client): per-person ceilings.
const BUDGET_CEILING_CENTS: Record<string, number> = { free: 0, low: 1000, medium: 2500 };

/** The goal a given activity plausibly serves, with a reason phrased for it. */
function goalMatch(goal: string, a: ScheduledActivity, attrs: string[], interestsMatched: boolean): string | null {
  switch (goal) {
    case "Meet people":
      return attrs.some((x) => ["come_alone", "host_introduces", "first_timers_welcome"].includes(x)) || a.kind === "game" ? "A good way to meet people" : null;
    case "Get active":
      return titleHas(a, ACTIVE_WORDS) ? "Helps you get active" : null;
    case "Learn something":
      return a.kind === "program_session" || titleHas(a, LEARN_WORDS) ? "A chance to learn something" : null;
    case "Explore locally":
      return a.kind === "experience_session" && a.experienceKind !== "volunteer" ? "A way to explore locally" : null;
    case "Family activities":
      return attrs.includes("family_friendly") || titleHas(a, FAMILY_WORDS) ? "Good for families" : null;
    case "Volunteer":
      return a.experienceKind === "volunteer" || titleHas(a, ["volunteer", "clean-up", "cleanup"]) ? "A volunteering opportunity" : null;
    case "Find a regular group":
      return a.kind === "club_session" || a.kind === "program_session" || !!a.circleId ? "Runs regularly with the same group" : null;
    case "Try something new":
      return !interestsMatched && attrs.some((x) => ["beginner_friendly", "no_experience", "first_timers_welcome"].includes(x)) ? "Something new, and beginner friendly" : null;
    default:
      return null;
  }
}

/** Pure scoring — no I/O, so it's unit-testable and cheap per item. */
export function scoreFit(a: ScheduledActivity, ctx: ScoringContext): FitResult {
  const p = ctx.profile;
  if (!p) return { earned: 0, score: 0, label: null, reasons: [] };
  const w = ctx.weights;
  const attrs = (a.listingType && a.listingId && ctx.attributes.get(`${a.listingType}:${a.listingId}`)) || [];
  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];
  const add = (key: WeightKey, fraction: number, reason?: string) => {
    earned += w[key] * fraction;
    if (reason && fraction > 0) reasons.push(reason);
  };

  // Interest — "You're interested in photography".
  let interestsMatched = false;
  if (p.interests.length) {
    possible += w.interest;
    const title = a.title.toLowerCase();
    const hit = p.interests.find((i) => title.includes(i.toLowerCase()) || i.toLowerCase().includes(title));
    if (hit) {
      interestsMatched = true;
      add("interest", 1, `You're interested in ${hit.toLowerCase()}`);
    }
  }

  // Availability — "You're normally free Saturday mornings".
  if (p.availability.size) {
    possible += w.availability;
    const day = dayCode(a.date);
    const slot = slotOf(a.time);
    if (p.availability.has(`${day}:${slot}`)) add("availability", 1, `You're normally free ${DAY_NAMES[day]} ${slot}s`);
  }

  // Distance — "It's 2.1 km away" (only trusted coordinates), else county.
  const trusted = a.lat !== null && a.lng !== null && a.locationSource === "confirmed";
  if (p.home && trusted) {
    possible += w.distance;
    const km = haversineKm(p.home.lat, p.home.lng, a.lat!, a.lng!);
    if (km <= p.radiusKm) add("distance", Math.max(0.5, 1 - km / (p.radiusKm * 2)), `It's ${km < 10 ? km.toFixed(1) : Math.round(km)} km away`);
  } else if (p.homeCounty && a.county) {
    possible += w.distance;
    if (a.county.toLowerCase() === p.homeCounty.toLowerCase()) add("distance", 0.6, "In your home county");
  }

  // Community goal — "A good way to meet people".
  if (p.goals.length) {
    possible += w.goal;
    for (const g of p.goals) {
      const reason = goalMatch(g, a, attrs, interestsMatched);
      if (reason) {
        add("goal", 1, reason);
        break;
      }
    }
  }

  // Social comfort — the host's own claims matched against what the
  // resident asked for, plus people they've played with before.
  const wanted: { want: boolean; ok: boolean; reason: string }[] = [
    { want: p.prefSolo, ok: attrs.includes("come_alone"), reason: "People commonly come on their own" },
    { want: p.prefBeginner, ok: attrs.includes("beginner_friendly") || attrs.includes("no_experience"), reason: "It's beginner friendly" },
    { want: p.prefFirstTimer, ok: attrs.includes("first_timers_welcome"), reason: "First-timers are welcome" },
    { want: p.prefFamily, ok: attrs.includes("family_friendly"), reason: "It's family friendly" },
    { want: p.prefGroupSize === "small", ok: attrs.includes("small_group"), reason: "It's a small group" },
  ].filter((x) => x.want);
  const familiar = a.kind === "game" ? ctx.familiar.get(a.id) ?? 0 : 0;
  if (wanted.length || familiar) {
    possible += w.social;
    const matched = wanted.filter((x) => x.ok);
    let fraction = wanted.length ? matched.length / wanted.length : 0;
    matched.forEach((x) => reasons.push(x.reason));
    if (familiar) {
      fraction = Math.min(1, fraction + 0.5);
      reasons.push(`${familiar} ${familiar === 1 ? "person" : "people"} you've played with before`);
    }
    earned += w.social * fraction;
  }

  // Budget — only when the resident set one.
  const ceiling = BUDGET_CEILING_CENTS[p.prefBudget];
  if (ceiling !== undefined) {
    possible += w.budget;
    const price = a.priceCents ?? 0;
    if (price <= ceiling) add("budget", 1, price === 0 ? "It's free" : "Within your budget");
  }

  // Circle — something one of your Circles runs.
  if (p.circleIds.size) {
    possible += w.circle;
    if (a.circleId && p.circleIds.has(a.circleId)) add("circle", 1, "From one of your Circles");
  }

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const label: FitLabel | null = !reasons.length ? null : score >= 70 ? "Great fit" : score >= 45 ? "Good fit" : score >= 20 ? "Worth exploring" : null;
  return { earned, score, label, reasons };
}

function csv(v: string | null): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export async function loadResidentProfile(residentId: string, homeCounty: string | null): Promise<ResidentProfile | null> {
  const r = (await db
    .prepare(
      `SELECT interests, availability, goals, pref_solo_friendly, pref_beginner_friendly, pref_first_timer, pref_family, pref_group_size, pref_budget,
              home_lat, home_lng, search_radius_km
       FROM residents WHERE id = ?`
    )
    .get(residentId)) as
    | {
        interests: string | null; availability: string | null; goals: string | null; pref_solo_friendly: number; pref_beginner_friendly: number;
        pref_first_timer: number; pref_family: number; pref_group_size: string; pref_budget: string; home_lat: number | string | null; home_lng: number | string | null; search_radius_km: number;
      }
    | undefined;
  if (!r) return null;
  const circles = (await db.prepare(`SELECT circle_id FROM circle_members WHERE resident_id = ?`).all(residentId)) as { circle_id: string }[];
  return {
    id: residentId,
    homeCounty,
    interests: csv(r.interests),
    availability: new Set(csv(r.availability)),
    goals: csv(r.goals),
    prefSolo: !!r.pref_solo_friendly,
    prefBeginner: !!r.pref_beginner_friendly,
    prefFirstTimer: !!r.pref_first_timer,
    prefFamily: !!r.pref_family,
    prefGroupSize: r.pref_group_size,
    prefBudget: r.pref_budget,
    home: r.home_lat !== null && r.home_lng !== null ? { lat: Number(r.home_lat), lng: Number(r.home_lng) } : null,
    radiusKm: r.search_radius_km || 10,
    circleIds: new Set(circles.map((c) => c.circle_id)),
  };
}

async function loadAttributes(activities: ScheduledActivity[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const byType = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!a.listingType || !a.listingId) continue;
    if (!byType.has(a.listingType)) byType.set(a.listingType, new Set());
    byType.get(a.listingType)!.add(a.listingId);
  }
  for (const [type, ids] of byType) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rows = (await db
        .prepare(`SELECT listing_id, attr FROM listing_attributes WHERE listing_type = ? AND listing_id IN (${chunk.map(() => "?").join(", ")})`)
        .all(type, ...chunk)) as { listing_id: string; attr: string }[];
      for (const r of rows) {
        const key = `${type}:${r.listing_id}`;
        map.set(key, [...(map.get(key) ?? []), r.attr]);
      }
    }
  }
  return map;
}

/** Batched version of countFamiliarCoParticipants for a whole pool of games
 * (same rules: joined, not opted out, not blocked either way, shared an
 * earlier joined game with the viewer). */
async function loadFamiliar(residentId: string, gameIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!gameIds.length) return map;
  const rows = (await db
    .prepare(
      `SELECT gp_now.game_id, COUNT(DISTINCT gp_now.resident_id) as n
       FROM game_participants gp_now
       JOIN residents r ON r.id = gp_now.resident_id
       WHERE gp_now.game_id IN (${gameIds.map(() => "?").join(", ")}) AND gp_now.status = 'joined' AND gp_now.resident_id != ?
         AND r.hide_from_familiar_count = 0 AND r.deactivated_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocked_residents br
           WHERE (br.blocker_resident_id = ? AND br.blocked_resident_id = gp_now.resident_id)
              OR (br.blocker_resident_id = gp_now.resident_id AND br.blocked_resident_id = ?)
         )
         AND EXISTS (
           SELECT 1 FROM game_participants gp_before
           JOIN game_participants gp_me ON gp_me.game_id = gp_before.game_id AND gp_me.resident_id = ? AND gp_me.status = 'joined'
           WHERE gp_before.resident_id = gp_now.resident_id AND gp_before.status = 'joined' AND gp_before.game_id != gp_now.game_id
         )
       GROUP BY gp_now.game_id`
    )
    .all(...gameIds, residentId, residentId, residentId, residentId)) as { game_id: string; n: number | string }[];
  rows.forEach((r) => map.set(r.game_id, Number(r.n)));
  return map;
}

export async function loadScoringContext(activities: ScheduledActivity[], residentId: string | null, homeCounty: string | null): Promise<ScoringContext> {
  const weights = await getRecommendationWeights();
  if (!residentId) return { profile: null, weights, attributes: new Map(), familiar: new Map() };
  const [profile, attributes, familiar] = await Promise.all([
    loadResidentProfile(residentId, homeCounty),
    loadAttributes(activities),
    loadFamiliar(residentId, activities.filter((a) => a.kind === "game").map((a) => a.id)),
  ]);
  return { profile, weights, attributes, familiar };
}

/** Kept for any caller wanting one item — loads a context for just it. */
export async function personalizeActivity(activity: ScheduledActivity, residentId: string | null, homeCounty: string | null): Promise<{ bonus: number; reasons: string[] }> {
  const ctx = await loadScoringContext([activity], residentId, homeCounty);
  const fit = scoreFit(activity, ctx);
  return { bonus: fit.earned * RANK_BONUS_PER_POINT, reasons: fit.reasons };
}

/** How much one fit point is worth in discover.ts's rankScore (roughly the
 * old scale: a full interest match used to add 80). */
export const RANK_BONUS_PER_POINT = 3;
