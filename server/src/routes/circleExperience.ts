import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { writeAudit } from "../audit.js";
import { logEvent } from "../analytics.js";
import { circleFeatureOn, requireCircleFeature } from "../circleFeatures.js";
import {
  MATCH_MIN_GROUP,
  PULSE_NOTE_MAX_LENGTH,
  aggregatePulse,
  cleanInterestLabel,
  cleanSlots,
  freeDays,
  isSelectableWeek,
  matchFreeTime,
  normaliseInterest,
  parseSlots,
  planStage,
  selectableWeeks,
  weekExpiry,
  type AvailabilityRow,
  type PulseRow,
} from "../circlePlanning.js";
import { deletePoll, removeWishGroup } from "../circleModeration.js";
import { db } from "../db/index.js";
import { filterViewable, GAME_VISIBILITY_COLUMNS } from "../gameVisibility.js";
import { irelandTodayIso } from "../irelandTime.js";
import { objectKeyFromUrlForEntity } from "../media/mediaService.js";
import { notifyResident } from "../notifications.js";
import { simpleRateLimit } from "../rateLimit.js";
import { requireResident } from "../residents.js";
import { isOrganiser } from "./circleHelpers.js";

// Circle Experience 2.0 (docs/circle-experience-2-audit.md) — the new Circle
// capabilities, kept out of circles.ts so that file doesn't keep growing.
// Mounted on the same /api/circles prefix. Every feature route is behind its
// circles.* switch (404 when off) and every route checks membership on the
// server. Nothing here creates a booking, an activity or a payment: a plan
// only becomes real through POST /api/games (games.ts), unchanged.
//
// Privacy rules, the same everywhere below:
//   - Pulse, free time and plan interest are members-only in every join mode.
//   - Only totals leave the server, with minimum group sizes
//     (circlePlanning.ts). Nobody's individual wish or free time is listed.
//   - Memories are members-only in every join mode (owner decision D4).

export const circleExperienceRouter = Router();

interface CircleBasics {
  id: string;
  name: string;
  status: string;
  join_mode: string;
  activity_label: string;
  values: string | null;
  who_can_join: string | null;
}

async function loadCircle(idOrSlug: string): Promise<CircleBasics | undefined> {
  return (await db
    .prepare(`SELECT id, name, status, join_mode, activity_label, circle_values as \`values\`, who_can_join FROM circles WHERE id = ? OR slug = ?`)
    .get(idOrSlug, idOrSlug)) as CircleBasics | undefined;
}

async function roleOf(circleId: string, residentId: string): Promise<"member" | "organiser" | null> {
  const row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId)) as { role: string } | undefined;
  return row ? (row.role === "organiser" ? "organiser" : "member") : null;
}

/** Loads the Circle and checks the caller is a member. Sends the error and
 * returns null otherwise. `write` also refuses a closed Circle. */
async function memberCircle(req: Request, res: Response, opts: { write?: boolean } = {}): Promise<{ circle: CircleBasics; role: "member" | "organiser" } | null> {
  const circle = await loadCircle(req.params.id);
  if (!circle) {
    res.status(404).json({ error: "Circle not found" });
    return null;
  }
  const role = await roleOf(circle.id, req.resident!.id);
  if (!role) {
    res.status(403).json({ error: "Only members of this Circle can do this" });
    return null;
  }
  if (opts.write && circle.status === "closed") {
    res.status(409).json({ error: "This Circle is closed" });
    return null;
  }
  return { circle, role };
}

