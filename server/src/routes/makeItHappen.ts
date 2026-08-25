import { Router } from "express";
import { DEPOSIT_CENTS, MAX_OPEN_SPOTS, createBookingInternal, hireCost } from "./bookings.js";
import { listCentres } from "../db/queries.js";
import { computePricing, splitCostPerPerson } from "../pricing.js";
import { requireResident } from "../residents.js";
import { BadRequestError, bookingEndHour, clientIdFrom, hoursOverlap, isValidEmail } from "../util.js";
import { db } from "../db/index.js";
import type { Centre, Room } from "../types.js";

export const makeItHappenRouter = Router();

// Make It Happen (implementation plan Phase 10) — "pick activity/time/
// place/participant-count/budget → HelloCircle finds a facility, prices
// it, proposes it, recruits participants, confirms once viable" (the
// differentiator's own wording). Functionally this is Open Booking (Phase
// 3) + Minimum Participation (Phase 4) started from a blank search instead
// of an existing reservation — /search below finds+prices candidate rooms,
// /confirm books the top pick via the exact same createBookingInternal()
// the normal checkout route now shares (see bookings.ts), with
// minParticipants set equal to openSpots so the resulting game requires the
// FULL requested group before it's "viable", matching the doc's own wording.

interface Candidate {
  centreId: string;
  centreName: string;
  area: string;
  county: string;
  roomId: string;
  roomName: string;
  capacity: number;
  perPersonCents: number;
  totalCents: number;
  paymentMethod: "online" | "cash";
}

interface SearchBody {
  activityLabel?: string;
  county?: string;
  date?: string;
  time?: string;
  duration?: number;
  partySize?: number;
  maxBudgetPerPersonCents?: number;
}

function validateSearchInput(body: SearchBody): string | null {
  if (!body.date || !body.time || !body.duration) return "Date, time and duration are required";
  if (!Number.isInteger(body.partySize) || (body.partySize as number) < 2 || (body.partySize as number) > MAX_OPEN_SPOTS + 1) {
    return `Party size must be a whole number between 2 and ${MAX_OPEN_SPOTS + 1}`;
  }
  return null;
}

/** Read-only candidate search — no lock, no insert. The final /confirm
 * step re-verifies availability under a real transaction lock (same as
 * every other booking path in this app), so a stale search result just
 * fails confirm with a normal 409 rather than silently double-booking. */
async function findCandidates(body: SearchBody): Promise<Candidate[]> {
  const startHour = parseInt(body.time!.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, body.duration!);
  const partySize = body.partySize!;
  const openSpots = partySize - 1;

  const centres = await listCentres(body.county);
  const candidates: Candidate[] = [];

  for (const centre of centres as Centre[]) {
    if (!centre.isOpen) continue;
    // Feature flags (implementation backlog #5) — Make It Happen always
    // requests openSpots, so a centre whose org has Open Booking disabled
    // can never actually be confirmed; excluded from candidates entirely
    // rather than surfaced and then failing at /confirm.
    if (!centre.openBookingEnabled) continue;
    const opensHour = parseInt(centre.opensAt.slice(0, 2), 10);
    const closesHour = parseInt(centre.closesAt.slice(0, 2), 10);
    if (startHour < opensHour || reqEnd > closesHour) continue;

    for (const room of centre.rooms as Room[]) {
      if (!room.active || room.cap < partySize) continue;

      const isCash = room.paymentMethod === "cash";
      const subtotalCents = hireCost(room.rate, body.duration!) * 100;
      const pricing = computePricing(subtotalCents, isCash ? 0 : DEPOSIT_CENTS, 0, null);
      const perPersonCents = splitCostPerPerson(pricing.totalCents, openSpots);
      if (body.maxBudgetPerPersonCents && perPersonCents > body.maxBudgetPerPersonCents) continue;

      const overlapping = (await db
        .prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND payment_status != 'failed' AND status != 'cancelled'`)
        .all(room.id, centre.id, body.date)) as { time: string; duration: number }[];
      const clashes = overlapping.some((b) => {
        const bStart = parseInt(b.time.slice(0, 2), 10);
        return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
      });
      if (clashes) continue;

      const blocks = (await db
        .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
        .all(centre.id, body.date, room.id)) as { time: string | null }[];
      const blocked = blocks.some((b) => {
        if (b.time === null) return true;
        const bh = parseInt(b.time.slice(0, 2), 10);
        return bh >= startHour && bh < reqEnd;
      });
      if (blocked) continue;

      candidates.push({
        centreId: centre.id,
        centreName: centre.name,
        area: centre.area,
        county: centre.county,
        roomId: room.id,
        roomName: room.name,
        capacity: room.cap,
        perPersonCents,
        totalCents: pricing.totalCents,
        paymentMethod: room.paymentMethod,
      });
    }
  }

  candidates.sort((a, b) => a.perPersonCents - b.perPersonCents);
  return candidates;
}

makeItHappenRouter.post("/search", async (req, res) => {
  const body = req.body as SearchBody;
  const error = validateSearchInput(body);
  if (error) return res.status(400).json({ error });
  const candidates = await findCandidates(body);
  res.json(candidates.slice(0, 3));
});

interface ConfirmBody extends SearchBody {
  centreId?: string;
  roomId?: string;
  activityLabel?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

makeItHappenRouter.post("/confirm", requireResident, async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const body = req.body as ConfirmBody;
  const searchError = validateSearchInput(body);
  if (searchError) return res.status(400).json({ error: searchError });
  if (!body.centreId || !body.roomId) return res.status(400).json({ error: "A chosen venue and room are required" });
  if (!body.name || !isValidEmail(body.email ?? "") || !body.phone) return res.status(400).json({ error: "Name, a valid email and phone are required" });

  const openSpots = body.partySize! - 1;
  const result = await createBookingInternal({
    centreId: body.centreId,
    roomId: body.roomId,
    date: body.date!,
    time: body.time!,
    duration: body.duration!,
    eventType: body.activityLabel || "Make It Happen",
    guests: body.partySize!,
    name: body.name,
    email: body.email!,
    phone: body.phone,
    notes: body.notes,
    // Make It Happen always requires the full requested group — a partial
    // threshold would silently confirm a smaller activity than what was
    // actually asked for, contradicting the differentiator's own "confirms
    // once viable" wording.
    openSpots,
    minParticipants: openSpots,
    residentId: req.resident!.id,
    clientId,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ ref: result.ref, url: result.url, totalEuro: result.totalEuro });
});
