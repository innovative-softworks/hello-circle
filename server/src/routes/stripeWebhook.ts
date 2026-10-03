import type { Request, Response } from "express";
import { createGameFromOpenBooking } from "./bookings.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { checkMinParticipantsThreshold } from "./games.js";
import { logEvent } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { notifyNewBookingOrRegistration, notifyResident } from "../notifications.js";
import { claimWaitlistOffer } from "../waitlist.js";
import { endPendingHold, gameSeatSql, holdIsLive, occupiesCapacitySql } from "../bookingIntegrity.js";
import { writeAudit } from "../audit.js";
import { bookingEndHour, hoursOverlap } from "../util.js";
import { CLIENT_URL, STRIPE_WEBHOOK_SECRET, stripe } from "../stripe.js";
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

/** Phase 8 (HC-QA-041) — settle one pending paid row under its parent's row
 * lock. Duplicate/replayed delivery is a no-op (only 'pending' rows settle).
 * A live hold confirms; a stale hold (past PENDING_HOLD_MINUTES) confirms only
 * if capacity still allows, otherwise it becomes status='cancelled' with
 * payment_status='paid' — the existing "refund required" state the vendor
 * refund route acts on (no refund is performed or fabricated here). */
type Settle = "confirmed" | "refund_required" | "noop";
async function settlePending(kind: "booking" | "registration" | "program" | "experience", ref: string): Promise<Settle> {
  return db.transaction(async (tx) => {
    const spec = {
      booking: { table: "bookings", parent: `SELECT r.id FROM rooms r JOIN bookings b ON b.room_id = r.id AND b.centre_id = r.centre_id WHERE b.ref = ? FOR UPDATE` },
      registration: { table: "registrations", parent: `SELECT c.id FROM clubs c JOIN registrations r ON r.club_id = c.id WHERE r.ref = ? FOR UPDATE` },
      program: { table: "program_enrollments", parent: `SELECT p.id FROM programs p JOIN program_enrollments e ON e.program_id = p.id WHERE e.ref = ? FOR UPDATE` },
      experience: { table: "experience_bookings", parent: `SELECT s.id FROM experience_sessions s JOIN experience_bookings b ON b.session_id = s.id WHERE b.ref = ? FOR UPDATE` },
    }[kind];
    await tx.prepare(spec.parent).get(ref);
    const row = (await tx.prepare(`SELECT * FROM ${spec.table} WHERE ref = ? FOR UPDATE`).get(ref)) as Record<string, any> | undefined;
    if (!row || row.payment_status !== "pending") return "noop";
    let fits = row.status !== "cancelled";
    if (fits && !holdIsLive(row.created_at)) fits = await stillFits(tx, kind, row);
    if (fits) {
      await tx.prepare(`UPDATE ${spec.table} SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      return "confirmed";
    }
    await tx.prepare(`UPDATE ${spec.table} SET payment_status = 'paid', status = 'cancelled' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
    return "refund_required";
  });
}

/** Re-proves capacity for a stale hold, excluding the row itself. */
async function stillFits(tx: Pick<typeof db, "prepare">, kind: string, row: Record<string, any>): Promise<boolean> {
  const occ = occupiesCapacitySql();
  if (kind === "booking") {
    const others = (await tx.prepare(`SELECT time, duration FROM bookings WHERE room_id = ? AND centre_id = ? AND date = ? AND ref != ? AND ${occ}`).all(row.room_id, row.centre_id, row.date, row.ref)) as { time: string; duration: number }[];
    const start = parseInt(String(row.time).slice(0, 2), 10);
    const end = bookingEndHour(start, row.duration);
    return !others.some((b) => { const bs = parseInt(b.time.slice(0, 2), 10); return hoursOverlap(start, end, bs, bookingEndHour(bs, b.duration)); });
  }
  if (kind === "registration") {
    const club = (await tx.prepare(`SELECT capacity FROM clubs WHERE id = ?`).get(row.club_id)) as { capacity: number | null };
    const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND ref != ? AND ${occ}`).get(row.club_id, row.ref)) as { n: number };
    if (computeCapacity(club.capacity, Number(n)).isFull) return false;
    if (row.session_id) {
      const session = (await tx.prepare(`SELECT capacity, active FROM club_sessions WHERE id = ?`).get(row.session_id)) as { capacity: number | null; active: number } | undefined;
      if (!session || !session.active) return false;
      const { n: sn } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND ref != ? AND ${occ}`).get(row.session_id, row.ref)) as { n: number };
      if (computeCapacity(session.capacity, Number(sn)).isFull) return false;
    }
    return true;
  }
  if (kind === "program") {
    const program = (await tx.prepare(`SELECT capacity, status FROM programs WHERE id = ?`).get(row.program_id)) as { capacity: number | null; status: string };
    if (program.status !== "published") return false;
    if (program.capacity === null) return true;
    const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM program_enrollments WHERE program_id = ? AND ref != ? AND ${occ}`).get(row.program_id, row.ref)) as { n: number };
    return Number(n) < program.capacity;
  }
  const session = (await tx.prepare(`SELECT s.capacity, s.status, e.capacity as expCapacity FROM experience_sessions s JOIN experiences e ON e.id = s.experience_id WHERE s.id = ?`).get(row.session_id)) as { capacity: number | null; status: string; expCapacity: number };
  if (session.status !== "scheduled") return false;
  const { n } = (await tx.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ref != ? AND ${occ}`).get(row.session_id, row.ref)) as { n: number };
  return Number(n) + row.party_size <= (session.capacity ?? session.expCapacity);
}

