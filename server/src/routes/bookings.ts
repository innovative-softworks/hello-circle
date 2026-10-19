import { customerPaymentCase, hasOpenReview } from "../payments/paymentReview.js";
import crypto from "node:crypto";
import { paymentUnderReview } from "../payments/checkoutAgreement.js";
import { shadowLegacy } from "../commerce/engine.js";
import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { getCentre, openBookingAvailable, orgPoliciesForVendor } from "../db/queries.js";
import { TIME_SLOTS } from "./availability.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { buildIcsEvent } from "../ics.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon, splitCostPerPerson } from "../pricing.js";
import { couponValidateLimiter, lookupLimiter } from "../rateLimit.js";
import { bookingChangeBlock, cancelDeadlineIso, refundStateOf } from "../selfCancel.js";
import { recordOrderAcknowledgements } from "../orderAcknowledgements.js";
import { BadRequestError, ConflictError, bookingEndHour, clientIdFrom, generateRef, hoursOverlap, isValidEmail } from "../util.js";
import { VENDOR_SUSPENDED_ERROR, consumeCoupon, customerKeyOf, endPendingHold, isPositiveInt, occupiesCapacitySql, startIsInFuture, validateFutureDate } from "../bookingIntegrity.js";
import { assertSellable, offeringSellable } from "../orgStatus.js";
import { moveBookingSlot } from "../bookingMove.js";

export const bookingsRouter = Router();

interface CreateBookingBody {
  centreId: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  eventType: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  couponCode?: string;
  /** Open Booking (Phase 3) — how many additional spots (beyond the
   * booker) to open to other residents once this booking is confirmed. */
  openSpots?: number;
  /** Open-booking setup (IA spec §6) — display-only, passed through to the
   * resulting game by createGameFromOpenBooking(). */
  confirmationDeadline?: string;
  /** Minimum Participation Booking (participation-intent plan Phase 5) —
   * only meaningful alongside openSpots: the spun-off game stays
   * 'pending_participants' (joinable, but not yet "confirmed as public")
   * until this many players (not counting the original booker's own room
   * spot) have joined. The column/pass-through already existed end-to-end
   * (createBookingInternal, createGameFromOpenBooking) — this is what was
   * actually missing, the public request body never read it. */
  minParticipants?: number;
}

export function hireCost(rate: number, duration: number): number {
  return duration >= 8 ? Math.round(rate * 6.5) : rate * duration;
}

export const DEPOSIT_CENTS = 100 * 100;
export const MAX_OPEN_SPOTS = 20;

/** Open Booking (Phase 3) — once a booking with open_spots is confirmed
 * (paid, or cash-immediate), create the joinable Game other residents
 * discover and pay their own way into. Idempotent (games.booking_ref is
 * checked first) since confirmBooking can run more than once for the same
 * ref if a webhook retries. Never throws — a failure here shouldn't undo
 * an already-confirmed booking. */
