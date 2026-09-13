import { Router } from "express";
import { db } from "../db/index.js";
import { simpleRateLimit } from "../rateLimit.js";
import { isValidEmail } from "../util.js";

export const launchSignupsRouter = Router();

// Same spam concern as magicLinkLimiter (an open, unauthenticated email
// capture) — one budget per IP, not per email, since nothing here is a
// secret to guess.
const launchSignupLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

interface LaunchSignupBody {
  email?: string;
  name?: string;
  county?: string;
}

launchSignupsRouter.post("/", launchSignupLimiter, async (req, res) => {
  const b = req.body as LaunchSignupBody;
  const email = (b.email ?? "").trim().toLowerCase();
  const name = (b.name ?? "").trim();
  const county = (b.county ?? "").trim();

  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email is required" });

  await db
    .prepare(
      `INSERT INTO launch_signups (email, name, county, client_id)
       VALUES (@email, @name, @county, @clientId)
       ON DUPLICATE KEY UPDATE
         name = CASE WHEN VALUES(name) != '' THEN VALUES(name) ELSE name END,
         county = CASE WHEN VALUES(county) != '' THEN VALUES(county) ELSE county END`
    )
    .run({ email, name, county, clientId: req.header("X-Client-Id") ?? null });

  res.status(201).json({ ok: true });
});
