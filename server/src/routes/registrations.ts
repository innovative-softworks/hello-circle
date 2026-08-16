import { Router } from "express";
import { db } from "../db/index.js";
import { getClub } from "../db/queries.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { lookupLimiter } from "../rateLimit.js";
import { CLIENT_URL, stripe } from "../stripe.js";
import { BadRequestError, ConflictError, clientIdFrom, generateRef, isValidEmail } from "../util.js";
import { promoteNextWaitlistEntry } from "../waitlist.js";

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
  team: string;
  childFirst: string;
  childLast: string;
  dob: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName: string;
  ecPhone: string;
  ecRel: string;
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

async function insertRegistration(
  ref: string,
  clientId: string,
  residentId: string | null,
  body: CreateRegistrationBody,
  pricing: ReturnType<typeof computePricing>,
  status: "pending" | "paid",
  passId: number | null = null
) {
  await db.prepare(
    `INSERT INTO registrations (ref, client_id, resident_id, club_id, session_id, pass_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial,
      subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, waiver_version)
     VALUES (@ref, @clientId, @residentId, @clubId, @sessionId, @passId, @team, @childFirst, @childLast, @dob, @gFirst, @gLast, @email, @phone, @address, @ecName, @ecPhone, @ecRel, @medical, @consent, @trial,
      @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status, @waiverVersion)`
  ).run({
    ref,
    clientId,
    residentId,
    clubId: body.clubId,
    sessionId: body.sessionId ?? null,
    passId,
    team: body.team,
    childFirst: body.childFirst,
    childLast: body.childLast,
    dob: body.dob,
    gFirst: body.gFirst,
    gLast: body.gLast,
    email: body.email,
    phone: body.phone,
    address: body.address,
    ecName: body.ecName,
    ecPhone: body.ecPhone,
    ecRel: body.ecRel,
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

registrationsRouter.post("/checkout", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const body = req.body as CreateRegistrationBody;
  if (!body.clubId || !body.childFirst || !body.childLast || !body.dob || !body.team || !body.consent) {
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
  if (club.capacity !== null) {
    const { n: paidCount } = (await db
      .prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
      .get(club.id)) as { n: number };
    if (paidCount >= club.capacity) {
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

        await tx.prepare(`UPDATE passes SET credits_used = credits_used + 1 WHERE id = ?`).run(pass.id);
        const zeroPricing = computePricing(0, 0, 0, null);
        await insertRegistration(ref, clientId, req.resident!.id, body, zeroPricing, "paid", pass.id);
      });
    } catch (e) {
      if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
      throw e;
    }

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
      detailsText: `${body.childFirst} ${body.childLast} (DOB ${body.dob}) · ${body.team} · redeemed via pass`,
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
    return res.status(201).json({ ref, totalEuro: 0, trial: false });
  }

  const subtotalCents = body.trial ? 0 : club.price * 100;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (!body.trial && body.couponCode) {
    const result = await evaluateCoupon(body.couponCode, subtotalCents);
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
      detailsText: `${body.childFirst} ${body.childLast} (DOB ${body.dob}) · ${body.team}${body.trial ? " · Trial session" : ""} · €${(pricing.totalCents / 100).toFixed(2)}${isCash ? " due in cash on arrival" : " total"}`,
    }).catch((e) => console.error("[notifications] registration notify failed:", e));
  if (pricing.totalCents === 0 || isCash) {
    await insertRegistration(ref, clientId, req.resident?.id ?? null, body, pricing, "paid");
    notify("paid");
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100, trial: body.trial });
  }

  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });

  await insertRegistration(ref, clientId, req.resident?.id ?? null, body, pricing, "pending");

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `${club.name} registration`, description: `${body.childFirst} ${body.childLast} — ${body.team}${couponCode ? ` (coupon ${couponCode} applied)` : ""}` },
            unit_amount: pricing.taxableCents,
          },
          quantity: 1,
        },
        { price_data: { currency: "eur", product_data: { name: "VAT (23%)" }, unit_amount: pricing.vatCents }, quantity: 1 },
        { price_data: { currency: "eur", product_data: { name: "Platform fee" }, unit_amount: pricing.platformFeeCents }, quantity: 1 },
      ],
      customer_email: body.email,
      success_url: `${CLIENT_URL}/payment/success?ref=${ref}`,
      cancel_url: `${CLIENT_URL}/payment/cancel?ref=${ref}`,
      metadata: { type: "registration", ref },
    });
  } catch (e) {
    await db.prepare(`DELETE FROM registrations WHERE ref = ?`).run(ref);
    console.error("[stripe] checkout session creation failed:", e instanceof Error ? e.message : e);
    return res.status(400).json({ error: "Couldn't start checkout — please check your details and try again" });
  }

  await db.prepare(`UPDATE registrations SET stripe_session_id = ? WHERE ref = ?`).run(session.id, ref);
  res.status(201).json({ ref, url: session.url, totalEuro: pricing.totalCents / 100, trial: body.trial });
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
                  c.id as clubId, c.name as clubName, c.sport as sport
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
                  c.id as clubId, c.name as clubName, c.sport as sport
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
              c.id as clubId, c.name as clubName, c.sport as sport
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
    detailsText: `${row.childFirst} ${row.childLast} · ${row.team}`,
  }).catch((e) => console.error("[notifications] registration cancellation notify failed:", e));

  // A cancelled paid registration frees a capacity spot (NEXT — waitlist
  // auto-promotion). No-op if the club has no capacity set or no one is
  // waiting — promoteNextWaitlistEntry never throws.
  promoteNextWaitlistEntry("club", row.clubId, row.clubName);

  res.json({ ok: true });
});