export async function createGameFromOpenBooking(ref: string) {
  try {
    const row = (await db
      .prepare(
        `SELECT b.open_spots as openSpots, b.min_participants as minParticipants, b.resident_id as residentId, b.centre_id as centreId, b.date, b.time,
                b.event_type as eventType, b.total_cents as totalCents, b.confirmation_deadline as confirmationDeadline
         FROM bookings b WHERE b.ref = ? AND b.payment_status = 'paid'`
      )
      .get(ref)) as
      | { openSpots: number | null; minParticipants: number | null; residentId: string | null; centreId: string; date: string; time: string; eventType: string; totalCents: number; confirmationDeadline: string | null }
      | undefined;
    if (!row || !row.openSpots || !row.residentId) return;

    const existing = await db.prepare(`SELECT id FROM games WHERE booking_ref = ?`).get(ref);
    if (existing) return;

    // Make It Happen (Phase 10) sets min_participants = openSpots (the
    // whole requested group is required) — since the host isn't inserted
    // as a game_participant on this game (their spot is the room booking
    // itself), any set threshold >= 1 means the game isn't "viable" yet.
    const startsPending = !!row.minParticipants && row.minParticipants > 0;

    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, price_cents, visibility, booking_ref, min_participants, confirmation_deadline, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, ?)`
      )
      .run(
        id,
        row.residentId,
        row.eventType || "Open booking",
        row.centreId,
        row.date,
        row.time,
        row.openSpots,
        splitCostPerPerson(row.totalCents, row.openSpots),
        ref,
        row.minParticipants,
        row.confirmationDeadline,
        startsPending ? "pending_participants" : "open"
      );
  } catch (e) {
    console.error("[bookings] createGameFromOpenBooking failed:", e);
  }
}

export interface CreateBookingInternalInput {
  centreId: string;
  roomId: string;
  date: string;
  time: string;
  duration: number;
  eventType: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  couponCode?: string;
  openSpots?: number | null;
  minParticipants?: number | null;
  confirmationDeadline?: string | null;
  residentId: string | null;
  clientId: string;
  /** Mobile checkout hand-off (Phase 3) — see checkoutService.ts's isNative
   * param. Optional: makeItHappen.ts's other call site omits it, keeping
   * web/default behavior unchanged. */
  isNative?: boolean;
  /** Booking UX Phase 4 (B8) — recorded with the order; the terms version is resolved server-side. */
  acceptedTerms?: boolean;
}

export type CreateBookingResult =
  | { ok: true; ref: string; totalEuro: number; url?: string }
  | { ok: false; status: number; error: string };

export type BookingPriceInput = Pick<CreateBookingInternalInput, "centreId" | "roomId" | "date" | "time" | "duration" | "guests" | "couponCode" | "openSpots">;

type PricedBooking = {
  ok: true;
  centre: NonNullable<Awaited<ReturnType<typeof getCentre>>>;
  room: NonNullable<Awaited<ReturnType<typeof getCentre>>>["rooms"][number];
  vendorId: string | null;
  startHour: number;
  reqEnd: number;
  isCash: boolean;
  discountCents: number;
  couponCode: string | null;
  pricing: ReturnType<typeof computePricing>;
};

/** Booking audit 2026-10-11 (B1) — every check that decides whether a
 * booking request is valid, and its price, in one place. Shared by
 * createBookingInternal (checkout, Make It Happen) and POST /quote, so the
 * total shown before payment is computed by exactly the code that charges
 * it. Read-only: no slot lock and no coupon reservation happen here. */
export async function priceBookingRequest(input: BookingPriceInput): Promise<PricedBooking | { ok: false; status: number; error: string }> {
  const centre = await getCentre(input.centreId);
  const room = centre?.rooms.find((r) => r.id === input.roomId);
  // Booking audit 2026-10-11 — getCentre is the unfiltered internal read, so
  // the approval check lives here: a pending/rejected venue takes no bookings.
  if (!centre || !room || centre.status !== "approved") return { ok: false, status: 404, error: "Centre or room not found" };
  if (!centre.isOpen) return { ok: false, status: 409, error: "This venue isn't currently taking bookings" };

  // Every overlap/opening-hours check below (and in availability.ts) only
  // ever compares whole hours (bookingEndHour/hoursOverlap take integer
  // hours) — an unvalidated time like "14:30" was silently truncated to
  // "14:00" for clash-checking purposes while still being stored/displayed
  // as "14:30", so a second booking at "15:00" (real overlap 14:30–15:30 vs
  // 15:00–16:00) was wrongly accepted as non-overlapping. Reject anything
  // not on the fixed slot grid the client itself offers, rather than
  // silently truncating it.
  if (!TIME_SLOTS.includes(input.time)) return { ok: false, status: 400, error: "Invalid time slot" };
  // Phase 8 (HC-QA-035/036) — validate everything that drives price and
  // inventory before pricing: whole hours (the billed hours ARE the reserved
  // hours — end is derived from start + duration), a real party size within
  // the room's capacity, and a real date/time that hasn't passed.
  if (!isPositiveInt(input.duration, 24)) return { ok: false, status: 400, error: "Duration must be a whole number of hours" };
  if (!isPositiveInt(input.guests)) return { ok: false, status: 400, error: "Number of guests must be a whole number of at least 1" };
  if (room.cap > 0 && input.guests > room.cap) return { ok: false, status: 400, error: `This room holds up to ${room.cap} guests` };
  const dateError = validateFutureDate(input.date);
  if (dateError) return { ok: false, status: 400, error: dateError };
  if (!startIsInFuture(input.date, input.time)) return { ok: false, status: 400, error: "That time has already passed" };

  const startHour = parseInt(input.time.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, input.duration);

  const opensHour = parseInt(centre.opensAt.slice(0, 2), 10);
  const closesHour = parseInt(centre.closesAt.slice(0, 2), 10);
  if (startHour < opensHour || reqEnd > closesHour) {
    return { ok: false, status: 409, error: "That time is outside the venue's opening hours" };
  }

  const centreVendorRow = (await db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(input.centreId)) as { vendor_id: string | null } | undefined;
  // D-01: the member and their organisation must both be able to sell (re-checked under lock below).
  if (!(await offeringSellable(centreVendorRow?.vendor_id))) return { ok: false, status: 409, error: VENDOR_SUSPENDED_ERROR };
  const { bookingWindowDays } = await orgPoliciesForVendor(centreVendorRow?.vendor_id ?? null);
  const eventStart = irelandWallTimeToUtc(input.date, startHour);
  if (eventStart.getTime() - Date.now() > bookingWindowDays * 24 * 60 * 60 * 1000) {
    return { ok: false, status: 409, error: `This venue only takes bookings up to ${bookingWindowDays} days in advance` };
  }

  // Feature flags (implementation backlog #5) — admin can disable Open
  // Booking for an org; checked here (the single internal function shared
  // by direct checkout and Make It Happen's confirm step) rather than at
  // each entry point separately, so neither can drift out of enforcement.
  if (input.openSpots && !(await openBookingAvailable(centreVendorRow?.vendor_id ?? null))) {
    return { ok: false, status: 403, error: "Open Booking isn't enabled for this venue" };
  }

  const isCash = room.paymentMethod === "cash";
  const subtotalCents = hireCost(room.rate, input.duration) * 100;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (input.couponCode) {
    const result = await evaluateCoupon(input.couponCode, subtotalCents, { listingType: "centre", listingId: input.centreId });
    if (!result.valid) return { ok: false, status: 400, error: result.error! };
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  // Cash bookings skip the refundable deposit too — there's no online charge to hold it against.
  const pricing = computePricing(subtotalCents, isCash ? 0 : DEPOSIT_CENTS, discountCents, couponCode);
  return { ok: true, centre, room, vendorId: centreVendorRow?.vendor_id ?? null, startHour, reqEnd, isCash, discountCents, couponCode, pricing };
}

/** The actual booking-creation logic shared by POST /checkout below and
 * Make It Happen's confirm step (routes/makeItHappen.ts) — extracted so
 * the two entry points can't drift apart on anything payment-adjacent
 * (overlap-locking, pricing, Stripe session creation). The route handler
 * below does request-shape validation (missing fields, email format) and
 * maps the result to an HTTP response; this function assumes its input is
 * already validated. */
export async function createBookingInternal(input: CreateBookingInternalInput): Promise<CreateBookingResult> {
  const priced = await priceBookingRequest(input);
  if (!priced.ok) return priced;
  const { centre, room, startHour, reqEnd, isCash, discountCents, couponCode, pricing } = priced;
  const ref = generateRef("HB");
  shadowLegacy("booking", ref, { vendorUserId: priced.vendorId }, pricing);

  // The availability check and the insert must be atomic against concurrent
  // checkouts for the same room — otherwise two guests can both pass the
  // overlap check for the same slot before either has inserted their row
  // (a plain read-then-insert race). `SELECT ... FOR UPDATE` on the room's
  // own row (which always exists, regardless of date) takes an InnoDB row
  // lock for the rest of this transaction: a second transaction's own
  // `FOR UPDATE` on the same room blocks until the first commits or rolls
  // back, so by the time it re-reads bookings/room_blocks, the first
  // transaction's insert (or failure) is already visible.
  try {
    await db.transaction(async (tx) => {
      await tx.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ? FOR UPDATE`).get(input.roomId, input.centreId);
      // D-01: re-check with a shared lock on the organisation row, so a
      // concurrent suspension and this sale serialise.
      await assertSellable(tx, priced.vendorId);

      // rooms.id is only unique per-centre (PRIMARY KEY (centre_id, id)) —
      // without this, a different centre's booking on a colliding room_id
      // could wrongly reject this checkout as clashing.
      const overlapping = (await tx
        // HC-QA-041 — a stale pending hold (abandoned checkout) no longer blocks the slot.
        .prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND ${occupiesCapacitySql()}`)
        .all(input.roomId, input.centreId, input.date)) as { time: string; duration: number }[];
      const clashes = overlapping.some((b) => {
        const bStart = parseInt(b.time.slice(0, 2), 10);
        return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
      });
      if (clashes) throw new ConflictError("That slot is no longer available");

      const blocks = (await tx
        .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
        .all(input.centreId, input.date, input.roomId)) as { time: string | null }[];
      const blocked = blocks.some((b) => {
        if (b.time === null) return true;
        const bh = parseInt(b.time.slice(0, 2), 10);
        return bh >= startHour && bh < reqEnd;
      });
      if (blocked) throw new ConflictError("The vendor has closed that date/time");

      // HC-QA-037/050 — the coupon use is reserved with the booking itself (cash
      // or online); a pending online hold that fails/expires hands it back.
      if (couponCode) {
        try {
          await consumeCoupon(tx, couponCode, { sourceType: "booking", ref, customerKey: customerKeyOf(input.residentId, input.clientId), discountMinor: discountCents, confirmed: isCash });
        } catch (e) {
          throw new BadRequestError(e instanceof Error ? e.message : "That code has been fully redeemed");
        }
      }

      await tx
        .prepare(
          `INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
            subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, open_spots, min_participants, confirmation_deadline)
           VALUES (@ref, @clientId, @residentId, @centreId, @roomId, @date, @time, @duration, @eventType, @guests, @name, @email, @phone, @notes,
            @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status, @openSpots, @minParticipants, @confirmationDeadline)`
        )
        .run({
          ref,
          clientId: input.clientId,
          residentId: input.residentId,
          centreId: input.centreId,
          roomId: input.roomId,
          date: input.date,
          time: input.time,
          duration: input.duration,
          eventType: input.eventType,
          guests: input.guests,
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: input.notes ?? "",
          subtotalCents: pricing.taxableCents,
          discountCents: pricing.discountCents,
          vatCents: pricing.vatCents,
          platformFeeCents: pricing.platformFeeCents,
          openSpots: input.openSpots ?? null,
          minParticipants: input.minParticipants ?? null,
          confirmationDeadline: input.confirmationDeadline ?? null,
          couponCode: pricing.couponCode,
          totalCents: pricing.totalCents,
          status: isCash ? "paid" : "pending",
        });
      await recordOrderAcknowledgements(tx, { sourceType: "booking", ref, clientId: input.clientId, residentId: input.residentId, terms: input.acceptedTerms === true });
    });
  } catch (e) {
    if (e instanceof BadRequestError) return { ok: false, status: 400, error: e.message };
    if (e instanceof ConflictError) return { ok: false, status: 409, error: e.message };
    throw e;
  }

  // Cash rooms skip Stripe entirely — confirmed immediately, paid on arrival.
  if (isCash) {
    const centreVendor = (await db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(centre.id)) as { vendor_id: string | null } | undefined;
    notifyNewBookingOrRegistration({
      kind: "booking",
      listingType: "centre",
      listingId: centre.id,
      listingName: centre.name,
      vendorId: centreVendor?.vendor_id ?? null,
      guestName: input.name,
      guestEmail: input.email,
      ref,
      detailsText: `${input.date} at ${input.time} · ${input.duration}h · ${input.guests} guests · €${(pricing.totalCents / 100).toFixed(2)} due in cash on arrival`,
      residentId: input.residentId,
    }).catch((e) => console.error("[notifications] booking notify failed:", e));
    if (input.openSpots) await createGameFromOpenBooking(ref);
    if (input.residentId) await upgradeFavouriteStatus(input.residentId, "centre", centre.id);
    void logEvent("booking_completed", { residentId: input.residentId ?? null, metadata: { type: "booking", ref, via: "cash" } });
    return { ok: true, ref, totalEuro: pricing.totalCents / 100 };
  }

  const result = await createCheckoutSession({
    ref,
    type: "booking",
    customerEmail: input.email,
    residentId: input.residentId,
    lineItems: pricingLineItems(pricing, {
      name: room.name ? `${centre.name} — ${room.name}` : centre.name,
      description: `${input.date} at ${input.time}, ${input.duration}h${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
    }),
    isNative: input.isNative,
  });
  if (!result.ok) {
    await endPendingHold("bookings", ref, "delete");
    return { ok: false, status: result.status, error: result.error };
  }

  await db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  return { ok: true, ref, url: result.session.url ?? undefined, totalEuro: pricing.totalCents / 100 };
}

