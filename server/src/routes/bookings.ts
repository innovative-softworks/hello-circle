import crypto from "node:crypto";
import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { getCentre, orgPoliciesForVendor } from "../db/queries.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon, splitCostPerPerson } from "../pricing.js";
import { lookupLimiter } from "../rateLimit.js";
import { BadRequestError, ConflictError, bookingEndHour, clientIdFrom, generateRef, hoursOverlap, isValidEmail } from "../util.js";

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
}

function hireCost(rate: number, duration: number): number {
  return duration >= 8 ? Math.round(rate * 6.5) : rate * duration;
}

const DEPOSIT_CENTS = 100 * 100;
const MAX_OPEN_SPOTS = 20;

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
        `SELECT b.open_spots as openSpots, b.resident_id as residentId, b.centre_id as centreId, b.date, b.time,
                b.event_type as eventType, b.total_cents as totalCents
         FROM bookings b WHERE b.ref = ? AND b.payment_status = 'paid'`
      )
      .get(ref)) as { openSpots: number | null; residentId: string | null; centreId: string; date: string; time: string; eventType: string; totalCents: number } | undefined;
    if (!row || !row.openSpots || !row.residentId) return;

    const existing = await db.prepare(`SELECT id FROM games WHERE booking_ref = ?`).get(ref);
    if (existing) return;

    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, price_cents, visibility, booking_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?)`
      )
      .run(id, row.residentId, row.eventType || "Open booking", row.centreId, row.date, row.time, row.openSpots, splitCostPerPerson(row.totalCents, row.openSpots), ref);
  } catch (e) {
    console.error("[bookings] createGameFromOpenBooking failed:", e);
  }
}

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
  if (body.openSpots) {
    if (!req.resident) return res.status(400).json({ error: "Sign in to open this booking to other players" });
    if (!Number.isInteger(body.openSpots) || body.openSpots < 1 || body.openSpots > MAX_OPEN_SPOTS) {
      return res.status(400).json({ error: `Open spots must be a whole number between 1 and ${MAX_OPEN_SPOTS}` });
    }
    openSpots = body.openSpots;
  }

  const centre = await getCentre(body.centreId);
  const room = centre?.rooms.find((r) => r.id === body.roomId);
  if (!centre || !room) return res.status(404).json({ error: "Centre or room not found" });
  if (!centre.isOpen) return res.status(409).json({ error: "This venue isn't currently taking bookings" });

  const startHour = parseInt(body.time.slice(0, 2), 10);
  const reqEnd = bookingEndHour(startHour, body.duration);

  const opensHour = parseInt(centre.opensAt.slice(0, 2), 10);
  const closesHour = parseInt(centre.closesAt.slice(0, 2), 10);
  if (startHour < opensHour || reqEnd > closesHour) {
    return res.status(409).json({ error: "That time is outside the venue's opening hours" });
  }

  const centreVendorRow = (await db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(body.centreId)) as { vendor_id: string | null } | undefined;
  const { bookingWindowDays } = await orgPoliciesForVendor(centreVendorRow?.vendor_id ?? null);
  const eventStart = irelandWallTimeToUtc(body.date, startHour);
  if (eventStart.getTime() - Date.now() > bookingWindowDays * 24 * 60 * 60 * 1000) {
    return res.status(409).json({ error: `This venue only takes bookings up to ${bookingWindowDays} days in advance` });
  }

  const isCash = room.paymentMethod === "cash";
  const subtotalCents = hireCost(room.rate, body.duration) * 100;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (body.couponCode) {
    const result = await evaluateCoupon(body.couponCode, subtotalCents);
    if (!result.valid) return res.status(400).json({ error: result.error });
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  // Cash bookings skip the refundable deposit too — there's no online charge to hold it against.
  const pricing = computePricing(subtotalCents, isCash ? 0 : DEPOSIT_CENTS, discountCents, couponCode);
  const ref = generateRef("HB");

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
      await tx.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ? FOR UPDATE`).get(body.roomId, body.centreId);

      // rooms.id is only unique per-centre (PRIMARY KEY (centre_id, id)) —
      // without this, a different centre's booking on a colliding room_id
      // could wrongly reject this checkout as clashing.
      const overlapping = (await tx
        .prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND payment_status != 'failed' AND status != 'cancelled'`)
        .all(body.roomId, body.centreId, body.date)) as { time: string; duration: number }[];
      const clashes = overlapping.some((b) => {
        const bStart = parseInt(b.time.slice(0, 2), 10);
        return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
      });
      if (clashes) throw new ConflictError("That slot is no longer available");

      const blocks = (await tx
        .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
        .all(body.centreId, body.date, body.roomId)) as { time: string | null }[];
      const blocked = blocks.some((b) => {
        if (b.time === null) return true;
        const bh = parseInt(b.time.slice(0, 2), 10);
        return bh >= startHour && bh < reqEnd;
      });
      if (blocked) throw new ConflictError("The vendor has closed that date/time");

      await tx
        .prepare(
          `INSERT INTO bookings (ref, client_id, resident_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
            subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, open_spots)
           VALUES (@ref, @clientId, @residentId, @centreId, @roomId, @date, @time, @duration, @eventType, @guests, @name, @email, @phone, @notes,
            @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status, @openSpots)`
        )
        .run({
          ref,
          clientId,
          residentId: req.resident?.id ?? null,
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
          notes: body.notes ?? "",
          subtotalCents: pricing.taxableCents,
          discountCents: pricing.discountCents,
          vatCents: pricing.vatCents,
          platformFeeCents: pricing.platformFeeCents,
          openSpots,
          couponCode: pricing.couponCode,
          totalCents: pricing.totalCents,
          status: isCash ? "paid" : "pending",
        });
    });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
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
      guestName: body.name,
      guestEmail: body.email,
      ref,
      detailsText: `${body.date} at ${body.time} · ${body.duration}h · ${body.guests} guests · €${(pricing.totalCents / 100).toFixed(2)} due in cash on arrival`,
    }).catch((e) => console.error("[notifications] booking notify failed:", e));
    if (openSpots) await createGameFromOpenBooking(ref);
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100 });
  }

  const result = await createCheckoutSession({
    ref,
    type: "booking",
    customerEmail: body.email,
    lineItems: pricingLineItems(pricing, {
      name: room.name ? `${centre.name} — ${room.name}` : centre.name,
      description: `${body.date} at ${body.time}, ${body.duration}h${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
    }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

bookingsRouter.get("/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const row = await db
    .prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM bookings WHERE ref = ? AND client_id = ?`)
    .get(req.params.ref, clientId);
  if (!row) return res.status(404).json({ error: "Booking not found" });
  res.json(row);
});

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
                  c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName
           FROM bookings b
           JOIN centres c ON c.id = b.centre_id
           LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
           WHERE (b.client_id = ? OR LOWER(b.email) = LOWER(?)) AND b.payment_status = 'paid'
           ORDER BY b.created_at DESC`
        )
        .all(clientId, req.guestEmail)
    : await db
        .prepare(
          `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt, b.status,
                  c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName
           FROM bookings b
           JOIN centres c ON c.id = b.centre_id
           LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
           WHERE b.client_id = ? AND b.payment_status = 'paid'
           ORDER BY b.created_at DESC`
        )
        .all(clientId);

  res.json(rows);
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
              c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE b.ref = ? AND LOWER(b.email) = LOWER(?)`
    )
    .get(ref.trim(), email.trim());
  if (!row) return res.status(404).json({ error: "We couldn't find a booking with that reference and email" });
  res.json(row);
});

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
              b.name, b.email, b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND (b.client_id = ? OR LOWER(b.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | { ref: string; date: string; time: string; duration: number; guests: number; status: string; paymentStatus: string; name: string; email: string; centreId: string; centreName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This booking is already cancelled" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This booking can't be cancelled" });

  // Venues are physically in Ireland — the booking's date/time is an Irish
  // wall-clock time, so the cutoff must be computed against that, not
  // against whatever timezone this server process happens to be running in.
  const { cancellationHours } = await orgPoliciesForVendor(row.vendorId);
  const startHour = parseInt(row.time.slice(0, 2), 10);
  const eventStart = irelandWallTimeToUtc(row.date, startHour);
  if (eventStart.getTime() - Date.now() < cancellationHours * 60 * 60 * 1000) {
    return res.status(409).json({ error: `This booking is within ${cancellationHours} hours and can no longer be cancelled online — please contact the venue directly` });
  }

  await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE ref = ?`).run(row.ref);

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

  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.status, b.payment_status as paymentStatus, b.room_id as roomId,
              b.name, b.email, b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId, c.opens_at as opensAt, c.closes_at as closesAt
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND (b.client_id = ? OR LOWER(b.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | {
        ref: string; date: string; time: string; duration: number; status: string; paymentStatus: string; roomId: string;
        name: string; email: string; centreId: string; centreName: string; vendorId: string | null; opensAt: string; closesAt: string;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This booking is already cancelled" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This booking can't be rescheduled" });

  const { cancellationHours, bookingWindowDays } = await orgPoliciesForVendor(row.vendorId);
  const currentStartHour = parseInt(row.time.slice(0, 2), 10);
  const currentEventStart = irelandWallTimeToUtc(row.date, currentStartHour);
  if (currentEventStart.getTime() - Date.now() < cancellationHours * 60 * 60 * 1000) {
    return res.status(409).json({ error: `This booking is within ${cancellationHours} hours and can no longer be rescheduled online — please contact the venue directly` });
  }

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
    await db.transaction(async (tx) => {
      // rooms.id is only unique per-centre (PRIMARY KEY (centre_id, id)) —
      // scope both the lock and the overlap check by row.centreId (already
      // fetched above), same fix as availability.ts/queries.ts/programs.ts.
      await tx.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ? FOR UPDATE`).get(row.roomId, row.centreId);
      const overlapping = (await tx
        .prepare(`SELECT ref, time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND ref != ? AND payment_status != 'failed' AND status != 'cancelled'`)
        .all(row.roomId, row.centreId, date, row.ref)) as { ref: string; time: string; duration: number }[];
      const clashes = overlapping.some((b) => {
        const bStart = parseInt(b.time.slice(0, 2), 10);
        return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
      });
      if (clashes) throw new ConflictError("That new time is no longer available");

      const blocks = (await tx
        .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
        .all(row.centreId, date, row.roomId)) as { time: string | null }[];
      const blocked = blocks.some((b) => (b.time === null ? true : parseInt(b.time.slice(0, 2), 10) >= startHour && parseInt(b.time.slice(0, 2), 10) < reqEnd));
      if (blocked) throw new ConflictError("The vendor has closed that date/time");

      await tx.prepare(`UPDATE bookings SET date = ?, time = ? WHERE ref = ?`).run(date, time, row.ref);
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
  }).catch((e) => console.error("[notifications] reschedule notify failed:", e));

  res.json({ ok: true, date, time });
});
