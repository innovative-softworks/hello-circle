import crypto from "node:crypto";
import { Router } from "express";
import { logEvent } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
import { createCheckoutSession, issueStripeRefund, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { countFamiliarCoParticipants } from "../db/queries.js";
import { isOrganiser as isCircleOrganiser } from "./circleHelpers.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyCentreFollowers, notifyHostFollowers } from "./follows.js";
import { buildIcsEvent } from "../ics.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyResident } from "../notifications.js";
import { sendMail } from "../email.js";
import { writeAudit } from "../audit.js";
import { CLIENT_URL } from "../stripe.js";
import { matchParticipationIntentsForGame } from "../participationIntents.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { requireResident } from "../residents.js";
import { matchSearchAlertsForGame } from "../searchAlerts.js";
import { canViewPrivateGame } from "./sharing.js";
import { ConflictError, generateRef } from "../util.js";
import { DISCOVERABLE_LIFECYCLES_SQL, getEffectiveAvailability, getEffectiveLifecycle, getPublicLifecycleLabel, validateLifecycleTransition, type Lifecycle } from "../lifecycle.js";
import { notifyGameNotifyMeSubscribers, subscribeNotifyMe, unsubscribeNotifyMe } from "../notifyMe.js";
import { activeOfferedCount, claimWaitlistOffer, hasActiveOffer, offerToWaitlistEntry, promoteNextWaitlistEntry } from "../waitlist.js";

export const gamesRouter = Router();

interface GameRow {
  id: string;
  host_resident_id: string;
  activity_label: string;
  centre_id: string | null;
  location_text: string;
  date: string;
  time: string;
  skill_level: string;
  capacity: number;
  price_cents: number | null;
  visibility: string;
  status: string;
  created_at: string;
  solo_friendly: number;
  booking_ref: string | null;
  min_participants: number | null;
  confirmation_deadline: string | null;
  image_url: string;
  description: string | null;
  duration_minutes: number | null;
  equipment_needed: string | null;
  min_age: number | null;
  surface_type: string;
  indoor_outdoor: string;
  meeting_instructions: string | null;
  cancellation_policy: string | null;
  circle_id: string | null;
  lifecycle: string;
  publish_at: string | null;
  booking_open_at: string | null;
  booking_close_at: string | null;
}

// Universal Publishing, Lifecycle & Availability System, Phase D —
// Activities. Deliberately does NOT store 'cancelled' in games.lifecycle at
// all: `games.status = 'cancelled'` (existing, battle-tested — drives
// join-blocking, participant handling, refunds, notifications throughout
// this file) stays the sole authority for cancellation, so cancelling a
// game never needs a second, parallel write to stay consistent. Likewise
// "completed" is never stored — derived from `date < today`, the exact
// same precedent this codebase already uses (circles.ts's own displayStatus
// logic, client/src/activityStatus.ts) rather than duplicating it into a
// stored value that could drift from the real date.
export function getEffectiveGameLifecycle(row: Pick<GameRow, "status" | "date" | "lifecycle" | "publish_at" | "booking_open_at" | "booking_close_at">, now: Date = new Date()): Lifecycle {
  if (row.status === "cancelled") return "cancelled";
  if (row.date < irelandTodayIso()) return "completed";
  return getEffectiveLifecycle(
    { lifecycle: row.lifecycle as Lifecycle, publishAt: row.publish_at, bookingOpenAt: row.booking_open_at, bookingCloseAt: row.booking_close_at },
    now
  );
}

async function toGameJson(row: GameRow) {
  const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(row.id)) as {
    n: number;
  };
  const centre = row.centre_id ? ((await db.prepare(`SELECT name, area, county FROM centres WHERE id = ?`).get(row.centre_id)) as { name: string; area: string; county: string } | undefined) : undefined;
  // "Host" trust tier (IA spec five-layer audit) — badge-only, joined off
  // the same host_resident_id that already gates cancellation elsewhere in
  // this file. Neither field existed on this response before; nothing
  // previously surfaced a host's name at all.
  const host = (await db.prepare(`SELECT name, host_status as hostStatus, avatar_url as avatarUrl FROM residents WHERE id = ?`).get(row.host_resident_id)) as
    | { name: string; hostStatus: string; avatarUrl: string | null }
    | undefined;
  // HelloCircle Manage Phase 5 — lets /manage/activities show which rows are
  // a Circle's own Plan (and link back to it), instead of listing them
  // undifferentiated alongside unrelated solo hosted games.
  const circle = row.circle_id
    ? ((await db.prepare(`SELECT name, slug FROM circles WHERE id = ?`).get(row.circle_id)) as { name: string; slug: string | null } | undefined)
    : undefined;
  const effectiveLifecycle = getEffectiveGameLifecycle(row);
  const effectiveAvailability = getEffectiveAvailability(effectiveLifecycle, row.capacity, joined, true);
  return {
    id: row.id,
    hostResidentId: row.host_resident_id,
    hostName: host?.name ?? "",
    hostAvatarUrl: host?.avatarUrl ?? null,
    hostVerified: host?.hostStatus === "verified",
    activityLabel: row.activity_label,
    centreId: row.centre_id,
    centreName: centre?.name ?? null,
    area: centre?.area ?? null,
    county: centre?.county ?? null,
    locationText: row.location_text,
    date: row.date,
    time: row.time,
    skillLevel: row.skill_level,
    capacity: row.capacity,
    joined,
    spotsLeft: computeCapacity(row.capacity, joined).spotsLeft,
    priceCents: row.price_cents,
    visibility: row.visibility,
    status: row.status,
    createdAt: row.created_at,
    soloFriendly: !!row.solo_friendly,
    // Universal Publishing, Lifecycle & Availability System — `lifecycle` is
    // the host's own last explicit choice (draft/coming_soon/active/paused/
    // archived); `effectiveLifecycle`/`effectiveAvailability` are what a
    // viewer sees *right now* once any schedule (publishAt/bookingOpenAt/
    // bookingCloseAt) and the existing status/date fields are accounted for
    // (see getEffectiveGameLifecycle above) — the client renders off these
    // two, never re-deriving the policy itself (§67: client helpers are
    // presentation-only).
    lifecycle: row.lifecycle,
    publishAt: row.publish_at,
    bookingOpenAt: row.booking_open_at,
    bookingCloseAt: row.booking_close_at,
    effectiveLifecycle,
    effectiveAvailability,
    publicLifecycleLabel: getPublicLifecycleLabel(effectiveLifecycle, effectiveAvailability),
    /** Open Booking (Phase 3) — set when this game exists because someone
     * opened spots on their own room booking, rather than being created
     * standalone. Lets the UI show it's linked to an existing reservation. */
    bookingRef: row.booking_ref,
    /** Minimum Participation Booking (Phase 4) — null means no threshold
     * (the game is 'open' from creation, as before). When set, the game
     * starts 'pending_participants' and flips to 'open' once `joined`
     * reaches this number. */
    minParticipants: row.min_participants,
    /** Open game detail (IA spec §5) — display-only, see db/index.ts's
     * ensureColumn comment; never enforced server-side. */
    confirmationDeadline: row.confirmation_deadline,
    imageUrl: row.image_url || null,
    description: row.description,
    durationMinutes: row.duration_minutes,
    equipmentNeeded: row.equipment_needed,
    minAge: row.min_age,
    surfaceType: row.surface_type || null,
    indoorOutdoor: row.indoor_outdoor || null,
    cancellationPolicy: row.cancellation_policy,
    /** HelloCircle Manage Phase 4 — set only when this game was created as a
     * specific Circle's plan (via the "Create plan" deep-link). */
    circleId: row.circle_id,
    circleName: circle?.name ?? null,
    circleSlug: circle?.slug ?? null,
    // meeting_instructions is deliberately NOT included here — see GET /:id,
    // which adds it only for the host or a joined participant. toGameJson
    // is shared with the public list endpoint, where it must never appear.
  };
}

