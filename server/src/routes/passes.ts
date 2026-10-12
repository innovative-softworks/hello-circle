import { Router } from "express";
import { shadowLegacy } from "../commerce/engine.js";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { VENDOR_SUSPENDED_ERROR, isPositiveInt, vendorSuspended } from "../bookingIntegrity.js";
import { computePricing } from "../pricing.js";
import { requireResident } from "../residents.js";
import { generateRef } from "../util.js";
import { commerceQuoteLimiter } from "../rateLimit.js";

export const passesRouter = Router();

export const MAX_PASS_CREDITS = 50;

// Credit-pack passes (NEXT) — a resident buys N credits up front for a
// specific club, redeemable one-per-registration instead of paying each
// time. Deliberately its own simple checkout, mirroring
// bookings.ts/registrations.ts's pending -> Stripe -> webhook-confirms
// pattern rather than being wired through the registration flow itself.
passesRouter.get("/me", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.id, p.listing_type as listingType, p.listing_id as listingId, p.credits_total as creditsTotal,
              p.credits_used as creditsUsed, p.purchased_cents as purchasedCents, p.expires_at as expiresAt,
              c.name as listingName
       FROM passes p LEFT JOIN clubs c ON c.id = p.listing_id AND p.listing_type = 'club'
       WHERE p.resident_id = ? AND p.payment_status = 'paid' ORDER BY p.created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

interface PassCheckoutInput {
  listingType: "club";
  listingId: string;
  creditsTotal: number;
}

type PassPrice =
  | { ok: true; club: { name: string; vendor_id: string | null }; pricing: ReturnType<typeof computePricing> }
  | { ok: false; status: number; error: string };

/** The one place a pass is priced — shared by the quote and the checkout so
 * the button's price is the charged price (R3A; replaces a client estimate). */
async function pricePass(listingId: string | undefined, creditsTotal: unknown): Promise<PassPrice> {
  if (!listingId || !creditsTotal || Number(creditsTotal) < 1) return { ok: false, status: 400, error: "listingId and creditsTotal are required" };
  // Commerce audit R10 — a whole number of credits within a sane pack size.
  if (!isPositiveInt(creditsTotal, MAX_PASS_CREDITS)) return { ok: false, status: 400, error: `A pass can hold between 1 and ${MAX_PASS_CREDITS} sessions` };

  // Commerce audit R10/R14 — same listing gates every other checkout applies:
  // only an approved club whose vendor isn't suspended can sell a pass.
  const club = (await db.prepare(`SELECT name, price, status, vendor_id FROM clubs WHERE id = ?`).get(listingId)) as
    | { name: string; price: number; status: string; vendor_id: string | null }
    | undefined;
  if (!club || club.status !== "approved") return { ok: false, status: 404, error: "Club not found" };
  if (await vendorSuspended(club.vendor_id)) return { ok: false, status: 409, error: VENDOR_SUSPENDED_ERROR };
  if (!(club.price > 0)) return { ok: false, status: 400, error: "This club doesn't sell passes" };

  // Simple bulk pricing: credits at the club's per-registration price, no
  // discount logic — a real pass product would want tiered pricing, out of
  // scope for this scaffolding.
  const subtotalCents = club.price * 100 * (creditsTotal as number);
  return { ok: true, club, pricing: computePricing(subtotalCents, 0, 0, null) };
}

/** R3A — read-only price for the "Buy a pass" button (no row, no Stripe call). */
passesRouter.get("/quote", commerceQuoteLimiter, async (req, res) => {
  const credits = Number(req.query.creditsTotal ?? 10);
  const priced = await pricePass(typeof req.query.listingId === "string" ? req.query.listingId : undefined, credits);
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error });
  const p = priced.pricing;
  res.json({
    creditsTotal: credits,
    subtotalCents: p.subtotalCents,
    discountCents: p.discountCents,
    taxableCents: p.taxableCents,
    vatCents: p.vatCents,
    platformFeeCents: p.platformFeeCents,
    depositCents: p.depositCents,
    totalCents: p.totalCents,
    couponCode: null,
    currency: "EUR",
  });
});

passesRouter.post("/checkout", requireResident, async (req, res) => {
  const b = req.body as PassCheckoutInput;
  const priced = await pricePass(b.listingId, b.creditsTotal);
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error });
  const { club, pricing } = priced;
  const ref = generateRef("PS");
  shadowLegacy("pass", ref, { vendorUserId: club.vendor_id }, pricing);

  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', ?, ?, ?, 'pending')`)
    .run(ref, req.resident!.id, b.listingId, b.creditsTotal, pricing.totalCents);

  const result = await createCheckoutSession({
    ref,
    type: "pass",
    customerEmail: req.resident!.email,
    residentId: req.resident!.id,
    lineItems: pricingLineItems(pricing, { name: `${club.name} — ${b.creditsTotal}-credit pass` }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(ref);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE passes SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

/** Mirrors bookings.ts's/registrations.ts's GET /status/:ref — PaymentSuccess.tsx
 * polls this for a "PS-" ref after the Stripe redirect. Passes are always
 * resident-owned (no guest-client-id path), so ownership is by resident_id. */
passesRouter.get("/status/:ref", requireResident, async (req, res) => {
  // Resident Experience Polish — Changeset 5, same reasoning as
  // bookings.ts's GET /status/:ref. Passes are always listing_type='club'
  // today (the only pass-purchase flow that exists — ClubDetail.tsx's
  // 10-session pack), confirmed by grep across every INSERT INTO passes.
  const row = await db
    .prepare(
      `SELECT p.ref, p.payment_status as paymentStatus, p.purchased_cents as totalCents,
              p.listing_id as clubId, c.name as clubName, p.credits_total as creditsTotal
       FROM passes p LEFT JOIN clubs c ON p.listing_type = 'club' AND c.id = p.listing_id
       WHERE p.ref = ? AND p.resident_id = ?`
    )
    .get(req.params.ref, req.resident!.id);
  if (!row) return res.status(404).json({ error: "Pass not found" });
  res.json(row);
});