async function organiserIds(circleId: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT resident_id as id FROM circle_members WHERE circle_id = ? AND role = 'organiser'`).all(circleId)) as { id: string }[];
  return rows.map((r) => r.id);
}

// --- Shared with circles.ts ------------------------------------------------

/** D5 — removed by an organiser and not yet lifted. */
export async function isRestricted(circleId: string, residentId: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 FROM circle_restrictions WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId));
}

/** Leaving or being removed takes a member's Pulse, shared free time and
 * "I'm in"s with them. Memories they added stay until they remove them. */
export async function clearCircleParticipation(circleId: string, residentId: string): Promise<void> {
  await db.prepare(`DELETE FROM circle_pulses WHERE circle_id = ? AND resident_id = ?`).run(circleId, residentId);
  await db.prepare(`DELETE FROM circle_availability WHERE circle_id = ? AND resident_id = ?`).run(circleId, residentId);
  await db
    .prepare(`DELETE cpi FROM circle_plan_interest cpi JOIN circle_plans cp ON cp.id = cpi.plan_id WHERE cp.circle_id = ? AND cpi.resident_id = ? AND cp.status IN ('idea', 'confirmed')`)
    .run(circleId, residentId);
}

const writeLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

// --- D5: restrictions (organisers) -----------------------------------------

circleExperienceRouter.get("/:id/restrictions", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!(await isOrganiser(circle.id, req.resident!.id))) return res.status(403).json({ error: "Only an organiser can see this" });
  const rows = await db
    .prepare(
      `SELECT cr.resident_id as residentId, COALESCE(NULLIF(r.name, ''), 'A former member') as name, cr.reason, cr.created_at as createdAt,
              COALESCE(NULLIF(o.name, ''), 'An organiser') as restrictedByName
       FROM circle_restrictions cr LEFT JOIN residents r ON r.id = cr.resident_id LEFT JOIN residents o ON o.id = cr.restricted_by
       WHERE cr.circle_id = ? ORDER BY cr.created_at DESC`
    )
    .all(circle.id);
  res.json(rows);
});

circleExperienceRouter.post("/:id/restrictions/:residentId/lift", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!(await isOrganiser(circle.id, req.resident!.id))) return res.status(403).json({ error: "Only an organiser can do this" });
  const r = await db.prepare(`DELETE FROM circle_restrictions WHERE circle_id = ? AND resident_id = ?`).run(circle.id, req.params.residentId);
  if (r.changes !== 1) return res.status(404).json({ error: "That person isn't restricted here" });
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "circle.restriction_lifted", objectType: "circle", objectId: circle.id, newValue: { residentId: req.params.residentId } });
  res.json({ ok: true });
});

// --- Organiser removals (owner, 2026-10-24) ------------------------------------
// A wish row is a total, so an organiser removes it as a whole (every member's
// wish for that interest that week); the people who added it are told,
// without naming who removed it. Polls can be deleted outright. Both audited.

circleExperienceRouter.delete("/:id/pulse-groups/:weekStart/:interestKey", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!(await isOrganiser(circle.id, req.resident!.id))) return res.status(403).json({ error: "Only an organiser can remove a wish" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
  const n = await removeWishGroup(circle.id, req.params.weekStart, req.params.interestKey, { kind: "organiser", residentId: req.resident!.id }, reason || undefined);
  if (n === 0) return res.status(404).json({ error: "That wish has already gone" });
  res.json({ ok: true, removed: n });
});

circleExperienceRouter.delete("/:id/polls/:pollId", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!(await isOrganiser(circle.id, req.resident!.id))) return res.status(403).json({ error: "Only an organiser can delete a poll" });
  if (!(await deletePoll(circle.id, req.params.pollId, { kind: "organiser", residentId: req.resident!.id }))) return res.status(404).json({ error: "Poll not found" });
  res.json({ ok: true });
});

// --- First-Time Friendly ---------------------------------------------------

circleExperienceRouter.post("/:id/welcome/dismiss", requireResident, requireCircleFeature("circles.first_time_friendly"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  await db.prepare(`UPDATE circle_members SET welcomed_at = NOW() WHERE circle_id = ? AND resident_id = ? AND welcomed_at IS NULL`).run(ctx.circle.id, req.resident!.id);
  res.json({ ok: true });
});

/** What to expect at this Circle's next activity the viewer can see. Built
 * only from what the organiser actually entered — nothing is made up. */
circleExperienceRouter.get("/:id/first-time", requireCircleFeature("circles.first_time_friendly"), async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const viewerId = req.resident?.id ?? null;
  const role = viewerId ? await roleOf(circle.id, viewerId) : null;
  if (circle.join_mode !== "open" && !role) return res.status(403).json({ error: "Only circle members can view this" });

  const rows = (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.duration_minutes as durationMinutes, g.location_text as locationText,
              c.name as centreName, g.meeting_instructions as meetingInstructions, g.equipment_needed as equipmentNeeded,
              g.experience_required as experienceRequired, g.solo_friendly as soloFriendly, g.accessibility_info as accessibilityInfo,
              r.name as hostName, ${GAME_VISIBILITY_COLUMNS("g")}
       FROM games g LEFT JOIN centres c ON c.id = g.centre_id LEFT JOIN residents r ON r.id = g.host_resident_id
       WHERE g.circle_id = ? AND g.status IN ('open', 'pending_participants') AND g.date >= ?
       ORDER BY g.date, g.time LIMIT 5`
    )
    .all(circle.id, irelandTodayIso())) as Record<string, unknown>[];
  const [next] = await filterViewable(rows, viewerId);
  res.json({
    guidelines: { values: circle.values || null, whoCanJoin: circle.who_can_join || null },
    nextActivity: next
      ? {
          id: next.id,
          activityLabel: next.activityLabel,
          date: next.date,
          time: next.time,
          durationMinutes: next.durationMinutes ?? null,
          where: (next.centreName as string | null) || (next.locationText as string | null) || null,
          meetingInstructions: next.meetingInstructions || null,
          equipmentNeeded: next.equipmentNeeded || null,
          experienceRequired: next.experienceRequired || null,
          soloFriendly: !!next.soloFriendly,
          accessibilityInfo: next.accessibilityInfo || null,
          organiserName: next.hostName || null,
        }
      : null,
  });
});

// --- Circle Pulse ----------------------------------------------------------

const MAX_ACTIVE_PULSES = 5;

interface PulseDbRow {
  id: string;
  resident_id: string;
  interest: string;
  interest_key: string;
  week_start: string;
  slots: string;
  note: string | null;
}

async function activePulseRows(circleId: string): Promise<PulseDbRow[]> {
  return (await db
    .prepare(`SELECT id, resident_id, interest, interest_key, week_start, slots, note FROM circle_pulses WHERE circle_id = ? AND expires_at > NOW() ORDER BY created_at`)
    .all(circleId)) as PulseDbRow[];
}

const toPulseRow = (r: PulseDbRow): PulseRow => ({ residentId: r.resident_id, interest: r.interest, interestKey: r.interest_key, weekStart: r.week_start, slots: parseSlots(r.slots) });