/** Booking audit 2026-10-11 (B1) — the authoritative price for the booking
 * form, from priceBookingRequest(): the same validation and pricing checkout
 * runs, so the shown total is the charged total. Read-only: the slot isn't
 * held and a coupon is evaluated, not reserved. Also returns the cancellation
 * deadline for the requested slot, so the review step doesn't hard-code it. */
bookingsRouter.post("/quote", couponValidateLimiter, async (req, res) => {
  const b = req.body as Partial<Pick<CreateBookingBody, "centreId" | "roomId" | "date" | "time" | "duration" | "guests" | "couponCode">>;
  if (!b.centreId || !b.roomId || !b.date || !b.time || b.duration === undefined || b.guests === undefined) {
    return res.status(400).json({ error: "centreId, roomId, date, time, duration and guests are required" });
  }
  const priced = await priceBookingRequest({ centreId: b.centreId, roomId: b.roomId, date: b.date, time: b.time, duration: b.duration, guests: b.guests, couponCode: b.couponCode });
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error });
  const p = priced.pricing;
  const { cancellationHours } = await orgPoliciesForVendor(priced.vendorId);
  const start = irelandWallTimeToUtc(b.date, priced.startHour);
  res.json({
    subtotalCents: p.subtotalCents,
    discountCents: p.discountCents,
    taxableCents: p.taxableCents,
    vatCents: p.vatCents,
    platformFeeCents: p.platformFeeCents,
    depositCents: p.depositCents,
    totalCents: p.totalCents,
    couponCode: priced.couponCode,
    currency: "EUR",
    payAtVenue: priced.isCash,
    cancellationHours,
    cancelDeadline: new Date(start.getTime() - cancellationHours * 60 * 60 * 1000).toISOString(),
  });
});