// Upcoming, open games — v1 is cash/free only (see POST /, priceCents is
// display-only, never charged through Stripe/pricing.ts). Sorted soonest
// first; a past-dated game is simply never returned (no cleanup job needed
// since nothing depends on stale rows being deleted).
//
// Lifecycle-audit privacy fix — `visibility = 'public'` added: this public,
// unauthenticated list previously had no visibility filter at all, so a
// circle-only or invite-only game (see the `visibility` column) would
// appear in the general "what's open" list to anyone. Same gap closed in
// listScheduledActivities (db/queries.ts) for Home/Explore/Search.
// Lifecycle-aware discoverability (§7, §34, §41): 'coming_soon' and
// 'paused' games are meant to stay visible here alongside 'active' ones —
// only their availability/CTA differs (see toGameJson's effectiveLifecycle/
// effectiveAvailability/publicLifecycleLabel) — while 'draft'/'archived'
// never appear.
gamesRouter.get("/", async (req, res) => {
  const today = irelandTodayIso();
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const rows = (
    county
      ? await db
          .prepare(
            `SELECT g.* FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.visibility = 'public' AND g.lifecycle IN ${DISCOVERABLE_LIFECYCLES_SQL} AND g.date >= ? AND c.county = ? ORDER BY g.date, g.time`
          )
          .all(today, county)
      : await db
          .prepare(`SELECT * FROM games WHERE status = 'open' AND visibility = 'public' AND lifecycle IN ${DISCOVERABLE_LIFECYCLES_SQL} AND date >= ? ORDER BY date, time`)
          .all(today)
  ) as GameRow[];
  res.json(await Promise.all(rows.map(toGameJson)));
});

// Every game this resident is hosting or has joined — the host is always
// also a participant row (see POST / below), so one query covers both.
// Distinct from GET / (public "what's open" list), which only ever shows
// status='open' games — this shows the resident's own history regardless
// of status, so a cancelled game they were in still appears.
gamesRouter.get("/mine", requireResident, async (req, res) => {
  // `?hostedOnly=1` (HelloCircle Manage's /manage/activities) narrows this to
  // games this resident hosts — every other existing caller (unparameterized)
  // keeps today's hosted-or-joined behaviour.
  const hostedOnly = req.query.hostedOnly === "1" || req.query.hostedOnly === "true";
  const rows = (await db
    .prepare(
      hostedOnly
        ? `SELECT g.* FROM games g WHERE g.host_resident_id = ? ORDER BY g.date DESC, g.time DESC`
        : `SELECT g.* FROM games g
           JOIN game_participants gp ON gp.game_id = g.id
           WHERE gp.resident_id = ? AND gp.status = 'joined'
           ORDER BY g.date DESC, g.time DESC`
    )
    .all(req.resident!.id)) as GameRow[];
  res.json(await Promise.all(rows.map(toGameJson)));
});

// HelloCircle Manage Phase 24 — a flat "who paid me for what" transaction
// list for a host's paid games. `game_participants` has no per-participant
// amount column, but `updateGame` (PUT /:id below) freezes `price_cents`
// the moment anyone besides the host has joined, so `games.price_cents` is
// safe to show as "amount paid" per row here — no new column needed.
gamesRouter.get("/host/earnings", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT g.id as gameId, g.activity_label as activityLabel, g.date, g.price_cents as amountCents,
              r.name as participantName, gp.joined_at as joinedAt
       FROM game_participants gp
       JOIN games g ON g.id = gp.game_id
       JOIN residents r ON r.id = gp.resident_id
       WHERE g.host_resident_id = ? AND gp.resident_id != g.host_resident_id AND gp.payment_status = 'paid'
       ORDER BY gp.joined_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

// Host Experience Polish — mirrors vendorInsights.ts's GET /vendor/insights
// exactly: decision-focused aggregates and one honest narrative sentence,
// never decorative charts (same "Host Manage spec §15" convention that
// route's own comment cites). Two stats beyond the Vendor version, since
// Games carry data Bookings don't: a repeat-participant rate and an
// attendance rate (from game_participants.attended, only counting rows
// where attendance was actually confirmed one way or the other).
gamesRouter.get("/host/insights", requireResident, async (req, res) => {
  const hostId = req.resident!.id;

  const totals = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM games WHERE host_resident_id = ?) as totalSessions,
        (SELECT COUNT(*) FROM games WHERE host_resident_id = ? AND status = 'cancelled') as cancelledSessions,
        (SELECT COUNT(DISTINCT gp.resident_id) FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE g.host_resident_id = ? AND gp.status = 'joined' AND gp.resident_id != g.host_resident_id) as uniqueParticipants`
    )
    .get(hostId, hostId, hostId)) as { totalSessions: number; cancelledSessions: number; uniqueParticipants: number };

  const utilisation = (await db
    .prepare(
      `SELECT DAYOFWEEK(g.date) as dayOfWeek, SUBSTRING(g.time, 1, 2) as hour, COUNT(*) as n
       FROM games g WHERE g.host_resident_id = ? AND g.status != 'cancelled'
       GROUP BY dayOfWeek, hour`
    )
    .all(hostId)) as { dayOfWeek: number; hour: string; n: number }[];

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byDay = new Map<number, number>();
  for (const row of utilisation) byDay.set(row.dayOfWeek, (byDay.get(row.dayOfWeek) ?? 0) + row.n);
  let narrative: string | null = null;
  if (byDay.size > 1) {
    const totalSeen = [...byDay.values()].reduce((a, b) => a + b, 0);
    const [busiestDay, busiestCount] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const avgOtherDays = (totalSeen - busiestCount) / (byDay.size - 1);
    if (avgOtherDays > 0 && busiestCount > avgOtherDays) {
      const pct = Math.round(((busiestCount - avgOtherDays) / avgOtherDays) * 100);
      if (pct >= 10) narrative = `${DAY_NAMES[busiestDay - 1]} is your busiest day — ${pct}% more sessions than your other days average.`;
    }
  }

  const trendRow = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM games WHERE host_resident_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) as thisMonth,
        (SELECT COUNT(*) FROM games WHERE host_resident_id = ? AND created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH) AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01')) as lastMonth`
    )
    .get(hostId, hostId)) as { thisMonth: number; lastMonth: number };
  const trend = {
    thisMonth: trendRow.thisMonth,
    lastMonth: trendRow.lastMonth,
    deltaPercent: trendRow.lastMonth > 0 ? Math.round(((trendRow.thisMonth - trendRow.lastMonth) / trendRow.lastMonth) * 100) : null,
  };

  // Repeat participants — distinct residents who've joined 2+ of this
  // host's games (across any activity, not scoped to one label — a
  // different, real-time aggregate query, not the per-join activity-label-
  // scoped analytics heuristic in POST /:id/join above).
  const { n: repeatParticipants } = (await db
    .prepare(
      `SELECT COUNT(*) as n FROM (
         SELECT gp.resident_id FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE g.host_resident_id = ? AND gp.status = 'joined' AND gp.resident_id != g.host_resident_id
         GROUP BY gp.resident_id HAVING COUNT(*) >= 2
       ) t`
    )
    .get(hostId)) as { n: number };
  const repeatParticipantPercent = totals.uniqueParticipants > 0 ? Math.round((repeatParticipants / totals.uniqueParticipants) * 100) : null;

  // Attendance rate — only among rows where attendance was actually
  // confirmed (attended IS NOT NULL), never guessed for an unconfirmed one.
  const attendanceRow = (await db
    .prepare(
      `SELECT COUNT(*) as confirmed, SUM(gp.attended = 1) as attended
       FROM game_participants gp JOIN games g ON g.id = gp.game_id
       WHERE g.host_resident_id = ? AND gp.status = 'joined' AND gp.attended IS NOT NULL AND gp.resident_id != g.host_resident_id`
    )
    .get(hostId)) as { confirmed: number; attended: number | null };
  const attendanceRatePercent = attendanceRow.confirmed > 0 ? Math.round((Number(attendanceRow.attended ?? 0) / attendanceRow.confirmed) * 100) : null;

  res.json({ totals, utilisation, narrative, trend, repeatParticipantPercent, attendanceRatePercent });
});

// HelloCircle Manage Phase 25 — coupons for a host's own paid games. Unlike
// Vendor's coupons (scoped by created_by_vendor_id, optionally listing-wide
// via a null eligible_listing_id), a host-created coupon MUST name a
// specific game: evaluateCoupon() only checks eligible_listing_type/id when
// eligible_listing_id is actually set — leaving it null on a
// type='game' coupon would make it redeemable against *any* game
// system-wide, not just this host's own, since evaluateCoupon has no
// concept of "creator". Requiring a specific, ownership-checked game id is
// the only safe shape given that existing shared function's behaviour.
gamesRouter.get("/coupons", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, code, kind, amount, max_uses as maxUses, used_count as usedCount, expires_at as expiresAt, active, eligible_listing_id as eligibleListingId
       FROM coupons WHERE created_by_resident_id = ? ORDER BY created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

gamesRouter.post("/coupons", requireResident, async (req, res) => {
  const b = req.body as { code?: string; kind?: "percent" | "fixed"; amount?: number; maxUses?: number; expiresAt?: string; gameId?: string };
  if (!b.code?.trim() || !b.kind || !b.amount || !b.gameId) return res.status(400).json({ error: "code, kind, amount and gameId are required" });
  const game = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(b.gameId)) as { host_resident_id: string } | undefined;
  if (!game || game.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Not your session" });
  try {
    await db
      .prepare(
        `INSERT INTO coupons (code, kind, amount, max_uses, expires_at, created_by_resident_id, eligible_listing_type, eligible_listing_id)
         VALUES (?, ?, ?, ?, ?, ?, 'game', ?)`
      )
      .run(b.code.trim().toUpperCase(), b.kind, b.amount, b.maxUses ?? null, b.expiresAt ?? null, req.resident!.id, b.gameId);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error && e.message.includes("Duplicate") ? "That code is already in use" : "Couldn't create the coupon" });
  }
});