circleExperienceRouter.get("/:id/pulse", requireResident, requireCircleFeature("circles.pulse"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const { circle, role } = ctx;
  // Retention: a Pulse is about one week. Expired rows are kept 30 days
  // (so "what did we want last week" can still turn into a plan), then go.
  await db.prepare(`DELETE FROM circle_pulses WHERE circle_id = ? AND expires_at < NOW() - INTERVAL 30 DAY`).run(circle.id);
  const rows = await activePulseRows(circle.id);
  const me = req.resident!.id;
  const groups = aggregatePulse(rows.map(toPulseRow), me);

  // Organisers also see the notes members left for them — without names,
  // and only on groups big enough to be visible at all.
  const notesByGroup = new Map<string, string[]>();
  if (role === "organiser") {
    for (const r of rows) if (r.note) notesByGroup.set(`${r.week_start}|${r.interest_key}`, [...(notesByGroup.get(`${r.week_start}|${r.interest_key}`) ?? []), r.note]);
  }
  const plans = (await db
    .prepare(`SELECT id, source_pulse_key as pulseKey, status FROM circle_plans WHERE circle_id = ? AND source_pulse_key IS NOT NULL AND status != 'cancelled'`)
    .all(circle.id)) as { id: string; pulseKey: string; status: string }[];
  const planByKey = new Map(plans.map((p) => [p.pulseKey, p]));

  res.json({
    weeks: selectableWeeks(),
    groups: groups.map((g) => {
      const key = `${g.weekStart}|${g.interestKey}`;
      const plan = planByKey.get(key);
      return {
        ...g,
        key,
        status: plan ? (plan.status === "activity_created" ? "converted" : "proposed") : g.count !== null && g.count >= MATCH_MIN_GROUP ? "matched" : "active",
        planId: plan?.id ?? null,
        organiserNotes: role === "organiser" && g.count !== null ? notesByGroup.get(key) ?? [] : undefined,
      };
    }),
    mine: rows
      .filter((r) => r.resident_id === me)
      .map((r) => ({ id: r.id, interest: r.interest, weekStart: r.week_start, slots: parseSlots(r.slots), note: r.note })),
    suggestions: [...new Set([circle.activity_label, ...groups.filter((g) => g.count !== null).map((g) => g.interest)].filter(Boolean))].slice(0, 8),
    limits: { maxActive: MAX_ACTIVE_PULSES, noteMaxLength: PULSE_NOTE_MAX_LENGTH },
  });
});

/** Add or update ("I'm interested" / "Update my interest"). One row per
 * member per interest per week, so a repeat tap updates rather than counts twice. */
circleExperienceRouter.post("/:id/pulse", requireResident, requireCircleFeature("circles.pulse"), writeLimiter, async (req, res) => {
  const ctx = await memberCircle(req, res, { write: true });
  if (!ctx) return;
  const { circle } = ctx;
  const me = req.resident!.id;
  const b = req.body as { interest?: unknown; weekStart?: unknown; slots?: unknown; note?: unknown };
  const interest = cleanInterestLabel(b.interest);
  if (!interest) return res.status(400).json({ error: "Say what you'd like to do (2–60 characters)", field: "interest" });
  if (typeof b.weekStart !== "string" || !isSelectableWeek(b.weekStart)) return res.status(400).json({ error: "Choose this week or next week", field: "weekStart" });
  const slots = cleanSlots(b.slots, b.weekStart);
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > PULSE_NOTE_MAX_LENGTH) return res.status(400).json({ error: `Keep the note under ${PULSE_NOTE_MAX_LENGTH} characters`, field: "note" });
  const key = normaliseInterest(interest);

  const existing = (await db
    .prepare(`SELECT id FROM circle_pulses WHERE circle_id = ? AND resident_id = ? AND interest_key = ? AND week_start = ?`)
    .get(circle.id, me, key, b.weekStart)) as { id: string } | undefined;
  if (!existing) {
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_pulses WHERE circle_id = ? AND resident_id = ? AND expires_at > NOW()`).get(circle.id, me)) as { n: number };
    if (Number(n) >= MAX_ACTIVE_PULSES) return res.status(409).json({ error: `You can have up to ${MAX_ACTIVE_PULSES} interests at a time here. Withdraw one first.` });
  }
  const id = existing?.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO circle_pulses (id, circle_id, resident_id, interest, interest_key, week_start, slots, note, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE interest = VALUES(interest), slots = VALUES(slots), note = VALUES(note), expires_at = VALUES(expires_at)`
    )
    .run(id, circle.id, me, interest, key, b.weekStart, slots.join(","), note || null, weekExpiry(b.weekStart));
  void logEvent(existing ? "circle_pulse_updated" : "circle_pulse_added", { residentId: me, metadata: { circleId: circle.id } });

  // Once per interest per week: tell the organisers there's enough interest
  // to plan something. The notice row is the idempotency guard.
  const { n: people } = (await db
    .prepare(`SELECT COUNT(DISTINCT resident_id) as n FROM circle_pulses WHERE circle_id = ? AND interest_key = ? AND week_start = ? AND expires_at > NOW()`)
    .get(circle.id, key, b.weekStart)) as { n: number };
  if (Number(people) >= MATCH_MIN_GROUP) {
    const notice = await db.prepare(`INSERT IGNORE INTO circle_pulse_notices (circle_id, interest_key, week_start) VALUES (?, ?, ?)`).run(circle.id, key, b.weekStart);
    if (notice.changes === 1) {
      for (const organiserId of await organiserIds(circle.id)) {
        await notifyResident({
          residentId: organiserId,
          kind: "circle",
          title: `${Number(people)} members want to do ${interest}`,
          body: `In ${circle.name}. Suggest a plan from Circle Pulse.`,
          listingType: "circle",
          listingId: circle.id,
          ref: `pulse:${b.weekStart}|${key}`,
        });
      }
    }
  }
  res.status(existing ? 200 : 201).json({ id, updated: !!existing });
});

