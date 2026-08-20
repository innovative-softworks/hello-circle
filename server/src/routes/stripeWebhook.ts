import type { Request, Response } from "express";
import { createGameFromOpenBooking } from "./bookings.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { checkMinParticipantsThreshold } from "./games.js";
import { db } from "../db/index.js";
import { notifyNewBookingOrRegistration, notifyResident } from "../notifications.js";
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
              b.name, b.email, b.date, b.time, b.duration, b.guests, b.coupon_code, b.total_cents, b.resident_id
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ?`
    )
    .get(ref)) as (BookingForNotify & { resident_id: string | null }) | undefined;
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

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "centre", row.centre_id);
  await createGameFromOpenBooking(row.ref);
}

async function confirmRegistration(ref: string) {
  const info = await db.prepare(`UPDATE registrations SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;

  const row = (await db
    .prepare(
      `SELECT r.ref, r.club_id, c.name as club_name, c.vendor_id, r.g_first, r.g_last, r.email,
              r.child_first, r.child_last, r.dob, r.team, r.trial, r.coupon_code, r.total_cents, r.resident_id
       FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
    )
    .get(ref)) as (RegistrationForNotify & { resident_id: string | null }) | undefined;
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

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "club", row.club_id);
}

interface GameJoinForNotify {
  game_id: string;
  host_resident_id: string;
  activity_label: string;
  date: string;
  time: string;
  capacity: number;
  resident_id: string;
}

/** Paid Join-a-Game confirmation (NEXT). Same idempotent
 * only-flip-if-still-pending pattern as confirmBooking/confirmRegistration
 * above — a retried webhook delivery is a safe no-op. */
async function confirmGameJoin(ref: string) {
  const info = await db.prepare(`UPDATE game_participants SET status = 'joined', payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;

  const row = (await db
    .prepare(
      `SELECT gp.game_id, gp.resident_id, g.host_resident_id, g.activity_label, g.date, g.time, g.capacity
       FROM game_participants gp JOIN games g ON g.id = gp.game_id WHERE gp.ref = ?`
    )
    .get(ref)) as GameJoinForNotify | undefined;
  if (!row) return;

  const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(row.game_id)) as {
    n: number;
  };
  if (joined >= row.capacity) {
    await notifyResident({
      residentId: row.host_resident_id,
      kind: "game",
      title: `Your game is full: ${row.activity_label}`,
      body: `${row.date} at ${row.time} — all ${row.capacity} spots are taken.`,
      listingType: "game",
      listingId: row.game_id,
      ref: row.game_id,
    }).catch((e) => console.error("[notifications] game notify failed:", e));
  }

  await checkMinParticipantsThreshold(row.game_id);
  await upgradeFavouriteStatus(row.resident_id, "game", row.game_id);
}

/** Credit-pack pass confirmation (NEXT) — same idempotent pattern. */
async function confirmPass(ref: string) {
  await db.prepare(`UPDATE passes SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
}

/** Program enrollment confirmation (Phase B) — same idempotent pattern. */
async function confirmProgramEnrollment(ref: string) {
  const info = await db.prepare(`UPDATE program_enrollments SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;
  const row = (await db
    .prepare(
      `SELECT pe.participant_name as participantName, pe.email, p.title, p.vendor_id as vendorId, p.listing_type as listingType, p.listing_id as listingId, pe.total_cents as totalCents
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ?`
    )
    .get(ref)) as { participantName: string; email: string; title: string; vendorId: string; listingType: "centre" | "club"; listingId: string; totalCents: number } | undefined;
  if (!row) return;
  notifyNewBookingOrRegistration({
    kind: "registration",
    listingType: row.listingType,
    listingId: row.listingId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref,
    detailsText: `${row.participantName} enrolled in ${row.title} · €${(row.totalCents / 100).toFixed(2)} total`,
  }).catch((e) => console.error("[notifications] program enrollment notify failed:", e));
}

/** Adventure/Experience session booking confirmation — same idempotent
 * pattern as confirmBooking/confirmRegistration above. */
async function confirmExperienceBooking(ref: string) {
  const info = await db.prepare(`UPDATE experience_bookings SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;

  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.participant_name as participantName, eb.email, eb.party_size as partySize, eb.total_cents as totalCents,
              eb.resident_id as residentId, e.id as experienceId, e.title, e.vendor_id as vendorId, es.date, es.time
       FROM experience_bookings eb
       JOIN experiences e ON e.id = eb.experience_id
       JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.ref = ?`
    )
    .get(ref)) as
    | { ref: string; participantName: string; email: string; partySize: number; totalCents: number; residentId: string | null; experienceId: string; title: string; vendorId: string; date: string; time: string }
    | undefined;
  if (!row) return;

  notifyNewBookingOrRegistration({
    kind: "booking",
    listingType: "experience",
    listingId: row.experienceId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · party of ${row.partySize} · €${(row.totalCents / 100).toFixed(2)} total`,
  }).catch((e) => console.error("[notifications] experience booking notify failed:", e));

  if (row.residentId) await upgradeFavouriteStatus(row.residentId, "experience", row.experienceId);
}

async function markFailed(metadata: Stripe.Metadata | null | undefined) {
  if (!metadata?.ref) return;
  if (metadata.type === "booking") await db.prepare(`UPDATE bookings SET payment_status = 'failed' WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "registration") await db.prepare(`UPDATE registrations SET payment_status = 'failed' WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "game") await db.prepare(`DELETE FROM game_participants WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "pass") await db.prepare(`DELETE FROM passes WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "program") await db.prepare(`DELETE FROM program_enrollments WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "experience") await db.prepare(`DELETE FROM experience_bookings WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
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
    else if (type === "game" && ref) await confirmGameJoin(ref);
    else if (type === "pass" && ref) await confirmPass(ref);
    else if (type === "program" && ref) await confirmProgramEnrollment(ref);
    else if (type === "experience" && ref) await confirmExperienceBooking(ref);
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await markFailed(session.metadata);
  }

  res.json({ received: true });
}
