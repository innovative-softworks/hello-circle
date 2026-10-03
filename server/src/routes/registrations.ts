import { Router } from "express";
import { computeCapacity } from "../capacity.js";
import { createCheckoutSession, paymentsAvailable, pricingLineItems } from "../checkoutService.js";
import { consumeCoupon, endPendingHold, occupiesCapacitySql } from "../bookingIntegrity.js";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { getClub } from "../db/queries.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { lookupLimiter } from "../rateLimit.js";
import { stripe } from "../stripe.js";
import { BadRequestError, ConflictError, clientIdFrom, generateRef, isPlausibleDob, isValidEmail } from "../util.js";
import { activeOfferedCount, claimWaitlistOffer, hasActiveOffer, promoteNextWaitlistEntry } from "../waitlist.js";

export const registrationsRouter = Router();

// Safeguarding scaffolding (FUTURE, best-effort) — records which version of
// the guardian consent/waiver text a registration was submitted under,
// alongside the existing `consent` boolean. Bump this constant whenever the
// waiver copy shown in RegistrationFlow.tsx materially changes, so past
// registrations stay attributable to the text the guardian actually saw.
// This is a record-keeping mechanism only, not a substitute for legal
// review of that text.
export const WAIVER_VERSION = "2026-08-v1";

interface CreateRegistrationBody {
  clubId: string;
  /** Which shape this submission is — drives which fields below are
   * actually required (see the /checkout validation). Defaults to "child"
   * when omitted, matching every registration before this field existed. */
  registrantType?: "child" | "adult";
  /** Age-group team (kids flow only) — RegistrationFlow.tsx's adult path
   * doesn't show a team picker, so this is optional there. */
  team?: string;
  childFirst: string;
  childLast: string;
  /** Kids flow only — RegistrationFlow.tsx's adult path collects no DOB. */
  dob?: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  /** Kids flow only — required for a minor, optional for a self-registering adult. */
  ecName?: string;
  ecPhone?: string;
  ecRel?: string;
  medical?: string;
  consent: boolean;
  trial: boolean;
  couponCode?: string;
  /** Optional pick from that club's recurring schedule (Tier 1 UI pass) —
   * a club with no sessions configured simply never sends this. */
  sessionId?: string;
  /** Redeem a credit-pack pass instead of paying (Tier 2). Mutually
   * exclusive with couponCode/trial — validated + consumed atomically in
   * the checkout handler, not here. */
  passId?: number;
}

/** Shared "who + when" fragment for notification/receipt text — the kids
 * flow always has a DOB + age-group team to show; the adult flow has
 * neither (RegistrationFlow.tsx never collects them in that path). */
function registrantSummary(body: CreateRegistrationBody): string {
  if (body.registrantType === "adult") return `${body.childFirst} ${body.childLast}`;
  return `${body.childFirst} ${body.childLast} (DOB ${body.dob}) · ${body.team}`;
}

async function insertRegistration(
  ref: string,
  clientId: string,
  residentId: string | null,
  body: CreateRegistrationBody,
  pricing: ReturnType<typeof computePricing>,
  status: "pending" | "paid",
  passId: number | null = null,
  // Accepts a transaction's `tx` in place of the module-level pool so this
  // insert can participate in a caller's transaction — see
  // reserveRegistration, which needs the capacity
  // check and this insert to commit atomically together.
  conn: Pick<typeof db, "prepare"> = db
) {
  await conn.prepare(
    `INSERT INTO registrations (ref, client_id, resident_id, club_id, session_id, pass_id, registrant_type, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial,
      subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, waiver_version)
     VALUES (@ref, @clientId, @residentId, @clubId, @sessionId, @passId, @registrantType, @team, @childFirst, @childLast, @dob, @gFirst, @gLast, @email, @phone, @address, @ecName, @ecPhone, @ecRel, @medical, @consent, @trial,
      @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status, @waiverVersion)`
  ).run({
    ref,
    clientId,
    residentId,
    clubId: body.clubId,
    sessionId: body.sessionId ?? null,
    passId,
    registrantType: body.registrantType ?? "child",
    team: body.team ?? "",
    childFirst: body.childFirst,
    childLast: body.childLast,
    dob: body.dob ?? "",
    gFirst: body.gFirst,
    gLast: body.gLast,
    email: body.email,
    phone: body.phone,
    address: body.address,
    ecName: body.ecName ?? "",
    ecPhone: body.ecPhone ?? "",
    ecRel: body.ecRel ?? "",
    medical: body.medical ?? "",
    consent: body.consent ? 1 : 0,
    trial: body.trial ? 1 : 0,
    subtotalCents: pricing.taxableCents,
    discountCents: pricing.discountCents,
    vatCents: pricing.vatCents,
    platformFeeCents: pricing.platformFeeCents,
    couponCode: pricing.couponCode,
    totalCents: pricing.totalCents,
    status,
    waiverVersion: body.consent ? WAIVER_VERSION : "",
  });
}