circleExperienceRouter.delete("/:id/pulse/:pulseId", requireResident, requireCircleFeature("circles.pulse"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const r = await db.prepare(`DELETE FROM circle_pulses WHERE id = ? AND circle_id = ? AND resident_id = ?`).run(req.params.pulseId, ctx.circle.id, req.resident!.id);
  if (r.changes !== 1) return res.status(404).json({ error: "That interest isn't there any more" });
  res.json({ ok: true });
});

// --- Free Time Match -------------------------------------------------------

// "Who's free" for the Circle Home planner (owner, 2026-10-24): members free
// each day this week and next, from shared free time and wish times. Totals
// only, from MATCH_MIN_GROUP up. Available while either source is switched on.
circleExperienceRouter.get("/:id/free-days", requireResident, async (req, res) => {
  const [pulseOn, freeOn] = await Promise.all([circleFeatureOn("circles.pulse"), circleFeatureOn("circles.free_time_match")]);
  if (!pulseOn && !freeOn) return res.status(404).json({ error: "Not found" });
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const availability = freeOn
    ? ((await db
        .prepare(`SELECT resident_id as residentId, week_start as weekStart, slots FROM circle_availability WHERE circle_id = ? AND expires_at > NOW()`)
        .all(ctx.circle.id)) as { residentId: string; weekStart: string; slots: string }[]).map((r): AvailabilityRow => ({ ...r, slots: parseSlots(r.slots) }))
    : [];
  const pulses = pulseOn ? (await activePulseRows(ctx.circle.id)).map(toPulseRow) : [];
  res.json({ days: freeDays(availability, pulses), minGroup: MATCH_MIN_GROUP });
});


circleExperienceRouter.get("/:id/free-time", requireResident, requireCircleFeature("circles.free_time_match"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const { circle } = ctx;
  const me = req.resident!.id;
  await db.prepare(`DELETE FROM circle_availability WHERE circle_id = ? AND expires_at < NOW()`).run(circle.id);
  const availability = ((await db
    .prepare(`SELECT resident_id as residentId, week_start as weekStart, slots FROM circle_availability WHERE circle_id = ? AND expires_at > NOW()`)
    .all(circle.id)) as { residentId: string; weekStart: string; slots: string }[]).map((r): AvailabilityRow => ({ ...r, slots: parseSlots(r.slots) }));
  // Interests only count towards a match while Circle Pulse is switched on.
  const pulses = (await circleFeatureOn("circles.pulse")) ? (await activePulseRows(circle.id)).map(toPulseRow) : [];
  const weeks = selectableWeeks();
  const sharing = (week: string) => availability.filter((a) => a.weekStart === week).length;
  res.json({
    weeks,
    mine: Object.fromEntries(weeks.map((w) => [w, availability.find((a) => a.weekStart === w && a.residentId === me)?.slots ?? null])),
    // How many have shared, only once that's enough not to point at anyone.
    sharedCount: Object.fromEntries(weeks.map((w) => [w, sharing(w) >= MATCH_MIN_GROUP ? sharing(w) : null])),
    matches: matchFreeTime(pulses, availability, me),
    minGroup: MATCH_MIN_GROUP,
  });
});

circleExperienceRouter.put("/:id/free-time/:weekStart", requireResident, requireCircleFeature("circles.free_time_match"), writeLimiter, async (req, res) => {
  const ctx = await memberCircle(req, res, { write: true });
  if (!ctx) return;
  const week = req.params.weekStart;
  if (!isSelectableWeek(week)) return res.status(400).json({ error: "Choose this week or next week" });
  const slots = cleanSlots((req.body as { slots?: unknown }).slots, week);
  if (slots.length === 0) {
    await db.prepare(`DELETE FROM circle_availability WHERE circle_id = ? AND resident_id = ? AND week_start = ?`).run(ctx.circle.id, req.resident!.id, week);
    return res.json({ ok: true, slots: [] });
  }
  await db
    .prepare(
      `INSERT INTO circle_availability (circle_id, resident_id, week_start, slots, expires_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE slots = VALUES(slots), expires_at = VALUES(expires_at)`
    )
    .run(ctx.circle.id, req.resident!.id, week, slots.join(","), weekExpiry(week));
  void logEvent("circle_free_time_shared", { residentId: req.resident!.id, metadata: { circleId: ctx.circle.id } });
  res.json({ ok: true, slots });
});

circleExperienceRouter.delete("/:id/free-time/:weekStart", requireResident, requireCircleFeature("circles.free_time_match"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  await db.prepare(`DELETE FROM circle_availability WHERE circle_id = ? AND resident_id = ? AND week_start = ?`).run(ctx.circle.id, req.resident!.id, req.params.weekStart);
  res.json({ ok: true });
});

// --- Make It Happen: "I'm in" on a plan idea --------------------------------

interface PlanInterestRow {
  id: string;
  circle_id: string;
  title: string;
  status: string;
  target_size: number | null;
  expires_at: string | null;
  ready_notified_at: string | null;
}

async function planFor(circleId: string, planId: string): Promise<PlanInterestRow | undefined> {
  return (await db
    // Circles 3.0 — a plan shared with this Circle counts here too.
    .prepare(`SELECT id, circle_id, title, status, target_size, expires_at, ready_notified_at FROM circle_plans WHERE id = ? AND (circle_id = ? OR partner_circle_id = ?)`)
    .get(planId, circleId, circleId)) as PlanInterestRow | undefined;
}

