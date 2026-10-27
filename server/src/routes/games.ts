import { viewerGameState } from "../gameCardFacts.js";
import { applyListingCategory, categoryFromBody, setListingTags, taxonomyFields, taxonomyFilter } from "../taxonomy.js";
import { heldRefsFor, shortenReviewHolds } from "../payments/paymentReview.js";
import { moveBookingSlot, slotRuleError } from "../bookingMove.js";
import { bookingChangeBlock } from "../selfCancel.js";
import { hasOpenReview } from "../payments/paymentReview.js";
import { orgPoliciesForVendor } from "../db/queries.js";
import { notifyNewBookingOrRegistration } from "../notifications.js";
import { customerPaymentCase } from "../payments/paymentReview.js";
import crypto from "node:crypto";
import { paymentUnderReview } from "../payments/checkoutAgreement.js";
import { minAgeError } from "../orderAcknowledgements.js";
import { shadowLegacy } from "../commerce/engine.js";
import { Router } from "express";
import { logEvent, logView } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
import { createCheckoutSession, refundPaidOnce, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { commerceSwitch } from "../commerce/switches.js";
import { partnerBalances } from "../commerce/settlement.js";
import { countFamiliarCoParticipants } from "../db/queries.js";
import { isMember as isCircleMember, isOrganiser as isCircleOrganiser } from "./circleHelpers.js";
import { featureOn } from "../circleFeatures.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyCentreFollowers, notifyHostFollowers } from "./follows.js";
import { buildIcsEvent } from "../ics.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyResident } from "../notifications.js";
import { sendMail } from "../email.js";
import { writeAudit } from "../audit.js";
import { CLIENT_URL } from "../stripe.js";
import { matchParticipationIntentsForGame } from "../participationIntents.js";
import { computePricing, couponAmountError, evaluateCoupon, parseCouponLimits } from "../pricing.js";
import { requireResident } from "../residents.js";
import { matchSearchAlertsForGame } from "../searchAlerts.js";
import { PaginationError, parsePageParams, setNextCursor } from "../pagination.js";
import { canViewGame, discoverableGameSql, getEffectiveGameLifecycle, loadViewableGame } from "../gameVisibility.js";
export { getEffectiveGameLifecycle } from "../gameVisibility.js";
import { getListingAttributes, setListingAttributes } from "../listingAttributes.js";
import { getNextSteps } from "../nextSteps.js";
import { getOpportunities } from "../participationIntents.js";
import { BadRequestError, ConflictError, generateRef } from "../util.js";
import { noticeListingCancelled } from "../circlePlanNotices.js";
import { addListingLink } from "./circleLinks.js";
import { consumeCoupon, customerKeyOf, endPendingHold, gameSeatSql, holdIsLive } from "../bookingIntegrity.js";
import { getEffectiveAvailability, getEffectiveLifecycle, getPublicLifecycleLabel, validateLifecycleTransition, type Lifecycle } from "../lifecycle.js";
import { isSubscribedToNotifyMe, notifyGameNotifyMeSubscribers, subscribeNotifyMe, unsubscribeNotifyMe } from "../notifyMe.js";
import { activeOfferedCount, claimWaitlistOffer, hasActiveOffer, offerToWaitlistEntry, promoteNextWaitlistEntry } from "../waitlist.js";

// HC-QA-056 — Circle members hear about every plan (the join dialog and
// Circle card promise this). Fired when a Circle plan becomes bookable —
// created already active, or opened from Coming Soon — never for a draft or
// a still-Coming-Soon plan (same reasoning as the follower notifications).
// Current members only (removed members are no longer in circle_members),
// never the organiser who created it, and at most once per member per plan
// so a repeated open or a retry can't duplicate it.
async function notifyCircleMembersOfPlan(row: GameRow) {
  if (!row.circle_id) return;
  // Experience 3.0 — a shared Circle-to-Circle activity is announced to the
  // partner Circle's members too (same once-per-member guard).
  const partnerId = (row as unknown as { partner_circle_id?: string | null }).partner_circle_id;
  if (partnerId) await announceToCircle(row, partnerId, true);
  await announceToCircle(row, row.circle_id, false);
}

async function announceToCircle(row: GameRow, circleId: string, asPartner: boolean) {
  const circle = (await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(circleId)) as { name: string } | undefined;
  const owner = asPartner ? ((await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(row.circle_id)) as { name: string } | undefined) : undefined;
  if (!circle) return;
  const members = (await db
    .prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ? AND resident_id != ?`)
    .all(circleId, row.host_resident_id)) as { resident_id: string }[];
  // Circle Experience 2.0, Make It Happen — members who said "I'm in" on the
  // plan idea this activity came from get the same single notice, worded as
  // the thing they asked for happening (still one notice each, same guard).
  const planId = (row as unknown as { plan_id?: string | null }).plan_id ?? null;
  const interested = new Set(
    planId ? ((await db.prepare(`SELECT resident_id FROM circle_plan_interest WHERE plan_id = ?`).all(planId)) as { resident_id: string }[]).map((r) => r.resident_id) : []
  );
  for (const m of members) {
    const already = await db
      .prepare(`SELECT 1 FROM notifications WHERE resident_id = ? AND kind = 'circle' AND listing_type = 'game' AND listing_id = ?`)
      .get(m.resident_id, row.id);
    if (already) continue;
    await notifyResident({
      residentId: m.resident_id,
      kind: "circle",
      title: asPartner
        ? `Shared activity with ${owner?.name ?? "another Circle"}: ${row.activity_label}`
        : interested.has(m.resident_id)
          ? `It's happening: ${row.activity_label} in ${circle.name}`
          : `New plan in ${circle.name}: ${row.activity_label}`,
      body: `${row.date} at ${row.time}${row.location_text ? ` · ${row.location_text}` : ""}`,
      listingType: "game",
      listingId: row.id,
      ref: row.id,
    });
  }
}

/** Booking UX Phase 5 (audit B11) — an activity may name a venue only
 * through the host's own confirmed booking there: same venue, same date,
 * starting inside the booked hours, and no more people than the room holds.
 * Without one, the host gives an address (locationText) instead — the venue
 * is never shown as hosting something it hasn't been booked for. */
export async function venueBookingProblem(hostId: string, input: { centreId: string; bookingRef?: string | null; date: string; time: string; capacity: number }): Promise<string | null> {
  if (!input.bookingRef) return "To hold this at a venue, book it first and pick that booking — or enter an address instead";
  const booking = (await db
    .prepare(
      `SELECT b.centre_id as centreId, b.date, b.time, b.duration, r.cap
       FROM bookings b LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE b.ref = ? AND b.resident_id = ? AND b.payment_status = 'paid' AND b.status != 'cancelled'`
    )
    .get(input.bookingRef, hostId)) as { centreId: string; date: string; time: string; duration: number; cap: number | null } | undefined;
  if (!booking || booking.centreId !== input.centreId) return "That booking isn't yours, isn't confirmed, or is for a different venue";
  if (booking.date !== input.date) return "The activity has to be on the date you booked the venue";
  const start = parseInt(booking.time.slice(0, 2), 10);
  const hour = parseInt(input.time.slice(0, 2), 10);
  if (!(hour >= start && hour < start + Number(booking.duration))) return `The activity has to start within your booking (${booking.time} for ${booking.duration} hours)`;
  if (booking.cap && booking.cap > 0 && input.capacity > booking.cap) return `The room you booked holds up to ${booking.cap}`;
  return null;
}

/** Booking UX Phase 4 (B9) — refused for want of the minimum-age declaration;
 * the response carries `minAge` so a quick-join can open the activity page. */
class MinAgeRequiredError extends BadRequestError {
  constructor(message: string, readonly minAge: number) {
    super(message);
  }
}

export const gamesRouter = Router();