bookingsRouter.post("/checkout", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const body = req.body as CreateBookingBody;
  if (!body.centreId || !body.roomId || !body.date || !body.time || !body.duration) {
    return res.status(400).json({ error: "Missing required booking fields" });
  }
  if (!isValidEmail(body.email)) {
    return res.status(400).json({ error: "That doesn't look like a valid email address" });
  }
  // Open Booking (Phase 3) — the resulting Game needs a resident to host
  // it (same requirement as creating any game directly), so this isn't
  // available to a pure guest checkout.
  let openSpots: number | null = null;
  let minParticipants: number | null = null;
  if (body.openSpots) {
    if (!req.resident) return res.status(400).json({ error: "Sign in to open this booking to other players" });
    if (!Number.isInteger(body.openSpots) || body.openSpots < 1 || body.openSpots > MAX_OPEN_SPOTS) {
      return res.status(400).json({ error: `Open spots must be a whole number between 1 and ${MAX_OPEN_SPOTS}` });
    }
    openSpots = body.openSpots;
    if (body.minParticipants !== undefined) {
      if (!Number.isInteger(body.minParticipants) || body.minParticipants < 1 || body.minParticipants > openSpots) {
        return res.status(400).json({ error: "Minimum players must be a whole number between 1 and the number of open spots" });
      }
      minParticipants = body.minParticipants;
    }
  }

  const result = await createBookingInternal({
    centreId: body.centreId,
    roomId: body.roomId,
    date: body.date,
    time: body.time,
    duration: body.duration,
    eventType: body.eventType,
    guests: body.guests,
    name: body.name,
    email: body.email,
    phone: body.phone,
    notes: body.notes,
    couponCode: body.couponCode,
    openSpots,
    minParticipants,
    confirmationDeadline: openSpots ? body.confirmationDeadline ?? null : null,
    residentId: req.resident?.id ?? null,
    clientId,
    isNative: req.header("X-Client-Platform") === "mobile",
    acceptedTerms: (body as { acceptedTerms?: unknown }).acceptedTerms === true,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ ref: result.ref, url: result.url, totalEuro: result.totalEuro });
});