async function interestCount(planId: string): Promise<number> {
  const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_plan_interest WHERE plan_id = ?`).get(planId)) as { n: number };
  return Number(n);
}

circleExperienceRouter.post("/:id/plan-ideas/:planId/interest", requireResident, requireCircleFeature("circles.make_it_happen"), writeLimiter, async (req, res) => {
  const ctx = await memberCircle(req, res, { write: true });
  if (!ctx) return;
  const plan = await planFor(ctx.circle.id, req.params.planId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const stageNow = planStage({ status: plan.status, interestCount: 0, targetSize: plan.target_size, expiresAt: plan.expires_at });
  if (stageNow === "expired") return res.status(409).json({ error: "This suggestion has stopped gathering interest" });
  if (plan.status !== "idea" && plan.status !== "confirmed") return res.status(409).json({ error: "This plan isn't gathering interest any more" });

  await db.prepare(`INSERT IGNORE INTO circle_plan_interest (plan_id, resident_id) VALUES (?, ?)`).run(plan.id, req.resident!.id);
  const count = await interestCount(plan.id);
  // Once only: tell the organisers a suggestion is ready for them to review.
  if (plan.status === "idea" && planStage({ status: "idea", interestCount: count, targetSize: plan.target_size, expiresAt: plan.expires_at }) === "ready") {
    const flipped = await db.prepare(`UPDATE circle_plans SET ready_notified_at = NOW() WHERE id = ? AND ready_notified_at IS NULL`).run(plan.id);
    if (flipped.changes === 1) {
      // The plan's own (home) Circle reviews it, even when the click came from a partner Circle.
      const home = plan.circle_id === ctx.circle.id ? ctx.circle : ((await db.prepare(`SELECT id, name FROM circles WHERE id = ?`).get(plan.circle_id)) as { id: string; name: string });
      for (const organiserId of await organiserIds(home.id)) {
        await notifyResident({
          residentId: organiserId,
          kind: "circle",
          title: `Ready for review: ${plan.title}`,
          body: `${count} people are in. Review it in ${home.name}.`,
          listingType: "circle",
          listingId: home.id,
          ref: plan.id,
        });
      }
    }
  }
  res.json({ ok: true, interestCount: count, interestedByMe: true });
});

circleExperienceRouter.delete("/:id/plan-ideas/:planId/interest", requireResident, requireCircleFeature("circles.make_it_happen"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const plan = await planFor(ctx.circle.id, req.params.planId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "idea" && plan.status !== "confirmed") return res.status(409).json({ error: "This plan isn't gathering interest any more" });
  await db.prepare(`DELETE FROM circle_plan_interest WHERE plan_id = ? AND resident_id = ?`).run(plan.id, req.resident!.id);
  res.json({ ok: true, interestCount: await interestCount(plan.id), interestedByMe: false });
});

// --- Circle Memories -------------------------------------------------------

const MEMORY_DAILY_LIMIT = 10;
const MEMORY_WINDOW_DAYS = 180;

const LOCAL_MEMORY_FILE = /^\/api\/media\/circles\/([^/?]+)\/memory-file\?file=([A-Za-z0-9._-]+)$/;

/** A photo must be one uploaded for this Circle's memories (media.ts entity
 * "circle-memory"): a private local file or an object under its R2 prefix. */
export function memoryImageBelongs(circleId: string, url: string): boolean {
  const local = LOCAL_MEMORY_FILE.exec(url);
  if (local) return local[1] === circleId;
  try {
    return !!objectKeyFromUrlForEntity("circle-memory", circleId, url);
  } catch {
    return false;
  }
}

export function memoryDeliveryUrl(circleId: string, memoryId: string): string {
  return `/api/media/circles/${circleId}/memories/${memoryId}`;
}

/** Past Circle activities the viewer took part in — what they may add to. */
async function contributableActivities(circleId: string, residentId: string) {
  const today = irelandTodayIso();
  const since = new Date(Date.now() - MEMORY_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date FROM games g
       JOIN game_participants gp ON gp.game_id = g.id AND gp.resident_id = ? AND gp.status = 'joined'
       WHERE g.circle_id = ? AND g.date <= ? AND g.date >= ? AND g.status != 'cancelled'
       ORDER BY g.date DESC LIMIT 20`
    )
    .all(residentId, circleId, today, since)) as { id: string; activityLabel: string; date: string }[];
}

circleExperienceRouter.get("/:id/memories", requireResident, requireCircleFeature("circles.memories"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const { circle, role } = ctx;
  const me = req.resident!.id;
  const rows = (await db
    .prepare(
      `SELECT m.id, m.kind, m.caption, m.body, m.resident_id as residentId, m.created_at as createdAt, m.game_id as gameId,
              g.activity_label as activityLabel, g.date, COALESCE(NULLIF(r.name, ''), 'A member') as contributorName
       FROM circle_memories m JOIN games g ON g.id = m.game_id LEFT JOIN residents r ON r.id = m.resident_id
       WHERE m.circle_id = ? AND m.status = 'visible'
       ORDER BY g.date DESC, m.created_at DESC LIMIT 200`
    )
    .all(circle.id)) as { id: string; kind: string; caption: string | null; body: string | null; residentId: string; createdAt: string; gameId: string; activityLabel: string; date: string; contributorName: string }[];
  const together = (await db
    .prepare(
      `SELECT COUNT(*) as n FROM games g WHERE g.circle_id = ? AND g.date < ? AND g.status != 'cancelled'
         AND EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = g.id AND gp.attended = 1)`
    )
    .get(circle.id, irelandTodayIso())) as { n: number };
  const activities = await contributableActivities(circle.id, me);
  res.json({
    activitiesTogether: Number(together.n),
    canContribute: circle.status !== "closed" && activities.length > 0,
    contributableActivities: activities,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      imageUrl: r.kind === "photo" ? memoryDeliveryUrl(circle.id, r.id) : null,
      caption: r.caption,
      body: r.body,
      activity: { id: r.gameId, activityLabel: r.activityLabel, date: r.date },
      contributorName: r.contributorName,
      mine: r.residentId === me,
      canRemove: r.residentId === me || role === "organiser",
      createdAt: r.createdAt,
    })),
  });
});