class FullError extends ConflictError {}
class DuplicateRegistrationError extends ConflictError {}
class CouponExhaustedError extends ConflictError {}

/** Phase 8 (HC-QA-034/037/038/041) — the single serialized reservation path
 * for every registration (free, trial, cash, pass and pending-paid). Inside
 * ONE transaction, under a row lock on the club (so different clubs never
 * block each other): duplicate check, club-wide capacity (occupancy + live
 * pending holds + held waitlist offers), per-session capacity (session row
 * lock), coupon consumption for orders confirmed now, then the insert.
 * Previously the club-wide count ran unlocked before the insert, so six
 * concurrent registrations all fit a capacity of one. */
async function reserveRegistration(
  ref: string,
  clientId: string,
  residentId: string | null,
  body: CreateRegistrationBody,
  pricing: ReturnType<typeof computePricing>,
  status: "pending" | "paid",
  passId: number | null = null,
  existingTx?: Pick<typeof db, "prepare">
) {
  const run = async (tx: Pick<typeof db, "prepare">) => {
    const club = (await tx.prepare(`SELECT id, capacity FROM clubs WHERE id = ? FOR UPDATE`).get(body.clubId)) as { id: string; capacity: number | null } | undefined;
    if (!club) throw new ConflictError("Club not found");

    // HC-QA-038 — one active registration per owner + participant (+ session).
    const duplicate = await tx
      .prepare(
        `SELECT id FROM registrations
         WHERE club_id = ? AND ${occupiesCapacitySql()} AND (session_id <=> ?)
           AND LOWER(child_first) = LOWER(?) AND LOWER(child_last) = LOWER(?) AND dob = ?
           AND (client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?)) LIMIT 1`
      )
      .get(body.clubId, body.sessionId ?? null, body.childFirst, body.childLast, body.dob ?? "", clientId, residentId ?? "");
    if (duplicate) throw new DuplicateRegistrationError("This person is already registered for this club");

    if (club.capacity !== null) {
      const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND ${occupiesCapacitySql()}`).get(body.clubId)) as { n: number };
      // An active waitlist offer holds its spot, except the registrant's own.
      const offered = await activeOfferedCount("club", body.clubId);
      const ownsOffer = await hasActiveOffer("club", body.clubId, clientId, residentId);
      if (computeCapacity(club.capacity, Number(n) + offered - (ownsOffer ? 1 : 0)).isFull) throw new FullError("This club is currently full");
    }

    if (body.sessionId) {
      const session = (await tx
        .prepare(`SELECT id, capacity FROM club_sessions WHERE id = ? AND club_id = ? AND active = 1 FOR UPDATE`)
        .get(body.sessionId, body.clubId)) as { id: string; capacity: number | null } | undefined;
      if (!session) throw new FullError("That session is no longer available — please pick another");
      const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND ${occupiesCapacitySql()}`).get(body.sessionId)) as { n: number };
      if (computeCapacity(session.capacity, Number(n)).isFull) throw new FullError("That session is full — please pick another");
    }

    // HC-QA-050 — reserve the coupon use with the registration, paid or pending.
    {
      try {
        await consumeCoupon(tx, pricing.couponCode);
      } catch {
        throw new CouponExhaustedError("That code has been fully redeemed");
      }
    }
    await insertRegistration(ref, clientId, residentId, body, pricing, status, passId, tx);
  };
  if (existingTx) await run(existingTx);
  else await db.transaction(run);
}