gamesRouter.put("/coupons/:id/active", requireResident, async (req, res) => {
  const { active } = req.body as { active?: boolean };
  const info = await db
    .prepare(`UPDATE coupons SET active = ? WHERE id = ? AND created_by_resident_id = ?`)
    .run(active ? 1 : 0, req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

gamesRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  // Lifecycle-audit privacy fix — this route had no visibility check at
  // all (its own now-removed comment on the /ics route below claimed
  // "games are visible to anyone with the link," which was true in code
  // but not intended: a circle-only/invite-only game's full location/time/
  // participant data was reachable by anyone who had (or guessed) the id.
  // Reuses the exact same authorization sharing.ts's getShareData already
  // applies for the share-card/OG-meta paths, rather than a second
  // ad-hoc check — 404 (not 403) so an unauthorized request can't even
  // confirm the id exists.
  if (row.visibility !== "public" && !(await canViewPrivateGame(row.id, row.circle_id, req.resident?.id ?? null, row.host_resident_id))) {
    return res.status(404).json({ error: "Session not found" });
  }
  // §6 — a Draft is "not publicly discoverable... not searchable," full
  // stop, regardless of visibility: only the host can ever see it. Coming
  // Soon/Active/Paused/Completed/Cancelled/Archived are all real, publicly-
  // reachable states once past this gate (their own discoverability in
  // list/search endpoints is a separate, narrower filter — this only
  // protects the not-yet-announced case).
  const isHostForLifecycleGate = req.resident?.id === row.host_resident_id;
  if (getEffectiveGameLifecycle(row) === "draft" && !isHostForLifecycleGate) {
    return res.status(404).json({ error: "Session not found" });
  }
  const json = await toGameJson(row);
  // Lets the detail page render "Join" vs "Leave" vs host-only controls
  // without a second round trip — only computed here, not on the list.
  let joinedByMe = false;
  let waitlistedByMe = false;
  // Contextual familiarity (Phase 8) — "N people you've played with before
  // are joining," computed only inside this one game's own context, never
  // as a browsable list. 0 for a signed-out visitor (nothing to compute).
  let familiarCount = 0;
  if (req.resident) {
    // Platform Pre-Launch Polish — Changeset 4E. Self-leave/host-remove now
    // soft-cancel (status='cancelled') rather than deleting the row (see
    // DELETE /:id/join below) — this must only count an *active* claim as
    // "joined", or a resident who left would still see themselves as
    // joined (and the page would still offer "Leave" instead of "Join")
    // after they'd already left.
    const p = await db.prepare(`SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ? AND status IN ('joined', 'pending_payment')`).get(req.params.id, req.resident.id);
    joinedByMe = !!p;
    const w = await db
      .prepare(`SELECT id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'`)
      .get(req.params.id, req.resident.id);
    waitlistedByMe = !!w;
    familiarCount = await countFamiliarCoParticipants(req.resident.id, req.params.id);
  }
  // Self-serve check-in + attendance confirmation (IA spec §11) — only
  // meaningful for this resident's own participation, same "only computed
  // here, not on the list" reasoning as joinedByMe above.
  let checkedInAt: string | null = null;
  let attended: boolean | null = null;
  if (req.resident) {
    const p = (await db.prepare(`SELECT checked_in_at as checkedInAt, attended FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident.id)) as
      | { checkedInAt: string | null; attended: number | null }
      | undefined;
    checkedInAt = p?.checkedInAt ?? null;
    attended = p?.attended === null || p?.attended === undefined ? null : !!p.attended;
  }
  // Exact meeting instructions are host/joined-participant-only (see the
  // `description` column comment in db/index.ts) — a browsing visitor gets
  // the public venue location, nothing more precise than that.
  const isHost = req.resident?.id === row.host_resident_id;
  const meetingInstructions = isHost || joinedByMe ? row.meeting_instructions : null;
  res.json({ ...json, joinedByMe, waitlistedByMe, familiarCount, checkedInAt, attended, meetingInstructions });
});

// "Add to calendar" (IA spec §13) — same visibility gate as GET /:id (a
// circle-only/invite-only game's date/time/location must not be
// downloadable as a .ics by anyone with the link either). Falls back to a
// 2-hour block when the host hasn't set a real duration — display-only,
// same "informational, not enforced" spirit as the confirmation-deadline
// field.
const GAME_ICS_DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

gamesRouter.get("/:id/ics", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.visibility !== "public" && !(await canViewPrivateGame(row.id, row.circle_id, req.resident?.id ?? null, row.host_resident_id))) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (getEffectiveGameLifecycle(row) === "draft" && req.resident?.id !== row.host_resident_id) {
    return res.status(404).json({ error: "Session not found" });
  }
  const json = await toGameJson(row);
  const [h, m] = json.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(json.date, h, m);
  const durationMs = json.durationMinutes ? json.durationMinutes * 60 * 1000 : GAME_ICS_DEFAULT_DURATION_MS;
  const end = new Date(start.getTime() + durationMs);
  const ics = buildIcsEvent({
    uid: `game-${row.id}`,
    title: json.activityLabel,
    location: json.centreName ?? json.locationText,
    start,
    end,
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="game-${row.id}.ics"`);
  res.send(ics);
});

const PARTICIPANTS_PREVIEW_LIMIT = 8;

// "Who's going" (Game Detail redesign §13) — public, like the rest of a
// game's detail. Only ever returns a name (already exposed the same way as
// hostName on every game response) — never email/phone/exact address, per
// the spec's own explicit privacy instruction. Capped to a preview count +
// a total, so the client can render "+N" instead of dozens of avatars.
gamesRouter.get("/:id/participants", async (req, res) => {
  // Mutual-block filter (post-audit hardening pass) — if the viewer blocked
  // a participant, or a participant blocked the viewer, neither should see
  // the other here. This route is otherwise public/unauthenticated, so an
  // anonymous viewer (no req.resident) still gets the unfiltered list, same
  // as before — there's no viewer identity to filter against.
  const viewerId = req.resident?.id ?? null;
  const blockSubquery = `NOT IN (
    SELECT blocked_resident_id FROM blocked_residents WHERE blocker_resident_id = ?
    UNION
    SELECT blocker_resident_id FROM blocked_residents WHERE blocked_resident_id = ?
  )`;
  const countFilter = viewerId ? `AND resident_id ${blockSubquery}` : "";
  const listFilter = viewerId ? `AND gp.resident_id ${blockSubquery}` : "";
  const blockParams = viewerId ? [viewerId, viewerId] : [];
  const { n: total } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined' ${countFilter}`)
    .get(req.params.id, ...blockParams)) as { n: number };
  const rows = (await db
    .prepare(
      `SELECT r.id as residentId, r.name FROM game_participants gp
       JOIN residents r ON r.id = gp.resident_id
       WHERE gp.game_id = ? AND gp.status = 'joined' ${listFilter}
       ORDER BY gp.joined_at ASC
       LIMIT ?`
    )
    .all(req.params.id, ...blockParams, PARTICIPANTS_PREVIEW_LIMIT)) as { residentId: string; name: string }[];
  res.json({ participants: rows, total });
});

// Host-only, uncapped participant view (HelloCircle Manage §3a) — distinct from
// the public preview above (which stays capped/names-only for the consumer
// page). Surfaces the operational detail a host needs to actually manage
// their own game: join/payment status, when they joined, check-in/attendance.
gamesRouter.get("/:id/participants/manage", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(req.params.id)) as { host_resident_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can view this" });

  const rows = (await db
    .prepare(
      `SELECT r.id as residentId, r.name, gp.status, gp.payment_status as paymentStatus,
              gp.joined_at as joinedAt, gp.checked_in_at as checkedInAt, gp.attended
       FROM game_participants gp JOIN residents r ON r.id = gp.resident_id
       WHERE gp.game_id = ? ORDER BY gp.joined_at ASC`
    )
    .all(req.params.id)) as { residentId: string; name: string; status: string; paymentStatus: string; joinedAt: string; checkedInAt: string | null; attended: number | null }[];
  res.json(rows.map((r) => ({ ...r, attended: r.attended === null || r.attended === undefined ? null : !!r.attended })));
});

// Host removes one participant (e.g. a no-show). Platform Pre-Launch Polish
// — Changeset 4A: was a hard delete (mirroring the resident's own
// DELETE /:id/join, which itself now soft-cancels instead — see below) —
// now soft-cancels the same way, so a paid participant the host removes
// still has a real row to refund via POST .../refund below. No refund
// automation here still (this route just changes membership, same
// off-platform-refund convention as everywhere else) — the new dedicated
// refund route is the only place money actually moves.
gamesRouter.post("/:id/participants/:residentId/remove", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id, activity_label FROM games WHERE id = ?`).get(req.params.id)) as
    | { host_resident_id: string; activity_label: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can remove a participant" });
  if (req.params.residentId === req.resident!.id) return res.status(400).json({ error: "You can't remove yourself as the host — cancel the session instead" });

  const info = await db
    .prepare(`UPDATE game_participants SET status = 'cancelled' WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .run(req.params.id, req.params.residentId);
  if (info.changes === 0) return res.status(404).json({ error: "That participant isn't joined to this session" });

  promoteNextWaitlistEntry("game", req.params.id, row.activity_label);

  await notifyResident({
    residentId: req.params.residentId,
    kind: "game",
    title: `Removed: ${row.activity_label}`,
    body: "The host has removed you from this session.",
    listingType: "game",
    listingId: req.params.id,
    ref: req.params.id,
  });

  res.json({ ok: true });
});

