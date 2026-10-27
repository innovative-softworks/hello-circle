import type { ScheduledActivity } from "./db/queries.js";
import { haversineKm } from "./geo.js";

// Experience 3.0 — Plan My Day (owner decision D1). Chains real listings on
// one day into a realistic order. Deterministic. Travel between two stops is
// a *rough estimate*: straight-line distance × ROAD_FACTOR at a slow
// TRAVEL_KMH, plus BUFFER_MINUTES — and only between places whose
// coordinates are confirmed; anything without them can't be chained after
// another stop (it can still be a first stop with no origin given).
// Only listings with a stated length are used (no assumed durations).
// Nothing here books or reserves anything.

export const ROAD_FACTOR = 1.3;
export const TRAVEL_KMH = 20;
export const BUFFER_MINUTES = 15;
export const MAX_STOPS = 4;

export interface PlannerInput {
  /** "HH:MM" — the day's window. */
  startTime: string;
  endTime: string;
  /** Total for the day (per person); null = no limit. */
  maxPriceCents: number | null;
  origin: { lat: number; lng: number } | null;
  maxStops?: number;
}

export interface PlannedStop<T> {
  item: T;
  start: string;
  end: string;
  /** Minutes allowed to get here from the previous stop (or the start point); null when it's the first stop with no start point. */
  travelMinutes: number | null;
}

export interface DayPlan<T> {
  stops: PlannedStop<T>[];
  totalPriceCents: number;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hasConfirmedPlace(a: ScheduledActivity): boolean {
  return a.lat !== null && a.lng !== null && a.locationSource === "confirmed";
}

/** Rough minutes from a to b, or null when it can't honestly be estimated. */
export function travelEstimate(from: { lat: number; lng: number } | null, to: ScheduledActivity): number | null {
  if (!from || !hasConfirmedPlace(to)) return null;
  const km = haversineKm(from.lat, from.lng, to.lat!, to.lng!) * ROAD_FACTOR;
  return Math.ceil((km / TRAVEL_KMH) * 60) + BUFFER_MINUTES;
}

/** Best plan: the most stops that fit the window, budget and travel; ties go
 * to the higher summed rank, then the earlier finish. `rank` is the item's
 * position-independent score (higher is better). Never two stops from the
 * same listing. */
export function planDay<T extends ScheduledActivity>(candidates: T[], input: PlannerInput, rank: (item: T) => number): DayPlan<T> {
  const dayStart = toMinutes(input.startTime);
  const dayEnd = toMinutes(input.endTime);
  const maxStops = Math.min(MAX_STOPS, input.maxStops ?? MAX_STOPS);
  const items = candidates
    .filter((c) => c.durationKnown && (c.spotsLeft === null || c.spotsLeft > 0))
    .map((c) => ({ c, s: toMinutes(c.time), e: toMinutes(c.time) + c.durationMinutes }))
    .filter((x) => x.s >= dayStart && x.e <= dayEnd)
    .filter((x) => input.maxPriceCents === null || (x.c.priceCents ?? 0) <= input.maxPriceCents)
    .sort((a, b) => a.s - b.s || rank(b.c) - rank(a.c) || a.c.id.localeCompare(b.c.id));

  type Chain = { idx: number[]; count: number; score: number; price: number; listings: Set<string>; travel: (number | null)[] };
  const best: (Chain | null)[] = items.map(() => null);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const price = it.c.priceCents ?? 0;
    // Start a chain here: from the start point, if any.
    const firstTravel = input.origin ? travelEstimate(input.origin, it.c) : null;
    let chain: Chain | null = null;
    if (!input.origin || firstTravel !== null) {
      if (!input.origin || it.s >= dayStart + (firstTravel ?? 0)) {
        chain = { idx: [i], count: 1, score: rank(it.c), price, listings: new Set([`${it.c.listingType}:${it.c.listingId ?? it.c.id}`]), travel: [firstTravel] };
      }
    }
    for (let j = 0; j < i; j++) {
      const prev = best[j];
      if (!prev || prev.count >= maxStops) continue;
      const p = items[j];
      const key = `${it.c.listingType}:${it.c.listingId ?? it.c.id}`;
      if (prev.listings.has(key)) continue;
      if (input.maxPriceCents !== null && prev.price + price > input.maxPriceCents) continue;
      const from = hasConfirmedPlace(p.c) ? { lat: p.c.lat!, lng: p.c.lng! } : null;
      const travel = travelEstimate(from, it.c);
      if (travel === null || it.s < p.e + travel) continue;
      const candidate: Chain = { idx: [...prev.idx, i], count: prev.count + 1, score: prev.score + rank(it.c), price: prev.price + price, listings: new Set([...prev.listings, key]), travel: [...prev.travel, travel] };
      if (!chain || candidate.count > chain.count || (candidate.count === chain.count && candidate.score > chain.score)) chain = candidate;
    }
    best[i] = chain;
  }
  let winner: Chain | null = null;
  for (let i = 0; i < best.length; i++) {
    const c = best[i];
    if (!c) continue;
    const end = items[c.idx[c.idx.length - 1]].e;
    const wEnd = winner ? items[winner.idx[winner.idx.length - 1]].e : Infinity;
    if (!winner || c.count > winner.count || (c.count === winner.count && (c.score > winner.score || (c.score === winner.score && end < wEnd)))) winner = c;
  }
  if (!winner) return { stops: [], totalPriceCents: 0 };
  return {
    stops: winner.idx.map((k, n) => ({ item: items[k].c, start: fromMinutes(items[k].s), end: fromMinutes(items[k].e), travelMinutes: winner!.travel[n] })),
    totalPriceCents: winner.price,
  };
}