// Commerce audit R3 — every paid Game's money is collected into the
// platform's own Stripe account, so charging for one is limited to residents
// an admin has verified as hosts. Admin kill switch: app_settings
// 'commerce.paid_games_require_verified_host' = 'false' restores the old
// open behaviour without a deploy.
const PAID_HOST_ERROR = "Charging for an activity is available to verified hosts — apply to host from your profile, or make this one free";
async function mayHostPaid(residentId: string): Promise<boolean> {
  if (!(await commerceSwitch("commerce.paid_games_require_verified_host"))) return true;
  const row = (await db.prepare(`SELECT host_status FROM residents WHERE id = ?`).get(residentId)) as { host_status: string } | undefined;
  return row?.host_status === "verified";
}

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
  experience_required: string | null;
  accessibility_info: string | null;
  cancellation_policy: string | null;
  circle_id: string | null;
  lifecycle: string;
  publish_at: string | null;
  booking_open_at: string | null;
  booking_close_at: string | null;
  /** OG-27 — 'open' (join straight away) or 'approval' (free activities only: the host approves each request). */
  join_mode?: string;
  /** OG-26 — set on each occurrence of a weekly series. */
  series_id?: string | null;
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
  // Experience 3.0 — the partner Circle of a shared Circle-to-Circle activity.
  const partnerId = (row as unknown as { partner_circle_id?: string | null }).partner_circle_id;
  const partnerCircle = partnerId ? ((await db.prepare(`SELECT id, name, slug FROM circles WHERE id = ?`).get(partnerId)) as { id: string; name: string; slug: string | null } | undefined) ?? null : null;
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
    joinMode: row.join_mode === "approval" ? "approval" : "open",
    seriesId: row.series_id ?? null,
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
    experienceRequired: row.experience_required || null,
    accessibilityInfo: row.accessibility_info || null,
    minAge: row.min_age,
    surfaceType: row.surface_type || null,
    indoorOutdoor: row.indoor_outdoor || null,
    cancellationPolicy: row.cancellation_policy,
    /** HelloCircle Manage Phase 4 — set only when this game was created as a
     * specific Circle's plan (via the "Create plan" deep-link). */
    circleId: row.circle_id,
    partnerCircle,
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
// HC-QA-073 — keyset-paginated public activity list (see pagination.ts).
// Visibility/lifecycle (discoverableGameSql), status and date window are part
// of the SAME query that is paginated, so nothing private is ever fetched and
// filtered afterwards. Filters the Games page used to apply only client-side
// over the full list are applied here too, so a page never hides matches:
//   q (activity / centre / location / area), county, category (exact
//   activity), dateFrom/dateTo (ISO), timeFrom (HH:MM), weekend=1,
//   priceMin/priceMax (cents), skill (matches like the UI: unset/"All levels"
//   always match), centreId (a venue's own activities — HC-QA-101).
//   Order: date, time, id (total, stable).
gamesRouter.get("/", async (req, res) => {
  let page;
  try {
    page = parsePageParams<[string, string, string]>(req.query as Record<string, unknown>, ["string", "string", "string"]);
  } catch (e) {
    if (e instanceof PaginationError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const q = req.query as Record<string, string | undefined>;
  const isoDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  // Activities waiting for enough people ('pending_participants') are still
  // joinable, so they're listed too: they're the ones that most need joiners
  // (Activities card labels, owner 2026-10-27: "2 more needed").
  const where: string[] = ["g.status IN ('open', 'pending_participants')", discoverableGameSql("g"), "g.date >= ?"];
  const params: unknown[] = [irelandTodayIso()];
  if (q.county) { where.push("c.county = ?"); params.push(q.county); }
  if (q.centreId) { where.push("g.centre_id = ?"); params.push(q.centreId); }
  if (q.category) { where.push("g.activity_label = ?"); params.push(q.category); }
  if (q.q && q.q.trim()) {
    const like = `%${q.q.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(LOWER(g.activity_label) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ? OR LOWER(COALESCE(g.location_text, '')) LIKE ? OR LOWER(COALESCE(c.area, '')) LIKE ?)");
    params.push(like, like, like, like);
  }
  if (isoDate(q.dateFrom)) { where.push("g.date >= ?"); params.push(q.dateFrom); }
  if (isoDate(q.dateTo)) { where.push("g.date <= ?"); params.push(q.dateTo); }
  if (q.timeFrom && /^\d{2}:\d{2}$/.test(q.timeFrom)) { where.push("g.time >= ?"); params.push(q.timeFrom); }
  if (q.weekend === "1") where.push("DAYOFWEEK(g.date) IN (1, 7)");
  if (q.priceMin && /^\d+$/.test(q.priceMin)) { where.push("COALESCE(g.price_cents, 0) >= ?"); params.push(Number(q.priceMin)); }
  if (q.priceMax && /^\d+$/.test(q.priceMax)) { where.push("COALESCE(g.price_cents, 0) <= ?"); params.push(Number(q.priceMax)); }
  if (q.skill && q.skill !== "any") { where.push("(g.skill_level IS NULL OR g.skill_level = '' OR g.skill_level = 'All levels' OR LOWER(g.skill_level) = LOWER(?))"); params.push(q.skill); }
  // Category system — categoryId/subcategoryId (or …Slug); unknown → no rows.
  const tax = await taxonomyFilter("game", "g.id", q);
  if (tax === "none") { setNextCursor(res, null); return res.json([]); }
  if (tax) { where.push(tax.sql); params.push(...tax.params); }
  if (page.after) {
    const [d, t, id] = page.after;
    where.push("(g.date > ? OR (g.date = ? AND (g.time > ? OR (g.time = ? AND g.id > ?))))");
    params.push(d, d, t, t, id);
  }
  const rows = (await db
    .prepare(`SELECT g.* FROM games g LEFT JOIN centres c ON c.id = g.centre_id WHERE ${where.join(" AND ")} ORDER BY g.date, g.time, g.id LIMIT ${page.limit + 1}`)
    .all(...params)) as GameRow[];
  const more = rows.length > page.limit;
  const pageRows = more ? rows.slice(0, page.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  setNextCursor(res, more && last ? [String(last.date), String(last.time), String(last.id)] : null);
  const games = await Promise.all(pageRows.map(toGameJson));
  res.json(await withViewerState(games, req.resident?.id ?? null));
});

/** The signed-in viewer's own state on each listed activity, for the
 * Activities card labels (owner 2026-10-27): joined, waiting on the
 * waitlist (or offered a place), or a join request waiting for the host.
 * Only ever the viewer's own rows; signed out adds nothing. */
async function withViewerState<T extends { id: string }>(games: T[], residentId: string | null): Promise<T[]> {
  if (!residentId || games.length === 0) return games;
  const mine = await viewerGameState(games.map((g) => g.id), residentId);
  return games.map((g) => ({ ...g, joinedByMe: mine.joined.has(g.id), waitlistedByMe: mine.waiting.has(g.id), joinRequestByMe: mine.requested.has(g.id) ? "requested" : null }));
}

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
// Host opportunities for verified resident hosts (Release 6) — same
// aggregate-only clusters vendors see, scoped to the host's home county.
// The action on the client is "Create a game", prefilled from the cluster.
gamesRouter.get("/host/opportunities", requireResident, async (req, res) => {
  const me = (await db.prepare(`SELECT host_status as hostStatus, home_county as homeCounty FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { hostStatus: string; homeCounty: string | null }
    | undefined;
  if (me?.hostStatus !== "verified") return res.status(403).json({ error: "Opportunities are for verified hosts" });
  const opportunities = await getOpportunities(me.homeCounty ? [me.homeCounty] : null);
  void logEvent("host_opportunity_viewed", { residentId: req.resident!.id, metadata: { by: "resident_host", shown: opportunities.length } });
  res.json({ opportunities, counties: me.homeCounty ? [me.homeCounty] : [] });
});

/** Booking UX Phase 5 (B11) — the host's own upcoming, confirmed venue
 * bookings: what an activity can be held on (see venueBookingProblem). */
// OG-16 / OG-28 — the host's own venue reservations (the bookings they made as
// a resident): upcoming, past (12 months) and cancelled, with what was paid
// and the activity held on each. Read-only; the booking itself is managed
// from My Life (or moved with its activity, OG-12).
gamesRouter.get("/host/reservations", requireResident, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT b.ref, b.centre_id as centreId, c.name as centreName, c.slug as centreSlug, r.name as roomName, b.date, b.time, b.duration, b.guests,
              b.status, b.payment_status as paymentStatus, b.total_cents as totalCents, b.stripe_session_id IS NOT NULL as paidOnline, b.created_at as createdAt,
              (SELECT COALESCE(SUM(rf.amount_minor), 0) FROM refunds rf WHERE rf.source_type = 'booking' AND rf.source_ref = b.ref AND rf.status IN ('succeeded', 'reconciled')) as refundedCents,
              g.id as gameId, g.activity_label as activityLabel, g.status as gameStatus, g.price_cents as gamePriceCents
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       LEFT JOIN games g ON g.booking_ref = b.ref
       WHERE b.resident_id = ? AND b.payment_status IN ('paid', 'refunded', 'pending') AND b.date >= ?
       ORDER BY b.date DESC, b.time DESC LIMIT 300`
    )
    .all(req.resident!.id, new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10))) as Record<string, unknown>[];
  res.json(rows.map((r) => ({ ...r, paidOnline: Number(r.paidOnline) === 1, totalCents: Number(r.totalCents ?? 0), refundedCents: Number(r.refundedCents ?? 0) })));
});

gamesRouter.get("/host/venue-bookings", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT b.ref, b.centre_id as centreId, c.name as centreName, r.name as roomName, r.cap, b.date, b.time, b.duration
       FROM bookings b JOIN centres c ON c.id = b.centre_id LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE b.resident_id = ? AND b.payment_status = 'paid' AND b.status != 'cancelled' AND b.date >= ?
       ORDER BY b.date, b.time`
    )
    .all(req.resident!.id, irelandTodayIso());
  res.json(rows);
});

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
// Revenue & Connect Stage 2d — a host's own earnings from the ledger.
// (Stage 5c: was also mounted at /host/earnings, where the paid-players list
// above already answers first — so hosts never got their balances.)
gamesRouter.get("/host/balances", requireResident, async (req, res) => {
  res.json(await partnerBalances({ partyType: "host", partyId: req.resident!.id }));
});

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
  const amountError = couponAmountError(b.kind, b.amount);
  if (amountError) return res.status(400).json({ error: amountError });
  const game = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(b.gameId)) as { host_resident_id: string } | undefined;
  if (!game || game.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Not your session" });
  // Commerce Engine Phase 3 — host coupons are partner-funded; optional limits.
  const limits = parseCouponLimits(req.body as Record<string, unknown>);
  if (!limits.ok) return res.status(400).json({ error: limits.error });
  try {
    await db
      .prepare(
        `INSERT INTO coupons (code, kind, amount, max_uses, expires_at, created_by_resident_id, eligible_listing_type, eligible_listing_id,
                              funding, platform_share_bps, min_spend_cents, max_discount_cents, per_customer_limit, starts_at)
         VALUES (?, ?, ?, ?, ?, ?, 'game', ?, 'partner', 0, ?, ?, ?, ?)`
      )
      .run(b.code.trim().toUpperCase(), b.kind, b.amount, b.maxUses ?? null, b.expiresAt ?? null, req.resident!.id, b.gameId,
        limits.limits.minSpendCents, limits.limits.maxDiscountCents, limits.limits.perCustomerLimit, limits.limits.startsAt);
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

// "6 first-timers" (Release 2) — joined participants, host excluded, with no
// earlier joined game of the same activity. Aggregate only, and null below
// FIRST_TIMER_MIN so a small group can't be narrowed down to individuals.
// Anyone who opted out of familiarity counts (hide_from_familiar_count, the
// existing privacy switch for exactly this kind of aggregate) isn't counted.
const FIRST_TIMER_MIN = 3;

async function countFirstTimers(row: GameRow): Promise<number | null> {
  const { n } = (await db
    .prepare(
      `SELECT COUNT(*) as n FROM game_participants gp
       JOIN residents r ON r.id = gp.resident_id
       WHERE gp.game_id = ? AND gp.status = 'joined' AND gp.resident_id != ?
         AND r.hide_from_familiar_count = 0 AND r.deactivated_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM game_participants gp2 JOIN games g2 ON g2.id = gp2.game_id
           WHERE gp2.resident_id = gp.resident_id AND gp2.status = 'joined' AND g2.id != gp.game_id
             AND LOWER(g2.activity_label) = LOWER(?) AND g2.status != 'cancelled'
             AND (g2.date < ? OR (g2.date = ? AND g2.time < ?))
         )`
    )
    .get(row.id, row.host_resident_id, row.activity_label, row.date, row.date, row.time)) as { n: number | string };
  const count = Number(n);
  return count >= FIRST_TIMER_MIN ? count : null;
}

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
  if (!(await canViewGame(row, req.resident?.id ?? null))) {
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
  let myJoin: { ref: string; paymentReview: boolean } | null = null;
  if (req.resident) {
    // Platform Pre-Launch Polish — Changeset 4E. Self-leave/host-remove now
    // soft-cancel (status='cancelled') rather than deleting the row (see
    // DELETE /:id/join below) — this must only count an *active* claim as
    // "joined", or a resident who left would still see themselves as
    // joined (and the page would still offer "Leave" instead of "Join")
    // after they'd already left.
    const p = (await db
      .prepare(`SELECT status, ref, payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ? AND status IN ('joined', 'pending_payment')`)
      .get(req.params.id, req.resident.id)) as { status: string; ref: string | null; paymentStatus: string | null } | undefined;
    joinedByMe = !!p;
    // The pass (owner 2026-10-27): a paid join's own reference, and whether
    // its payment is still being checked (D-10) — never shown as booked then.
    if (p?.ref && p.paymentStatus === "paid") myJoin = { ref: p.ref, paymentReview: false };
    else if (p?.ref && p.paymentStatus === "pending") myJoin = { ref: p.ref, paymentReview: await paymentUnderReview("game", p.ref) };
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
  const [participationAttributes, firstTimerCount] = await Promise.all([getListingAttributes("game", row.id), countFirstTimers(row)]);
  logView("activity_viewed", req, { kind: "game", id: row.id });
  // OG-27 — this resident's own join request on an approval activity, if any.
  const joinRequestByMe = req.resident
    ? (((await db.prepare(`SELECT status FROM game_join_requests WHERE game_id = ? AND resident_id = ?`).get(row.id, req.resident.id)) as { status: string } | undefined)?.status ?? null)
    : null;
  const otherDates = await seriesOtherDates(row, req.resident?.id ?? null);
  res.json({ ...json, joinedByMe, waitlistedByMe, myJoin, familiarCount, checkedInAt, attended, meetingInstructions, participationAttributes, firstTimerCount, joinRequestByMe, otherDates, ...(await taxonomyFields("game", row.id)) });
});

/** Detail-page audit DP-15 (2026-10-22) — the upcoming dates of the same
 * repeating activity (same series_id), so a full, past or cancelled date can
 * point at the next one. Each sibling goes through the same visibility and
 * draft rules as the detail route itself; cancelled ones are left out. */
async function seriesOtherDates(row: GameRow, viewerId: string | null) {
  if (!row.series_id) return [];
  const siblings = (await db
    .prepare(`SELECT * FROM games WHERE series_id = ? AND id != ? AND status != 'cancelled' AND date >= ? ORDER BY date, time LIMIT 12`)
    .all(row.series_id, row.id, irelandTodayIso())) as GameRow[];
  const out: { id: string; date: string; time: string; spotsLeft: number | null }[] = [];
  for (const g of siblings) {
    if (out.length >= 6) break;
    if (!(await canViewGame(g, viewerId))) continue;
    if (getEffectiveGameLifecycle(g) === "draft" && g.host_resident_id !== viewerId) continue;
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(g.id)) as { n: number };
    out.push({ id: g.id, date: g.date, time: g.time, spotsLeft: computeCapacity(g.capacity, Number(n)).spotsLeft });
  }
  return out;
}

// "Keep the connection going" (community participation upgrade, Release 1)
// — what to do after a game, in priority order: the game's own Circle, an
// open Circle for the same activity in the same county, the next open game
// for the same activity, else a prefilled "start a Circle". Participants
// only (the host, or someone who joined): it's a post-activity surface, and
// a circle-only game's official Circle shouldn't be probe-able by id.
// Returns aggregate member counts only — never who is in a Circle or game.
gamesRouter.get("/:id/next-steps", requireResident, async (req, res) => {
  // Logic lives in nextSteps.ts (shared with bookings/registrations/
  // programs/experiences since Release 3); this route stays for the
  // Release 1 client.
  const steps = await getNextSteps("game", req.params.id, req.resident!.id, null);
  if (!steps) return res.status(404).json({ error: "Session not found" });
  res.json(steps);
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
  if (!(await canViewGame(row, req.resident?.id ?? null))) return res.status(404).json({ error: "Session not found" });
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
  // HC-QA-010 — a child read must never exceed the canonical detail policy
  // (GET /:id): 404 for a draft/scheduled or private activity the viewer
  // can't see, same response as a nonexistent id.
  if (!(await loadViewableGame(req.params.id, req.resident?.id ?? null))) return res.status(404).json({ error: "Session not found" });
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
// reuses refundPaidOnce() from checkoutService.ts exactly as-is — the
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

  // HC-QA-051 — lock, re-check, refund and mark refunded in one transaction;
  // concurrent requests get 409 instead of each calling the provider.
  const result = await refundPaidOnce("game_participants", "game_id = ? AND resident_id = ?", [req.params.id, req.params.residentId], participant.stripeSessionId, "This participant has already been refunded", { actorUserId: req.resident!.id, objectType: "game_participant", objectId: `${req.params.id}:${req.params.residentId}` });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await writeAudit({
    actorUserId: req.resident!.id,
    action: result.reconciled ? "game_participant.refund_reconciled_external" : "game_participant.refunded_by_host",
    objectType: "game_participant",
    objectId: `${req.params.id}:${req.params.residentId}`,
    previousValue: { paymentStatus: "paid" },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents, source: result.reconciled ? "stripe_external" : "hellocircle" },
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
  // HC-QA-010 — "public read" means public to whoever may view the activity.
  if (!(await loadViewableGame(req.params.id, req.resident?.id ?? null))) return res.status(404).json({ error: "Session not found" });
  const rows = await db
    .prepare(`SELECT id, message, created_at as createdAt FROM game_updates WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
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
/** Cancels an activity once and tells everyone involved — participants and
 * anyone still waitlisted. Idempotent (HC-QA-028): only the call that flips
 * the status fans out notifications. Shared by the host's own cancel and,
 * since Booking UX Phase 5 (audit E1), by a venue cancelling the booking the
 * activity was held on. Returns false when it was already cancelled. */
export async function cancelGameAndNotify(gameId: string, opts: { by: "host" | "venue" | "platform"; reason?: string; excludeResidentId?: string; actorId?: string }): Promise<boolean> {
  const row = (await db.prepare(`SELECT activity_label FROM games WHERE id = ?`).get(gameId)) as { activity_label: string } | undefined;
  if (!row) return false;
  const flipped = await db.prepare(`UPDATE games SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'`).run(gameId);
  if (flipped.changes === 0) return false;
  // Circles 3.0 — Circles that suggested this activity hear it's off.
  await noticeListingCancelled("game", gameId, { title: row.activity_label, what: "this activity" });

  const who =
    opts.by === "host"
      ? "The host has cancelled this session"
      : opts.by === "platform"
        ? "HelloCircle has cancelled this session after a review"
        : "The venue has cancelled the booking this session was held on, so it's cancelled";
  const reason = opts.reason;

  // Waitlisted residents lose their place too: close their entries (no
  // offer can follow) and tell them, instead of leaving them "waiting".
  const waiting = (await db
    .prepare(`SELECT id, resident_id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND status IN ('waiting', 'offered')`)
    .all(gameId)) as { id: number; resident_id: string | null }[];
  await db.prepare(`UPDATE waitlist_entries SET status = 'cancelled' WHERE listing_type = 'game' AND listing_id = ? AND status IN ('waiting', 'offered')`).run(gameId);
  for (const w of waiting) {
    if (!w.resident_id) continue;
    await notifyResident({
      residentId: w.resident_id,
      kind: "game",
      title: `Cancelled: ${row.activity_label}`,
      body: reason ? `${who}: ${reason}. You've been taken off the waitlist.` : `${who}. You've been taken off the waitlist.`,
      listingType: "game",
      listingId: gameId,
      ref: gameId,
    });
  }

  const participants = (await db
    .prepare(`SELECT resident_id, payment_status as paymentStatus, stripe_session_id as sessionId, total_cents as totalCents FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
    .all(gameId, opts.excludeResidentId ?? "")) as { resident_id: string; paymentStatus: string; sessionId: string | null; totalCents: number | null }[];
  for (const p of participants) {
    // Provider cancellation refunds in full (as vendor cancellations already
    // do — providerCancelRefund.ts): same refund-once path as the host's own
    // "Refund" button, so a later manual refund can't pay twice. A failed
    // refund is audited and left paid for the host / finance to retry.
    let refundLine = "";
    if (p.paymentStatus === "paid" && p.sessionId && Number(p.totalCents ?? 0) > 0) {
      const objectId = `${gameId}:${p.resident_id}`;
      const r = await refundPaidOnce("game_participants", "game_id = ? AND resident_id = ?", [gameId, p.resident_id], p.sessionId, "This participant has already been refunded", {
        actorUserId: opts.actorId ?? "system",
        objectType: "game_participant",
        objectId,
      });
      if (r.ok) {
        refundLine = ` A full refund of €${(r.amountCents / 100).toFixed(2)} has been issued — it can take a few business days to reach your account.`;
        await writeAudit({ actorUserId: opts.actorId ?? "system", action: "game_participant.refunded_on_cancel", objectType: "game_participant", objectId, newValue: { paymentStatus: "refunded", amountCents: r.amountCents, by: opts.by } });
      } else {
        console.error(`[refunds] automatic refund on game cancel failed for ${objectId}: ${r.error}`);
        await writeAudit({ actorUserId: opts.actorId ?? "system", action: "game_participant.refund_on_cancel_failed", objectType: "game_participant", objectId, newValue: { error: r.error } });
        refundLine = " Your refund is being arranged — we'll let you know when it's on its way.";
      }
    }
    await notifyResident({
      residentId: p.resident_id,
      kind: "game",
      title: `Cancelled: ${row.activity_label}`,
      body: (reason ? `${who}: ${reason}.` : `${who}.`) + refundLine,
      listingType: "game",
      listingId: gameId,
      ref: gameId,
    });
  }
  return true;
}

gamesRouter.post("/:id/cancel", requireResident, async (req, res) => {
  const { reason } = req.body as { reason?: string };
  const row = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(req.params.id)) as { host_resident_id: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can cancel this session" });
  const cancelled = await cancelGameAndNotify(req.params.id, { by: "host", reason, excludeResidentId: req.resident!.id, actorId: req.resident!.id });
  if (!cancelled) return res.json({ ok: true, alreadyCancelled: true });
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
// OG-28 — the money recorded for one activity, side by side: what
// participants paid, what was refunded, the fees and partner share recorded
// on those payments, and what the host paid for the venue booking. Read-only
// and deliberately not netted: a profit figure would need an approved
// allocation rule (shared venue costs, refunds after payout, timing).
gamesRouter.get("/:id/money", requireResident, async (req, res) => {
  const game = (await db.prepare(`SELECT host_resident_id as host, booking_ref as bookingRef FROM games WHERE id = ?`).get(req.params.id)) as { host: string; bookingRef: string | null } | undefined;
  if (!game) return res.status(404).json({ error: "Session not found" });
  if (game.host !== req.resident!.id) return res.status(403).json({ error: "Only the host can see this" });
  const paid = (await db
    .prepare(
      `SELECT COUNT(*) as n, COALESCE(SUM(total_cents), 0) as minor FROM game_participants
       WHERE game_id = ? AND payment_status IN ('paid', 'refunded') AND stripe_session_id IS NOT NULL AND total_cents > 0`
    )
    .get(req.params.id)) as { n: number | string; minor: number | string };
  const refunds = (await db
    .prepare(
      `SELECT COALESCE(SUM(rf.amount_minor), 0) as minor FROM refunds rf JOIN game_participants gp ON gp.ref = rf.source_ref
       WHERE rf.source_type = 'game' AND gp.game_id = ? AND rf.status IN ('succeeded', 'reconciled')`
    )
    .get(req.params.id)) as { minor: number | string };
  const recorded = (await db
    .prepare(
      `SELECT COUNT(*) as n, COALESCE(SUM(ps.customer_fee_minor), 0) as customerFees, COALESCE(SUM(ps.success_fee_minor), 0) as successFees, COALESCE(SUM(ps.partner_payout_minor), 0) as partnerShare
       FROM game_participants gp JOIN commerce_orders o ON o.source_type = 'game' AND o.source_ref = gp.ref JOIN pricing_snapshots ps ON ps.order_id = o.id
       WHERE gp.game_id = ? AND gp.payment_status IN ('paid', 'refunded')`
    )
    .get(req.params.id)) as { n: number | string; customerFees: number | string; successFees: number | string; partnerShare: number | string };
  const venue = game.bookingRef
    ? ((await db
        .prepare(
          `SELECT b.ref, c.name as centreName, b.total_cents as totalCents, b.payment_status as paymentStatus, b.status,
                  (SELECT COALESCE(SUM(rf.amount_minor), 0) FROM refunds rf WHERE rf.source_type = 'booking' AND rf.source_ref = b.ref AND rf.status IN ('succeeded', 'reconciled')) as refundedCents
           FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ? AND b.resident_id = ?`
        )
        .get(game.bookingRef, req.resident!.id)) as Record<string, unknown> | undefined)
    : undefined;
  res.json({
    ticketPayments: { count: Number(paid.n), minor: Number(paid.minor) },
    refundedMinor: Number(refunds.minor),
    recordedOn: Number(recorded.n),
    customerFeesMinor: Number(recorded.customerFees),
    platformFeesMinor: Number(recorded.successFees),
    partnerShareMinor: Number(recorded.partnerShare),
    venueBooking: venue ? { ...venue, totalCents: Number(venue.totalCents ?? 0), refundedCents: Number(venue.refundedCents ?? 0) } : null,
  });
});

// OG-12 — move an activity that's held at a venue, together with the host's
// venue booking, in one transaction: either both move or neither does. The
// booking follows the same rules as any customer reschedule (the venue's
// cancellation cut-off and booking window, the room lock, overlap and closure
// checks); participants and the venue are told. Nothing about payments
// changes — a participant who can't make the new time leaves under the
// activity's existing rules.
gamesRouter.post("/:id/move", requireResident, async (req, res) => {
  const { date, time } = req.body as { date?: string; time?: string };
  if (!date || !time) return res.status(400).json({ error: "Choose the new date and time" });
  const game = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!game) return res.status(404).json({ error: "Session not found" });
  if (game.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can move this session" });
  if (game.status === "cancelled") return res.status(409).json({ error: "This session has been cancelled" });
  if (!game.booking_ref) return res.status(409).json({ error: "This session isn't held on a venue booking — edit its date and time instead" });
  const booking = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.status, b.payment_status as paymentStatus, b.room_id as roomId, b.resident_id as residentId, b.name, b.email,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, c.opens_at as opensAt, c.closes_at as closesAt
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`
    )
    .get(game.booking_ref)) as
    | { ref: string; date: string; time: string; duration: number; status: string; paymentStatus: string; roomId: string; residentId: string | null; name: string; email: string; centreId: string; centreName: string; vendorId: string | null; opensAt: string; closesAt: string }
    | undefined;
  if (!booking || booking.residentId !== req.resident!.id) return res.status(403).json({ error: "The venue booking for this session isn't yours" });
  if (date === booking.date && time === booking.time) return res.status(400).json({ error: "That's when it's already booked" });
  if (await hasOpenReview("booking", booking.ref)) return res.status(409).json({ error: "The venue booking's payment is still being checked, so it can't be moved yet" });
  const { cancellationHours, bookingWindowDays } = await orgPoliciesForVendor(booking.vendorId);
  const block = bookingChangeBlock(booking, "reschedule", cancellationHours);
  if (block) return res.status(block.status).json({ error: block.error });
  const rule = slotRuleError(booking, date, time, bookingWindowDays);
  if (rule) return res.status(400).json({ error: rule });

  try {
    await db.transaction(async (tx) => {
      await moveBookingSlot(tx, booking, date, time);
      const moved = await tx.prepare(`UPDATE games SET date = ?, time = ? WHERE id = ? AND status != 'cancelled'`).run(date, time, game.id);
      if (moved.changes !== 1) throw new ConflictError("This session can no longer be moved");
    });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "game.moved_with_venue_booking", objectType: "game", objectId: game.id, previousValue: { date: game.date, time: game.time }, newValue: { date, time, bookingRef: booking.ref } });
  await shortenReviewHolds("game", await heldRefsFor("game", game.id));
  const participants = (await db
    .prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
    .all(game.id, req.resident!.id)) as { resident_id: string }[];
  for (const p of participants) {
    await notifyResident({
      residentId: p.resident_id,
      kind: "game",
      title: `New time: ${game.activity_label}`,
      body: `The host has moved this to ${date} at ${time} (was ${game.date} at ${game.time}). If you can't make it, you can leave the session.`,
      listingType: "game",
      listingId: game.id,
      ref: game.id,
    });
  }
  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "centre",
    listingId: booking.centreId,
    listingName: booking.centreName,
    vendorId: booking.vendorId,
    guestName: booking.name,
    guestEmail: booking.email,
    ref: booking.ref,
    detailsText: `Rescheduled with its activity to ${date} at ${time} (was ${booking.date} at ${booking.time})`,
    residentId: booking.residentId,
  }).catch((e) => console.error("[notifications] game move notify failed:", e));
  const updated = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(game.id)) as GameRow;
  res.json(await toGameJson(updated));
});

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
  const category = await categoryFromBody(res, "game", row.id, req.body);
  if (category === false) return;
  // HC-QA-032 — only a CHANGED date must be in the future; an existing past
  // (completed) activity can still have its other details corrected.
  if (b.date !== row.date && (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date < irelandTodayIso())) {
    return res.status(400).json({ error: "Pick a date that hasn't passed" });
  }

  // Booking UX Phase 5 (B11) — checked whenever the venue, date, time or
  // capacity changes; an older activity that already names a venue keeps
  // working until one of those is edited.
  if (b.centreId && (b.centreId !== row.centre_id || b.date !== row.date || b.time !== row.time || b.capacity !== row.capacity || (b.bookingRef ?? row.booking_ref ?? null) !== (row.booking_ref ?? null))) {
    const problem = await venueBookingProblem(req.resident!.id, { centreId: b.centreId, bookingRef: b.bookingRef ?? row.booking_ref, date: b.date, time: b.time, capacity: b.capacity });
    if (problem) return res.status(400).json({ error: problem, needsVenueBooking: true });
  }

  const { n: joined } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND ${gameSeatSql()}`)
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
  // Commerce audit R3 — only newly *introducing* or changing a price is gated;
  // an already-priced game keeps working for its host.
  if (priceCents && priceCents > 0 && priceCents !== row.price_cents && !(await mayHostPaid(req.resident!.id))) {
    return res.status(403).json({ error: PAID_HOST_ERROR });
  }
  // OG-27 — join approval is for free activities only (a paid join goes straight to checkout).
  if (priceCents && priceCents > 0 && row.join_mode === "approval") {
    return res.status(409).json({ error: "Turn off join approval before adding a price" });
  }

  await db
    .prepare(
      `UPDATE games SET activity_label = ?, centre_id = ?, location_text = ?, date = ?, time = ?, skill_level = ?, capacity = ?,
              price_cents = ?, visibility = ?, solo_friendly = ?, min_participants = ?, confirmation_deadline = ?,
              description = ?, duration_minutes = ?, equipment_needed = ?, min_age = ?, surface_type = ?, indoor_outdoor = ?,
              meeting_instructions = ?, cancellation_policy = ?, image_url = COALESCE(?, image_url),
              experience_required = COALESCE(?, experience_required), accessibility_info = COALESCE(?, accessibility_info)
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
      gameSoloFriendly(b) ? 1 : 0,
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
      // COALESCE-guarded (unlike the full-overwrite columns above) so an
      // installed native build on the pre-Release-2 bundle, which never
      // sends these, can't wipe them; "" is an explicit clear.
      b.experienceRequired === undefined ? null : b.experienceRequired.trim(),
      b.accessibilityInfo === undefined ? null : b.accessibilityInfo.trim(),
      req.params.id
    );
  // Booking UX Phase 5 — the venue booking travels with the venue; an address clears it.
  await db.prepare(`UPDATE games SET booking_ref = ? WHERE id = ?`).run(b.centreId ? b.bookingRef ?? row.booking_ref ?? null : null, req.params.id);
  await syncGameAttributes(req.params.id, b);
  await applyListingCategory("game", req.params.id, category, "host");
  await setListingTags("game", req.params.id, (req.body as { tags?: unknown }).tags);

  const materialChange = b.date !== row.date || b.time !== row.time || (b.centreId ?? null) !== row.centre_id || (b.locationText ?? "") !== row.location_text;
  // D-10 — a moved activity can only shorten a payment-review hold, never extend it.
  if (b.date !== row.date || b.time !== row.time) await shortenReviewHolds("game", await heldRefsFor("game", req.params.id));
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

  // HC-QA-025 — games.lifecycle only ever holds the host's publishing choice
  // (draft/coming_soon/active/paused/archived). Cancellation is owned by
  // games.status via POST /:id/cancel (notifications, waitlist), and
  // "completed" is derived from the date — storing either here produced
  // contradictory rows (lifecycle=cancelled, status=open) with no side effects.
  if (to === "cancelled") return res.status(409).json({ error: "Use cancel to cancel this session" });
  if (to === "completed") return res.status(409).json({ error: "A session completes automatically after its date" });
  if (row.status === "cancelled" && to !== "archived") return res.status(409).json({ error: "This session has been cancelled — it can only be archived" });
  // HC-QA-028 — archiving is administrative: an upcoming, live session with
  // other joined participants must be cancelled first (which notifies them)
  // rather than silently disappearing from under them.
  if (to === "archived" && row.status !== "cancelled" && getEffectiveGameLifecycle(row) !== "completed") {
    const others = (await db
      .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND resident_id != ? AND status IN ('joined', 'pending_payment')`)
      .get(row.id, row.host_resident_id)) as { n: number | string };
    if (Number(others.n) > 0) return res.status(409).json({ error: "People have joined this session — cancel it first so they're told" });
  }

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
    await notifyCircleMembersOfPlan(row);
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

// Sitemap audit P2-09 — whether the signed-in resident is subscribed, so the
// card can show "We'll let you know" (with a way to stop) after a reload.
gamesRouter.get("/:id/notify-me", requireResident, async (req, res) => {
  res.json({ subscribed: await isSubscribedToNotifyMe(req.resident!.id, "game", req.params.id) });
});

gamesRouter.delete("/:id/notify-me", requireResident, async (req, res) => {
  await unsubscribeNotifyMe(req.resident!.id, "game", req.params.id);
  res.json({ ok: true });
});

interface CreateGameInput {
  activityLabel: string;
  centreId?: string;
  /** Booking UX Phase 5 — the host's own confirmed booking at centreId (required with it). */
  bookingRef?: string;
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
  /** Release 2 — what-to-expect gaps. "" clears on update; omitted leaves it. */
  experienceRequired?: string;
  accessibilityInfo?: string;
  /** Release 6 — set when created from a Host Opportunity (the cluster key); analytics only. */
  fromDemand?: string;
  /** Release 2 — host-selected participation attributes (participationVocab.ts).
   * Omitted (an older client) falls back to syncing come_alone from soloFriendly. */
  participationAttributes?: string[];
  /** HelloCircle Manage Phase 4 — set when this game is created as a specific
   * Circle's plan (the "Create plan" deep-link). Organiser-only — enforced in
   * POST / below (HC-QA-014); createGameRow itself stays unchecked because its
   * other caller (plan conversion) authorizes first. */
  circleId?: string;
  /** Phase 2 "Circles V2" — set when this game is being created by
   * converting a confirmed circle_plans row (the "Create Activity" action).
   * Unlike circleId above, this IS ownership/state-checked (see the route
   * below) — converting someone else's plan, or a plan that isn't
   * `confirmed`, is a real state-mutating action, not just "create a game
   * tagged with a circle". */
  planId?: string;
  /** Experience 3.0, Circle-to-Circle (owner decision D2) — an accepted
   * collaboration between `circleId` (the proposer, which owns the activity)
   * and a partner Circle. State-checked below; flipped to activity_created
   * in the same transaction as the insert, like planId. */
  collaborationId?: string;
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

// Release 2 — games.solo_friendly predates listing_attributes and is still
// read by list cards (Games.tsx's "Solo friendly" pill), so the two are kept
// in sync: the attribute set wins when sent; an older client that only
// sends soloFriendly toggles come_alone to match.
function gameSoloFriendly(b: { soloFriendly?: boolean; participationAttributes?: string[] }): boolean {
  return Array.isArray(b.participationAttributes) ? b.participationAttributes.includes("come_alone") : !!b.soloFriendly;
}

async function syncGameAttributes(gameId: string, b: { soloFriendly?: boolean; participationAttributes?: string[] }) {
  if (Array.isArray(b.participationAttributes)) {
    await setListingAttributes("game", gameId, b.participationAttributes);
  } else if (b.soloFriendly) {
    await db.prepare(`INSERT IGNORE INTO listing_attributes (listing_type, listing_id, attr) VALUES ('game', ?, 'come_alone')`).run(gameId);
  } else {
    await db.prepare(`DELETE FROM listing_attributes WHERE listing_type = 'game' AND listing_id = ? AND attr = 'come_alone'`).run(gameId);
  }
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
export async function createGameRow(input: CreateGameInput & { hostResidentId: string; seriesId?: string; quiet?: boolean }): Promise<GameRow> {
  // The host is auto-joined below, so a threshold of 1 (or unset) is
  // already met at creation — only start pending if more than the host
  // is genuinely required.
  const startsPending = !!input.minParticipants && input.minParticipants > 1;
  const id = crypto.randomUUID();
  const lifecycle = input.lifecycle ?? "active";

  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, skill_level, capacity, price_cents, visibility, solo_friendly, min_participants, confirmation_deadline, status, description, duration_minutes, equipment_needed, min_age, surface_type, indoor_outdoor, meeting_instructions, cancellation_policy, circle_id, plan_id, lifecycle, publish_at, booking_open_at, booking_close_at, experience_required, accessibility_info, booking_ref)
         VALUES (@id, @hostResidentId, @activityLabel, @centreId, @locationText, @date, @time, @skillLevel, @capacity, @priceCents, @visibility, @soloFriendly, @minParticipants, @confirmationDeadline, @status, @description, @durationMinutes, @equipmentNeeded, @minAge, @surfaceType, @indoorOutdoor, @meetingInstructions, @cancellationPolicy, @circleId, @planId, @lifecycle, @publishAt, @bookingOpenAt, @bookingCloseAt, @experienceRequired, @accessibilityInfo, @bookingRef)`
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
        soloFriendly: gameSoloFriendly(input) ? 1 : 0,
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
        experienceRequired: input.experienceRequired?.trim() || null,
        accessibilityInfo: input.accessibilityInfo?.trim() || null,
        // Booking UX Phase 5 — set only alongside a centre (validated by venueBookingProblem).
        bookingRef: input.centreId ? input.bookingRef ?? null : null,
      });
    // The host is automatically a participant — they take one of the capacity spots.
    await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(id, input.hostResidentId);
    if (input.seriesId) await tx.prepare(`UPDATE games SET series_id = ? WHERE id = ?`).run(input.seriesId, id);

    // Phase 2 "Circles V2" — atomically flip the plan-idea to
    // activity_created and link it to this new game, guarded so two
    // concurrent conversions of the same plan can never both succeed: the
    // loser sees changes===0, throws, and its Game insert rolls back with
    // it in the same transaction. Same idempotency idiom as the Stripe
    // webhook's confirm* functions / the Phase 0 refund-race fix in
    // vendorOperations.ts.
    if (input.collaborationId) {
      const linked = await tx
        .prepare(`UPDATE circle_collaborations SET status = 'activity_created', game_id = ? WHERE id = ? AND status = 'accepted'`)
        .run(id, input.collaborationId);
      if (linked.changes === 0) throw new ConflictError("This shared activity has already been created, or the other Circle hasn't agreed yet");
      await tx.prepare(`UPDATE games SET partner_circle_id = (SELECT partner_circle_id FROM circle_collaborations WHERE id = ?) WHERE id = ?`).run(input.collaborationId, id);
    }
    if (input.planId) {
      const linkResult = await tx
        .prepare(`UPDATE circle_plans SET status = 'activity_created', activity_source_type = 'game', activity_source_id = ? WHERE id = ? AND status = 'confirmed'`)
        .run(id, input.planId);
      if (linkResult.changes === 0) throw new ConflictError("This plan has already been converted into an activity");
    }
  });

  await syncGameAttributes(id, input);
  if (input.fromDemand) void logEvent("host_created_from_demand", { residentId: input.hostResidentId, metadata: { kind: "game", id, clusterKey: input.fromDemand } });
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(id)) as GameRow;

  // Universal Publishing, Lifecycle & Availability System — a draft/coming-
  // soon game must not trigger any of these "this is now live" side
  // effects (§6/§7: not searchable, no alert matching; Coming Soon is
  // "publicly announced" but still pre-booking, so it also gets no search-
  // alert/intent match yet — those exist to surface *bookable* activities).
  // Only a game that's effectively 'active' right at creation fires them,
  // same behaviour as every pre-existing caller (which never set
  // `lifecycle` at all, and therefore defaults to 'active' above).
  // OG-26 — a series announces itself once (its first date), not once per week.
  if (getEffectiveGameLifecycle(row) === "active" && !input.quiet) {
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
    await notifyCircleMembersOfPlan(row);
  }

  return row;
}

