import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { notifyNewBookingOrRegistration } from "../notifications.js";
import { recordCouponUse } from "../pricing.js";
import { STRIPE_WEBHOOK_SECRET, stripe } from "../stripe.js";
import type Stripe from "stripe";

interface BookingForNotify {
  ref: string;
  centre_id: string;
  centre_name: string;
  vendor_id: string | null;
  name: string;
  email: string;
  date: string;
  time: string;
  duration: number;
  guests: number;
  coupon_code: string | null;
  total_cents: number;
}

interface RegistrationForNotify {
  ref: string;
  club_id: string;
  club_name: string;
  vendor_id: string | null;
  g_first: string;
  g_last: string;
  email: string;
  child_first: string;
  child_last: string;
  dob: string;
  team: string;
  trial: number;
  coupon_code: string | null;
  total_cents: number;
}

async function confirmBooking(ref: string) {
  const info = await db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return; // already processed (webhook retried) or unknown ref

  const row = (await db
    .prepare(
      `SELECT b.ref, b.centre_id, c.name as centre_name, c.vendor_id,
              b.name, b.email, b.date, b.time, b.duration, b.guests, b.coupon_code, b.total_cents
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ?`
    )
    .get(ref)) as BookingForNotify | undefined;
  if (!row) return;

  if (row.coupon_code) await recordCouponUse(row.coupon_code);
  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "centre",
    listingId: row.centre_id,
    listingName: row.centre_name,
    vendorId: row.vendor_id,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests · €${(row.total_cents / 100).toFixed(2)} total`,
  }).catch((e) => console.error("[notifications] booking notify failed:", e));
}

async function confirmRegistration(ref: string) {
  const info = await db.prepare(`UPDATE registrations SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;

  const row = (await db
    .prepare(
      `SELECT r.ref, r.club_id, c.name as club_name, c.vendor_id, r.g_first, r.g_last, r.email,
              r.child_first, r.child_last, r.dob, r.team, r.trial, r.coupon_code, r.total_cents
       FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
    )
    .get(ref)) as RegistrationForNotify | undefined;
  if (!row) return;

  if (row.coupon_code) await recordCouponUse(row.coupon_code);
  notifyNewBookingOrRegistration({
    kind: "registration",
    listingType: "club",
    listingId: row.club_id,
    listingName: row.club_name,
    vendorId: row.vendor_id,
    guestName: `${row.g_first} ${row.g_last}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.child_first} ${row.child_last} (DOB ${row.dob}) · ${row.team}${row.trial ? " · Trial session" : ""} · €${(row.total_cents / 100).toFixed(2)} total`,
  }).catch((e) => console.error("[notifications] registration notify failed:", e));
}

async function markFailed(metadata: Stripe.Metadata | null | undefined) {
  if (!metadata?.ref) return;
  if (metadata.type === "booking") await db.prepare(`UPDATE bookings SET payment_status = 'failed' WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "registration") await db.prepare(`UPDATE registrations SET payment_status = 'failed' WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
}

/** Registered with express.raw() (not express.json()) — Stripe's signature
 * check needs the exact raw request body bytes. This is the only place a
 * booking/registration is ever marked 'paid' — never on the client's say-so. */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!stripe) return res.status(503).send("Payments not configured");

  let event: Stripe.Event;
  const signature = req.headers["stripe-signature"];
  if (STRIPE_WEBHOOK_SECRET && signature) {
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error("[stripe] webhook signature verification failed:", e instanceof Error ? e.message : e);
      return res.status(400).send("Invalid signature");
    }
  } else if (process.env.NODE_ENV === "production") {
    // Without signature verification, anyone who finds this URL could POST a
    // forged checkout.session.completed and get a booking marked paid for
    // free — never accept unverified events once real money is on the line.
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set — refusing to process unverified webhook in production");
    return res.status(503).send("Webhook not configured");
  } else {
    // No webhook secret configured — accept unverified for local/dev testing only.
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set — accepting webhook without signature verification (dev only, do not run this way in production)");
    event = JSON.parse(req.body.toString("utf8"));
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { type, ref } = session.metadata ?? {};
    if (type === "booking" && ref) await confirmBooking(ref);
    else if (type === "registration" && ref) await confirmRegistration(ref);
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await markFailed(session.metadata);
  }

  res.json({ received: true });
}
