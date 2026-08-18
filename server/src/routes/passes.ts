import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { computePricing } from "../pricing.js";
import { requireResident } from "../residents.js";
import { generateRef } from "../util.js";

export const passesRouter = Router();

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

passesRouter.post("/checkout", requireResident, async (req, res) => {
  const b = req.body as PassCheckoutInput;
  if (!b.listingId || !b.creditsTotal || b.creditsTotal < 1) return res.status(400).json({ error: "listingId and creditsTotal are required" });

  const club = (await db.prepare(`SELECT name, price FROM clubs WHERE id = ?`).get(b.listingId)) as { name: string; price: number } | undefined;
  if (!club) return res.status(404).json({ error: "Club not found" });

  // Simple bulk pricing: credits at the club's per-registration price, no
  // discount logic — a real pass product would want tiered pricing, out of
  // scope for this scaffolding.
  const subtotalCents = club.price * 100 * b.creditsTotal;
  const pricing = computePricing(subtotalCents, 0, 0, null);
  const ref = generateRef("PS");

  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status) VALUES (?, ?, 'club', ?, ?, ?, 'pending')`)
    .run(ref, req.resident!.id, b.listingId, b.creditsTotal, pricing.totalCents);

  const result = await createCheckoutSession({
    ref,
    type: "pass",
    customerEmail: req.resident!.email,
    lineItems: pricingLineItems(pricing, { name: `${club.name} — ${b.creditsTotal}-credit pass` }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(ref);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE passes SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});
