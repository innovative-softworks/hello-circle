import { logEvent } from "./analytics.js";
import { db } from "./db/index.js";
import { interestRange, normalizeDemand } from "./demandNormalize.js";
import { notifyResident } from "./notifications.js";

// ParticipationIntent — the community request (participation-intent plan
// Phase 1, extended in the community participation upgrade's Release 6).
// Each participation_intents row is one person's interest; a *cluster* is
// every active row sharing cluster_key + county (demandNormalize.ts), so
// wording variants add up instead of fragmenting. Matching is
// trigger-based, run when new supply is published — this app has no
// cron/job queue.

/** Resident-backed active intents in one cluster before "enough people are
 * interested" fires, and before hosts see it as an opportunity. */
const NOTIFY_THRESHOLD = 3;
export const OPPORTUNITY_THRESHOLD = 3;
/** At most this many "a match for your request" notifications per resident
 * per week, however much matching supply appears (notification overload). */
const MATCH_NOTIFY_CAP_PER_WEEK = 3;

const ACTIVE = `status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`;

// --- supply matching --------------------------------------------------------

export interface Supply {
  kind: "game" | "program" | "experience" | "club";
  id: string;
  title: string;
  county: string | null;
  /** Shown in the notification body, e.g. "Sunday · 10:00". */
  when: string;
}

/** Whole-word/phrase match, so "art" doesn't match "Start-up networking". */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

async function underMatchCap(residentId: string): Promise<boolean> {
  const { n } = (await db
    .prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'intent_match' AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`)
    .get(residentId)) as { n: number | string };
  return Number(n) < MATCH_NOTIFY_CAP_PER_WEEK;
}

/** Called right after new supply goes live (a game created active, a
 * program published, an experience approved or given a new date, a club
 * session added). Every active intent in the same county whose cluster
 * matches the supply's own title flips to 'converted' and its
 * resident-backed owner is told once. An owner already at the weekly cap
 * keeps their intent active (so a later match can still reach them)
 * rather than silently converting it. Never throws — a failed match must
 * not fail publishing. */
export async function matchIntentsForSupply(supply: Supply) {
  try {
    if (!supply.county) return; // county-scoped requests need a county to match
    const supplyKey = normalizeDemand(supply.title).clusterKey;
    const title = supply.title.toLowerCase();
    if (!supplyKey) return;
    const intents = (await db
      .prepare(`SELECT id, resident_id as residentId, cluster_key as clusterKey FROM participation_intents WHERE ${ACTIVE} AND county = ?`)
      .all(supply.county)) as { id: string; residentId: string | null; clusterKey: string }[];

    for (const intent of intents) {
      const key = intent.clusterKey;
      // Same cluster, or the supply's title mentions the requested activity
      // ("Sunday Badminton Social" satisfies "badminton").
      if (!key || !(key === supplyKey || containsPhrase(title, key) || containsPhrase(supplyKey, key))) continue;
      if (intent.residentId && !(await underMatchCap(intent.residentId))) continue;

      const info = await db.prepare(`UPDATE participation_intents SET status = 'converted' WHERE id = ? AND status = 'active'`).run(intent.id);
      if (info.changes === 0) continue; // a concurrent publish already matched it

      if (intent.residentId) {
        await notifyResident({
          residentId: intent.residentId,
          kind: "intent_match",
          title: `Good news — ${supply.title} is now available`,
          body: `Matches what you asked for. ${supply.when}`,
          listingType: supply.kind === "club" ? "club" : supply.kind,
          listingId: supply.id,
          ref: supply.id,
        });
        void logEvent("match_notified", { residentId: intent.residentId, metadata: { intentId: intent.id, kind: supply.kind, id: supply.id } });
      }
    }
  } catch (e) {
    console.error("[participation-intents] supply match failed:", e);
  }
}

/** Kept for games.ts's existing call sites. */
export async function matchParticipationIntentsForGame(game: { id: string; activityLabel: string; centreId: string | null; date: string }) {
  let county: string | null = null;
  if (game.centreId) {
    const centre = (await db.prepare(`SELECT county FROM centres WHERE id = ?`).get(game.centreId)) as { county: string } | undefined;
    county = centre?.county ?? null;
  }
  await matchIntentsForSupply({ kind: "game", id: game.id, title: game.activityLabel, county, when: game.date });
}

// --- cluster threshold -------------------------------------------------------

/** Called right after an intent is upserted — if its cluster just crossed
 * NOTIFY_THRESHOLD resident-backed people, tell every one of them exactly
 * once (intent_cluster_notifications, INSERT IGNORE — see the note below).
 * The notification table's activity_label column holds the cluster key. */
export async function notifyIntentClusterIfThreshold(clusterKey: string, county: string, label: string) {
  try {
    const { n } = (await db
      .prepare(`SELECT COUNT(DISTINCT resident_id) as n FROM participation_intents WHERE ${ACTIVE} AND cluster_key = ? AND county = ? AND resident_id IS NOT NULL`)
      .get(clusterKey, county)) as { n: number | string };
    if (Number(n) < NOTIFY_THRESHOLD) return;

    // INSERT IGNORE, not ON DUPLICATE KEY UPDATE — verified against this
    // app's mysql2 pool that a self-referencing `ON DUPLICATE KEY UPDATE
    // col = col` still reports affectedRows=1, which defeated this guard.
    const info = await db.prepare(`INSERT IGNORE INTO intent_cluster_notifications (activity_label, county) VALUES (?, ?)`).run(clusterKey, county);
    if (info.changes !== 1) return;

    const rows = (await db
      .prepare(`SELECT DISTINCT resident_id as residentId FROM participation_intents WHERE ${ACTIVE} AND cluster_key = ? AND county = ? AND resident_id IS NOT NULL`)
      .all(clusterKey, county)) as { residentId: string }[];
    const ref = `${clusterKey}::${county}`;
    for (const row of rows) {
      await notifyResident({
        residentId: row.residentId,
        kind: "intent_match",
        title: `Enough people are interested in ${label}`,
        body: `${n} people${county ? ` near ${county}` : ""} want to do this — want to start a plan?`,
        listingType: "intent",
        listingId: ref,
        ref,
      });
    }
  } catch (e) {
    console.error("[participation-intents] cluster notify failed:", e);
  }
}