/** The checks every new activity passes (POST / and each occurrence of a
 * series, OG-26) — returns the visibility to use, or the refusal. */
async function validateNewGame(b: CreateGameInput, residentId: string): Promise<{ ok: true; visibility: CreateGameInput["visibility"] } | { ok: false; status: number; body: Record<string, unknown> }> {
  const fail = (status: number, body: Record<string, unknown>) => ({ ok: false as const, status, body });
  if (!b.activityLabel || !b.date || !b.time || !b.capacity) {
    return fail(400, { error: "Activity, date, time and capacity are required" });
  }
  if (!b.centreId && !b.locationText) {
    return fail(400, { error: "A venue or a location is required" });
  }
  if (b.minParticipants !== undefined && (!Number.isInteger(b.minParticipants) || b.minParticipants < 1 || b.minParticipants > b.capacity)) {
    return fail(400, { error: "Minimum players must be a whole number between 1 and the session's capacity" });
  }
  if (b.lifecycle !== undefined && !["draft", "coming_soon", "active"].includes(b.lifecycle)) {
    return fail(400, { error: "Publishing state must be draft, coming_soon, or active" });
  }
  if (b.visibility !== undefined && !["public", "circle", "invite"].includes(b.visibility)) {
    return fail(400, { error: "Visibility must be public, circle, or invite" });
  }
  if (b.priceCents && b.priceCents > 0 && !(await mayHostPaid(residentId))) {
    return fail(403, { error: PAID_HOST_ERROR });
  }
  // HC-QA-032 — a new activity cannot start in the past (Ireland calendar
  // date). Editing an existing past activity is handled separately in PUT.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date < irelandTodayIso()) {
    return fail(400, { error: "Pick a date that hasn't passed" });
  }

  // HC-QA-014 (Model A, Circle-controlled planning) — attaching an activity
  // to a Circle makes it that Circle's own plan ("From this Circle", nextPlan,
  // organiser Plans, member visibility), so only the Circle's organiser may do
  // it. Every client entry point that sends circleId is already organiser-only;
  // members suggest through plan-ideas instead.
  if (b.circleId && !(await isCircleOrganiser(b.circleId, residentId))) {
    return fail(403, { error: "Only the Circle's organiser can add a plan to it" });
  }
  if (b.collaborationId) {
    if (!(await featureOn("circles.collaboration"))) return fail(404, { error: "This isn't available yet" });
    if (b.planId) return fail(400, { error: "Create a shared activity on its own, not from a plan idea" });
    const collab = (await db
      .prepare(
        `SELECT cc.proposer_circle_id as proposer, cc.status, p.status as proposerStatus, q.status as partnerStatus FROM circle_collaborations cc
         JOIN circles p ON p.id = cc.proposer_circle_id JOIN circles q ON q.id = cc.partner_circle_id WHERE cc.id = ?`
      )
      .get(b.collaborationId)) as { proposer: string; status: string; proposerStatus: string; partnerStatus: string } | undefined;
    if (!collab || collab.proposer !== b.circleId) return fail(404, { error: "Shared activity not found" });
    if (collab.status !== "accepted") return fail(409, { error: "The other Circle hasn't agreed to this yet" });
    if (collab.proposerStatus === "closed" || collab.partnerStatus === "closed") return fail(409, { error: "One of the Circles is closed" });
  }

  // Phase 2 "Circles V2" — converting a confirmed plan-idea into a real
  // activity is a state-mutating action gated to that circle's organiser.
  if (b.planId) {
    const plan = (await db.prepare(`SELECT circle_id as circleId, status, listing_type as listingType FROM circle_plans WHERE id = ?`).get(b.planId)) as { circleId: string; status: string; listingType: string | null } | undefined;
    if (!plan || plan.circleId !== b.circleId) return fail(404, { error: "Plan not found" });
    if (plan.status !== "confirmed") return fail(409, { error: "This plan isn't confirmed yet" });
    // Circles 3.0 — a plan about an existing activity, experience or
    // programme is booked on that listing; it never becomes a second one.
    // A venue plan (where to meet) can still become the Circle's own activity.
    if (plan.listingType && plan.listingType !== "centre" && plan.listingType !== "club") {
      return fail(409, { error: "This plan is about an existing listing — members book it there" });
    }
    if (!(await isCircleOrganiser(plan.circleId, residentId))) {
      return fail(403, { error: "Only the organiser can create the activity for this plan" });
    }
    // Circle Experience Polish — Changeset 1D. A closed Circle is read-only
    // historical context — it can't convert a plan into a new activity.
    const circle = (await db.prepare(`SELECT status FROM circles WHERE id = ?`).get(plan.circleId)) as { status: string } | undefined;
    if (circle?.status === "closed") return fail(409, { error: "This Circle is closed — plans can't be converted into new activities" });
  }

  // HC-QA-023 — an official Circle plan must not be more public than its
  // Circle unless the caller explicitly asks. The host UI never sends a
  // visibility, so derive it from the Circle's join mode: an open Circle's
  // plans are public; an approval/invite Circle's plans are circle-only
  // (members, invitees and participants per canViewGame).
  let visibility = b.visibility;
  if (b.circleId && visibility === undefined) {
    const circle = (await db.prepare(`SELECT join_mode as joinMode FROM circles WHERE id = ?`).get(b.circleId)) as { joinMode: string } | undefined;
    visibility = circle?.joinMode === "open" ? "public" : "circle";
  }

  if (b.centreId) {
    const problem = await venueBookingProblem(residentId, { centreId: b.centreId, bookingRef: b.bookingRef, date: b.date, time: b.time, capacity: b.capacity });
    if (problem) return fail(400, { error: problem, needsVenueBooking: true });
  }

  return { ok: true, visibility };
}

