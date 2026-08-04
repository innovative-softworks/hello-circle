import { Router } from "express";
import { evaluateCoupon } from "../pricing.js";

export const couponsRouter = Router();

couponsRouter.post("/validate", async (req, res) => {
  const { code, subtotalCents } = req.body as { code?: string; subtotalCents?: number };
  if (!code || typeof subtotalCents !== "number") {
    return res.status(400).json({ error: "code and subtotalCents are required" });
  }
  const result = await evaluateCoupon(code, subtotalCents);
  if (!result.valid) return res.status(400).json({ error: result.error });
  res.json({ code: result.code, discountCents: result.discountCents });
});