circleExperienceRouter.post("/:id/memories", requireResident, requireCircleFeature("circles.memories"), writeLimiter, async (req, res) => {
  const ctx = await memberCircle(req, res, { write: true });
  if (!ctx) return;
  const { circle } = ctx;
  const me = req.resident!.id;
  const b = req.body as { gameId?: unknown; kind?: unknown; imageUrl?: unknown; caption?: unknown; body?: unknown; consent?: unknown };
  if (b.kind !== "photo" && b.kind !== "reflection") return res.status(400).json({ error: "Choose a photo or a reflection", field: "kind" });
  if (typeof b.gameId !== "string") return res.status(400).json({ error: "Choose the activity this is from", field: "gameId" });
  // Only people who took part in that activity can add to it.
  const eligible = (await contributableActivities(circle.id, me)).some((a) => a.id === b.gameId);
  if (!eligible) return res.status(403).json({ error: "You can add memories to Circle activities you took part in", field: "gameId" });

  const caption = typeof b.caption === "string" ? b.caption.trim() : "";
  if (caption.length > 280) return res.status(400).json({ error: "Keep the caption under 280 characters", field: "caption" });
  let imageUrl: string | null = null;
  let body: string | null = null;
  if (b.kind === "photo") {
    if (typeof b.imageUrl !== "string" || !memoryImageBelongs(circle.id, b.imageUrl)) return res.status(400).json({ error: "Add a photo first", field: "imageUrl" });
    if (b.consent !== true) return res.status(400).json({ error: "Confirm everyone in the photo is happy for it to be shared with the Circle", field: "consent" });
    imageUrl = b.imageUrl;
  } else {
    const text = typeof b.body === "string" ? b.body.trim() : "";
    if (text.length < 3 || text.length > 1000) return res.status(400).json({ error: "Write between 3 and 1,000 characters", field: "body" });
    body = text;
  }

  const { n: today } = (await db
    .prepare(`SELECT COUNT(*) as n FROM circle_memories WHERE circle_id = ? AND resident_id = ? AND created_at > NOW() - INTERVAL 1 DAY`)
    .get(circle.id, me)) as { n: number };
  if (Number(today) >= MEMORY_DAILY_LIMIT) return res.status(429).json({ error: "That's plenty for today. Try again tomorrow." });

  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO circle_memories (id, circle_id, game_id, resident_id, kind, image_url, caption, body, consent_confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, circle.id, b.gameId, me, b.kind, imageUrl, caption || null, body, b.kind === "photo" ? 1 : 0);
  void logEvent("circle_memory_added", { residentId: me, metadata: { circleId: circle.id, kind: b.kind } });

  // Tell the others who were there — once per person per activity, however
  // many memories are added to it.
  const ref = `memory:${b.gameId}`;
  const others = (await db
    .prepare(
      `SELECT gp.resident_id as id FROM game_participants gp JOIN circle_members cm ON cm.circle_id = ? AND cm.resident_id = gp.resident_id
       WHERE gp.game_id = ? AND gp.status = 'joined' AND gp.resident_id != ?`
    )
    .all(circle.id, b.gameId, me)) as { id: string }[];
  for (const o of others) {
    const already = await db.prepare(`SELECT 1 FROM notifications WHERE resident_id = ? AND kind = 'circle' AND ref = ? LIMIT 1`).get(o.id, ref);
    if (already) continue;
    await notifyResident({ residentId: o.id, kind: "circle", title: `New memory in ${circle.name}`, body: `${req.resident!.name || "A member"} shared a memory from an activity you were at.`, listingType: "circle", listingId: circle.id, ref });
  }
  res.status(201).json({ id });
});

circleExperienceRouter.delete("/:id/memories/:memoryId", requireResident, requireCircleFeature("circles.memories"), async (req, res) => {
  const ctx = await memberCircle(req, res);
  if (!ctx) return;
  const memory = (await db.prepare(`SELECT resident_id as residentId, status FROM circle_memories WHERE id = ? AND circle_id = ?`).get(req.params.memoryId, ctx.circle.id)) as
    | { residentId: string; status: string }
    | undefined;
  if (!memory || memory.status !== "visible") return res.status(404).json({ error: "That memory isn't there any more" });
  const mine = memory.residentId === req.resident!.id;
  if (!mine && ctx.role !== "organiser") return res.status(403).json({ error: "Only the person who added it or an organiser can remove it" });
  const r = await db
    .prepare(`UPDATE circle_memories SET status = 'removed', removed_at = NOW(), removed_by = ?, removed_by_kind = ? WHERE id = ? AND status = 'visible'`)
    .run(req.resident!.id, mine ? "contributor" : "organiser", req.params.memoryId);
  if (r.changes !== 1) return res.status(404).json({ error: "That memory isn't there any more" });
  if (!mine) {
    await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "circle.memory_removed", objectType: "circle", objectId: ctx.circle.id, newValue: { memoryId: req.params.memoryId } });
  }
  res.json({ ok: true });
});

/** For media.ts: may this viewer see this memory's photo right now? */
export async function memoryImageFor(circleId: string, memoryId: string, viewerId: string | null): Promise<string | null> {
  if (!viewerId || !(await circleFeatureOn("circles.memories"))) return null;
  if (!(await roleOf(circleId, viewerId))) return null;
  const row = (await db.prepare(`SELECT image_url FROM circle_memories WHERE id = ? AND circle_id = ? AND status = 'visible' AND kind = 'photo'`).get(memoryId, circleId)) as
    | { image_url: string | null }
    | undefined;
  return row?.image_url ?? null;
}