bookingsRouter.get("/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  // Resident Experience Polish — Changeset 5. Previously this only ever
  // returned {ref, paymentStatus, totalCents} — enough for PaymentSuccess.tsx's
  // polling loop, not enough to answer "what did I just book?" once paid.
  // Enriched in place rather than adding a second fetch: PaymentSuccess.tsx
  // already stores the terminal poll response, so no extra round trip.
  const row = (await db
    .prepare(
      `SELECT b.ref, b.payment_status as paymentStatus, b.total_cents as totalCents,
              b.centre_id as centreId, c.name as centreName, r.name as roomName, b.date, b.time, b.duration, b.guests, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE b.ref = ? AND b.client_id = ?`
    )
    .get(req.params.ref, clientId)) as ({ vendorId: string | null; date: string; time: string } & Record<string, unknown>) | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  // Booking UX Phase 3 — the confirmation page states the deadline (same rule as cancel).
  const { vendorId, ...rest } = row;
  const { cancellationHours } = await orgPoliciesForVendor(vendorId);
  const paymentReview = row.paymentStatus === "pending" && (await paymentUnderReview("booking", req.params.ref));
  res.json({ ...rest, cancelDeadline: cancelDeadlineIso(row.date, row.time, cancellationHours), paymentReview, paymentCase: await customerPaymentCase("booking", req.params.ref) });
});