/** Maps reservation conflicts to the API's existing response shapes. */
function reservationError(e: unknown, res: import("express").Response) {
  if (e instanceof CouponExhaustedError) return res.status(400).json({ error: e.message });
  if (e instanceof DuplicateRegistrationError) return res.status(409).json({ error: e.message, duplicate: true });
  if (e instanceof FullError) return res.status(409).json({ error: e.message, full: true });
  if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
  throw e;
}

registrationsRouter.post("/checkout", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const body = req.body as CreateRegistrationBody;
  if (!body.clubId || !body.childFirst || !body.childLast || !body.consent) {
    return res.status(400).json({ error: "Missing required registration fields" });
  }
  // DOB and an age-group team only make sense for a minor being registered
  // by a guardian — an adult registering themselves (club.audience ===
  // "adults"/"all") skips both. Every pre-existing caller omits
  // registrantType entirely, which defaults to "child" here and keeps this
  // check byte-for-byte the same as before this field existed.
  if (body.registrantType !== "adult") {
    if (!body.dob || !body.team) {
      return res.status(400).json({ error: "Missing required registration fields" });
    }
    // Onboarding audit §6 — format/plausibility only (not an age rule): dob
    // previously passed through completely unvalidated, so "not-a-real-date"
    // text could land in a registration record alongside medical info.
    if (!isPlausibleDob(body.dob)) {
      return res.status(400).json({ error: "That doesn't look like a valid date of birth" });
    }
  }
  if (!isValidEmail(body.email)) {
    return res.status(400).json({ error: "That doesn't look like a valid email address" });
  }

  const club = await getClub(body.clubId);
  if (!club) return res.status(404).json({ error: "Club not found" });

  if (body.sessionId) {
    const session = await db.prepare(`SELECT id FROM club_sessions WHERE id = ? AND club_id = ? AND active = 1`).get(body.sessionId, body.clubId);
    if (!session) return res.status(400).json({ error: "That session is no longer available — please pick another" });
  }

  // Capacity, duplicates and coupon use are decided inside reserveRegistration's
  // locked transaction (HC-QA-034) — no unlocked pre-check here.

  const ref = generateRef("CR");

  // Pass redemption (Tier 2) — spends one credit instead of paying. Row-locks
  // the pass the same way bookings.ts locks a room, so two registrations
  // can't both spend the pass's last credit in a race. Returns early: no
  // pricing, no coupon, no Stripe — the pass was already paid for up front.
  if (body.passId) {
    if (!req.resident) return res.status(401).json({ error: "Sign in to use a pass" });
    try {
      await db.transaction(async (tx) => {
        const pass = (await tx
          .prepare(`SELECT id, resident_id, listing_id, credits_total, credits_used, expires_at FROM passes WHERE id = ? AND payment_status = 'paid' FOR UPDATE`)
          .get(body.passId)) as { id: number; resident_id: string; listing_id: string; credits_total: number; credits_used: number; expires_at: string | null } | undefined;
        if (!pass || pass.resident_id !== req.resident!.id || pass.listing_id !== body.clubId) throw new ConflictError("That pass isn't valid for this club");
        if (pass.expires_at && new Date(pass.expires_at) < new Date()) throw new ConflictError("That pass has expired");
        if (pass.credits_used >= pass.credits_total) throw new ConflictError("That pass has no credits left");

        await tx.prepare(`UPDATE passes SET credits_used = credits_used + 1 WHERE id = ?`).run(pass.id);
        const zeroPricing = computePricing(0, 0, 0, null);
        await reserveRegistration(ref, clientId, req.resident!.id, body, zeroPricing, "paid", pass.id, tx);
      });
    } catch (e) {
      return reservationError(e, res);
    }
    await claimWaitlistOffer("club", body.clubId, clientId, req.resident!.id);

    const clubVendorForPass = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(body.clubId)) as { vendor_id: string | null } | undefined;
    notifyNewBookingOrRegistration({
      kind: "registration",
      listingType: "club",
      listingId: club.id,
      listingName: club.name,
      vendorId: clubVendorForPass?.vendor_id ?? null,
      guestName: `${body.gFirst} ${body.gLast}`,
      guestEmail: body.email,
      ref,
      detailsText: `${registrantSummary(body)} · redeemed via pass`,
      residentId: req.resident!.id,
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
    await upgradeFavouriteStatus(req.resident!.id, "club", club.id);
    void logEvent("booking_completed", { residentId: req.resident!.id, metadata: { type: "registration", ref, via: "pass" } });
    return res.status(201).json({ ref, totalEuro: 0, trial: false });
  }

  const subtotalCents = body.trial ? 0 : club.price * 100;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (!body.trial && body.couponCode) {
    const result = await evaluateCoupon(body.couponCode, subtotalCents, { listingType: "club", listingId: club.id });
    if (!result.valid) return res.status(400).json({ error: result.error });
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  const pricing = computePricing(subtotalCents, 0, discountCents, couponCode);
  // Free trial registrations need no payment, and cash-mode clubs skip
  // Stripe entirely — both confirm immediately, no redirect.
  const isCash = club.paymentMethod === "cash" && pricing.totalCents > 0;

  const clubVendor = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(body.clubId)) as { vendor_id: string | null } | undefined;
  const notify = (status: "pending" | "paid") =>
    notifyNewBookingOrRegistration({
      kind: "registration",
      listingType: "club",
      listingId: club.id,
      listingName: club.name,
      vendorId: clubVendor?.vendor_id ?? null,
      guestName: `${body.gFirst} ${body.gLast}`,
      guestEmail: body.email,
      ref,
      detailsText: `${registrantSummary(body)}${body.trial ? " · Trial session" : ""} · €${(pricing.totalCents / 100).toFixed(2)}${isCash ? " due in cash on arrival" : " total"}`,
      residentId: req.resident?.id ?? null,
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
  if (pricing.totalCents === 0 || isCash) {
    try {
      await reserveRegistration(ref, clientId, req.resident?.id ?? null, body, pricing, "paid");
    } catch (e) {
      return reservationError(e, res);
    }
    await claimWaitlistOffer("club", club.id, clientId, req.resident?.id ?? null);
    notify("paid");
    if (req.resident) await upgradeFavouriteStatus(req.resident.id, "club", club.id);
    void logEvent("booking_completed", { residentId: req.resident?.id ?? null, clientId, metadata: { type: "registration", ref, via: isCash ? "cash" : "free" } });
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100, trial: body.trial });
  }

  if (!paymentsAvailable()) return res.status(503).json({ error: "Payments aren't configured yet" });

  // HC-QA-041 — the pending row IS the capacity hold for the checkout's lifetime.
  try {
    await reserveRegistration(ref, clientId, req.resident?.id ?? null, body, pricing, "pending");
  } catch (e) {
    return reservationError(e, res);
  }

  const result = await createCheckoutSession({
    ref,
    type: "registration",
    customerEmail: body.email,
    residentId: req.resident?.id ?? null,
    lineItems: pricingLineItems(pricing, {
      name: `${club.name} registration`,
      description: `${registrantSummary(body)}${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
    }),
    isNative: req.header("X-Client-Platform") === "mobile",
  });
  if (!result.ok) {
    await endPendingHold("registrations", ref, "delete");
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE registrations SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100, trial: body.trial });
});

registrationsRouter.get("/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  // Resident Experience Polish — Changeset 5, same reasoning as
  // bookings.ts's GET /status/:ref. A registration has no single dated
  // occurrence (ongoing club membership, not a booked slot), so no
  // date/time here — never fabricated.
  const row = await db
    .prepare(
      `SELECT r.ref, r.payment_status as paymentStatus, r.total_cents as totalCents,
              r.club_id as clubId, c.name as clubName, r.child_first as childFirst, r.child_last as childLast, r.team
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND r.client_id = ?`
    )
    .get(req.params.ref, clientId);
  if (!row) return res.status(404).json({ error: "Registration not found" });
  res.json(row);
});

registrationsRouter.get("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  // Signed in via a magic link (see guestAuth.ts)? Also include every
  // registration under that verified email, not just this device's
  // client_id — one OR, no dedup needed since it's one row per match.
  const rows = req.guestEmail
    ? await db
        .prepare(
          `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.trial, r.status,
                  r.total_cents as totalCents, r.created_at as createdAt,
                  c.id as clubId, c.name as clubName, c.sport as sport, c.vendor_id as vendorId,
                  (SELECT a.status FROM attendance a WHERE a.kind = 'registration' AND a.ref = r.ref) as attendance
           FROM registrations r
           JOIN clubs c ON c.id = r.club_id
           WHERE (r.client_id = ? OR LOWER(r.email) = LOWER(?)) AND r.payment_status = 'paid'
           ORDER BY r.created_at DESC`
        )
        .all(clientId, req.guestEmail)
    : await db
        .prepare(
          `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.trial, r.status,
                  r.total_cents as totalCents, r.created_at as createdAt,
                  c.id as clubId, c.name as clubName, c.sport as sport, c.vendor_id as vendorId,
                  (SELECT a.status FROM attendance a WHERE a.kind = 'registration' AND a.ref = r.ref) as attendance
           FROM registrations r
           JOIN clubs c ON c.id = r.club_id
           WHERE r.client_id = ? AND r.payment_status = 'paid'
           ORDER BY r.created_at DESC`
        )
        .all(clientId);

  res.json(rows);
});

/** Lets a guest recover a registration on a device that never made it —
 * i.e. one that doesn't have the original client_id in localStorage — by
 * proving they know both the ref (emailed to them) and the email address
 * used at signup. Read-only: doesn't touch client_id, so it can't remove
 * the registration from the original device's "My bookings" list. */
registrationsRouter.post("/lookup", lookupLimiter, async (req, res) => {
  const { ref, email } = req.body as { ref?: string; email?: string };
  if (!ref || !email) return res.status(400).json({ error: "Reference and email are required" });

  const row = await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.trial, r.status,
              r.total_cents as totalCents, r.created_at as createdAt,
              c.id as clubId, c.name as clubName, c.sport as sport, c.vendor_id as vendorId
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND LOWER(r.email) = LOWER(?)`
    )
    .get(ref.trim(), email.trim());
  if (!row) return res.status(404).json({ error: "We couldn't find a registration with that reference and email" });
  res.json(row);
});

/** Same ownership/idempotency rules as booking cancellation, but no 48h
 * cutoff — a club registration isn't tied to a single date/time the way a
 * hall booking is. Flips a status flag only; refunds (if any) happen
 * off-platform.
 *
 * Ownership is proven either by the usual X-Client-Id header, or (for a
 * registration recovered via /lookup on another device) an `email` in the
 * body matching the row — same email-based alternate as bookings.ts. */
registrationsRouter.post("/:ref/cancel", lookupLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  const headerClientId = req.header("X-Client-Id");
  if (!headerClientId && !email) {
    return res.status(400).json({ error: "X-Client-Id header or email is required" });
  }

  const row = (await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.status, r.payment_status as paymentStatus,
              r.g_first as gFirst, r.g_last as gLast, r.email, r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId, r.resident_id as residentId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND (r.client_id = ? OR LOWER(r.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | { ref: string; team: string; childFirst: string; childLast: string; status: string; paymentStatus: string; gFirst: string; gLast: string; email: string; clubId: string; clubName: string; vendorId: string | null; residentId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Registration not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This registration is already cancelled" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This registration can't be cancelled" });

  // HC-QA-046 — atomic transition: only the request that actually flips the row
  // runs the side effects (capacity release, audit, notifications, promotion).
  const flipped = await db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE ref = ? AND status != 'cancelled'`).run(row.ref);
  if (flipped.changes !== 1) return res.status(409).json({ error: "This registration is already cancelled" });

  notifyCancellation({
    kind: "registration",
    listingType: "club",
    listingId: row.clubId,
    listingName: row.clubName,
    vendorId: row.vendorId,
    guestName: `${row.gFirst} ${row.gLast}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: row.team ? `${row.childFirst} ${row.childLast} · ${row.team}` : `${row.childFirst} ${row.childLast}`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] registration cancellation notify failed:", e));

  // A cancelled paid registration frees a capacity spot (NEXT — waitlist
  // auto-promotion). No-op if the club has no capacity set or no one is
  // waiting — promoteNextWaitlistEntry never throws. Club-scoped only: if
  // this registration was tied to a specific session (see
  // reserveRegistration above), the freed spot is on that
  // session, but there's no session-level waitlist concept yet — this only
  // promotes from the club-wide waitlist. Fine for now since sessions are
  // opt-in per club and waitlisting is still club-wide everywhere else too.
  promoteNextWaitlistEntry("club", row.clubId, row.clubName);

  res.json({ ok: true });
});