// Platform Pre-Launch Polish — Changeset 4C/4D/4F. Paid Games previously had
// no refund path from any role, anywhere — this is the first one. Full
// refund only (no partial refunds this phase), Host-owned-game only, and
// reuses issueStripeRefund() from checkoutService.ts exactly as-is — the
// same function bookings/registrations/programs/experiences already refund
// through — no second payment architecture. Cancellation and refund are
// deliberately independent: this never touches `status`, only
// `payment_status`, matching 4A/4B's own "cancelled != refunded" principle.
gamesRouter.post("/:id/participants/:residentId/refund", requireResident, async (req, res) => {
  const game = (await db.prepare(`SELECT host_resident_id as hostResidentId, activity_label as activityLabel FROM games WHERE id = ?`).get(req.params.id)) as
    | { hostResidentId: string; activityLabel: string }
    | undefined;
  if (!game) return res.status(404).json({ error: "Session not found" });
  if (game.hostResidentId !== req.resident!.id) return res.status(403).json({ error: "Only the host of this session can issue a refund" });

  const participant = (await db
    .prepare(
      `SELECT gp.ref, gp.payment_status as paymentStatus, gp.stripe_session_id as stripeSessionId, r.name as residentName, r.email as residentEmail
       FROM game_participants gp JOIN residents r ON r.id = gp.resident_id
       WHERE gp.game_id = ? AND gp.resident_id = ?`
    )
    .get(req.params.id, req.params.residentId)) as
    | { ref: string | null; paymentStatus: string; stripeSessionId: string | null; residentName: string; residentEmail: string }
    | undefined;
  if (!participant) return res.status(404).json({ error: "That resident isn't a participant in this session" });
  if (participant.paymentStatus === "refunded") return res.status(409).json({ error: "This participant has already been refunded" });
  if (participant.paymentStatus !== "paid") return res.status(400).json({ error: "This participant hasn't paid, so there's nothing to refund" });
  if (!participant.stripeSessionId) return res.status(400).json({ error: "No payment record found for this participant" });

  const result = await issueStripeRefund(participant.stripeSessionId);
  if (!result.ok) return res.status(502).json({ error: result.error });

  // Same idempotency idiom as vendorOperations.ts's refund routes — guards
  // against two concurrent refund requests both passing the earlier check
  // and both calling Stripe. changes===0 here means we lost that race; the
  // request that won already notified/audited, so this one just no-ops.
  const updateResult = await db
    .prepare(`UPDATE game_participants SET payment_status = 'refunded' WHERE game_id = ? AND resident_id = ? AND payment_status = 'paid'`)
    .run(req.params.id, req.params.residentId);
  if (updateResult.changes === 0) return res.status(409).json({ error: "This participant has already been refunded" });

  await writeAudit({
    actorUserId: req.resident!.id,
    action: "game_participant.refunded_by_host",
    objectType: "game_participant",
    objectId: `${req.params.id}:${req.params.residentId}`,
    previousValue: { paymentStatus: "paid" },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents },
  });

  const amount = `€${(result.amountCents / 100).toFixed(2)}`;
  await notifyResident({
    residentId: req.params.residentId,
    kind: "game",
    title: `Refunded: ${game.activityLabel}`,
    body: `${amount} has been refunded to you.`,
    listingType: "game",
    listingId: req.params.id,
    ref: req.params.id,
  }).catch((e) => console.error("[notifications] game refund resident notify failed:", e));
  await sendMail({
    to: participant.residentEmail,
    subject: `You've been refunded ${amount} — ${game.activityLabel}`,
    text: `Hi ${participant.residentName},\n\nYou've been refunded ${amount} for ${game.activityLabel}.\n\nThis can take a few business days to show up, depending on your bank.\n\nThanks for using Hello Circle.`,
  }).catch((e) => console.error("[email] game refund confirmation failed:", e));

  res.json({ ok: true, amountCents: result.amountCents });
});

/** Host-run check-in (Host Manage spec §11's kiosk screen) — Games only had
 * *self-serve* check-in before (GET /:id/check-in below, resident-initiated).
 * Nothing let a host check someone else in (e.g. a participant without a
 * phone, or checking a whole group in from one screen at the door). Same
 * ownership pattern as the remove route above. */
gamesRouter.post("/:id/participants/:residentId/check-in", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(req.params.id)) as { host_resident_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can check in a participant" });

  const info = await db
    .prepare(`UPDATE game_participants SET checked_in_at = NOW() WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .run(req.params.id, req.params.residentId);
  if (info.changes === 0) return res.status(404).json({ error: "That participant isn't joined to this session" });

  res.json({ ok: true });
});

const GAME_UPDATES_LIMIT = 10;

// Host-posted announcements ("Latest update" module, §25) — public read
// (anyone with the link can see what changed), host-only write.
gamesRouter.get("/:id/updates", async (req, res) => {
  const rows = await db
    .prepare(`SELECT id, message, created_at as createdAt FROM game_updates WHERE game_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(req.params.id, GAME_UPDATES_LIMIT);
  res.json(rows);
});

gamesRouter.post("/:id/updates", requireResident, async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message || !message.trim()) return res.status(400).json({ error: "An update message is required" });

  const row = (await db.prepare(`SELECT host_resident_id, activity_label FROM games WHERE id = ?`).get(req.params.id)) as
    | { host_resident_id: string; activity_label: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can post an update" });

  const info = await db.prepare(`INSERT INTO game_updates (game_id, message) VALUES (?, ?)`).run(req.params.id, message.trim());

  const participants = (await db
    .prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
    .all(req.params.id, req.resident!.id)) as { resident_id: string }[];
  for (const p of participants) {
    await notifyResident({
      residentId: p.resident_id,
      kind: "game",
      title: `Update: ${row.activity_label}`,
      body: message.trim(),
      listingType: "game",
      listingId: req.params.id,
      ref: req.params.id,
    });
  }

  res.status(201).json({ id: info.lastInsertRowid, message: message.trim() });
});

// Self-serve check-in (IA spec §11) — distinct from the existing vendor-QR
// check-in machinery (routes/vendorOperations.ts), which is bookings/
// registrations-only and always vendor-initiated. This is resident-
// initiated, for a Game specifically. Deliberately unrestricted by time
// window server-side (the client only shows the button in-window) — a
// late/early check-in isn't worth hard-blocking over.
gamesRouter.post("/:id/check-in", requireResident, async (req, res) => {
  const info = await db
    .prepare(`UPDATE game_participants SET checked_in_at = NOW() WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .run(req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "You're not joined to this session" });
  res.json({ ok: true });
});

// "Did you attend?" (IA spec §11) — resolves unverified attendance without
// treating the resident as dishonest, matching the spec's own explicit
// instruction for this screen. Available any time after joining (not
// gated on check-in — someone might check in late or not at all but still
// confirm they went).
gamesRouter.post("/:id/confirm-attendance", requireResident, async (req, res) => {
  const { attended } = req.body as { attended?: boolean };
  if (typeof attended !== "boolean") return res.status(400).json({ error: "attended must be a boolean" });
  const info = await db
    .prepare(`UPDATE game_participants SET attended = ? WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .run(attended ? 1 : 0, req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "You're not joined to this session" });
  if (attended) void logEvent("attended", { residentId: req.resident!.id, metadata: { gameId: req.params.id } });
  res.json({ ok: true });
});

