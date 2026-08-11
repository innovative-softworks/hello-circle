import { Router } from "express";
import { db } from "../db/index.js";
import { getCentre } from "../db/queries.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { CLIENT_URL, stripe } from "../stripe.js";
import { BadRequestError, bookingEndHour, clientIdFrom, generateRef, hoursOverlap, isValidEmail } from "../util.js";

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
}

function hireCost(rate: number, duration: number): number {
  return duration >= 8 ? Math.round(rate * 6.5) : rate * duration;
}

const DEPOSIT_CENTS = 100 * 100;

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

  const overlapping = (await db
    .prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND date = ? AND payment_status != 'failed' AND status != 'cancelled'`)
    .all(body.roomId, body.date)) as { time: string; duration: number }[];
  const clashes = overlapping.some((b) => {
    const bStart = parseInt(b.time.slice(0, 2), 10);
    return hoursOverlap(startHour, reqEnd, bStart, bookingEndHour(bStart, b.duration));
  });
  if (clashes) return res.status(409).json({ error: "That slot is no longer available" });

  const blocks = (await db
    .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
    .all(body.centreId, body.date, body.roomId)) as { time: string | null }[];
  const blocked = blocks.some((b) => {
    if (b.time === null) return true;
    const bh = parseInt(b.time.slice(0, 2), 10);
    return bh >= startHour && bh < reqEnd;
  });
  if (blocked) return res.status(409).json({ error: "The vendor has closed that date/time" });

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

  await db.prepare(
    `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
      subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status)
     VALUES (@ref, @clientId, @centreId, @roomId, @date, @time, @duration, @eventType, @guests, @name, @email, @phone, @notes,
      @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status)`
  ).run({
    ref,
    clientId,
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
    couponCode: pricing.couponCode,
    totalCents: pricing.totalCents,
    status: isCash ? "paid" : "pending",
  });

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
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100 });
  }

  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });

  const lineItems: { price_data: { currency: string; product_data: { name: string; description?: string }; unit_amount: number }; quantity: number }[] = [
    {
      price_data: {
        currency: "eur",
        product_data: { name: centre.name, description: `${body.date} at ${body.time}, ${body.duration}h${couponCode ? ` (coupon ${couponCode} applied)` : ""}` },
        unit_amount: pricing.taxableCents,
      },
      quantity: 1,
    },
    { price_data: { currency: "eur", product_data: { name: "VAT (23%)" }, unit_amount: pricing.vatCents }, quantity: 1 },
    { price_data: { currency: "eur", product_data: { name: "Platform fee" }, unit_amount: pricing.platformFeeCents }, quantity: 1 },
    { price_data: { currency: "eur", product_data: { name: "Refundable deposit", description: "Refunded within 5 days after your event" }, unit_amount: pricing.depositCents }, quantity: 1 },
  ];

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: body.email,
      success_url: `${CLIENT_URL}/payment/success?ref=${ref}`,
      cancel_url: `${CLIENT_URL}/payment/cancel?ref=${ref}`,
      metadata: { type: "booking", ref },
    });
  } catch (e) {
    await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
    console.error("[stripe] checkout session creation failed:", e instanceof Error ? e.message : e);
    return res.status(400).json({ error: "Couldn't start checkout — please check your details and try again" });
  }

  await db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE ref = ?`).run(session.id, ref);
  res.status(201).json({ ref, url: session.url, totalEuro: pricing.totalCents / 100 });
});

bookingsRouter.get("/status/:ref", async (req, res) => {
  const row = await db.prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM bookings WHERE ref = ?`).get(req.params.ref);
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

  const rows = await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt, b.status,
              c.name as centreName, c.ph as ph, c.image_url as image
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       WHERE b.client_id = ? AND b.payment_status = 'paid'
       ORDER BY b.created_at DESC`
    )
    .all(clientId);

  res.json(rows);
});

/** A booking may only be cancelled by the guest who made it (ownership
 * checked via X-Client-Id, same as the "my bookings" list), and only up to
 * 48h before the booked start time — matches the "Free cancellation up to
 * 48h before" copy already shown on every centre's detail page. Cancelling
 * only flips a status flag; any refund for an online payment is handled
 * off-platform, same as the "refundable deposit" promise already is. */
bookingsRouter.post("/:ref/cancel", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.status, b.payment_status as paymentStatus,
              b.name, b.email, b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND b.client_id = ?`
    )
    .get(req.params.ref, clientId)) as
    | { ref: string; date: string; time: string; duration: number; guests: number; status: string; paymentStatus: string; name: string; email: string; centreId: string; centreName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This booking is already cancelled" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This booking can't be cancelled" });

  // Venues are physically in Ireland — the booking's date/time is an Irish
  // wall-clock time, so the 48h cutoff must be computed against that, not
  // against whatever timezone this server process happens to be running in.
  const startHour = parseInt(row.time.slice(0, 2), 10);
  const eventStart = irelandWallTimeToUtc(row.date, startHour);
  if (eventStart.getTime() - Date.now() < 48 * 60 * 60 * 1000) {
    return res.status(409).json({ error: "This booking is within 48 hours and can no longer be cancelled online — please contact the venue directly" });
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