// "Add to calendar" (IA spec §13) — same client_id ownership gate as
// GET /status/:ref, server-generated .ics rather than a client-side
// library since a paid booking's date/time/venue are already known here.
bookingsRouter.get("/:ref/ics", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, c.name as centreName, c.area as area, c.county as county
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND b.client_id = ? AND b.payment_status = 'paid'`
    )
    .get(req.params.ref, clientId)) as
    | { ref: string; date: string; time: string; duration: number; centreName: string; area: string; county: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });

  const [h, m] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, h, m);
  const end = new Date(start.getTime() + row.duration * 60 * 60 * 1000);
  const ics = buildIcsEvent({ uid: `booking-${row.ref}`, title: `${row.centreName} booking`, location: `${row.area}, ${row.county}`, start, end });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="booking-${row.ref}.ics"`);
  res.send(ics);
});

type ManageableBookingRow = Record<string, unknown> & { date: string; time: string; status: string; paymentStatus: string; totalCents: number; paidOnline: number; vendorId: string | null };

/** Booking audit 2026-10-11 (B3) — what the guest may do with each booking,
 * decided by the same rules the cancel and reschedule routes enforce
 * (selfCancel.ts), so My Life never offers an action the server refuses. */
async function withManageFields(rows: ManageableBookingRow[]) {
  const hoursByVendor = new Map<string | null, number>();
  const out = [];
  for (const { paidOnline, ...r } of rows) {
    if (!hoursByVendor.has(r.vendorId)) hoursByVendor.set(r.vendorId, (await orgPoliciesForVendor(r.vendorId)).cancellationHours);
    const hours = hoursByVendor.get(r.vendorId)!;
    out.push({
      ...r,
      paidOnline: !!paidOnline,
      canCancel: bookingChangeBlock(r, "cancel", hours) === null,
      canReschedule: bookingChangeBlock(r, "reschedule", hours) === null,
      cancelDeadline: cancelDeadlineIso(r.date, r.time, hours),
      refundState: refundStateOf({ ...r, paidOnline }),
    });
  }
  return out;
}

