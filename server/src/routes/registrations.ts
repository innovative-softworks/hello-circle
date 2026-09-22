import { Router } from "express";
import { computeCapacity } from "../capacity.js";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { getClub } from "../db/queries.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { lookupLimiter } from "../rateLimit.js";
import { stripe } from "../stripe.js";
import { BadRequestError, ConflictError, clientIdFrom, generateRef, isValidEmail } from "../util.js";
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
  // insertRegistrationWithSessionLock, which needs the session capacity
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

/** Locks and checks a specific club_session's own capacity (independent of
 * the club-wide capacity check above — a club can configure both), then
 * inserts the registration in the same transaction so the check and the
 * insert are atomic. A club_session's capacity tends to be much smaller
 * than the whole club's, so the race the club-wide check accepts as a minor
 * risk matters more here — hence the row lock, matching the pattern
 * bookings.ts/games.ts/programs.ts already use for their own capacity
 * checks. No-ops to the plain unlocked insert when the registration isn't
 * tied to a session — every club without sessions configured behaves
 * exactly as before. */
async function insertRegistrationWithSessionLock(
  ref: string,
  clientId: string,
  residentId: string | null,
  body: CreateRegistrationBody,
  pricing: ReturnType<typeof computePricing>,
  status: "pending" | "paid",
  passId: number | null = null
) {
  if (!body.sessionId) {
    await insertRegistration(ref, clientId, residentId, body, pricing, status, passId);
    return;
  }
  await db.transaction(async (tx) => {
    const session = (await tx
      .prepare(`SELECT id, capacity FROM club_sessions WHERE id = ? AND club_id = ? AND active = 1 FOR UPDATE`)
      .get(body.sessionId, body.clubId)) as { id: string; capacity: number | null } | undefined;
    if (!session) throw new ConflictError("That session is no longer available — please pick another");
    {
      const { n } = (await tx
        .prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
        .get(body.sessionId)) as { n: number };
      if (computeCapacity(session.capacity, n).isFull) throw new ConflictError("That session is full — please pick another");
    }
    await insertRegistration(ref, clientId, residentId, body, pricing, status, passId, tx);
  });
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
  if (body.registrantType !== "adult" && (!body.dob || !body.team)) {
    return res.status(400).json({ error: "Missing required registration fields" });
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

  // Capacity/waitlist (MVP) — nullable capacity means unlimited, matching
  // every club's behaviour before this existed. Not race-proof the way
  // bookings.ts's room lock is (a club registration has no single row to
  // lock against) — acceptable here since going slightly over capacity on a
  // club roster is a minor operational issue, not a double-booked venue.
  {
    const { n: paidCount } = (await db
      .prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
      .get(club.id)) as { n: number };
    // An active (unexpired) waitlist offer holds its spot — without this, a
    // fresh registration could grab a freed slot out from under the person
    // it was actually offered to, during their 48h claim window. Exclude
    // this registrant's own offer (if any) from the reserved count — it's
    // their spot to claim, not competing demand against itself.
    const offeredCount = await activeOfferedCount("club", club.id);
    const ownsOffer = await hasActiveOffer("club", club.id, clientId, req.resident?.id ?? null);
    if (computeCapacity(club.capacity, paidCount + offeredCount - (ownsOffer ? 1 : 0)).isFull) {
      return res.status(409).json({ error: "This club is currently full", full: true });
    }
  }

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

        if (body.sessionId) {
          const session = (await tx
            .prepare(`SELECT id, capacity FROM club_sessions WHERE id = ? AND club_id = ? AND active = 1 FOR UPDATE`)
            .get(body.sessionId, body.clubId)) as { id: string; capacity: number | null } | undefined;
          if (!session) throw new ConflictError("That session is no longer available — please pick another");
          if (session.capacity !== null) {
            const { n } = (await tx
              .prepare(`SELECT COUNT(*) as n FROM registrations WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
              .get(body.sessionId)) as { n: number };
            if (n >= session.capacity) throw new ConflictError("That session is full — please pick another");
          }
        }

        await tx.prepare(`UPDATE passes SET credits_used = credits_used + 1 WHERE id = ?`).run(pass.id);
        const zeroPricing = computePricing(0, 0, 0, null);
        await insertRegistration(ref, clientId, req.resident!.id, body, zeroPricing, "paid", pass.id, tx);
      });
    } catch (e) {
      if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
      throw e;
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
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
    await upgradeFavouriteStatus(req.resident!.id, "club", club.id);
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
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
  if (pricing.totalCents === 0 || isCash) {
    try {
      await insertRegistrationWithSessionLock(ref, clientId, req.resident?.id ?? null, body, pricing, "paid");
    } catch (e) {
      if (e instanceof ConflictError) return res.status(409).json({ error: e.message, full: true });
      throw e;
    }
    await claimWaitlistOffer("club", club.id, clientId, req.resident?.id ?? null);
    notify("paid");
    if (req.resident) await upgradeFavouriteStatus(req.resident.id, "club", club.id);
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100, trial: body.trial });
  }

  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });

  try {
    await insertRegistrationWithSessionLock(ref, clientId, req.resident?.id ?? null, body, pricing, "pending");
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message, full: true });
    throw e;
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
    await db.prepare(`DELETE FROM registrations WHERE ref = ?`).run(ref);
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

  const row = await db
    .prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM registrations WHERE ref = ? AND client_id = ?`)
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
                  c.id as clubId, c.name as clubName, c.sport as sport, c.vendor_id as vendorId
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
                  c.id as clubId, c.name as clubName, c.sport as sport, c.vendor_id as vendorId
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
              r.g_first as gFirst, r.g_last as gLast, r.email, r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND (r.client_id = ? OR LOWER(r.email) = LOWER(?))`
    )
    .get(req.params.ref, headerClientId ?? "", (email ?? "").trim())) as
    | { ref: string; team: string; childFirst: string; childLast: string; status: string; paymentStatus: string; gFirst: string; gLast: string; email: string; clubId: string; clubName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Registration not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This registration is already cancelled" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This registration can't be cancelled" });

  await db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE ref = ?`).run(row.ref);

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
  }).catch((e) => console.error("[notifications] registration cancellation notify failed:", e));

  // A cancelled paid registration frees a capacity spot (NEXT — waitlist
  // auto-promotion). No-op if the club has no capacity set or no one is
  // waiting — promoteNextWaitlistEntry never throws. Club-scoped only: if
  // this registration was tied to a specific session (see
  // insertRegistrationWithSessionLock above), the freed spot is on that
  // session, but there's no session-level waitlist concept yet — this only
  // promotes from the club-wide waitlist. Fine for now since sessions are
  // opt-in per club and waitlisting is still club-wide everywhere else too.
  promoteNextWaitlistEntry("club", row.clubId, row.clubName);

  res.json({ ok: true });
});