// Host-only — closes a game early (e.g. plans changed). Distinct from a
// participant leaving: this ends it for everyone. Deliberately doesn't
// refund a paid join automatically — same off-platform-refund convention
// bookings.ts/registrations.ts already use for cancellations.
gamesRouter.post("/:id/cancel", requireResident, async (req, res) => {
  const { reason } = req.body as { reason?: string };
  const row = (await db.prepare(`SELECT host_resident_id, activity_label FROM games WHERE id = ?`).get(req.params.id)) as
    | { host_resident_id: string; activity_label: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can cancel this session" });

  await db.prepare(`UPDATE games SET status = 'cancelled' WHERE id = ?`).run(req.params.id);

  const participants = (await db
    .prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
    .all(req.params.id, req.resident!.id)) as { resident_id: string }[];
  for (const p of participants) {
    await notifyResident({
      residentId: p.resident_id,
      kind: "game",
      title: `Cancelled: ${row.activity_label}`,
      body: reason ? `The host has cancelled this session: ${reason}` : "The host has cancelled this session.",
      listingType: "game",
      listingId: req.params.id,
      ref: req.params.id,
    });
  }
  res.json({ ok: true });
});

// Host-only edit (HelloCircle Manage §3a) — the field set a host can change
// after creation matches exactly what POST / accepts below. Guards: can't
// edit a cancelled game, can't shrink capacity under who's already joined,
// and price is frozen once anyone besides the host has joined (confirmed with
// the user — avoids a billing mismatch for anyone who already paid the old
// price; every other field stays editable). A date/time/location change
// notifies every joined participant, reusing the exact fan-out loop shape
// POST /:id/cancel already uses — there's no shared "notify all participants"
// helper in this file today (update/cancel/full/threshold-met each already
// duplicate their own loop), so this follows suit rather than introducing one.
gamesRouter.put("/:id", requireResident, async (req, res) => {
  const b = req.body as CreateGameInput;
  if (!b.activityLabel || !b.date || !b.time || !b.capacity) {
    return res.status(400).json({ error: "Activity, date, time and capacity are required" });
  }
  if (!b.centreId && !b.locationText) {
    return res.status(400).json({ error: "A venue or a location is required" });
  }
  if (b.minParticipants !== undefined && (!Number.isInteger(b.minParticipants) || b.minParticipants < 1 || b.minParticipants > b.capacity)) {
    return res.status(400).json({ error: "Minimum players must be a whole number between 1 and the session's capacity" });
  }

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can edit this session" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This session has been cancelled and can no longer be edited" });

  const { n: joined } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status IN ('joined', 'pending_payment')`)
    .get(req.params.id)) as { n: number };
  if (b.capacity < joined) return res.status(409).json({ error: `Capacity can't be lower than the ${joined} people already joined` });

  // Platform Pre-Launch Polish — Changeset 4A follow-on: a cancelled
  // participant's row now persists (see DELETE /:id/join below) rather than
  // disappearing, so this must only count *active* claims — otherwise a
  // game everyone has since cancelled out of would stay permanently
  // price-locked.
  const { n: othersJoined } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND resident_id != ? AND status IN ('joined', 'pending_payment')`)
    .get(req.params.id, req.resident!.id)) as { n: number };
  const priceCents = othersJoined > 0 ? row.price_cents : b.priceCents ?? null;

  await db
    .prepare(
      `UPDATE games SET activity_label = ?, centre_id = ?, location_text = ?, date = ?, time = ?, skill_level = ?, capacity = ?,
              price_cents = ?, visibility = ?, solo_friendly = ?, min_participants = ?, confirmation_deadline = ?,
              description = ?, duration_minutes = ?, equipment_needed = ?, min_age = ?, surface_type = ?, indoor_outdoor = ?,
              meeting_instructions = ?, cancellation_policy = ?, image_url = COALESCE(?, image_url)
       WHERE id = ?`
    )
    .run(
      b.activityLabel,
      b.centreId ?? null,
      b.locationText ?? "",
      b.date,
      b.time,
      b.skillLevel ?? "",
      b.capacity,
      priceCents,
      b.visibility ?? row.visibility,
      b.soloFriendly ? 1 : 0,
      b.minParticipants ?? null,
      b.confirmationDeadline ?? null,
      b.description ?? null,
      b.durationMinutes ?? null,
      b.equipmentNeeded ?? null,
      b.minAge ?? null,
      b.surfaceType ?? "",
      b.indoorOutdoor ?? "",
      b.meetingInstructions ?? null,
      b.cancellationPolicy ?? null,
      b.imageUrl,
      req.params.id
    );

  const materialChange = b.date !== row.date || b.time !== row.time || (b.centreId ?? null) !== row.centre_id || (b.locationText ?? "") !== row.location_text;
  if (materialChange) {
    const participants = (await db
      .prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
      .all(req.params.id, req.resident!.id)) as { resident_id: string }[];
    for (const p of participants) {
      await notifyResident({
        residentId: p.resident_id,
        kind: "game",
        title: `Plan updated: ${b.activityLabel}`,
        body: `${b.date} at ${b.time} — the host has changed the date, time or location. Check the details.`,
        listingType: "game",
        listingId: req.params.id,
        ref: req.params.id,
      });
    }
  }

  const updated = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow;
  res.json(await toGameJson(updated));
});

// §27 — manual override: host can always open/pause/resume/publish now,
// regardless of any schedule, and Manage always reflects what they
// actually set (never silently mutated by a background job — see
// getEffectiveLifecycle's own comment). §29 — the client is expected to
// show a real confirmation with actual counts before calling this for a
// dangerous transition (cancel/archive); this endpoint itself only owns
// the transition's own validity + side effects, not the confirmation UX.
gamesRouter.post("/:id/lifecycle", requireResident, async (req, res) => {
  const { lifecycle: to } = req.body as { lifecycle?: Lifecycle };
  if (!to) return res.status(400).json({ error: "lifecycle is required" });

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can change this session's publishing state" });

  const from = row.lifecycle as Lifecycle;
  const result = validateLifecycleTransition("activity", from, to);
  if (!result.ok) return res.status(409).json({ error: result.reason });

  // A manual "open now" clears any stale bookingOpenAt in the past so a
  // later read doesn't misinterpret it — the host's explicit action here
  // *is* the open event, not the schedule.
  await db.prepare(`UPDATE games SET lifecycle = ?, booking_open_at = NULL WHERE id = ?`).run(to, row.id);

  const wasComingSoon = from === "coming_soon";
  if (wasComingSoon && to === "active") {
    // §7/§39 — the "immediately live" side effects createGameRow() skips
    // for a non-active game fire now instead, exactly once, the moment a
    // Coming Soon activity actually opens — same reasoning as gating them
    // at creation: a search-alert/intent match or a follower notification
    // for something nobody can book yet would be a false promise.
    await matchSearchAlertsForGame({ id: row.id, activityLabel: row.activity_label, hostResidentId: row.host_resident_id, centreId: row.centre_id, date: row.date, time: row.time });
    await matchParticipationIntentsForGame({ id: row.id, activityLabel: row.activity_label, centreId: row.centre_id, date: row.date });
    await notifyGameNotifyMeSubscribers(row.id);
  }

  const updated = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow;
  res.json(await toGameJson(updated));
});

// §36-38 — "Notify me" on a Coming Soon activity. requireResident here
// means a signed-out click goes through the existing signInHref/
// safeReturnTo flow (client-side) and lands back here once authenticated —
// no second auth system, per §38's explicit instruction.
gamesRouter.post("/:id/notify-me", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT id FROM games WHERE id = ?`).get(req.params.id)) as { id: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  const created = await subscribeNotifyMe(req.resident!.id, "game", req.params.id);
  res.status(created ? 201 : 200).json({ ok: true, alreadySubscribed: !created });
});

gamesRouter.delete("/:id/notify-me", requireResident, async (req, res) => {
  await unsubscribeNotifyMe(req.resident!.id, "game", req.params.id);
  res.json({ ok: true });
});

