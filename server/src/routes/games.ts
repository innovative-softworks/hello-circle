import crypto from "node:crypto";
import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { countFamiliarCoParticipants } from "../db/queries.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyResident } from "../notifications.js";
import { computePricing } from "../pricing.js";
import { requireResident } from "../residents.js";
import { ConflictError, generateRef } from "../util.js";
import { promoteNextWaitlistEntry } from "../waitlist.js";

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
    spotsLeft: Math.max(0, row.capacity - joined),
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
  };
}

// Upcoming, open games — v1 is cash/free only (see POST /, priceCents is
// display-only, never charged through Stripe/pricing.ts). Sorted soonest
// first; a past-dated game is simply never returned (no cleanup job needed
// since nothing depends on stale rows being deleted).
gamesRouter.get("/", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
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
  const rows = (await db
    .prepare(
      `SELECT g.* FROM games g
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
  res.json({ ...json, joinedByMe, waitlistedByMe, familiarCount });
});

// Host-only — closes a game early (e.g. plans changed). Distinct from a
// participant leaving: this ends it for everyone. Deliberately doesn't
// refund a paid join automatically — same off-platform-refund convention
// bookings.ts/registrations.ts already use for cancellations.
gamesRouter.post("/:id/cancel", requireResident, async (req, res) => {
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
      body: "The host has cancelled this game.",
      listingType: "game",
      listingId: req.params.id,
      ref: req.params.id,
    });
  }
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
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, skill_level, capacity, price_cents, visibility, solo_friendly, min_participants, status)
         VALUES (@id, @hostResidentId, @activityLabel, @centreId, @locationText, @date, @time, @skillLevel, @capacity, @priceCents, @visibility, @soloFriendly, @minParticipants, @status)`
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
        status: startsPending ? "pending_participants" : "open",
      });
    // The host is automatically a participant — they take one of the capacity spots.
    await tx.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(id, req.resident!.id);
  });

  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(id)) as GameRow;
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
  try {
    await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT * FROM games WHERE id = ? FOR UPDATE`).get(req.params.id)) as GameRow | undefined;
      if (!row) throw new ConflictError("Game not found");
      // A 'pending_participants' game (Phase 4) is still joinable — that's
      // exactly how it reaches its threshold — only 'cancelled' blocks it.
      if (row.status !== "open" && row.status !== "pending_participants") throw new ConflictError("This game is no longer open");

      const already = await tx.prepare(`SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id);
      if (already) throw new ConflictError("You've already joined this game");

      const { n: joined } = (await tx
        .prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status IN ('joined', 'pending_payment')`)
        .get(req.params.id)) as { n: number };
      if (joined >= row.capacity) throw new ConflictError("This game is full");

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
    await checkMinParticipantsThreshold(req.params.id);
    await upgradeFavouriteStatus(req.resident!.id, "game", req.params.id);
  }

  if (!insertedRef || !checkoutRow) return res.json({ ok: true });

  const row = checkoutRow as GameRow;
  const pricing = computePricing(row.price_cents!, 0, 0, null);
  const result = await createCheckoutSession({
    ref: insertedRef,
    type: "game",
    customerEmail: req.resident!.email,
    lineItems: pricingLineItems(pricing, { name: `${row.activity_label} — ${row.date} ${row.time}` }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM game_participants WHERE ref = ?`).run(insertedRef);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE game_participants SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, insertedRef);
  res.status(201).json({ ref: insertedRef, url: result.session.url, totalEuro: pricing.totalCents / 100 });
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