/** For media.ts: membership check for previewing a just-uploaded file. */
export async function canUseCircleMemories(circleId: string, viewerId: string | null): Promise<boolean> {
  if (!viewerId || !(await circleFeatureOn("circles.memories"))) return false;
  return !!(await roleOf(circleId, viewerId));
}

// --- Circle-to-Circle activities (circles.collaboration, owner decision D2) ---
// Organiser-only on both sides. The proposer Circle owns the activity; the
// partner Circle is linked. Members and permissions are never merged; the
// partner Circle's private content stays private.

interface CollabRow {
  id: string;
  proposer_circle_id: string;
  partner_circle_id: string;
  proposed_by: string;
  title: string;
  note: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  location_text: string | null;
  status: string;
  decline_reason: string | null;
  game_id: string | null;
  created_at: string;
}

async function collabJson(row: CollabRow, circleId: string) {
  const [proposer, partner] = await Promise.all([
    db.prepare(`SELECT id, slug, name FROM circles WHERE id = ?`).get(row.proposer_circle_id) as Promise<{ id: string; slug: string | null; name: string } | undefined>,
    db.prepare(`SELECT id, slug, name FROM circles WHERE id = ?`).get(row.partner_circle_id) as Promise<{ id: string; slug: string | null; name: string } | undefined>,
  ]);
  return {
    id: row.id,
    direction: row.proposer_circle_id === circleId ? "sent" : "received",
    proposer: proposer ?? null,
    partner: partner ?? null,
    title: row.title,
    note: row.note,
    proposedDate: row.proposed_date,
    proposedTime: row.proposed_time,
    locationText: row.location_text,
    status: row.status,
    declineReason: row.decline_reason,
    gameId: row.game_id,
    planId: (row as CollabRow & { plan_id?: string | null }).plan_id ?? null,
    createdAt: row.created_at,
  };
}

async function organiserCircle(req: Request, res: Response): Promise<CircleBasics | null> {
  const circle = await loadCircle(req.params.id);
  if (!circle) {
    res.status(404).json({ error: "Circle not found" });
    return null;
  }
  if (!(await isOrganiser(circle.id, req.resident!.id))) {
    res.status(403).json({ error: "Only this Circle's organisers can do this" });
    return null;
  }
  return circle;
}