interface CreateGameInput {
  activityLabel: string;
  centreId?: string;
  locationText?: string;
  date: string;
  time: string;
  skillLevel?: string;
  capacity: number;
  priceCents?: number;
  visibility?: "public" | "circle" | "invite";
  soloFriendly?: boolean;
  /** Minimum Participation Booking (Phase 4) — total players needed
   * (including the host) before the game is confirmed. */
  minParticipants?: number;
  /** Open game detail (IA spec §5) — display-only, see db/index.ts's
   * ensureColumn comment. ISO datetime string. */
  confirmationDeadline?: string;
  // Game Detail redesign (§41) — all optional, host-provided plan content.
  description?: string;
  durationMinutes?: number;
  equipmentNeeded?: string;
  minAge?: number;
  surfaceType?: string;
  indoorOutdoor?: "indoor" | "outdoor" | "mixed";
  meetingInstructions?: string;
  cancellationPolicy?: string;
  /** HelloCircle Manage Phase 4 — set when this game is created as a specific
   * Circle's plan (the "Create plan" deep-link). Not ownership-checked here:
   * whoever's running this wizard is, by definition, the one creating the
   * game, regardless of which circle they're creating it for. */
  circleId?: string;
  /** Phase 2 "Circles V2" — set when this game is being created by
   * converting a confirmed circle_plans row (the "Create Activity" action).
   * Unlike circleId above, this IS ownership/state-checked (see the route
   * below) — converting someone else's plan, or a plan that isn't
   * `confirmed`, is a real state-mutating action, not just "create a game
   * tagged with a circle". */
  planId?: string;
  /** Cover image — set via a separate PUT after the initial create (needs a
   * real game id first, see media plan §31 / client's SingleImageUpload).
   * COALESCE'd in the UPDATE below, not part of createGameRow's INSERT, so
   * omitting it on an unrelated edit never wipes an existing cover. */
  imageUrl?: string;
  /** Universal Publishing, Lifecycle & Availability System — §21's
   * three-way publishing choice at create time. Defaults to 'active' when
   * omitted (every pre-existing caller of createGameRow — including the
   * Circles V2 Plan→Activity conversion in routes/circles.ts — keeps
   * publishing immediately, exactly as before this system existed). Only
   * 'draft'/'coming_soon'/'active' are meaningful here — a caller can't
   * create a game as already paused/completed/cancelled/archived. */
  lifecycle?: "draft" | "coming_soon" | "active";
  publishAt?: string;
  bookingOpenAt?: string;
  bookingCloseAt?: string;
}

/** Shared by POST / below and Phase 2's Plan→Activity conversion
 * (routes/circles.ts) — extracted verbatim from what used to be this
 * route's own body (zero behavior change for the existing route). Owns:
 * the insert transaction, the host auto-join, the plan-idea link/idempotency
 * guard when planId is set, and every post-creation side effect (search
 * alert matching, participation intent matching, follower notifications) —
 * a game created by converting a Plan gets exactly the same downstream
 * behaviour as one created directly. Validation (required fields, HTTP
 * status codes) stays the caller's responsibility. */
export async function createGameRow(input: CreateGameInput & { hostResidentId: string }): Promise<GameRow> {
  // The host is auto-joined below, so a threshold of 1 (or unset) is
  // already met at creation — only start pending if more than the host
  // is genuinely required.
  const startsPending = !!input.minParticipants && input.minParticipants > 1;
  const id = crypto.randomUUID();
  const lifecycle = input.lifecycle ?? "active";

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, skill_level, capacity, price_cents, visibility, solo_friendly, min_participants, confirmation_deadline, status, description, duration_minutes, equipment_needed, min_age, surface_type, indoor_outdoor, meeting_instructions, cancellation_policy, circle_id, plan_id, lifecycle, publish_at, booking_open_at, booking_close_at)
         VALUES (@id, @hostResidentId, @activityLabel, @centreId, @locationText, @date, @time, @skillLevel, @capacity, @priceCents, @visibility, @soloFriendly, @minParticipants, @confirmationDeadline, @status, @description, @durationMinutes, @equipmentNeeded, @minAge, @surfaceType, @indoorOutdoor, @meetingInstructions, @cancellationPolicy, @circleId, @planId, @lifecycle, @publishAt, @bookingOpenAt, @bookingCloseAt)`
      )
      .run({
        id,
        hostResidentId: input.hostResidentId,
        activityLabel: input.activityLabel,
        centreId: input.centreId ?? null,
        locationText: input.locationText ?? "",
        date: input.date,
        time: input.time,
        skillLevel: input.skillLevel ?? "",
        capacity: input.capacity,
        priceCents: input.priceCents ?? null,
        visibility: input.visibility ?? "public",
        soloFriendly: input.soloFriendly ? 1 : 0,
        minParticipants: input.minParticipants ?? null,
        confirmationDeadline: input.confirmationDeadline ?? null,
        status: startsPending ? "pending_participants" : "open",
        description: input.description ?? null,
        durationMinutes: input.durationMinutes ?? null,
        equipmentNeeded: input.equipmentNeeded ?? null,
        minAge: input.minAge ?? null,
        surfaceType: input.surfaceType ?? "",
        indoorOutdoor: input.indoorOutdoor ?? "",
        meetingInstructions: input.meetingInstructions ?? null,
        cancellationPolicy: input.cancellationPolicy ?? null,
        circleId: input.circleId ?? null,
        planId: input.planId ?? null,
        lifecycle,
        publishAt: input.publishAt ?? null,
        bookingOpenAt: input.bookingOpenAt ?? null,
        bookingCloseAt: input.bookingCloseAt ?? null,
      });
    // The host is automatically a participant — they take one of the capacity spots.
    await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(id, input.hostResidentId);

    // Phase 2 "Circles V2" — atomically flip the plan-idea to
    // activity_created and link it to this new game, guarded so two
    // concurrent conversions of the same plan can never both succeed: the
    // loser sees changes===0, throws, and its Game insert rolls back with
    // it in the same transaction. Same idempotency idiom as the Stripe
    // webhook's confirm* functions / the Phase 0 refund-race fix in
    // vendorOperations.ts.
    if (input.planId) {
      const linkResult = await tx
        .prepare(`UPDATE circle_plans SET status = 'activity_created', activity_source_type = 'game', activity_source_id = ? WHERE id = ? AND status = 'confirmed'`)
        .run(id, input.planId);
      if (linkResult.changes === 0) throw new ConflictError("This plan has already been converted into an activity");
    }
  });

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(id)) as GameRow;

  // Universal Publishing, Lifecycle & Availability System — a draft/coming-
  // soon game must not trigger any of these "this is now live" side
  // effects (§6/§7: not searchable, no alert matching; Coming Soon is
  // "publicly announced" but still pre-booking, so it also gets no search-
  // alert/intent match yet — those exist to surface *bookable* activities).
  // Only a game that's effectively 'active' right at creation fires them,
  // same behaviour as every pre-existing caller (which never set
  // `lifecycle` at all, and therefore defaults to 'active' above).
  if (getEffectiveGameLifecycle(row) === "active") {
    await matchSearchAlertsForGame({
      id: row.id,
      activityLabel: row.activity_label,
      hostResidentId: row.host_resident_id,
      centreId: row.centre_id,
      date: row.date,
      time: row.time,
    });
    await matchParticipationIntentsForGame({
      id: row.id,
      activityLabel: row.activity_label,
      centreId: row.centre_id,
      date: row.date,
    });

    // Follow feature — only a verified Host's followers get notified (an
    // unverified resident hosting a one-off game isn't the "keep me in the
    // loop on this host" relationship Follow represents).
    const hostRow = (await db.prepare(`SELECT host_status as hostStatus FROM residents WHERE id = ?`).get(input.hostResidentId)) as { hostStatus: string } | undefined;
    if (hostRow?.hostStatus === "verified") {
      await notifyHostFollowers(input.hostResidentId, { title: "New activity", body: `${row.activity_label} — ${row.date} at ${row.time}.`, ref: id });
    }
    if (row.centre_id) {
      await notifyCentreFollowers(row.centre_id, { title: "New activity at this venue", body: `${row.activity_label} — ${row.date} at ${row.time}.`, ref: id });
    }
  }

  return row;
}

gamesRouter.post("/", requireResident, async (req, res) => {
  const b = req.body as CreateGameInput;
  if (!b.activityLabel || !b.date || !b.time || !b.capacity) {
    return res.status(400).json({ error: "Activity, date, time and capacity are required" });
  }
  if (!b.centreId && !b.locationText) {
    return res.status(400).json({ error: "A venue or a location is required" });
  }
  if (b.minParticipants !== undefined && (!Number.isInteger(b.minParticipants) || b.minParticipants < 1 || b.minParticipants > b.capacity)) {
    return res.status(400).json({ error: "Minimum players must be a whole number between 1 and the session's capacity" });
  }
  if (b.lifecycle !== undefined && !["draft", "coming_soon", "active"].includes(b.lifecycle)) {
    return res.status(400).json({ error: "Publishing state must be draft, coming_soon, or active" });
  }

  // Phase 2 "Circles V2" — converting a confirmed plan-idea into a real
  // activity is a state-mutating action gated to that circle's organiser,
  // unlike the bare circleId tag above (which stays intentionally
  // unvalidated — see CreateGameInput's own comment).
  if (b.planId) {
    const plan = (await db.prepare(`SELECT circle_id as circleId, status FROM circle_plans WHERE id = ?`).get(b.planId)) as { circleId: string; status: string } | undefined;
    if (!plan || plan.circleId !== b.circleId) return res.status(404).json({ error: "Plan not found" });
    if (plan.status !== "confirmed") return res.status(409).json({ error: "This plan isn't confirmed yet" });
    if (!(await isCircleOrganiser(plan.circleId, req.resident!.id))) {
      return res.status(403).json({ error: "Only the organiser can create the activity for this plan" });
    }
    // Circle Experience Polish — Changeset 1D. A closed Circle is read-only
    // historical context — it can't convert a plan into a new activity.
    const circle = (await db.prepare(`SELECT status FROM circles WHERE id = ?`).get(plan.circleId)) as { status: string } | undefined;
    if (circle?.status === "closed") return res.status(409).json({ error: "This Circle is closed — plans can't be converted into new activities" });
  }

  let row: GameRow;
  try {
    row = await createGameRow({ ...b, hostResidentId: req.resident!.id });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  res.status(201).json(await toGameJson(row));
});

/** Minimum Participation Booking (Phase 4) — call after any join (free, or
 * a paid join once Stripe confirms it — see stripeWebhook.ts). If the game
 * is still 'pending_participants' and enough people have now joined,
 * flips it to 'open' and lets everyone who's in so far know. Never
 * throws — a failed notification/flip shouldn't fail the join that
 * triggered it. Reads via plain `db`, not a transaction handle, so callers
 * must invoke this only after their own transaction has committed. */
export async function checkMinParticipantsThreshold(gameId: string) {
  try {
    const row = (await db.prepare(`SELECT status, min_participants as minParticipants, activity_label as activityLabel, date, time FROM games WHERE id = ?`).get(gameId)) as
      | { status: string; minParticipants: number | null; activityLabel: string; date: string; time: string }
      | undefined;
    if (!row || row.status !== "pending_participants" || !row.minParticipants) return;

    const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(gameId)) as { n: number };
    if (joined < row.minParticipants) return;

    const info = await db.prepare(`UPDATE games SET status = 'open' WHERE id = ? AND status = 'pending_participants'`).run(gameId);
    if (info.changes === 0) return; // already flipped (concurrent join) — don't double-notify

    const participants = (await db.prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND status = 'joined'`).all(gameId)) as { resident_id: string }[];
    for (const p of participants) {
      await notifyResident({
        residentId: p.resident_id,
        kind: "game",
        title: `Confirmed: ${row.activityLabel}`,
        body: `Enough players joined — ${row.date} at ${row.time} is on.`,
        listingType: "game",
        listingId: gameId,
        ref: gameId,
      });
    }
  } catch (e) {
    console.error("[games] checkMinParticipantsThreshold failed:", e);
  }
}