gamesRouter.post("/", requireResident, async (req, res) => {
  const b = req.body as CreateGameInput;
  const checked = await validateNewGame(b, req.resident!.id);
  if (!checked.ok) return res.status(checked.status).json(checked.body);
  const visibility = checked.visibility;
  const category = await categoryFromBody(res, "game", null, req.body);
  if (category === false) return;
  // Circles 3.1 — a member creating an activity "for" a Circle they're in
  // (not the organiser's official circleId path): it's linked to the Circle
  // after it's created, waiting for an organiser like any member link.
  // Checked before creating, so a forged or foreign Circle creates nothing.
  const shareTo = typeof (req.body as { shareToCircleId?: unknown }).shareToCircleId === "string" ? (req.body as { shareToCircleId: string }).shareToCircleId : null;
  if (shareTo) {
    const c = (await db.prepare(`SELECT status FROM circles WHERE id = ?`).get(shareTo)) as { status: string } | undefined;
    if (!c || !(await isCircleMember(shareTo, req.resident!.id))) return res.status(403).json({ error: "You can only add activities to a Circle you're in" });
    if (c.status === "closed") return res.status(409).json({ error: "This Circle is closed" });
  }

  let row: GameRow;
  try {
    row = await createGameRow({ ...b, visibility, hostResidentId: req.resident!.id });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }
  await applyListingCategory("game", row.id, category, "host");
  await setListingTags("game", row.id, (req.body as { tags?: unknown }).tags);

  // The activity exists whatever happens next; a failed link is reported
  // (never as success) and can be retried with POST /api/circles/:id/links,
  // which can't create a second activity or a second link.
  let circleLink: { ok: boolean; status?: string; error?: string } | undefined;
  if (shareTo && !b.circleId) {
    try {
      const r = await addListingLink(shareTo, req.resident!.id, { type: "game", id: row.id }, { relationship: "created_for" });
      circleLink = r.ok ? { ok: true, status: r.status } : { ok: false, error: r.error };
    } catch (e) {
      console.error("[circle-links] link after create failed:", e instanceof Error ? e.message : e);
      circleLink = { ok: false, error: "The activity was created, but linking it to the Circle didn't work. Try linking it again." };
    }
  }
  res.status(201).json({ ...(await toGameJson(row)), ...(circleLink ? { circleLink } : {}) });
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
class GameNotVisibleError extends Error {}

/** HC-QA-047 — authoritative quote for a paid join (same computePricing as
 * the join's checkout); visibility-gated exactly like GET /:id. */
gamesRouter.get("/:id/quote", async (req, res) => {
  const row = await loadViewableGame(req.params.id, req.resident?.id ?? null);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const price = Number(row.price_cents ?? 0);
  let discountCents = 0;
  let couponCode: string | null = null;
  const raw = typeof req.query.couponCode === "string" ? req.query.couponCode : "";
  if (raw && price) {
    const result = await evaluateCoupon(raw, price, { listingType: "game", listingId: req.params.id });
    if (!result.valid) return res.status(400).json({ error: result.error });
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  const p = computePricing(price, 0, discountCents, couponCode);
  res.json({ subtotalCents: p.subtotalCents, discountCents: p.discountCents, vatCents: p.vatCents, platformFeeCents: p.platformFeeCents, totalCents: price ? p.totalCents : 0, couponCode, currency: "EUR" });
});

gamesRouter.post("/:id/join", requireResident, async (req, res) => {
  // Visibility must precede coupons, participation and checkout: joining must
  // never manufacture the relationship required to see a private activity.
  if (!(await loadViewableGame(req.params.id, req.resident!.id))) return res.status(404).json({ error: "Session not found" });
  const { couponCode: rawCouponCode, meetsMinAge } = req.body as { couponCode?: string; meetsMinAge?: boolean };
  let insertedRef: string | null = null;
  let checkoutRow: GameRow | null = null;
  let joinedRow: GameRow | null = null;
  let requestedRow: GameRow | null = null;
  const requestMessage = typeof (req.body as { message?: unknown }).message === "string" ? ((req.body as { message: string }).message.trim().slice(0, 500) || null) : null;
  // Evaluated before the row-locked transaction below — coupon validity
  // depends only on the game's price, not on the capacity race that
  // transaction guards against — same order bookings.ts/registrations.ts
  // already use. Visibility is checked above; the transaction rechecks the
  // locked activity if it disappeared or changed in the meantime.
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
      // Recheck the locked row in case publication/visibility changed after
      // the early guard. Keep the canonical relationship policy unchanged.
      if (!row || !(await canViewGame(row, req.resident!.id))) throw new GameNotVisibleError();
      joinedRow = row;
      // A 'pending_participants' game (Phase 4) is still joinable — that's
      // exactly how it reaches its threshold — only 'cancelled' blocks it.
      if (row.status !== "open" && row.status !== "pending_participants") throw new ConflictError("This session is no longer open");
      // Booking UX Phase 4 (B9) — a minimum age needs the joiner's declaration.
      const ageError = minAgeError(row.min_age, meetsMinAge);
      if (ageError) throw new MinAgeRequiredError(ageError, row.min_age!);
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
      const existing = (await tx.prepare(`SELECT id, status, payment_status, joined_at FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id)) as
        | { id: number; status: string; payment_status: string; joined_at: string }
        | undefined;
      // A pending_payment row only blocks while its hold is live (HC-QA-041
      // cross-model): an abandoned checkout can be restarted after expiry.
      if (existing && (existing.status === "joined" || (existing.status === "pending_payment" && holdIsLive(existing.joined_at)))) {
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
        .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND ${gameSeatSql()} AND resident_id != ?`)
        .get(req.params.id, req.resident!.id)) as { n: number };
      if (computeCapacity(row.capacity, Number(joined) + reservedCount).isFull) throw new ConflictError("This session is full");

      const isPaid = !!row.price_cents && row.price_cents > 0;
      // OG-27 — an approval activity (free only) takes a request instead of a
      // seat; the host's approval creates the participant row.
      if (row.join_mode === "approval" && !isPaid && row.host_resident_id !== req.resident!.id) {
        const prior = (await tx.prepare(`SELECT status FROM game_join_requests WHERE game_id = ? AND resident_id = ? FOR UPDATE`).get(row.id, req.resident!.id)) as { status: string } | undefined;
        if (prior?.status === "requested") throw new ConflictError("You've already asked to join — the host will reply");
        if (prior?.status === "declined") throw new ConflictError("The host didn't accept your request for this activity");
        if (prior) await tx.prepare(`UPDATE game_join_requests SET status = 'requested', message = ?, created_at = NOW(), decided_at = NULL WHERE game_id = ? AND resident_id = ?`).run(requestMessage, row.id, req.resident!.id);
        else await tx.prepare(`INSERT INTO game_join_requests (game_id, resident_id, message) VALUES (?, ?, ?)`).run(row.id, req.resident!.id, requestMessage);
        requestedRow = row;
        return;
      }
      if (isPaid) {
        const ref = generateRef("GJ");
        // HC-QA-050 — reserve the coupon use with the seat hold (released if it fails/expires).
        try {
          await consumeCoupon(tx, appliedCouponCode, { sourceType: "game", ref, customerKey: customerKeyOf(req.resident!.id, null), discountMinor: discountCents, confirmed: false });
        } catch (e) {
          throw new BadRequestError(e instanceof Error ? e.message : "That code has been fully redeemed");
        }
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
    if (e instanceof GameNotVisibleError) return res.status(404).json({ error: "Session not found" });
    if (e instanceof MinAgeRequiredError) return res.status(400).json({ error: e.message, minAge: e.minAge });
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  if (requestedRow) {
    const r = requestedRow as GameRow;
    await notifyResident({
      residentId: r.host_resident_id,
      kind: "game",
      title: `${req.resident!.name} asked to join ${r.activity_label}`,
      body: `${r.date} at ${r.time} — approve or decline from the activity's participants.`,
      listingType: "game",
      listingId: r.id,
      ref: r.id,
    });
    return res.status(202).json({ ok: true, requested: true });
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
  shadowLegacy("game", insertedRef, { hostResidentId: row.host_resident_id }, pricing);
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
    await endPendingHold("game_participants", insertedRef, "delete");
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE game_participants SET stripe_session_id = ?, total_cents = ? WHERE ref = ?`).run(result.session.id, pricing.totalCents, insertedRef);
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
  const paymentReview = (row as { paymentStatus?: string }).paymentStatus === "pending" && (await paymentUnderReview("game", req.params.ref));
  res.json({ ...row, paymentReview, paymentCase: await customerPaymentCase("game", req.params.ref) });
});

// --- waitlist (NEXT) — mirrors routes/clubs.ts's club waitlist ------------

gamesRouter.post("/:id/waitlist", requireResident, async (req, res) => {
  try {
    await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT * FROM games WHERE id = ? FOR UPDATE`).get(req.params.id)) as GameRow | undefined;
      if (!row || !(await canViewGame(row, req.resident!.id))) throw new GameNotVisibleError();
      // Visibility and lifecycle are independent gates, both before insertion.
      if (getEffectiveGameLifecycle(row) !== "active") {
        throw new ConflictError("Bookings are not currently open for this activity");
      }
      const existing = await tx
        .prepare(`SELECT id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'`)
        .get(req.params.id, req.resident!.id);
      if (existing) throw new ConflictError("You're already on the waitlist for this session");
      // HC-QA-026 — a participant already holds a place; a parallel waitlist
      // entry would later become an offer for capacity they already use.
      const participant = await tx
        .prepare(`SELECT 1 FROM game_participants WHERE game_id = ? AND resident_id = ? AND status IN ('joined', 'pending_payment')`)
        .get(req.params.id, req.resident!.id);
      if (participant) throw new ConflictError("You've already joined this session");
      await tx
        .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email) VALUES ('game', ?, ?, '', ?, ?)`)
        .run(req.params.id, req.resident!.id, req.resident!.name, req.resident!.email);
    });
  } catch (e) {
    if (e instanceof GameNotVisibleError) return res.status(404).json({ error: "Session not found" });
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }
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
  const row = (await db.prepare(`SELECT activity_label, host_resident_id as hostResidentId, date, time, price_cents as priceCents FROM games WHERE id = ?`).get(req.params.id)) as
    | { activity_label: string; hostResidentId: string; date: string; time: string; priceCents: number | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });

  const [hour, minute] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, hour, minute);
  if (Date.now() >= start.getTime()) {
    return res.status(409).json({ error: "This activity has already taken place." });
  }

  // HC-QA-028 — the host's own participant row is the ownership seat, not a
  // normal place; same rule as POST /:id/participants/:residentId/remove.
  if (row.hostResidentId === req.resident!.id) return res.status(400).json({ error: "You can't leave your own session as the host — cancel the session instead" });

  const participant = (await db
    .prepare(`SELECT payment_status as paymentStatus FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .get(req.params.id, req.resident!.id)) as { paymentStatus: string | null } | undefined;
  if (!participant) return res.status(404).json({ error: "You haven't joined this session" });

  // HC-QA-046 — concurrent leaves: only the one that flips the row promotes/notifies.
  const left = await db.prepare(`UPDATE game_participants SET status = 'cancelled' WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).run(req.params.id, req.resident!.id);
  if (left.changes !== 1) return res.status(404).json({ error: "You haven't joined this session" });

  promoteNextWaitlistEntry("game", req.params.id, row.activity_label);

  // HC-QA-027 — payment_status defaults to 'paid' even for a free join, so
  // only a genuinely priced activity has anything to refund.
  if (!!row.priceCents && row.priceCents > 0 && participant.paymentStatus === "paid" && row.hostResidentId !== req.resident!.id) {
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

// --- OG-27 — join approval and closing bookings ------------------------------

// The host's booking settings for one activity: join approval (free
// activities only) and when bookings close. Its own endpoint rather than part
// of the full-row PUT above, so a client that doesn't send these fields can
// never clear them.
gamesRouter.post("/:id/booking-settings", requireResident, async (req, res) => {
  const { joinMode, bookingCloseAt } = req.body as { joinMode?: string; bookingCloseAt?: string | null };
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can change this" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This session has been cancelled" });
  if (joinMode !== undefined && joinMode !== "open" && joinMode !== "approval") return res.status(400).json({ error: "Choose open or approval" });
  if (joinMode === "approval" && row.price_cents && row.price_cents > 0) return res.status(409).json({ error: "Join approval is only for free activities" });
  let close: Date | null | undefined;
  if (bookingCloseAt !== undefined) {
    close = bookingCloseAt === null || bookingCloseAt === "" ? null : new Date(bookingCloseAt);
    if (close && Number.isNaN(close.getTime())) return res.status(400).json({ error: "That closing time isn't valid" });
    const [h, m] = row.time.split(":").map(Number);
    if (close && close.getTime() > irelandWallTimeToUtc(row.date, h, m).getTime()) return res.status(400).json({ error: "Bookings must close before the activity starts" });
  }
  await db
    .prepare(`UPDATE games SET join_mode = COALESCE(?, join_mode), booking_close_at = IF(?, ?, booking_close_at) WHERE id = ?`)
    .run(joinMode ?? null, close !== undefined ? 1 : 0, close ?? null, row.id);
  const updated = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(row.id)) as GameRow;
  res.json(await toGameJson(updated));
});

gamesRouter.get("/:id/join-requests", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id as hostResidentId FROM games WHERE id = ?`).get(req.params.id)) as { hostResidentId: string } | undefined;
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.hostResidentId !== req.resident!.id) return res.status(403).json({ error: "Only the host can see join requests" });
  const rows = await db
    .prepare(
      `SELECT r.resident_id as residentId, COALESCE(NULLIF(res.name, ''), 'A resident') as name, r.status, r.message, r.created_at as createdAt, r.decided_at as decidedAt
       FROM game_join_requests r LEFT JOIN residents res ON res.id = r.resident_id
       WHERE r.game_id = ? ORDER BY r.status = 'requested' DESC, r.created_at`
    )
    .all(req.params.id);
  res.json(rows);
});

