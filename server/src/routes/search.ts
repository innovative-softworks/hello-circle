import { Router } from "express";
import { db } from "../db/index.js";
import { listClubs, listCentres } from "../db/queries.js";
import { parseSearchQuery } from "../searchParser.js";

export const searchRouter = Router();

// Natural-language-ish search (FUTURE, best-effort — "AI search" without an
// LLM). Parses a handful of structured signals out of the query
// (county/free/price/time-of-day) via searchParser.ts, then filters the
// existing centre/club lists — no new index, no vector store, just rules
// over data that already exists. Zero-result queries are logged to
// search_misses for demand intelligence (see routes/vendor.ts GET /demand,
// routes/admin.ts GET /demand).
searchRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) return res.json({ parsed: null, centres: [], clubs: [] });

  const parsed = parseSearchQuery(q);
  const matchesKeywords = (haystack: string) => parsed.keywords.length === 0 || parsed.keywords.some((k) => haystack.toLowerCase().includes(k));

  const [allCentres, allClubs] = await Promise.all([listCentres(parsed.county ?? undefined), listClubs(parsed.county ?? undefined)]);

  const centres = allCentres.filter((c) => matchesKeywords(`${c.name} ${c.blurb} ${c.amenities.join(" ")}`));
  const clubs = allClubs
    .filter((c) => matchesKeywords(`${c.name} ${c.sport} ${c.blurb}`))
    .filter((c) => !parsed.free || c.trial || c.price === 0)
    .filter((c) => parsed.maxPriceEuro === null || c.price <= parsed.maxPriceEuro);

  if (centres.length === 0 && clubs.length === 0) {
    await db
      .prepare(`INSERT INTO search_misses (query_text, county) VALUES (?, ?)`)
      .run(q.trim().slice(0, 500), parsed.county ?? "")
      .catch(() => {});
  }

  res.json({ parsed, centres, clubs });
});