// Row-locked the same way bookings.ts locks a room before checking overlap —
// prevents two joins from both passing the "spots left" check for the last
// spot before either has inserted their participant row. A free/cash game
// (priceCents unset) joins immediately, same as before. A priced game
// (NEXT — paid Join-a-Game) instead inserts a 'pending_payment' row and
// returns a Stripe Checkout url; the join only becomes 'joined' once
// stripeWebhook.ts confirms it — same never-trust-the-client contract as
// bookings/registrations.
gamesRouter.post("/:id/join", requireResident, async (req, res) => {
  const { couponCode: rawCouponCode } = req.body as { couponCode?: string };
  let insertedRef: string | null = null;
  let checkoutRow: GameRow | null = null;
  let joinedRow: GameRow | null = null;
  // Evaluated before the row-locked transaction below — coupon validity
  // depends only on the game's price, not on the capacity race that
  // transaction guards against — same order bookings.ts/registrations.ts
  // already use. Skipped (not a 404) if the game doesn't exist; the
  // transaction's own "Session not found" check handles that.
  let discountCents = 0;
  let appliedCouponCode: string | null = null;
  if (rawCouponCode) {
    const priceRow = (await db.prepare(`SELECT price_cents FROM games WHERE id = ?`).get(req.params.id)) as { price_cents: number | null } | undefined;
    if (priceRow?.price_cents) {
      const result = await evaluateCoupon(rawCouponCode, priceRow.price_cents, { listingType: "game", listingId: req.params.id });
      if (!result.valid) return res.status(400).json({ error: result.error });
      discountCents = result.discountCents!;
      appliedCouponCode = result.code!;
    }
  }
  // An active (unexpired) waitlist offer holds its spot — without this, a
  // fresh join could grab a freed slot out from under the person it was
  // actually offered to, during their 48h claim window. Exclude this
  // joiner's own offer (if any) — it's their spot to claim, not competing
  // demand against itself.
  const offeredCount = await activeOfferedCount("game", req.params.id);
  const ownsOffer = await hasActiveOffer("game", req.params.id, null, req.resident!.id);
  const reservedCount = offeredCount - (ownsOffer ? 1 : 0);
  try {
    await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT * FROM games WHERE id = ? FOR UPDATE`).get(req.params.id)) as GameRow | undefined;
      if (!row) throw new ConflictError("Session not found");
      joinedRow = row;
      // A 'pending_participants' game (Phase 4) is still joinable — that's
      // exactly how it reaches its threshold — only 'cancelled' blocks it.
      if (row.status !== "open" && row.status !== "pending_participants") throw new ConflictError("This session is no longer open");
      // §48 — CRITICAL: server-side lifecycle validation, not just a
      // disabled client button. A Draft/Coming Soon/Paused/Archived game
      // must reject a join even if its (separate) `status` column happens
      // to be 'open' — those two fields answer different questions (is
      // this operationally cancelled/needing more players, vs. has the
      // host actually published/opened it for booking yet).
      if (getEffectiveGameLifecycle(row) !== "active") {
        throw new ConflictError("Bookings are not currently open for this activity");
      }

      // Platform Pre-Launch Polish — Changeset 4A. Self-leave/host-remove no
      // longer hard-delete the row (see DELETE /:id/join and
      // /:id/participants/:residentId/remove below) — a resident who left
      // now has a real `status='cancelled'` row here, not no row at all.
      // "Already joined" must only block on an *active* claim, and a
      // previously-cancelled row needs an explicit re-activation path
      // instead of a plain INSERT (the UNIQUE(game_id, resident_id) key
      // would otherwise reject it outright).
      const existing = (await tx.prepare(`SELECT id, status, payment_status FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id)) as
        | { id: number; status: string; payment_status: string }
        | undefined;
      if (existing && (existing.status === "joined" || existing.status === "pending_payment")) {
        throw new ConflictError("You've already joined this session");
      }
      // A cancelled row that's still marked 'paid' means a prior payment was
      // never refunded — silently reusing the row to rejoin would overwrite
      // that unresolved payment history, exactly what this changeset exists
      // to stop. Force it to be resolved (by the host, via the new refund
      // route below) before the same person can rejoin.
      //
      // Only meaningful for a genuinely *priced* game — payment_status
      // defaults to 'paid' even on a free join (there's no real charge to
      // track), so gating on payment_status alone would wrongly block a
      // free-game rejoin with a nonsensical "unrefunded payment" message
      // (caught live against hello_circle_dev during this changeset's own
      // smoke test).
      if (row.price_cents && existing && existing.status === "cancelled" && existing.payment_status === "paid") {
        throw new ConflictError("You have an unrefunded payment for this session from a previous join — contact the host before rejoining.");
      }

      const { n: joined } = (await tx
        .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status IN ('joined', 'pending_payment')`)
        .get(req.params.id)) as { n: number };
      if (computeCapacity(row.capacity, joined + reservedCount).isFull) throw new ConflictError("This session is full");

      const isPaid = !!row.price_cents && row.price_cents > 0;
      if (isPaid) {
        const ref = generateRef("GJ");
        if (existing) {
          await tx
            .prepare(
              `UPDATE game_participants SET ref = ?, status = 'pending_payment', payment_status = 'pending', coupon_code = ?, stripe_session_id = NULL, checked_in_at = NULL, attended = NULL, joined_at = NOW() WHERE id = ?`
            )
            .run(ref, appliedCouponCode, existing.id);
        } else {
          await tx
            .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status, coupon_code) VALUES (?, ?, ?, 'pending_payment', 'pending', ?)`)
            .run(req.params.id, req.resident!.id, ref, appliedCouponCode);
        }
        insertedRef = ref;
        checkoutRow = row;
        return;
      }

      if (existing) {
        await tx
          .prepare(`UPDATE game_participants SET status = 'joined', payment_status = 'paid', ref = NULL, coupon_code = NULL, stripe_session_id = NULL, checked_in_at = NULL, attended = NULL, joined_at = NOW() WHERE id = ?`)
          .run(existing.id);
      } else {
        await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(req.params.id, req.resident!.id);
      }

      if (joined + 1 >= row.capacity) {
        await notifyResident({
          residentId: row.host_resident_id,
          kind: "game",
          title: `Your session is full: ${row.activity_label}`,
          body: `${row.date} at ${row.time} — all ${row.capacity} spots are taken.`,
          listingType: "game",
          listingId: row.id,
          ref: row.id,
        });
      }
    });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  // A free join is already 'joined' the moment the transaction above
  // commits — check the threshold now. A paid join isn't 'joined' until
  // stripeWebhook.ts's confirmGameJoin runs, which checks it there instead.
  if (!insertedRef) {
    await claimWaitlistOffer("game", req.params.id, null, req.resident!.id);
    await checkMinParticipantsThreshold(req.params.id);
    await upgradeFavouriteStatus(req.resident!.id, "game", req.params.id);
    const joinedActivityLabel: string | undefined = joinedRow ? (joinedRow as GameRow).activity_label : undefined;
    void logEvent("game_joined", { residentId: req.resident!.id, metadata: { gameId: req.params.id, activityLabel: joinedActivityLabel } });
    // Cheap repeat-participation heuristic (not a new dedup system) — did
    // this resident already join/attend the same activity before today?
    if (joinedActivityLabel) {
      const activityLabel = joinedActivityLabel;
      void (async () => {
        const { n } = (await db
          .prepare(
            `SELECT COUNT(*) as n FROM game_participants gp JOIN games g ON g.id = gp.game_id
             WHERE gp.resident_id = ? AND gp.status = 'joined' AND g.activity_label = ? AND g.id != ?`
          )
          .get(req.resident!.id, activityLabel, req.params.id)) as { n: number };
        if (n > 0) await logEvent("repeat_joined", { residentId: req.resident!.id, metadata: { gameId: req.params.id, activityLabel } });
      })();
    }
  }

  if (!insertedRef || !checkoutRow) return res.json({ ok: true });

  const row = checkoutRow as GameRow;
  const pricing = computePricing(row.price_cents!, 0, discountCents, appliedCouponCode);
  const result = await createCheckoutSession({
    ref: insertedRef,
    type: "game",
    customerEmail: req.resident!.email,
    residentId: req.resident!.id,
    lineItems: pricingLineItems(pricing, {
      name: `${row.activity_label} — ${row.date} ${row.time}`,
      description: appliedCouponCode ? `(coupon ${appliedCouponCode} applied)` : undefined,
    }),
    isNative: req.header("X-Client-Platform") === "mobile",
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM game_participants WHERE ref = ?`).run(insertedRef);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE game_participants SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, insertedRef);
  res.status(201).json({ ref: insertedRef, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

/** Mirrors bookings.ts's/registrations.ts's GET /status/:ref — PaymentSuccess.tsx
 * polls this for a "GJ-" ref after the Stripe redirect. A paid game join is
 * always resident-owned (join requires requireResident), so ownership is by
 * resident_id, not client_id. total_cents lives on the parent game, not the
 * participant row. */
gamesRouter.get("/status/:ref", requireResident, async (req, res) => {
  // Resident Experience Polish — Changeset 5, same reasoning as
  // bookings.ts's GET /status/:ref.
  const row = await db
    .prepare(
      `SELECT gp.ref, gp.payment_status as paymentStatus, g.price_cents as totalCents,
              g.id as gameId, g.activity_label as activityLabel, g.date, g.time, c.name as centreName, g.location_text as locationText
       FROM game_participants gp JOIN games g ON g.id = gp.game_id LEFT JOIN centres c ON c.id = g.centre_id
       WHERE gp.ref = ? AND gp.resident_id = ?`
    )
    .get(req.params.ref, req.resident!.id);
  if (!row) return res.status(404).json({ error: "Session join not found" });
  res.json(row);
});

// --- waitlist (NEXT) — mirrors routes/clubs.ts's club waitlist ------------

gamesRouter.post("/:id/waitlist", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  // §48 — same server-side lifecycle gate as a normal join: a waitlist
  // signup is still a real transaction (an inserted waitlist_entries row),
  // so a Draft/Coming Soon/Paused/Archived game must reject it too.
  if (getEffectiveGameLifecycle(row) !== "active") {
    return res.status(409).json({ error: "Bookings are not currently open for this activity" });
  }
  const existing = await db
    .prepare(`SELECT id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'`)
    .get(req.params.id, req.resident!.id);
  if (existing) return res.status(409).json({ error: "You're already on the waitlist for this session" });
  await db
    .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email) VALUES ('game', ?, ?, '', ?, ?)`)
    .run(req.params.id, req.resident!.id, req.resident!.name, req.resident!.email);
  res.status(201).json({ ok: true });
});

gamesRouter.delete("/:id/waitlist", requireResident, async (req, res) => {
  await db
    .prepare(`UPDATE waitlist_entries SET status = 'left' WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'`)
    .run(req.params.id, req.resident!.id);
  res.json({ ok: true });
});

