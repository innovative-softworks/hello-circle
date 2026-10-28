import { Router } from "express";
import { myLifePlansRouter } from "./myLifePlans.js";
import { db } from "./db/index.js";
import { listScheduledActivities, type ScheduledActivity } from "./db/queries.js";
import { featureOn, requireFeature } from "./circleFeatures.js";
import { irelandTodayIso } from "./irelandTime.js";
import { notifyResident } from "./notifications.js";
import { requireResident } from "./residents.js";
import { dayOfWeekOf, routineMatches, unseen, validDismissKey } from "./myLifeRules.js";

// My Life 3.0 (owner 2026-10-25, docs/my-life-3/). Read-only signals for the
// My Life page (saved-item availability, routine matches), dismissals that
// follow the resident across devices (D4), and the opt-in alerts sweep (D5).
// Nothing here books, holds or charges anything, and nothing names another
// person.

export const myLifeRouter = Router();
// Trust & Retention — "Your next plan" (GET /plans); signed-in or guest (client id).
myLifeRouter.use(myLifePlansRouter);

type Fav = { listingType: string; listingId: string; createdAt: string };
type Routine = { id: string; activityLabel: string; dayOfWeek: number; time: string };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function upcomingActivities(days: number): Promise<ScheduledActivity[]> {
  const now = new Date();
  return listScheduledActivities({ from: now, to: new Date(now.getTime() + days * 86400000), includeExperiences: true });
}

/** Upcoming public, open Sessions at a saved venue. */
async function centreSessions(centreId: string, today: string) {
  return (await db
    .prepare(
      `SELECT id, activity_label as title, date, time FROM games
       WHERE centre_id = ? AND date >= ? AND status IN ('open', 'pending_participants') AND visibility = 'public'
       ORDER BY date, time LIMIT 20`
    )
    .all(centreId, today)) as { id: string; title: string; date: string; time: string }[];
}

type SavedSession = { id: string; title: string; date: string; time: string; href: string };

/** Upcoming sessions for one saved item, from data the app already has. */
async function sessionsForSaved(f: Fav, acts: ScheduledActivity[], today: string): Promise<SavedSession[]> {
  if (f.listingType === "centre") {
    return (await centreSessions(f.listingId, today)).map((g) => ({ ...g, href: `/games/${g.id}` }));
  }
  if (f.listingType === "game") {
    return acts.filter((a) => a.kind === "game" && a.id === f.listingId).map((a) => ({ id: a.id, title: a.title, date: a.date, time: a.time, href: a.href }));
  }
  if (["program", "club", "experience"].includes(f.listingType)) {
    return acts
      .filter((a) => a.listingType === f.listingType && a.listingId === f.listingId)
      .map((a) => ({ id: a.id, title: a.title, date: a.date, time: a.time, href: a.href }));
  }
  return [];
}

