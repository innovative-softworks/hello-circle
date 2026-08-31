import crypto from "node:crypto";
import { Router } from "express";
import { logEvent } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { countFamiliarCoParticipants } from "../db/queries.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyCentreFollowers, notifyHostFollowers } from "./follows.js";
import { buildIcsEvent } from "../ics.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyResident } from "../notifications.js";
import { matchParticipationIntentsForGame } from "../participationIntents.js";
import { computePricing } from "../pricing.js";
import { requireResident } from "../residents.js";
import { matchSearchAlertsForGame } from "../searchAlerts.js";
import { ConflictError, generateRef } from "../util.js";
import { activeOfferedCount, claimWaitlistOffer, hasActiveOffer, promoteNextWaitlistEntry } from "../waitlist.js";

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
  const host = (await db.prepare(`SELECT name, host_status as hostStatus FROM residents WHERE id = ?`).get(row.host_resident_id)) as
    | { name: string; hostStatus: string }
    | undefined;
  // HelloCircle Manage Phase 5 — lets /manage/activities show which rows are
  // a Circle's own Plan (and link back to it), instead of listing them
  // undifferentiated alongside unrelated solo hosted games.
  const circle = row.circle_id
    ? ((await db.prepare(`SELECT name, slug FROM circles WHERE id = ?`).get(row.circle_id)) as { name: string; slug: string | null } | undefined)
    : undefined;
  return {
    id: row.id,
    hostResidentId: row.host_resident_id,
    hostName: host?.name ?? "",
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
gamesRouter.get("/", async (req, res) => {
  const today = irelandTodayIso();
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const rows = (
    county
      ? await db
          .prepare(
            `SELECT g.* FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.date >= ? AND c.county = ? ORDER BY g.date, g.time`
          )
          .all(today, county)
      : await db.prepare(`SELECT * FROM games WHERE status = 'open' AND date >= ? ORDER BY date, time`).all(today)
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

gamesRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Game not found" });
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
    const p = await db.prepare(`SELECT status FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident.id);
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

// "Add to calendar" (IA spec §13) — public like GET /:id itself (games are
// visible to anyone with the link). Falls back to a 2-hour block when the
// host hasn't set a real duration — display-only, same "informational, not
// enforced" spirit as the confirmation-deadline field.
const GAME_ICS_DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

gamesRouter.get("/:id/ics", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Game not found" });
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
  if (!row) return res.status(404).json({ error: "Game not found" });
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

// Host removes one participant (e.g. a no-show) — mirrors the resident's own
// DELETE /:id/join below exactly (delete the row, promote the next waitlist
// entry) rather than the status-flip convention bookings.ts/vendorOperations.ts
// use, since that's this file's own existing "no longer in the game"
// convention. No refund logic — same off-platform-refund convention as
// everywhere else.
gamesRouter.post("/:id/participants/:residentId/remove", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT host_resident_id, activity_label FROM games WHERE id = ?`).get(req.params.id)) as
    | { host_resident_id: string; activity_label: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can remove a participant" });
  if (req.params.residentId === req.resident!.id) return res.status(400).json({ error: "You can't remove yourself as the host — cancel the game instead" });

  const info = await db
    .prepare(`DELETE FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`)
    .run(req.params.id, req.params.residentId);
  if (info.changes === 0) return res.status(404).json({ error: "That participant isn't joined to this game" });

  promoteNextWaitlistEntry("game", req.params.id, row.activity_label);

  await notifyResident({
    residentId: req.params.residentId,
    kind: "game",
    title: `Removed: ${row.activity_label}`,
    body: "The host has removed you from this game.",
    listingType: "game",
    listingId: req.params.id,
    ref: req.params.id,
  });

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
  if (!row) return res.status(404).json({ error: "Game not found" });
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
  if (info.changes === 0) return res.status(404).json({ error: "You're not joined to this game" });
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
  if (info.changes === 0) return res.status(404).json({ error: "You're not joined to this game" });
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
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can cancel this game" });

  await db.prepare(`UPDATE games SET status = 'cancelled' WHERE id = ?`).run(req.params.id);

  const participants = (await db
    .prepare(`SELECT resident_id FROM game_participants WHERE game_id = ? AND resident_id != ? AND status = 'joined'`)
    .all(req.params.id, req.resident!.id)) as { resident_id: string }[];
  for (const p of participants) {
    await notifyResident({
      residentId: p.resident_id,
      kind: "game",
      title: `Cancelled: ${row.activity_label}`,
      body: reason ? `The host has cancelled this game: ${reason}` : "The host has cancelled this game.",
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
    return res.status(400).json({ error: "Minimum players must be a whole number between 1 and the game's capacity" });
  }

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(req.params.id)) as GameRow | undefined;
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.host_resident_id !== req.resident!.id) return res.status(403).json({ error: "Only the host can edit this game" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This game has been cancelled and can no longer be edited" });

  const { n: joined } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status IN ('joined', 'pending_payment')`)
    .get(req.params.id)) as { n: number };
  if (b.capacity < joined) return res.status(409).json({ error: `Capacity can't be lower than the ${joined} people already joined` });

  const { n: othersJoined } = (await db
    .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND resident_id != ?`)
    .get(req.params.id, req.resident!.id)) as { n: number };
  const priceCents = othersJoined > 0 ? row.price_cents : b.priceCents ?? null;

  await db
    .prepare(
      `UPDATE games SET activity_label = ?, centre_id = ?, location_text = ?, date = ?, time = ?, skill_level = ?, capacity = ?,
              price_cents = ?, visibility = ?, solo_friendly = ?, min_participants = ?, confirmation_deadline = ?,
              description = ?, duration_minutes = ?, equipment_needed = ?, min_age = ?, surface_type = ?, indoor_outdoor = ?,
              meeting_instructions = ?, cancellation_policy = ?
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
    return res.status(400).json({ error: "Minimum players must be a whole number between 1 and the game's capacity" });
  }
  // The host is auto-joined below, so a threshold of 1 (or unset) is
  // already met at creation — only start pending if more than the host
  // is genuinely required.
  const startsPending = !!b.minParticipants && b.minParticipants > 1;

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, skill_level, capacity, price_cents, visibility, solo_friendly, min_participants, confirmation_deadline, status, description, duration_minutes, equipment_needed, min_age, surface_type, indoor_outdoor, meeting_instructions, cancellation_policy, circle_id)
         VALUES (@id, @hostResidentId, @activityLabel, @centreId, @locationText, @date, @time, @skillLevel, @capacity, @priceCents, @visibility, @soloFriendly, @minParticipants, @confirmationDeadline, @status, @description, @durationMinutes, @equipmentNeeded, @minAge, @surfaceType, @indoorOutdoor, @meetingInstructions, @cancellationPolicy, @circleId)`
      )
      .run({
        id,
        hostResidentId: req.resident!.id,
        activityLabel: b.activityLabel,
        centreId: b.centreId ?? null,
        locationText: b.locationText ?? "",
        date: b.date,
        time: b.time,
        skillLevel: b.skillLevel ?? "",
        capacity: b.capacity,
        priceCents: b.priceCents ?? null,
        visibility: b.visibility ?? "public",
        soloFriendly: b.soloFriendly ? 1 : 0,
        minParticipants: b.minParticipants ?? null,
        confirmationDeadline: b.confirmationDeadline ?? null,
        status: startsPending ? "pending_participants" : "open",
        description: b.description ?? null,
        durationMinutes: b.durationMinutes ?? null,
        equipmentNeeded: b.equipmentNeeded ?? null,
        minAge: b.minAge ?? null,
        surfaceType: b.surfaceType ?? "",
        indoorOutdoor: b.indoorOutdoor ?? "",
        meetingInstructions: b.meetingInstructions ?? null,
        cancellationPolicy: b.cancellationPolicy ?? null,
        circleId: b.circleId ?? null,
      });
    // The host is automatically a participant — they take one of the capacity spots.
    await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(id, req.resident!.id);
  });

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(id)) as GameRow;
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
  const hostRow = (await db.prepare(`SELECT host_status as hostStatus FROM residents WHERE id = ?`).get(req.resident!.id)) as { hostStatus: string } | undefined;
  if (hostRow?.hostStatus === "verified") {
    await notifyHostFollowers(req.resident!.id, { title: "New activity", body: `${row.activity_label} — ${row.date} at ${row.time}.`, ref: id });
  }
  if (row.centre_id) {
    await notifyCentreFollowers(row.centre_id, { title: "New activity at this venue", body: `${row.activity_label} — ${row.date} at ${row.time}.`, ref: id });
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
  let insertedRef: string | null = null;
  let checkoutRow: GameRow | null = null;
  let joinedRow: GameRow | null = null;
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
      if (!row) throw new ConflictError("Game not found");
      joinedRow = row;
      // A 'pending_participants' game (Phase 4) is still joinable — that's
      // exactly how it reaches its threshold — only 'cancelled' blocks it.
      if (row.status !== "open" && row.status !== "pending_participants") throw new ConflictError("This game is no longer open");

      const already = await tx.prepare(`SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id);
      if (already) throw new ConflictError("You've already joined this game");

      const { n: joined } = (await tx
        .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status IN ('joined', 'pending_payment')`)
        .get(req.params.id)) as { n: number };
      if (computeCapacity(row.capacity, joined + reservedCount).isFull) throw new ConflictError("This game is full");

      const isPaid = !!row.price_cents && row.price_cents > 0;
      if (isPaid) {
        const ref = generateRef("GJ");
        await tx
          .prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status, payment_status) VALUES (?, ?, ?, 'pending_payment', 'pending')`)
          .run(req.params.id, req.resident!.id, ref);
        insertedRef = ref;
        checkoutRow = row;
        return;
      }

      await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(req.params.id, req.resident!.id);

      if (joined + 1 >= row.capacity) {
        await notifyResident({
          residentId: row.host_resident_id,
          kind: "game",
          title: `Your game is full: ${row.activity_label}`,
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
  const pricing = computePricing(row.price_cents!, 0, 0, null);
  const result = await createCheckoutSession({
    ref: insertedRef,
    type: "game",
    customerEmail: req.resident!.email,
    residentId: req.resident!.id,
    lineItems: pricingLineItems(pricing, { name: `${row.activity_label} — ${row.date} ${row.time}` }),
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
  const row = await db
    .prepare(
      `SELECT gp.ref, gp.payment_status as paymentStatus, g.price_cents as totalCents
       FROM game_participants gp JOIN games g ON g.id = gp.game_id
       WHERE gp.ref = ? AND gp.resident_id = ?`
    )
    .get(req.params.ref, req.resident!.id);
  if (!row) return res.status(404).json({ error: "Game join not found" });
  res.json(row);
});

// --- waitlist (NEXT) — mirrors routes/clubs.ts's club waitlist ------------

gamesRouter.post("/:id/waitlist", requireResident, async (req, res) => {
  const row = (await db.prepare(`SELECT activity_label FROM games WHERE id = ?`).get(req.params.id)) as { activity_label: string } | undefined;
  if (!row) return res.status(404).json({ error: "Game not found" });
  const existing = await db
    .prepare(`SELECT id FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? AND resident_id = ? AND status = 'waiting'`)
    .get(req.params.id, req.resident!.id);
  if (existing) return res.status(409).json({ error: "You're already on the waitlist for this game" });
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

gamesRouter.delete("/:id/join", requireResident, async (req, res) => {
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).run(req.params.id, req.resident!.id);
  const row = (await db.prepare(`SELECT activity_label FROM games WHERE id = ?`).get(req.params.id)) as { activity_label: string } | undefined;
  if (row) promoteNextWaitlistEntry("game", req.params.id, row.activity_label);
  res.json({ ok: true });
});