bookingsRouter.get("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  // Signed in via a magic link (see guestAuth.ts)? Also include every
  // booking under that verified email, not just this device's client_id —
  // one OR, no dedup needed since it's still one row per match, not a union.
  const rows = req.guestEmail
    ? await db
        .prepare(
          `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt, b.status,
                  b.payment_status as paymentStatus, b.stripe_session_id IS NOT NULL as paidOnline,
                  c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName, c.vendor_id as vendorId,
                  (SELECT a.status FROM attendance a WHERE a.kind = 'booking' AND a.ref = b.ref) as attendance
           FROM bookings b
           JOIN centres c ON c.id = b.centre_id
           LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
           WHERE (b.client_id = ? OR LOWER(b.email) = LOWER(?)) AND b.payment_status IN ('paid', 'refunded')
           ORDER BY b.created_at DESC`
        )
        .all(clientId, req.guestEmail)
    : await db
        .prepare(
          `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt, b.status,
                  b.payment_status as paymentStatus, b.stripe_session_id IS NOT NULL as paidOnline,
                  c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName, c.vendor_id as vendorId,
                  (SELECT a.status FROM attendance a WHERE a.kind = 'booking' AND a.ref = b.ref) as attendance
           FROM bookings b
           JOIN centres c ON c.id = b.centre_id
           LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
           WHERE b.client_id = ? AND b.payment_status IN ('paid', 'refunded')
           ORDER BY b.created_at DESC`
        )
        .all(clientId);

  res.json(await withManageFields(rows as ManageableBookingRow[]));
});

/** Lets a guest recover a booking on a device that never made it — i.e.
 * one that doesn't have the original client_id in localStorage — by
 * proving they know both the ref (emailed to them) and the email address
 * used at checkout. Read-only: doesn't touch client_id, so it can't remove
 * the booking from the original device's "My bookings" list. */
bookingsRouter.post("/lookup", lookupLimiter, async (req, res) => {
  const { ref, email } = req.body as { ref?: string; email?: string };
  if (!ref || !email) return res.status(400).json({ error: "Reference and email are required" });

  const row = await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt, b.status,
              b.payment_status as paymentStatus, b.stripe_session_id IS NOT NULL as paidOnline,
              c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName, c.vendor_id as vendorId
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE b.ref = ? AND LOWER(b.email) = LOWER(?)`
    )
    .get(ref.trim(), email.trim());
  if (!row) return res.status(404).json({ error: "We couldn't find a booking with that reference and email" });
  res.json((await withManageFields([row as ManageableBookingRow]))[0]);
});

/** Booking UX Phase 5 (audit E1) — activities held on this booking (games.booking_ref).
 * A guest can't cancel or move the booking out from under them; they change
 * or cancel the activity first. A venue-side cancel cascades instead. */
export async function activeLinkedGames(ref: string): Promise<{ id: string; activityLabel: string }[]> {
  return (await db.prepare(`SELECT id, activity_label as activityLabel FROM games WHERE booking_ref = ? AND status != 'cancelled'`).all(ref)) as { id: string; activityLabel: string }[];
}

/** A booking may only be cancelled by the guest who made it, and only up to
 * 48h before the booked start time — matches the "Free cancellation up to
 * 48h before" copy already shown on every centre's detail page. Cancelling
 * only flips a status flag; any refund for an online payment is handled
 * off-platform, same as the "refundable deposit" promise already is.
 *
 * Ownership is proven either by the usual X-Client-Id header, or (for a
 * booking recovered via /lookup on another device) an `email` in the body
 * matching the row. */
bookingsRouter.post("/:ref/cancel", lookupLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  const headerClientId = req.header("X-Client-Id");
  if (!headerClientId && !email) {
    return res.status(400).json({ error: "X-Client-Id header or email is required" });
  }

  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.status, b.payment_status as paymentStatus,
              b.name, b.email, b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, b.resident_id as residentId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND (b.client_id = ? OR LOWER(b.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | { ref: string; date: string; time: string; duration: number; guests: number; status: string; paymentStatus: string; name: string; email: string; centreId: string; centreName: string; vendorId: string | null; residentId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  // Venues are physically in Ireland — the cut-off is computed against the
  // booking's Irish wall-clock time (selfCancel.ts, shared with My Life).
  const { cancellationHours } = await orgPoliciesForVendor(row.vendorId);
  const block = bookingChangeBlock(row, "cancel", cancellationHours);
  if (block) return res.status(block.status).json({ error: block.error });
  const linked = await activeLinkedGames(row.ref);
  if (linked.length) return res.status(409).json({ error: `"${linked[0].activityLabel}" is being held on this booking — cancel or move the activity first`, linkedGameId: linked[0].id });

  // HC-QA-046 — atomic transition: only the request that actually flips the row
  // runs the side effects (capacity release, audit, notifications, promotion).
  const flipped = await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE ref = ? AND status != 'cancelled'`).run(row.ref);
  if (flipped.changes !== 1) return res.status(409).json({ error: "This booking is already cancelled" });

  notifyCancellation({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] booking cancellation notify failed:", e));

  res.json({ ok: true });
});

