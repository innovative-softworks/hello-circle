import { Router } from "express";
import { db } from "../db/index.js";
import { getClub } from "../db/queries.js";
import { notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { CLIENT_URL, stripe } from "../stripe.js";
import { BadRequestError, clientIdFrom, generateRef, isValidEmail } from "../util.js";

export const registrationsRouter = Router();

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
}

async function insertRegistration(ref: string, clientId: string, body: CreateRegistrationBody, pricing: ReturnType<typeof computePricing>, status: "pending" | "paid") {
  await db.prepare(
    `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial,
      subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status)
     VALUES (@ref, @clientId, @clubId, @team, @childFirst, @childLast, @dob, @gFirst, @gLast, @email, @phone, @address, @ecName, @ecPhone, @ecRel, @medical, @consent, @trial,
      @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status)`
  ).run({
    ref,
    clientId,
    clubId: body.clubId,
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
  const ref = generateRef("CR");
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
    await insertRegistration(ref, clientId, body, pricing, "paid");
    notify("paid");
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100, trial: body.trial });
  }

  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });

  await insertRegistration(ref, clientId, body, pricing, "pending");

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

  const rows = await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.trial, r.status,
              r.total_cents as totalCents, r.created_at as createdAt,
              c.name as clubName, c.sport as sport
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE r.client_id = ? AND r.payment_status = 'paid'
       ORDER BY r.created_at DESC`
    )
    .all(clientId);

  res.json(rows);
});

/** Same ownership/idempotency rules as booking cancellation, but no 48h
 * cutoff — a club registration isn't tied to a single date/time the way a
 * hall booking is. Flips a status flag only; refunds (if any) happen
 * off-platform. */
registrationsRouter.post("/:ref/cancel", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const row = (await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.status, r.payment_status as paymentStatus,
              r.g_first as gFirst, r.g_last as gLast, r.email, r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND r.client_id = ?`
    )
    .get(req.params.ref, clientId)) as
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

  res.json({ ok: true });
});