gamesRouter.post("/:id/join-requests/:residentId/:decision", requireResident, async (req, res) => {
  const { decision, residentId } = req.params;
  if (decision !== "approve" && decision !== "decline") return res.status(404).json({ error: "Not found" });
  let game: GameRow | null = null;
  try {
    await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT * FROM games WHERE id = ? FOR UPDATE`).get(req.params.id)) as GameRow | undefined;
      if (!row) throw new ConflictError("Session not found");
      if (row.host_resident_id !== req.resident!.id) throw new BadRequestError("forbidden");
      const request = (await tx.prepare(`SELECT status FROM game_join_requests WHERE game_id = ? AND resident_id = ? FOR UPDATE`).get(row.id, residentId)) as { status: string } | undefined;
      if (!request || request.status !== "requested") throw new ConflictError("This request has already been answered or withdrawn");
      game = row;
      if (decision === "decline") {
        await tx.prepare(`UPDATE game_join_requests SET status = 'declined', decided_at = NOW() WHERE game_id = ? AND resident_id = ?`).run(row.id, residentId);
        return;
      }
      if (row.status !== "open" && row.status !== "pending_participants") throw new ConflictError("This session is no longer open");
      const [h, m] = row.time.split(":").map(Number);
      if (Date.now() >= irelandWallTimeToUtc(row.date, h, m).getTime()) throw new ConflictError("This activity has already started");
      const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND ${gameSeatSql()}`).get(row.id)) as { n: number };
      if (computeCapacity(row.capacity, Number(n) + (await activeOfferedCount("game", row.id))).isFull) throw new ConflictError("This session is full — free a place first");
      const existing = (await tx.prepare(`SELECT id, status FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(row.id, residentId)) as { id: number; status: string } | undefined;
      if (existing && existing.status === "joined") {
        // Already in (e.g. joined while approval was off) — just close the request.
      } else if (existing) {
        await tx
          .prepare(`UPDATE game_participants SET status = 'joined', payment_status = 'paid', ref = NULL, coupon_code = NULL, stripe_session_id = NULL, checked_in_at = NULL, attended = NULL, joined_at = NOW() WHERE id = ?`)
          .run(existing.id);
      } else {
        await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(row.id, residentId);
      }
      await tx.prepare(`UPDATE game_join_requests SET status = 'approved', decided_at = NOW() WHERE game_id = ? AND resident_id = ?`).run(row.id, residentId);
    });
  } catch (e) {
    if (e instanceof BadRequestError && e.message === "forbidden") return res.status(403).json({ error: "Only the host can answer join requests" });
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }
  const g = game as unknown as GameRow;
  if (decision === "approve") {
    await checkMinParticipantsThreshold(g.id);
    void logEvent("game_joined", { residentId, metadata: { gameId: g.id, activityLabel: g.activity_label, viaApproval: true } });
  }
  await notifyResident({
    residentId,
    kind: "game",
    title: decision === "approve" ? `You're in: ${g.activity_label}` : `Your request for ${g.activity_label}`,
    body: decision === "approve" ? `${g.date} at ${g.time} — the host approved your request.` : `The host couldn't take you for ${g.date} at ${g.time}.`,
    listingType: "game",
    listingId: g.id,
    ref: g.id,
  });
  res.json({ ok: true });
});