circleExperienceRouter.get("/:id/collaborations", requireResident, requireCircleFeature("circles.collaboration"), async (req, res) => {
  const circle = await organiserCircle(req, res);
  if (!circle) return;
  const rows = (await db
    .prepare(`SELECT * FROM circle_collaborations WHERE proposer_circle_id = ? OR partner_circle_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(circle.id, circle.id)) as CollabRow[];
  res.json(await Promise.all(rows.map((r) => collabJson(r, circle.id))));
});

circleExperienceRouter.post("/:id/collaborations", requireResident, requireCircleFeature("circles.collaboration"), writeLimiter, async (req, res) => {
  const circle = await organiserCircle(req, res);
  if (!circle) return;
  if (circle.status === "closed") return res.status(409).json({ error: "This Circle is closed" });
  const b = req.body as { partnerCircleId?: unknown; title?: unknown; note?: unknown; proposedDate?: unknown; proposedTime?: unknown; locationText?: unknown; planId?: unknown };
  // Circles 3.0 — share one of this Circle's open plans (e.g. a listing plan)
  // instead of proposing a new activity. On acceptance the same plan shows
  // in both Circles; nothing is copied.
  type SharedPlan = { id: string; title: string; proposedDate: string; proposedTime: string };
  let sharedPlan: SharedPlan | null = null;
  if (b.planId !== undefined && b.planId !== null) {
    const found: SharedPlan | undefined =
      typeof b.planId === "string"
        ? ((await db
            .prepare(`SELECT id, title, proposed_date as proposedDate, proposed_time as proposedTime FROM circle_plans WHERE id = ? AND circle_id = ? AND status IN ('idea', 'confirmed') AND partner_circle_id IS NULL`)
            .get(b.planId, circle.id)) as SharedPlan | undefined)
        : undefined;
    sharedPlan = found ?? null;
    if (!found) return res.status(400).json({ error: "Choose one of this Circle's open plans that isn't shared yet", field: "planId" });
    if (b.title === undefined || b.title === "") b.title = found.title;
    if (!b.proposedDate && found.proposedDate) b.proposedDate = found.proposedDate;
    if (!b.proposedTime && found.proposedTime) b.proposedTime = found.proposedTime;
  }
  const partner = typeof b.partnerCircleId === "string" ? await loadCircle(b.partnerCircleId) : undefined;
  if (!partner || partner.id === circle.id) return res.status(400).json({ error: "Choose another Circle to invite", field: "partnerCircleId" });
  if (partner.status === "closed") return res.status(409).json({ error: "That Circle is closed" });
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 3 || title.length > 255) return res.status(400).json({ error: "Say what you'd do together (3–255 characters)", field: "title" });
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
  const date = typeof b.proposedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.proposedDate) ? b.proposedDate : null;
  if (date && date < irelandTodayIso()) return res.status(400).json({ error: "Choose a date that hasn't passed", field: "proposedDate" });
  const time = typeof b.proposedTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.proposedTime) ? b.proposedTime : null;
  const location = typeof b.locationText === "string" ? b.locationText.trim().slice(0, 255) : "";
  // One open proposal between the same two Circles at a time.
  const open = await db
    .prepare(
      `SELECT 1 FROM circle_collaborations WHERE status IN ('proposed', 'accepted')
         AND ((proposer_circle_id = ? AND partner_circle_id = ?) OR (proposer_circle_id = ? AND partner_circle_id = ?)) LIMIT 1`
    )
    .get(circle.id, partner.id, partner.id, circle.id);
  if (open) return res.status(409).json({ error: "There's already an open shared activity between these Circles" });
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO circle_collaborations (id, proposer_circle_id, partner_circle_id, proposed_by, title, note, proposed_date, proposed_time, location_text, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, circle.id, partner.id, req.resident!.id, title, note || null, date, time, location || null, sharedPlan?.id ?? null);
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "circle.collaboration_proposed", objectType: "circle", objectId: circle.id, newValue: { collaborationId: id, partnerCircleId: partner.id } });
  for (const o of await organiserIds(partner.id)) {
    await notifyResident({ residentId: o, kind: "circle", title: `${circle.name} invites ${partner.name} to a shared ${sharedPlan ? "plan" : "activity"}`, body: title, listingType: "circle", listingId: partner.id, ref: `collab:${id}` });
  }
  res.status(201).json({ id });
});

circleExperienceRouter.post("/:id/collaborations/:cid/respond", requireResident, requireCircleFeature("circles.collaboration"), async (req, res) => {
  const circle = await organiserCircle(req, res);
  if (!circle) return;
  const accept = (req.body as { accept?: unknown }).accept === true;
  const reason = typeof (req.body as { reason?: unknown }).reason === "string" ? String((req.body as { reason: string }).reason).trim().slice(0, 500) : "";
  const row = (await db.prepare(`SELECT * FROM circle_collaborations WHERE id = ? AND partner_circle_id = ?`).get(req.params.cid, circle.id)) as CollabRow | undefined;
  // Only the invited Circle answers; anything else reads as not found.
  if (!row) return res.status(404).json({ error: "Shared activity not found" });
  if (accept && circle.status === "closed") return res.status(409).json({ error: "This Circle is closed" });
  const r = await db
    .prepare(`UPDATE circle_collaborations SET status = ?, decided_by = ?, decided_at = NOW(), decline_reason = ? WHERE id = ? AND status = 'proposed'`)
    .run(accept ? "accepted" : "declined", req.resident!.id, accept ? null : reason || null, row.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This has already been answered" });
  // Circles 3.0 — a shared plan now shows in this Circle too; its members hear about it.
  const planRow = row as CollabRow & { plan_id?: string | null };
  if (accept && planRow.plan_id) {
    const linked = await db
      .prepare(`UPDATE circle_plans SET partner_circle_id = ? WHERE id = ? AND circle_id = ? AND partner_circle_id IS NULL AND status IN ('idea', 'confirmed')`)
      .run(circle.id, planRow.plan_id, row.proposer_circle_id);
    if (linked.changes === 1) {
      const proposer = (await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(row.proposer_circle_id)) as { name: string } | undefined;
      const members = (await db.prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ? AND resident_id != ?`).all(circle.id, req.resident!.id)) as { resident_id: string }[];
      for (const m of members) {
        await notifyResident({ residentId: m.resident_id, kind: "circle", title: `Shared plan with ${proposer?.name ?? "another Circle"}: ${row.title}`, body: `In ${circle.name}. Say you're in if you'd like to go.`, listingType: "circle", listingId: circle.id, ref: planRow.plan_id });
      }
    }
  }
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: accept ? "circle.collaboration_accepted" : "circle.collaboration_declined", objectType: "circle", objectId: circle.id, newValue: { collaborationId: row.id }, reason: reason || undefined });
  for (const o of await organiserIds(row.proposer_circle_id)) {
    await notifyResident({
      residentId: o,
      kind: "circle",
      title: accept ? `${circle.name} agreed: ${row.title}` : `${circle.name} declined: ${row.title}`,
      body: accept ? "Create the activity from Manage → Pulse & proposals." : reason || "They won't be taking part this time.",
      listingType: "circle",
      listingId: row.proposer_circle_id,
      ref: `collab:${row.id}`,
    });
  }
  res.json({ ok: true, status: accept ? "accepted" : "declined" });
});

circleExperienceRouter.post("/:id/collaborations/:cid/withdraw", requireResident, requireCircleFeature("circles.collaboration"), async (req, res) => {
  const circle = await organiserCircle(req, res);
  if (!circle) return;
  const r = await db
    .prepare(`UPDATE circle_collaborations SET status = 'withdrawn', decided_by = ?, decided_at = NOW() WHERE id = ? AND proposer_circle_id = ? AND status IN ('proposed', 'accepted')`)
    .run(req.resident!.id, req.params.cid, circle.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This can't be withdrawn any more" });
  // Circles 3.0 — a withdrawn shared plan goes back to being this Circle's own.
  const w = (await db.prepare(`SELECT plan_id, partner_circle_id FROM circle_collaborations WHERE id = ?`).get(req.params.cid)) as { plan_id: string | null; partner_circle_id: string } | undefined;
  if (w?.plan_id) await db.prepare(`UPDATE circle_plans SET partner_circle_id = NULL WHERE id = ? AND circle_id = ? AND partner_circle_id = ?`).run(w.plan_id, circle.id, w.partner_circle_id);
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "circle.collaboration_withdrawn", objectType: "circle", objectId: circle.id, newValue: { collaborationId: req.params.cid } });
  res.json({ ok: true });
});