// --- host opportunities -------------------------------------------------------

export interface Opportunity {
  clusterKey: string;
  label: string;
  category: string;
  county: string;
  /** A range ("10+"), never an exact count or anyone's identity. */
  interested: string;
  preferredDays: string[];
  preferredTime: string | null;
  budget: { minCents: number | null; maxCents: number | null } | null;
  radiusKm: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  values.forEach((v) => v && counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v);
}

/** Clusters with enough resident-backed demand to be worth a host's time
 * (anonymous, device-only interest is excluded — it's too easy to inflate).
 * Aggregates only: counts as ranges, typical day/time/budget, never who. */
export async function getOpportunities(counties: string[] | null): Promise<Opportunity[]> {
  const rows = (await db
    .prepare(
      `SELECT cluster_key as clusterKey, county, category, activity_label as activityLabel, resident_id as residentId, preferred_days as preferredDays,
              preferred_time_window as timeWindow, budget_min_cents as budgetMin, budget_max_cents as budgetMax, radius_km as radiusKm
       FROM participation_intents
       WHERE ${ACTIVE} AND resident_id IS NOT NULL AND cluster_key != '' ${counties?.length ? `AND county IN (${counties.map(() => "?").join(", ")})` : ""}`
    )
    .all(...(counties ?? []))) as {
    clusterKey: string; county: string; category: string; activityLabel: string; residentId: string; preferredDays: string;
    timeWindow: string; budgetMin: number | null; budgetMax: number | null; radiusKm: number | null;
  }[];

  const clusters = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.clusterKey}::${r.county}`;
    clusters.set(k, [...(clusters.get(k) ?? []), r]);
  }
  const out: (Opportunity & { n: number })[] = [];
  for (const group of clusters.values()) {
    const people = new Set(group.map((g) => g.residentId)).size;
    if (people < OPPORTUNITY_THRESHOLD) continue;
    const first = group[0];
    const times = group.map((g) => normalizeDemand(g.timeWindow).time || (["morning", "afternoon", "evening"].includes(g.timeWindow) ? g.timeWindow : ""));
    const mins = group.map((g) => g.budgetMin).filter((v): v is number => v !== null);
    const maxs = group.map((g) => g.budgetMax).filter((v): v is number => v !== null);
    const radii = group.map((g) => g.radiusKm).filter((v): v is number => v !== null);
    out.push({
      n: people,
      clusterKey: first.clusterKey,
      label: normalizeDemand(first.clusterKey).label || first.activityLabel,
      category: first.category,
      county: first.county,
      interested: interestRange(people),
      preferredDays: topValues(group.flatMap((g) => g.preferredDays.split(",")), 2),
      preferredTime: topValues(times, 1)[0] ?? null,
      budget: mins.length || maxs.length ? { minCents: median(mins), maxCents: median(maxs) } : null,
      radiusKm: median(radii),
    });
  }
  return out.sort((a, b) => b.n - a.n).map(({ n: _n, ...o }) => o);
}

// --- supply hooks for vendor listing types (Release 6) ------------------------
// Small loaders so each publishing route only has to pass an id.

export async function matchProgramSupply(programId: string) {
  const p = (await db
    .prepare(
      `SELECT p.id, p.title, p.category, COALESCE(c.county, cl.county) as county,
              (SELECT CONCAT(ps.date, ' · ', ps.time) FROM program_sessions ps WHERE ps.program_id = p.id AND ps.status != 'cancelled' AND ps.date >= CURDATE() ORDER BY ps.date, ps.time LIMIT 1) as nextWhen
       FROM programs p
       LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
       LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
       WHERE p.id = ? AND p.status = 'published'`
    )
    .get(programId)) as { id: string; title: string; category: string; county: string | null; nextWhen: string | null } | undefined;
  if (!p) return;
  // A program's title is often specific ("Tuesday Beginners Badminton");
  // its category is the cleaner activity signal when set.
  await matchIntentsForSupply({ kind: "program", id: p.id, title: p.category ? `${p.category} ${p.title}` : p.title, county: p.county, when: p.nextWhen ?? "" });
}

export async function matchExperienceSupply(experienceId: string) {
  const e = (await db
    .prepare(
      `SELECT e.id, e.title, e.county,
              (SELECT CONCAT(es.date, ' · ', es.time) FROM experience_sessions es WHERE es.experience_id = e.id AND es.status = 'scheduled' AND es.date >= CURDATE() ORDER BY es.date, es.time LIMIT 1) as nextWhen
       FROM experiences e WHERE e.id = ? AND e.status = 'approved'`
    )
    .get(experienceId)) as { id: string; title: string; county: string; nextWhen: string | null } | undefined;
  if (!e || !e.nextWhen) return; // nothing bookable yet — match once a date exists
  await matchIntentsForSupply({ kind: "experience", id: e.id, title: e.title, county: e.county, when: e.nextWhen });
}

export async function matchClubSessionSupply(clubId: string, sessionLabel: string, when: string) {
  const c = (await db.prepare(`SELECT id, name, sport, county FROM clubs WHERE id = ? AND status = 'approved'`).get(clubId)) as
    | { id: string; name: string; sport: string; county: string }
    | undefined;
  if (!c) return;
  await matchIntentsForSupply({ kind: "club", id: c.id, title: `${c.sport} ${sessionLabel || c.name}`, county: c.county, when });
}
