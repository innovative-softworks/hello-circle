import { Router } from "express";
import { evaluateCoupon } from "../pricing.js";
import { couponValidateLimiter } from "../rateLimit.js";

export const couponsRouter = Router();

const LISTING_TYPES = ["centre", "club", "program", "experience", "game"];

// Commerce audit R5 — rate-limited, and every rejection returns the same
// message so the preview can't tell an attacker which codes exist, expired
// or ran out. Checkout re-evaluates with full listing context regardless.
couponsRouter.post("/validate", couponValidateLimiter, async (req, res) => {
  const { code, subtotalCents, listingType, listingId } = req.body as { code?: string; subtotalCents?: number; listingType?: string; listingId?: string };
  if (!code || typeof subtotalCents !== "number") {
    return res.status(400).json({ error: "code and subtotalCents are required" });
  }
  const context = typeof listingType === "string" && LISTING_TYPES.includes(listingType) && typeof listingId === "string" && listingId ? { listingType, listingId } : undefined;
  const result = await evaluateCoupon(code, subtotalCents, context);
  if (!result.valid) return res.status(400).json({ error: "That code isn't valid" });
  res.json({ code: result.code, discountCents: result.discountCents });
});