async function savedFor(residentId: string): Promise<Fav[]> {
  return (await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId, created_at as createdAt FROM favourites WHERE resident_id = ? ORDER BY created_at DESC LIMIT 40`)
    .all(residentId)) as Fav[];
}

async function routinesFor(residentId: string): Promise<Routine[]> {
  return (await db
    .prepare(`SELECT id, activity_label as activityLabel, day_of_week as dayOfWeek, time FROM routines WHERE resident_id = ? AND status = 'active'`)
    .all(residentId)) as Routine[];
}

// GET /api/my-life/signals — what's open for things you saved, and sessions
// that fit your routines (next 14 days). Read-only.
myLifeRouter.get("/signals", requireResident, requireFeature("mylife.pulse"), async (req, res) => {
  const rid = req.resident!.id;
  const today = irelandTodayIso();
  const acts = await upcomingActivities(30);
  const saved = [];
  for (const f of await savedFor(rid)) {
    const sessions = await sessionsForSaved(f, acts, today);
    if (sessions.length === 0) continue;
    const spotsLeft = f.listingType === "game" ? acts.find((a) => a.kind === "game" && a.id === f.listingId)?.spotsLeft ?? null : null;
    saved.push({ listingType: f.listingType, listingId: f.listingId, upcoming: sessions.length, next: sessions[0], spotsLeft });
  }
  const sessions = acts.map((a) => ({ id: a.id, title: a.title, date: a.date, time: a.time, href: a.href }));
  const routines = (await routinesFor(rid))
    .map((r) => ({ routineId: r.id, activityLabel: r.activityLabel, dayOfWeek: r.dayOfWeek, matches: routineMatches(r, sessions, today, addDays(today, 14)) }))
    .filter((r) => r.matches.length > 0);
  res.json({ saved, routines });
});

// Dismissals (D4): a Pulse item or a suggestion the resident hid.
myLifeRouter.get("/dismissals", requireResident, async (req, res) => {
  const rows = (await db.prepare(`SELECT item_key as k FROM mylife_dismissals WHERE resident_id = ? ORDER BY created_at DESC LIMIT 500`).all(req.resident!.id)) as { k: string }[];
  res.json({ keys: rows.map((r) => r.k) });
});

myLifeRouter.post("/dismissals", requireResident, async (req, res) => {
  const key = (req.body as { key?: unknown }).key;
  if (!validDismissKey(key)) return res.status(400).json({ error: "That can't be hidden." });
  await db.prepare(`INSERT IGNORE INTO mylife_dismissals (resident_id, item_key) VALUES (?, ?)`).run(req.resident!.id, key);
  res.status(201).json({ ok: true });
});

myLifeRouter.delete("/dismissals/:key", requireResident, async (req, res) => {
  if (!validDismissKey(req.params.key)) return res.status(400).json({ error: "That can't be shown again." });
  await db.prepare(`DELETE FROM mylife_dismissals WHERE resident_id = ? AND item_key = ?`).run(req.resident!.id, req.params.key);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- alerts (D5)

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
const irelandHour = () => Number(new Intl.DateTimeFormat("en-IE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Dublin" }).format(new Date()));
const MAX_PER_SWEEP = 3;

/** Opt-in only: a resident gets nothing unless they turned the setting on
 * (notification_prefs.savedAvailability / routineAlerts === true; the older
 * routineReminders key defaulted to on, so it is never read here) and the
 * mylife.alerts switch is on. The first sweep after opting in only records
 * what already exists, so nobody is told about old sessions. In-app only. */
export async function sweepMyLifeAlerts(): Promise<number> {
  if (!(await featureOn("mylife.alerts"))) return 0;
  const residents = (await db
    .prepare(`SELECT id, notification_prefs as prefs FROM residents WHERE notification_prefs LIKE '%"savedAvailability":true%' OR notification_prefs LIKE '%"routineAlerts":true%'`)
    .all()) as { id: string; prefs: string | null }[];
  if (residents.length === 0) return 0;

  const today = irelandTodayIso();
  const tomorrow = addDays(today, 1);
  const acts = await upcomingActivities(30);
  const sessions = acts.map((a) => ({ id: a.id, title: a.title, date: a.date, time: a.time, href: a.href }));
  let sent = 0;

  for (const r of residents) {
    let prefs: Record<string, unknown> = {};
    try {
      prefs = r.prefs ? JSON.parse(r.prefs) : {};
    } catch {
      continue;
    }
    const seenRows = (await db.prepare(`SELECT alert_key as k FROM mylife_alerts_seen WHERE resident_id = ?`).all(r.id)) as { k: string }[];
    const seen = new Set(seenRows.map((x) => x.k));
    const mark = (key: string, notified: boolean) =>
      db.prepare(`INSERT IGNORE INTO mylife_alerts_seen (resident_id, alert_key, notified) VALUES (?, ?, ?)`).run(r.id, key, notified ? 1 : 0);
    let budget = MAX_PER_SWEEP;

    if (prefs.savedAvailability === true) {
      const baseline = !seen.has("baseline:saved");
      for (const f of await savedFor(r.id)) {
        if (f.listingType === "circle") continue;
        const list = await sessionsForSaved(f, acts, today);
        const keys = unseen(list.map((s) => `s:${f.listingType}:${f.listingId}:${s.id}`), seen);
        if (keys.length === 0) continue;
        if (baseline || budget <= 0) {
          for (const k of keys) await mark(k, false);
          continue;
        }
        const first = list.find((s) => keys.includes(`s:${f.listingType}:${f.listingId}:${s.id}`))!;
        await notifyResident({
          residentId: r.id,
          kind: "mylife",
          title: keys.length === 1 ? `New session: ${first.title}` : `${keys.length} new sessions: ${first.title}`,
          body: `Something you saved has a session on ${dayLabel(first.date)} at ${first.time}. Nothing is booked until you choose to.`,
          listingType: (["centre", "club", "game", "experience", "program"].includes(f.listingType) ? f.listingType : "account") as "centre",
          listingId: f.listingId,
          ref: first.id,
        });
        for (const k of keys) await mark(k, true);
        budget -= 1;
        sent += 1;
      }
      if (baseline) await mark("baseline:saved", false);
    }

    // The evening before a routine day: "Tomorrow: 2 Badminton sessions fit your routine."
    if (prefs.routineAlerts === true && irelandHour() >= 17 && budget > 0) {
      for (const rt of await routinesFor(r.id)) {
        if (rt.dayOfWeek !== dayOfWeekOf(tomorrow)) continue;
        const key = `r:${rt.id}:${tomorrow}`;
        if (seen.has(key)) continue;
        const matches = routineMatches(rt, sessions, tomorrow, tomorrow);
        if (matches.length === 0) continue;
        await notifyResident({
          residentId: r.id,
          kind: "mylife",
          title: `Tomorrow: ${matches.length} ${rt.activityLabel} ${matches.length === 1 ? "session fits" : "sessions fit"} your routine`,
          body: `First one at ${matches[0].time}. Routines never book for you.`,
          listingType: "account",
          listingId: "routines",
          ref: matches[0].id,
        });
        await mark(key, true);
        sent += 1;
        if (--budget <= 0) break;
      }
    }
  }
  return sent;
}
