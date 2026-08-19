import { Router } from "express";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { listScheduledActivities, type ScheduledActivity } from "../db/queries.js";

export const discoverRouter = Router();

// "Happening today" / "This weekend" homepage feeds (Phase 5 gap) — the
// first platform-wide aggregate across the three scheduled-activity
// sources (games, program_sessions, club_sessions). The actual fetch/join/
// status-filter logic lives in db/queries.ts's listScheduledActivities
// (shared with routes/search.ts's Phase 6 search) — this file only owns
// ranking + today/weekend bucketing. Deliberately read-only and public — no
// capacity/checkout logic here, just "what's on."

export type DiscoverItem = ScheduledActivity;

export interface DiscoverFeed {
  today: DiscoverItem[];
  weekend: DiscoverItem[];
}

/** Ranking, not just chronological sort — deliberately rule-based (no ML,
 * same "start simple" spirit as searchParser.ts elsewhere in this
 * codebase; personalization/ML-backed ranking is Phase 18+ in the
 * roadmap, well past where this app is). Four signals, in priority order:
 *   1. Live beats everything — something happening right now is the most
 *      compelling thing to surface first, full stop.
 *   2. Starting soon beats starting later — decays smoothly rather than a
 *      hard cutoff, so "in 20 minutes" clearly outranks "in 6 hours".
 *   3. Filling up (games only, real capacity/joined data) signals real
 *      demand — genuine social proof, not urgency theatre, since it's
 *      backed by actual joins.
 *   4. Small, deliberately minor boosts for free (lower friction to act
 *      on) and for having a real photo (more compelling in a photo-driven
 *      feed) — tie-breakers, not primary signals.
 * `minutesUntilStart` is negative once a (non-live, already-ended) item
 * has passed — those still sort last naturally since every term is >= 0. */
function rankScore(params: { isLive: boolean; minutesUntilStart: number; fillRatio: number | null; isFree: boolean; hasPhoto: boolean }): number {
  let score = 0;
  if (params.isLive) score += 1000;
  else score += Math.max(0, 300 - Math.max(0, params.minutesUntilStart) / 10);
  if (params.fillRatio !== null && params.fillRatio >= 0.5) score += params.fillRatio * 100;
  if (params.isFree) score += 20;
  if (params.hasPhoto) score += 10;
  return score;
}

discoverRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" && req.query.county !== "All" ? req.query.county : undefined;
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekFromNow = new Date(now);
  weekFromNow.setUTCDate(now.getUTCDate() + 7);
  const weekFromNowIso = weekFromNow.toISOString().slice(0, 10);

  const activities = await listScheduledActivities({ county, from: now, to: weekFromNow });

  const minutesUntil = (date: string, time: string): number => {
    const [hour, minute] = time.split(":").map(Number);
    return (irelandWallTimeToUtc(date, hour, minute).getTime() - now.getTime()) / 60000;
  };

  const scored = activities.map((item) => ({
    item,
    score: rankScore({
      isLive: item.isLive,
      minutesUntilStart: minutesUntil(item.date, item.time),
      fillRatio: item.kind === "game" && item.joined !== null && item.spotsLeft !== null && item.joined + item.spotsLeft > 0 ? item.joined / (item.joined + item.spotsLeft) : null,
      isFree: !item.priceCents,
      hasPhoto: !!item.imageUrl,
    }),
  }));

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
