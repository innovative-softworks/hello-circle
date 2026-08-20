import { Router } from "express";
import { runStructuredSearch, type StructuredSearchResult } from "./search.js";

export const askRouter = Router();

// Ask HelloCircle (implementation plan Phase 12) — deliberately rule-based,
// not an LLM. This app has no AI/LLM API key or SDK configured anywhere
// (confirmed — see README's Environment variables table), and adding one
// would mean a new required secret, a new external dependency, and
// per-request cost this app has never had, none of which was asked for.
// searchParser.ts already exists for exactly this ("AI search without an
// LLM API key/wiring") — this endpoint is a conversational framing over
// the EXACT SAME structured search routes/search.ts's own box uses (via
// the shared runStructuredSearch()), never a separate/looser query path.
// That's also what trivially satisfies the doc's own guardrail: results
// always come from real DB queries, so nothing here can "invent
// availability" — the reply text is templated around real counts, not
// generated.

const RESULT_CAP = 5;

function buildReply(result: StructuredSearchResult): string {
  const total = result.centres.length + result.clubs.length + result.activities.length + result.experiences.length;
  if (total === 0) {
    return "I couldn't find anything matching that — try a different activity, a wider budget, or another county.";
  }
  const parts: string[] = [];
  if (result.activities.length) parts.push(`${result.activities.length} activit${result.activities.length === 1 ? "y" : "ies"}`);
  if (result.experiences.length) parts.push(`${result.experiences.length} adventure${result.experiences.length === 1 ? "" : "s"}/experience${result.experiences.length === 1 ? "" : "s"}`);
  if (result.centres.length) parts.push(`${result.centres.length} centre${result.centres.length === 1 ? "" : "s"}`);
  if (result.clubs.length) parts.push(`${result.clubs.length} club${result.clubs.length === 1 ? "" : "s"}`);
  let reply = `Here's what I found — ${parts.join(", ")}.`;
  if (result.parsed.county) reply += ` Scoped to ${result.parsed.county}.`;
  if (result.parsed.free) reply += " Free only.";
  if (result.parsed.maxPriceEuro !== null) reply += ` Under €${result.parsed.maxPriceEuro}.`;
  return reply;
}

askRouter.post("/", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Ask me something first" });
  if (message.length > 500) return res.status(400).json({ error: "That's a bit long — try a shorter question" });

  const result = await runStructuredSearch(message, req.resident?.id ?? null, req.resident?.homeCounty ?? null);

  res.json({
    reply: buildReply(result),
    parsed: result.parsed,
    centres: result.centres.slice(0, RESULT_CAP),
    clubs: result.clubs.slice(0, RESULT_CAP),
    activities: result.activities.slice(0, RESULT_CAP),
    experiences: result.experiences.slice(0, RESULT_CAP),
    totalCentres: result.centres.length,
    totalClubs: result.clubs.length,
    totalActivities: result.activities.length,
    totalExperiences: result.experiences.length,
  });
});