// The requester withdraws their own pending request.
gamesRouter.delete("/:id/join-request", requireResident, async (req, res) => {
  const r = await db.prepare(`UPDATE game_join_requests SET status = 'withdrawn', decided_at = NOW() WHERE game_id = ? AND resident_id = ? AND status = 'requested'`).run(req.params.id, req.resident!.id);
  if (r.changes !== 1) return res.status(404).json({ error: "You don't have a pending request for this activity" });
  res.json({ ok: true });
});

// --- OG-26 — weekly activity series -----------------------------------------
// Each occurrence is an ordinary activity (its own capacity, participants,
// payments, refunds and cancellation — DEC-13: the existing rules, unchanged);
// the series only groups them. Address-based activities only: a venue
// activity needs its own venue booking for each date, so those are created
// one date at a time.

const MAX_SERIES_WEEKS = 12;
const MAX_SERIES_DATES = 36;
const DAY_MS = 86_400_000;

/** The dates of a series: every chosen weekday from the start date to the end
 * date (inclusive), or — the simple form — the start date's weekday for N weeks. */
export function seriesDates(start: string, opts: { repeatWeeks?: number; weekdays?: number[]; endDate?: string }): string[] | string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "Pick a start date";
  const t0 = Date.parse(`${start}T12:00:00Z`);
  if (opts.endDate !== undefined || opts.weekdays !== undefined) {
    const days = opts.weekdays ?? [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Choose at least one weekday";
    if (!opts.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(opts.endDate) || opts.endDate < start) return "Pick an end date on or after the start date";
    const t1 = Date.parse(`${opts.endDate}T12:00:00Z`);
    if ((t1 - t0) / DAY_MS > MAX_SERIES_WEEKS * 7) return `A series can run for up to ${MAX_SERIES_WEEKS} weeks`;
    const out: string[] = [];
    for (let t = t0; t <= t1; t += DAY_MS) if (days.includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length < 2) return "A series needs at least two dates";
    if (out.length > MAX_SERIES_DATES) return `A series can have up to ${MAX_SERIES_DATES} dates`;
    return out;
  }
  const weeks = Number(opts.repeatWeeks);
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_SERIES_WEEKS) return `Repeat for between 2 and ${MAX_SERIES_WEEKS} weeks`;
  return Array.from({ length: weeks }, (_, w) => new Date(t0 + w * 7 * DAY_MS).toISOString().slice(0, 10));
}

