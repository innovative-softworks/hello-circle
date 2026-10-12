import { Router } from "express";
import { consentHistory, currentConsents, recordConsent, type ConsentSubject } from "../consent.js";
import { simpleRateLimit } from "../rateLimit.js";
import { clientIdFrom } from "../util.js";

// Revenue & Connect Stage 5c — a person's own consents, each purpose
// separate. Contractual acceptance of Terms lives in the Policy Centre
// (/api/policies) and is not reported or changed here.

export const consentsRouter = Router();
const cookieLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

function signedIn(req: import("express").Request): ConsentSubject | null {
  if (req.resident) return { type: "resident", id: req.resident.id };
  if (req.user) return { type: "user", id: req.user.id };
  return null;
}

consentsRouter.get("/me", async (req, res) => {
  const subject = signedIn(req);
  if (!subject) return res.status(401).json({ error: "Sign in to see your consents" });
  res.json({ current: await currentConsents(subject), history: await consentHistory(subject) });
});

consentsRouter.put("/me/marketing", async (req, res) => {
  const subject = signedIn(req);
  if (!subject) return res.status(401).json({ error: "Sign in to change marketing preferences" });
  if (typeof req.body?.granted !== "boolean") return res.status(400).json({ error: "granted must be true or false" });
  await recordConsent(subject, "marketing_email", req.body.granted, "settings");
  res.json({ ok: true, granted: req.body.granted });
});

/** The cookie banner's choice: analytics and advertising are separate
 * purposes, recorded against the browser's client id (and the signed-in
 * person, if any). Strictly necessary storage needs no consent and isn't recorded. */
consentsRouter.post("/cookies", cookieLimiter, async (req, res) => {
  const { analytics, advertising, policyVersion } = (req.body ?? {}) as { analytics?: unknown; advertising?: unknown; policyVersion?: unknown };
  if (typeof analytics !== "boolean" || typeof advertising !== "boolean") return res.status(400).json({ error: "analytics and advertising must each be true or false" });
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch {
    return res.status(400).json({ error: "Missing client id" });
  }
  const policy = Number.isInteger(policyVersion) ? { docKey: "cookie-policy", version: Number(policyVersion) } : null;
  const subjects: ConsentSubject[] = [{ type: "client", id: clientId }];
  const person = signedIn(req);
  if (person) subjects.push(person);
  for (const s of subjects) {
    await recordConsent(s, "analytics_cookies", analytics, "cookie_banner", policy);
    await recordConsent(s, "advertising_cookies", advertising, "cookie_banner", policy);
  }
  res.json({ ok: true });
});
