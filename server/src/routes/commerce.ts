import { Router } from "express";
import { db } from "../db/index.js";
import { engineEnabledFor } from "../commerce/engine.js";
import { isPositiveInt } from "../bookingIntegrity.js";
import { commerceQuoteLimiter } from "../rateLimit.js";
import { BadRequestError, clientIdFrom } from "../util.js";
import { loadQuotableExperience, storedExperienceQuote } from "./experiences.js";

// Commerce Engine Phase 2 — the customer-facing commerce API (master prompt
// §15). Resource-specific routes keep working unchanged; these are the
// engine's own entry points. Only resource types the engine has been
// switched on for are quotable here; every other type answers 409 so a
// client can fall back to that resource's existing quote endpoint.
export const commerceRouter = Router();

function optionalClientId(req: Parameters<typeof clientIdFrom>[0]): string | null {
  try {
    return clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return null;
    throw e;
  }
}

commerceRouter.post("/quotes", commerceQuoteLimiter, async (req, res) => {
  const b = req.body as { sourceType?: string; resourceId?: string; sessionId?: string; quantity?: unknown; couponCode?: string };
  if (b.sourceType !== "experience") return res.status(409).json({ error: "This kind of booking isn't priced by the commerce engine yet", code: "engine_not_enabled" });
  if (!(await engineEnabledFor("experience"))) return res.status(409).json({ error: "The commerce engine isn't switched on for experiences", code: "engine_not_enabled" });
  if (!b.resourceId || !b.sessionId) return res.status(400).json({ error: "resourceId and sessionId are required" });
  if (b.quantity !== undefined && !isPositiveInt(b.quantity)) return res.status(400).json({ error: "Quantity must be a whole number of at least 1" });
  const found = await loadQuotableExperience(b.resourceId, b.sessionId);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const r = await storedExperienceQuote(found.experience, b.sessionId, (b.quantity as number | undefined) ?? 1, b.couponCode, optionalClientId(req), req.resident?.id ?? null);
  res.status(r.status).json(r.body);
});

/** The customer's own view of an order: status and what they paid. Partner
 * payout, success fee and cost estimates are internal and never returned. */
commerceRouter.get("/orders/:id", async (req, res) => {
  const clientId = optionalClientId(req);
  const residentId = req.resident?.id ?? null;
  const order = (await db
    .prepare(
      `SELECT o.id, o.source_type as sourceType, o.source_ref as sourceRef, o.currency, o.order_status as orderStatus, o.payment_status as paymentStatus,
              o.fulfilment_status as fulfilmentStatus, o.created_at as createdAt, o.customer_client_id as clientId, o.customer_resident_id as residentId,
              s.list_minor as listMinor, s.discount_minor as discountMinor, s.coupon_code as couponCode, s.vat_minor as vatMinor,
              s.customer_fee_minor as customerFeeMinor, s.deposit_minor as depositMinor, s.customer_paid_minor as customerPaidMinor
       FROM commerce_orders o JOIN pricing_snapshots s ON s.order_id = o.id WHERE o.id = ?`
    )
    .get(req.params.id)) as Record<string, any> | undefined;
  const owns = order && ((clientId && order.clientId === clientId) || (residentId && order.residentId === residentId));
  if (!order || !owns) return res.status(404).json({ error: "Order not found" });
  const { clientId: _c, residentId: _r, ...visible } = order;
  for (const k of ["listMinor", "discountMinor", "vatMinor", "customerFeeMinor", "depositMinor", "customerPaidMinor"]) visible[k] = Number(visible[k]);
  res.json({ ...visible, customerHelloCircleFeeMinor: visible.customerFeeMinor });
});
