import { Router } from "express";
import { db } from "../db/index.js";
import { getCentre } from "../db/queries.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { CLIENT_URL, stripe } from "../stripe.js";
import { BadRequestError, clientIdFrom, generateRef, isValidEmail } from "../util.js";

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
  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });

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

  const centre = getCentre(body.centreId);
  const room = centre?.rooms.find((r) => r.id === body.roomId);
  if (!centre || !room) return res.status(404).json({ error: "Centre or room not found" });

  const startHour = parseInt(body.time.slice(0, 2), 10);
  const reqEnd = body.duration >= 8 ? 24 : startHour + body.duration;

  const opensHour = parseInt(centre.opensAt.slice(0, 2), 10);
  const closesHour = parseInt(centre.closesAt.slice(0, 2), 10);
  if (startHour < opensHour || reqEnd > closesHour) {
    return res.status(409).json({ error: "That time is outside the venue's opening hours" });
  }

  const overlapping = db
    .prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND date = ? AND payment_status != 'failed'`)
    .all(body.roomId, body.date) as { time: string; duration: number }[];
  const clashes = overlapping.some((b) => {
    const bStart = parseInt(b.time.slice(0, 2), 10);
    const bEnd = b.duration >= 8 ? 24 : bStart + b.duration;
    return startHour < bEnd && bStart < reqEnd;
  });
  if (clashes) return res.status(409).json({ error: "That slot is no longer available" });

  const blocks = db
    .prepare(`SELECT time FROM room_blocks WHERE centre_id = ? AND date = ? AND (room_id = ? OR room_id IS NULL)`)
    .all(body.centreId, body.date, body.roomId) as { time: string | null }[];
  const blocked = blocks.some((b) => {
    if (b.time === null) return true;
    const bh = parseInt(b.time.slice(0, 2), 10);
    return bh >= startHour && bh < reqEnd;
  });
  if (blocked) return res.status(409).json({ error: "The vendor has closed that date/time" });

  const subtotalCents = hireCost(room.rate, body.duration) * 100;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (body.couponCode) {
    const result = evaluateCoupon(body.couponCode, subtotalCents);
    if (!result.valid) return res.status(400).json({ error: result.error });
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  const pricing = computePricing(subtotalCents, DEPOSIT_CENTS, discountCents, couponCode);
  const ref = generateRef("HB");

  db.prepare(
    `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes,
      subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status)
     VALUES (@ref, @clientId, @centreId, @roomId, @date, @time, @duration, @eventType, @guests, @name, @email, @phone, @notes,
      @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, 'pending')`
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
  });

  const lineItems: { price_data: { currency: string; product_data: { name: string; description?: string }; unit_amount: number }; quantity: number }[] = [
    {
      price_data: {
        currency: "eur",
        product_data: { name: `${centre.name} — ${room.name}`, description: `${body.date} at ${body.time}, ${body.duration}h${couponCode ? ` (coupon ${couponCode} applied)` : ""}` },
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
    db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
    console.error("[stripe] checkout session creation failed:", e instanceof Error ? e.message : e);
    return res.status(400).json({ error: "Couldn't start checkout — please check your details and try again" });
  }

  db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE ref = ?`).run(session.id, ref);
  res.status(201).json({ ref, url: session.url, totalEuro: pricing.totalCents / 100 });
});

bookingsRouter.get("/status/:ref", (req, res) => {
  const row = db.prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM bookings WHERE ref = ?`).get(req.params.ref);
  if (!row) return res.status(404).json({ error: "Booking not found" });
  res.json(row);
});

bookingsRouter.get("/", (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const rows = db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.total_cents as totalCents, b.created_at as createdAt,
              c.name as centreName, c.ph as ph, c.image_url as image, r.name as roomName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       JOIN rooms r ON r.centre_id = b.centre_id AND r.id = b.room_id
       WHERE b.client_id = ? AND b.payment_status = 'paid'
       ORDER BY b.created_at DESC`
    )
    .all(clientId);

  res.json(rows);
});