/** Host-visible waitlist (Vendor-parity pass) — mirrors
 * GET /vendor/clubs/:id/waitlist, ownership via host_resident_id instead of
 * vendorIds. No host-facing waitlist visibility existed at all before this
 * — only the resident's own self-service join/leave above. */
gamesRouter.get("/:id/waitlist", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(req.params.id)) as { host_resident_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can see this session's waitlist" });
  const rows = await db
    .prepare(
      `SELECT id, name, email, status, created_at as createdAt, offer_expires_at as offerExpiresAt
       FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND status IN ('waiting', 'offered') ORDER BY id`
    )
    .all(req.params.id);
  res.json(rows);
});

/** Host-side "invite this person" (Vendor-parity pass) — reuses the
 * already-generic offerToWaitlistEntry() built for Vendor's club waitlist
 * (waitlist.ts already accepts "game" as a listing type; no waitlist.ts
 * changes needed here, just this route). */
gamesRouter.post("/:id/waitlist/:entryId/offer", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id, activity_label FROM games WHERE id = ?`).get(req.params.id)) as
    | { host_resident_id: string; activity_label: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can invite from the waitlist" });
  const result = await offerToWaitlistEntry(Number(req.params.entryId), "game", req.params.id, row.activity_label);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ ok: true });
});

// Self-leave. Platform Pre-Launch Polish — Changeset 4A/4B. Used to
// hard-delete the participant row outright — a paid, possibly-attended
// transaction could vanish with no trace, and nothing stopped a resident
// leaving a session that had already happened. Now: soft-cancels (status
// only — payment_status/stripe_session_id/attended all stay exactly as
// they were, so a paid-but-cancelled row still exists for the host to
// refund via POST /:id/participants/:residentId/refund below), and is
// blocked outright once the session's start time has passed.
gamesRouter.delete("/:id/join", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT activity_label, host_resident_id as hostResidentId, date, time FROM games WHERE id = ?`).get(req.params.id)) as
    | { activity_label: string; hostResidentId: string; date: string; time: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });

  const [hour, minute] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, hour, minute);
  if (Date.now() >= start.getTime()) {
    return res.status(409).json({ error: "This activity has already taken place." });
  }

  const participant = (await db
    .prepare(`SELECT payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .get(req.params.id, req.resident!.id)) as { paymentStatus: string | null } | undefined;
  if (!participant) return res.status(404).json({ error: "You haven't joined this session" });

  await db.prepare(`UPDATE game_participants SET status = 'cancelled' WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).run(req.params.id, req.resident!.id);

  promoteNextWaitlistEntry("game", req.params.id, row.activity_label);

  if (participant.paymentStatus === "paid" && row.hostResidentId !== req.resident!.id) {
    await notifyResident({
      residentId: row.hostResidentId,
      kind: "game",
      title: `${req.resident!.name} left ${row.activity_label}`,
      body: `They'd paid to join — you can issue a refund from your activity's participant list.`,
      listingType: "game",
      listingId: req.params.id,
      ref: req.params.id,
    });
  }

  res.json({ ok: true });
});