/** Reschedule (Phase A) — same ownership/cutoff rules as cancel, but keeps
 * the same ref/payment instead of cancel-and-rebook. Re-runs the identical
 * row-locked overlap check checkout uses, against the *new* slot, so a
 * reschedule can never silently double-book a room. */
bookingsRouter.post("/:ref/reschedule", lookupLimiter, async (req, res) => {
  const { email, date, time } = req.body as { email?: string; date?: string; time?: string };
  const headerClientId = req.header("X-Client-Id");
  if (!headerClientId && !email) return res.status(400).json({ error: "X-Client-Id header or email is required" });
  if (!date || !time) return res.status(400).json({ error: "A new date and time are required" });
  // Same fixed-slot-grid validation as createBookingInternal — the overlap
  // check below only compares whole hours, so an off-grid time like "14:30"
  // would clash-check as "14:00" while displaying/storing as "14:30".
  if (!TIME_SLOTS.includes(time)) return res.status(400).json({ error: "Invalid time slot" });
  const newDateError = validateFutureDate(date);
  if (newDateError) return res.status(400).json({ error: newDateError });
  if (!startIsInFuture(date, time)) return res.status(400).json({ error: "That time has already passed" });

  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.status, b.payment_status as paymentStatus, b.room_id as roomId,
              b.name, b.email, b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, c.opens_at as opensAt, c.closes_at as closesAt, b.resident_id as residentId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND (b.client_id = ? OR LOWER(b.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | {
        ref: string; date: string; time: string; duration: number; status: string; paymentStatus: string; roomId: string;
        name: string; email: string; centreId: string; centreName: string; vendorId: string | null; opensAt: string; closesAt: string; residentId: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  // D-10 — a booking whose payment is under review can't be moved (its review
  // deadline belongs to this slot, and a deadline is never extended).
  if (await hasOpenReview("booking", row.ref)) return res.status(409).json({ error: "Your payment is still being checked, so this booking can't be moved yet" });
  const { cancellationHours, bookingWindowDays } = await orgPoliciesForVendor(row.vendorId);
  const block = bookingChangeBlock(row, "reschedule", cancellationHours);
  if (block) return res.status(block.status).json({ error: block.error });
  const linked = await activeLinkedGames(row.ref);
  if (linked.length) return res.status(409).json({ error: `"${linked[0].activityLabel}" is being held on this booking — cancel or move the activity first`, linkedGameId: linked[0].id });

  const startHour = parseInt(time.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, row.duration);
  const opensHour = parseInt(row.opensAt.slice(0, 2), 10);
  const closesHour = parseInt(row.closesAt.slice(0, 2), 10);
  if (startHour < opensHour || reqEnd > closesHour) {
    return res.status(409).json({ error: "That time is outside the venue's opening hours" });
  }

  const newEventStart = irelandWallTimeToUtc(date, startHour);
  if (newEventStart.getTime() - Date.now() > bookingWindowDays * 24 * 60 * 60 * 1000) {
    return res.status(409).json({ error: `This venue only takes bookings up to ${bookingWindowDays} days in advance` });
  }

  try {
    // Shared with accepted venue proposals and host activity moves (bookingMove.ts):
    // the same room lock, overlap and closure checks as checkout.
    await db.transaction(async (tx) => {
      await moveBookingSlot(tx, row, date, time);
    });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `Rescheduled to ${date} at ${time} (was ${row.date} at ${row.time})`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] reschedule notify failed:", e));

  res.json({ ok: true, date, time });
});
