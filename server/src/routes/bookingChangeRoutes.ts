import { Router } from "express";
import { ChangeError, describeProposal, respondToProposal } from "../bookingChanges.js";
import { lookupLimiter } from "../rateLimit.js";

// OG-11 — the customer's side of a proposed booking change: reached from the
// emailed link (the token is the only credential; it's single-purpose and
// hashed at rest).

export const bookingChangesRouter = Router();

bookingChangesRouter.get("/", lookupLimiter, async (req, res) => {
  try {
    res.json(await describeProposal(String(req.query.token ?? "")));
  } catch (e) {
    if (e instanceof ChangeError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

bookingChangesRouter.post("/respond", lookupLimiter, async (req, res) => {
  const accept = req.body?.accept;
  if (typeof accept !== "boolean") return res.status(400).json({ error: "accept must be true or false" });
  try {
    res.json(await respondToProposal(String(req.body?.token ?? ""), accept, typeof req.body?.note === "string" ? req.body.note : ""));
  } catch (e) {
    if (e instanceof ChangeError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});