gamesRouter.post("/series", requireResident, async (req, res) => {
  const b = req.body as CreateGameInput & { repeatWeeks?: number; weekdays?: number[]; endDate?: string };
  const planned = seriesDates(b.date, { repeatWeeks: b.repeatWeeks, weekdays: b.weekdays, endDate: b.endDate });
  if (typeof planned === "string") return res.status(400).json({ error: planned });
  if (b.centreId) return res.status(400).json({ error: "A venue activity needs its own venue booking for each date — create each date separately" });
  if (b.planId) return res.status(400).json({ error: "A Circle plan becomes one activity, not a series" });
  if (b.collaborationId) return res.status(400).json({ error: "A shared Circle activity is one activity, not a series" });
  if (b.bookingCloseAt || b.publishAt || b.bookingOpenAt) return res.status(400).json({ error: "Schedule publishing and closing on each date after creating the series" });
  const dates = planned;
  const checks = [];
  for (const date of dates) {
    const checked = await validateNewGame({ ...b, date }, req.resident!.id);
    if (!checked.ok) return res.status(checked.status).json(checked.body);
    checks.push(checked);
  }
  const category = await categoryFromBody(res, "game", null, req.body);
  if (category === false) return;
  const seriesId = crypto.randomUUID();
  const weekdays = Array.from(new Set(dates.map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()))).sort().join(",");
  await db
    .prepare(`INSERT INTO game_series (id, host_resident_id, weekdays, start_date, end_date, time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(seriesId, req.resident!.id, weekdays, dates[0], dates[dates.length - 1], b.time);
  const created: GameRow[] = [];
  for (const [i, date] of dates.entries()) {
    created.push(await createGameRow({ ...b, date, visibility: checks[i].ok ? checks[i].visibility : b.visibility, hostResidentId: req.resident!.id, seriesId, quiet: i > 0 }));
  }
  for (const g of created) {
    await applyListingCategory("game", g.id, category, "host");
    await setListingTags("game", g.id, (req.body as { tags?: unknown }).tags);
  }
  res.status(201).json({ seriesId, games: await Promise.all(created.map((g) => toGameJson(g))) });
});

async function hostSeries(seriesId: string, residentId: string) {
  const series = (await db.prepare(`SELECT id, host_resident_id as hostResidentId, start_date as startDate, end_date as endDate, time, status FROM game_series WHERE id = ?`).get(seriesId)) as
    | { id: string; hostResidentId: string; startDate: string; endDate: string; time: string; status: string }
    | undefined;
  if (!series) return { error: 404 as const };
  if (series.hostResidentId !== residentId) return { error: 403 as const };
  return { series };
}

gamesRouter.get("/series/:seriesId", requireResident, async (req, res) => {
  const found = await hostSeries(req.params.seriesId, req.resident!.id);
  if ("error" in found) return res.status(found.error!).json({ error: found.error === 404 ? "Series not found" : "Only the host can see this series" });
  const rows = (await db.prepare(`SELECT * FROM games WHERE series_id = ? ORDER BY date, time`).all(req.params.seriesId)) as GameRow[];
  res.json({ ...found.series, games: await Promise.all(rows.map((g) => toGameJson(g))) });
});

// Cancels every occurrence that hasn't started yet, each exactly as a single
// cancel would (participants told; the existing refund handling applies).
// Past occurrences stay as they are.
gamesRouter.post("/series/:seriesId/cancel-remaining", requireResident, async (req, res) => {
  const found = await hostSeries(req.params.seriesId, req.resident!.id);
  if ("error" in found) return res.status(found.error!).json({ error: found.error === 404 ? "Series not found" : "Only the host can cancel this series" });
  const { reason } = req.body as { reason?: string };
  const rows = (await db.prepare(`SELECT id, date, time FROM games WHERE series_id = ? AND status != 'cancelled'`).all(req.params.seriesId)) as { id: string; date: string; time: string }[];
  let cancelled = 0;
  for (const g of rows) {
    const [h, m] = g.time.split(":").map(Number);
    if (irelandWallTimeToUtc(g.date, h, m).getTime() <= Date.now()) continue;
    if (await cancelGameAndNotify(g.id, { by: "host", reason, excludeResidentId: req.resident!.id, actorId: req.resident!.id })) cancelled++;
  }
  await db.prepare(`UPDATE game_series SET status = 'ended' WHERE id = ?`).run(req.params.seriesId);
  res.json({ ok: true, cancelled });
});