async function refundRequired(kind: string, ref: string) {
  await writeAudit({ actorUserId: null, action: `${kind}.refund_required`, objectType: kind, objectId: ref, newValue: { status: "cancelled", paymentStatus: "paid", reason: "capacity_unavailable_at_confirmation" } });
  console.error(`[payments] ${kind} ${ref}: paid after its hold expired and capacity was gone — marked cancelled/paid for refund`);
}

export async function confirmBooking(ref: string) {
  const settled = await settlePending("booking", ref);
  if (settled !== "confirmed") { if (settled === "refund_required") await refundRequired("booking", ref); return; }
  void logEvent("booking_completed", { metadata: { type: "booking", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT b.ref, b.centre_id, c.name as centre_name, c.vendor_id,
              b.name, b.email, b.date, b.time, b.duration, b.guests, b.coupon_code, b.total_cents, b.resident_id
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ?`
    )
    .get(ref)) as (BookingForNotify & { resident_id: string | null }) | undefined;
  if (!row) return;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
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
    residentId: row.resident_id,
  }).catch((e) => console.error("[notifications] booking notify failed:", e));

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "centre", row.centre_id);
  await createGameFromOpenBooking(row.ref);
}

export async function confirmRegistration(ref: string) {
  const settled = await settlePending("registration", ref);
  if (settled !== "confirmed") { if (settled === "refund_required") await refundRequired("registration", ref); return; }
  void logEvent("booking_completed", { metadata: { type: "registration", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT r.ref, r.club_id, c.name as club_name, c.vendor_id, r.g_first, r.g_last, r.email,
              r.child_first, r.child_last, r.dob, r.team, r.trial, r.coupon_code, r.total_cents, r.resident_id, r.client_id
       FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
    )
    .get(ref)) as (RegistrationForNotify & { resident_id: string | null; client_id: string }) | undefined;
  if (!row) return;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  await claimWaitlistOffer("club", row.club_id, row.client_id, row.resident_id);
  notifyNewBookingOrRegistration({
    kind: "registration",
    listingType: "club",
    listingId: row.club_id,
    listingName: row.club_name,
    vendorId: row.vendor_id,
    guestName: `${row.g_first} ${row.g_last}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.dob ? `${row.child_first} ${row.child_last} (DOB ${row.dob}) · ${row.team}` : `${row.child_first} ${row.child_last}`}${row.trial ? " · Trial session" : ""} · €${(row.total_cents / 100).toFixed(2)} total`,
    residentId: row.resident_id,
  }).catch((e) => console.error("[notifications] registration notify failed:", e));

  if (row.resident_id) await upgradeFavouriteStatus(row.resident_id, "club", row.club_id);
}

interface GameJoinForNotify {
  game_id: string;
  total_cents: number | null;
  host_resident_id: string;
  activity_label: string;
  date: string;
  time: string;
  capacity: number;
  price_cents: number | null;
  location_text: string;
  centre_name: string | null;
  resident_id: string;
  resident_name: string;
  resident_email: string;
  coupon_code: string | null;
}

/** Paid Join-a-Game confirmation (NEXT). Same idempotent
 * only-flip-if-still-pending pattern as confirmBooking/confirmRegistration
 * above — a retried webhook delivery is a safe no-op. */
export async function confirmGameJoin(ref: string) {
  // HC-QA-041 (cross-model) — settle under the game's row lock: a live hold
  // confirms; a stale one confirms only if a seat is still free, otherwise it
  // becomes cancelled/paid (refund required). Replays are no-ops.
  const settled: Settle = await db.transaction(async (tx) => {
    await tx.prepare(`SELECT g.id FROM games g JOIN game_participants gp ON gp.game_id = g.id WHERE gp.ref = ? FOR UPDATE`).get(ref);
    const p = (await tx.prepare(`SELECT game_id, payment_status, status, joined_at FROM game_participants WHERE ref = ? FOR UPDATE`).get(ref)) as
      | { game_id: string; payment_status: string; status: string; joined_at: string }
      | undefined;
    if (!p || p.payment_status !== "pending") return "noop";
    let fits = p.status === "pending_payment";
    if (fits && !holdIsLive(p.joined_at)) {
      const g = (await tx.prepare(`SELECT capacity, status FROM games WHERE id = ?`).get(p.game_id)) as { capacity: number; status: string };
      const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND ref != ? AND ${gameSeatSql()}`).get(p.game_id, ref)) as { n: number };
      fits = g.status !== "cancelled" && Number(n) < g.capacity;
    }
    if (fits) {
      await tx.prepare(`UPDATE game_participants SET status = 'joined', payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
      return "confirmed";
    }
    await tx.prepare(`UPDATE game_participants SET status = 'cancelled', payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
    return "refund_required";
  });
  if (settled !== "confirmed") { if (settled === "refund_required") await refundRequired("game", ref); return; }
  void logEvent("booking_completed", { metadata: { type: "game", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT gp.game_id, gp.resident_id, gp.coupon_code, gp.total_cents, g.host_resident_id, g.activity_label, g.date, g.time, g.capacity, g.price_cents, g.location_text, c.name as centre_name,
              r.name as resident_name, r.email as resident_email
       FROM game_participants gp
       JOIN games g ON g.id = gp.game_id
       JOIN residents r ON r.id = gp.resident_id
       LEFT JOIN centres c ON c.id = g.centre_id
       WHERE gp.ref = ?`
    )
    .get(ref)) as GameJoinForNotify | undefined;
  if (!row) return;

  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
  await claimWaitlistOffer("game", row.game_id, null, row.resident_id);

  // Platform Pre-Launch Polish — Changeset 3. Paid Game joins previously had
  // zero payer-facing confirmation — this function's only notify call was
  // the host-full one below. Fires exactly once per successful payment: the
  // idempotency guard above (info.changes === 0) already returns early on a
  // replayed webhook, so this can never double-send.
  const venue = row.centre_name ?? (row.location_text || "the venue");
  // HC-QA-049: state what was charged (VAT + fee − coupon), not the list price.
  const chargedCents = row.total_cents ?? row.price_cents;
  const amount = chargedCents ? `€${(chargedCents / 100).toFixed(2)} paid` : "Free";
  const manageUrl = `${CLIENT_URL}/games/${row.game_id}`;
  await notifyResident({
    residentId: row.resident_id,
    kind: "game",
    title: `You're in: ${row.activity_label}`,
    body: `${row.date} at ${row.time} · ${venue} · ${amount}`,
    listingType: "game",
    listingId: row.game_id,
    ref: row.game_id,
  }).catch((e) => console.error("[notifications] game join resident notify failed:", e));
  await sendMail({
    to: row.resident_email,
    subject: `You're confirmed — ${row.activity_label} (${ref})`,
    text: `Hi ${row.resident_name},\n\nYou're confirmed for ${row.activity_label}.\nReference: ${ref}\n\n${row.date} at ${row.time}\n${venue}\n${amount}\n\nView your session any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  }).catch((e) => console.error("[email] game join confirmation failed:", e));

  const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(row.game_id)) as {
    n: number;
  };
  if (computeCapacity(row.capacity, joined).isFull) {
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
  void logEvent("game_joined", { residentId: row.resident_id, metadata: { gameId: row.game_id, activityLabel: row.activity_label, paid: true } });
}

/** Credit-pack pass confirmation (NEXT) — same idempotent pattern. */
export async function confirmPass(ref: string) {
  const info = await db.prepare(`UPDATE passes SET payment_status = 'paid' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
  if (info.changes === 0) return;
  void logEvent("booking_completed", { metadata: { type: "pass", ref, via: "stripe" } });

  // Platform Pre-Launch Polish — Changeset 3. This function previously had
  // zero notification code at all — a Pass purchase confirmed with no
  // payer-facing signal of any kind. Passes are always listing_type='club'
  // today (the only pass-purchase flow that exists, per passes.ts's own
  // GET /status/:ref precedent) — same LEFT JOIN pattern reused here.
  const row = (await db
    .prepare(
      `SELECT p.resident_id as residentId, p.listing_id as clubId, c.name as clubName, p.credits_total as creditsTotal, p.purchased_cents as purchasedCents,
              r.name as residentName, r.email as residentEmail
       FROM passes p
       LEFT JOIN clubs c ON p.listing_type = 'club' AND c.id = p.listing_id
       JOIN residents r ON r.id = p.resident_id
       WHERE p.ref = ?`
    )
    .get(ref)) as
    | { residentId: string; clubId: string; clubName: string | null; creditsTotal: number; purchasedCents: number; residentName: string; residentEmail: string }
    | undefined;
  if (!row) return;

  const clubName = row.clubName ?? "your club";
  const amount = `€${(row.purchasedCents / 100).toFixed(2)}`;
  const manageUrl = `${CLIENT_URL}/clubs/${row.clubId}`;
  await notifyResident({
    residentId: row.residentId,
    kind: "registration",
    title: `Pass purchased: ${clubName}`,
    body: `${row.creditsTotal} sessions · ${amount} paid`,
    listingType: "club",
    listingId: row.clubId,
    ref,
  }).catch((e) => console.error("[notifications] pass resident notify failed:", e));
  await sendMail({
    to: row.residentEmail,
    subject: `Your pass is confirmed — ${clubName} (${ref})`,
    text: `Hi ${row.residentName},\n\nYour pass for ${clubName} is confirmed.\nReference: ${ref}\n\n${row.creditsTotal} sessions · ${amount} paid\n\nView it any time: ${manageUrl}\n\nThanks for using Hello Circle.`,
  }).catch((e) => console.error("[email] pass confirmation failed:", e));
}

/** Program enrollment confirmation (Phase B) — same idempotent pattern. */
export async function confirmProgramEnrollment(ref: string) {
  const settled = await settlePending("program", ref);
  if (settled !== "confirmed") { if (settled === "refund_required") await refundRequired("program", ref); return; }
  void logEvent("booking_completed", { metadata: { type: "program", ref, via: "stripe" } });
  const row = (await db
    .prepare(
      `SELECT pe.participant_name as participantName, pe.email, p.title, p.vendor_id as vendorId, p.listing_type as listingType, p.listing_id as listingId, pe.total_cents as totalCents, pe.resident_id as residentId, pe.coupon_code as couponCode
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ?`
    )
    .get(ref)) as
    | { participantName: string; email: string; title: string; vendorId: string; listingType: "centre" | "club"; listingId: string; totalCents: number; residentId: string | null; couponCode: string | null }
    | undefined;
  if (!row) return;
  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.
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
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] program enrollment notify failed:", e));
}

/** Adventure/Experience session booking confirmation — same idempotent
 * pattern as confirmBooking/confirmRegistration above. */
export async function confirmExperienceBooking(ref: string) {
  const settled = await settlePending("experience", ref);
  if (settled !== "confirmed") { if (settled === "refund_required") await refundRequired("experience", ref); return; }
  void logEvent("booking_completed", { metadata: { type: "experience", ref, via: "stripe" } });

  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.participant_name as participantName, eb.email, eb.party_size as partySize, eb.total_cents as totalCents, eb.coupon_code as couponCode,
              eb.resident_id as residentId, e.id as experienceId, e.title, e.vendor_id as vendorId, es.date, es.time
       FROM experience_bookings eb
       JOIN experiences e ON e.id = eb.experience_id
       JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.ref = ?`
    )
    .get(ref)) as
    | { ref: string; participantName: string; email: string; partySize: number; totalCents: number; couponCode: string | null; residentId: string | null; experienceId: string; title: string; vendorId: string; date: string; time: string }
    | undefined;
  if (!row) return;
  // Coupon use was reserved with the hold at checkout (HC-QA-050) — never consumed again here.

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
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] experience booking notify failed:", e));

  if (row.residentId) await upgradeFavouriteStatus(row.residentId, "experience", row.experienceId);
}

async function markFailed(metadata: Stripe.Metadata | null | undefined) {
  if (!metadata?.ref) return;
  // HC-QA-050 — each end-of-hold transition happens once and hands back the
  // coupon use reserved at checkout. Same per-model row conventions as before
  // (bookings/registrations kept as 'failed'; the rest removed).
  if (metadata.type === "booking") await endPendingHold("bookings", metadata.ref, "fail");
  else if (metadata.type === "registration") await endPendingHold("registrations", metadata.ref, "fail");
  else if (metadata.type === "game") await endPendingHold("game_participants", metadata.ref, "delete");
  else if (metadata.type === "pass") await db.prepare(`DELETE FROM passes WHERE ref = ? AND payment_status = 'pending'`).run(metadata.ref);
  else if (metadata.type === "program") await endPendingHold("program_enrollments", metadata.ref, "delete");
  else if (metadata.type === "experience") await endPendingHold("experience_bookings", metadata.ref, "delete");
}

/** Registered with express.raw() (not express.json()) — Stripe's signature
 * check needs the exact raw request body bytes. This is the only place a
 * booking/registration is ever marked 'paid' — never on the client's say-so. */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!stripe) return res.status(503).send("Payments not configured");

  let event: Stripe.Event;
  const signature = req.headers["stripe-signature"];
  // HC-QA-048 — once a signing secret is configured, every event must carry a
  // valid signature. A missing header used to fall through to the unverified
  // dev branch below, so outside production a forged "paid" event confirmed a
  // booking with no payment.
  if (STRIPE_WEBHOOK_SECRET && !signature) {
    console.error("[stripe] webhook rejected: missing Stripe-Signature header");
    return res.status(400).send("Missing signature");
  }
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

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    // A delayed payment method (SEPA/Bacs Direct Debit — never explicitly
    // restricted in checkoutService.ts's createCheckoutSession, so available
    // whenever "automatic payment methods" is on in the Stripe Dashboard)
    // fires `completed` immediately with payment_status "unpaid", before the
    // debit has actually settled — confirming here would mark the booking
    // paid before money has moved, with no later event to revert it if the
    // debit then fails. Only `async_payment_succeeded` (and a `completed`
    // whose payment_status is already "paid", the common synchronous-method
    // case) should confirm; `async_payment_failed` mirrors `expired`.
    if (event.type === "checkout.session.async_payment_failed") {
      await markFailed(session.metadata);
    } else if (session.payment_status === "paid") {
      await confirmByType(session.metadata);
    }
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await markFailed(session.metadata);
  }

  res.json({ received: true });
}

/** Provider-independent outcome entry point (Phase 8). The webhook handler
 * maps provider events onto these; the QA provider seam calls it directly.
 * success → confirm (idempotent); failure/expired → release the hold. */
export async function processProviderOutcome(type: string, ref: string, outcome: "success" | "failure" | "expired") {
  if (outcome === "success") await confirmByType({ type, ref });
  else await markFailed({ type, ref });
}

async function confirmByType(metadata: Stripe.Metadata | null | undefined) {
  const { type, ref } = metadata ?? {};
  if (!ref) return;
  if (type === "booking") await confirmBooking(ref);
  else if (type === "registration") await confirmRegistration(ref);
  else if (type === "game") await confirmGameJoin(ref);
  else if (type === "pass") await confirmPass(ref);
  else if (type === "program") await confirmProgramEnrollment(ref);
  else if (type === "experience") await confirmExperienceBooking(ref);
}
