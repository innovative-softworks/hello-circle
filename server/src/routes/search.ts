import { withGameCardFacts } from "../gameCardFacts.js";
import { orgActiveSql } from "../orgSql.js";
import { Router } from "express";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { listClubs, listCentres, listScheduledActivities, type ScheduledActivity } from "../db/queries.js";
import { scoreActivities, type DiscoverItem } from "./discover.js";
import { parseSearchQuery, type ParsedQuery } from "../searchParser.js";
import type { Centre, Club } from "../types.js";
import { clientIdFrom } from "../util.js";
import { categoriesForSearch, loadTaxonomy, type TaxonomyListingType } from "../taxonomy.js";
import { listProgramsForBrowse } from "./programs.js";

interface ExperienceSearchRow {
  id: string;
  kind: "adventure" | "experience";
  title: string;
  area: string;
  county: string;
  blurb: string;
  price_cents: number;
  image_url: string;
}

export const searchRouter = Router();

// Natural-language-ish search (FUTURE, best-effort — "AI search" without an
// LLM). Parses a handful of structured signals out of the query
// (county/free/price/time-of-day) via searchParser.ts, then filters the
// existing centre/club lists plus every scheduled activity (games, program
// sessions, club sessions — via db/queries.ts's listScheduledActivities,
// shared with routes/discover.ts) — Phase 6 of the roadmap explicitly wants
// search to cover activities/sessions, not just places. No new index, no
// vector store, just rules over data that already exists. Zero-result
// queries are logged to search_misses for demand intelligence (see
// routes/vendor.ts GET /demand, routes/admin.ts GET /demand) — unchanged,
// still only tracks the centre/club signal it always has.
//
// Activities are ranked (implementation plan Phase 12), not just sorted by
// date — via discover.ts's shared scoreActivities(), the exact same
// personalization + rankScore() the homepage feed uses, so a signed-in
// resident sees the same "why this fits" reasons everywhere. Centres/clubs
// stay unranked (see personalization.ts's own scope note).

const SEARCH_WINDOW_DAYS = 60;

/** Buckets a "HH:MM" clock time into the same three-way taxonomy
 * searchParser.ts's TIME_WORDS produces from the query text, so "evening"
 * in the query actually matches something. */
function bucketTimeOfDay(time: string): ParsedQuery["timeOfDay"] {
  const hour = Number(time.split(":")[0]);
  if (Number.isNaN(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export interface ExperienceSearchResult {
  id: string;
  kind: "adventure" | "experience";
  title: string;
  area: string;
  county: string;
  blurb: string;
  priceCents: number;
  imageUrl: string;
}

export interface ProgrammeSearchResult {
  id: string;
  title: string;
  parentName: string | null;
  area: string | null;
  county: string | null;
  nextSessionDate: string | null;
  priceCents: number | null;
  imageUrl: string | null;
}

export interface CircleSearchResult {
  id: string;
  slug: string | null;
  name: string;
  activityLabel: string;
  area: string;
  county: string;
  members: number;
}

export interface StructuredSearchResult {
  parsed: ParsedQuery;
  centres: Centre[];
  clubs: Club[];
  activities: DiscoverItem[];
  experiences: ExperienceSearchResult[];
  /** Category system (2026-10-22) — additive keys; older clients ignore them. */
  programmes: ProgrammeSearchResult[];
  circles: CircleSearchResult[];
}

/** Listing ids of one type whose category or subcategory is in the given sets. */
async function idsInCategories(type: TaxonomyListingType, categoryIds: string[], subcategoryIds: string[]): Promise<Set<string>> {
  if (categoryIds.length === 0 && subcategoryIds.length === 0) return new Set();
  const clauses: string[] = [];
  const params: string[] = [type];
  if (categoryIds.length) { clauses.push(`category_id IN (${categoryIds.map(() => "?").join(",")})`); params.push(...categoryIds); }
  if (subcategoryIds.length) { clauses.push(`subcategory_id IN (${subcategoryIds.map(() => "?").join(",")})`); params.push(...subcategoryIds); }
  const rows = (await db.prepare(`SELECT listing_id FROM listing_taxonomy WHERE listing_type = ? AND (${clauses.join(" OR ")})`).all(...params)) as { listing_id: string }[];
  return new Set(rows.map((r) => r.listing_id));
}

/** The actual "run this parsed query against real data" logic — shared by
 * the search box route below and routes/ask.ts's rule-based "Ask
 * HelloCircle" (Phase 12), so the two entry points can't drift apart on
 * what counts as a match. Also logs zero-result misses for demand
 * intelligence, same as the search box always has, since a miss from
 * either entry point is the same real signal. */
export async function runStructuredSearch(
  q: string,
  residentId: string | null,
  residentHomeCounty: string | null,
  filter: { categorySlug?: string; subcategorySlug?: string } = {}
): Promise<StructuredSearchResult> {
  const parsed = parseSearchQuery(q);
  const keywordMatch = (haystack: string) => parsed.keywords.length === 0 || parsed.keywords.some((k) => haystack.toLowerCase().includes(k));
  const index = await loadTaxonomy();
  // Category aliases: "football" finds soccer and Gaelic listings, "badminton"
  // finds every type classified as badminton, whatever its title says.
  const tax = categoriesForSearch(index, parsed.keywords.join(" ") || q);
  const [catGames, catExperiences, catPrograms, catCircles, catClubs, catCentres] = await Promise.all(
    (["game", "experience", "program", "circle", "club", "centre"] as const).map((t) => idsInCategories(t, tax.categoryIds, tax.subcategoryIds))
  );
  // Explore's category filter (?category=&sub=): only listings classified
  // there, AND any typed keywords. An unknown slug matches nothing.
  const pick = filter.subcategorySlug ?? filter.categorySlug;
  const picked = pick ? [...index.byId.values()].find((r) => r.slug === pick && !r.archived_at) ?? null : null;
  const inFilter = pick
    ? await Promise.all(
        (["game", "experience", "program", "circle", "club", "centre"] as const).map((t) =>
          picked ? idsInCategories(t, picked.parent_id ? [] : [picked.id], picked.parent_id ? [picked.id] : []) : Promise.resolve(new Set<string>())
        )
      )
    : null;
  const allowed = (i: number, id: string) => !inFilter || inFilter[i].has(id);
  const matchesKeywords = (haystack: string) => keywordMatch(haystack);

  const [allCentres, allClubs, allExperiencesRaw] = await Promise.all([
    listCentres(parsed.county ?? undefined),
    listClubs(parsed.county ?? undefined),
    parsed.county
      ? db.prepare(`SELECT id, kind, title, area, county, blurb, price_cents, image_url FROM experiences WHERE status = 'approved' AND ${orgActiveSql("vendor_id")} AND county = ?`).all(parsed.county)
      : db.prepare(`SELECT id, kind, title, area, county, blurb, price_cents, image_url FROM experiences WHERE status = 'approved' AND ${orgActiveSql("vendor_id")}`).all(),
  ]);
  const allExperiences = allExperiencesRaw as ExperienceSearchRow[];

  const centres = allCentres.filter((c) => allowed(5, c.id) && (catCentres.has(c.id) || matchesKeywords(`${c.name} ${c.blurb} ${c.amenities.join(" ")} ${c.accessibility.join(" ")}`)));
  const clubs = allClubs
    .filter((c) => allowed(4, c.id) && (catClubs.has(c.id) || matchesKeywords(`${c.name} ${c.sport} ${c.blurb} ${c.accessibility.join(" ")}`)))
    .filter((c) => !parsed.free || c.trial || c.price === 0)
    .filter((c) => parsed.maxPriceEuro === null || c.price <= parsed.maxPriceEuro);
  // Not run through scoreActivities/DiscoverItem — an experience is a
  // browsable listing with multiple future departures (like a centre/club),
  // not itself a single dated activity, so it's filtered the same simple
  // way centres/clubs are rather than ranked alongside games/sessions.
  const experiences: ExperienceSearchResult[] = allExperiences
    .filter((e) => allowed(1, e.id) && (catExperiences.has(e.id) || matchesKeywords(`${e.title} ${e.blurb} ${e.kind}`)))
    .filter((e) => !parsed.free || e.price_cents === 0)
    .filter((e) => parsed.maxPriceEuro === null || e.price_cents <= parsed.maxPriceEuro * 100)
    .map((e) => ({ id: e.id, kind: e.kind, title: e.title, area: e.area, county: e.county, blurb: e.blurb, priceCents: e.price_cents, imageUrl: e.image_url }));

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setUTCDate(now.getUTCDate() + SEARCH_WINDOW_DAYS);
  const allActivities = await listScheduledActivities({ county: parsed.county ?? undefined, from: now, to: windowEnd });

  const matchingActivities = allActivities
    // With a category filter only classified activities (games) can match.
    .filter((a: ScheduledActivity) => (!inFilter || (a.kind === "game" && allowed(0, a.id))) && ((a.kind === "game" && catGames.has(a.id)) || matchesKeywords(`${a.title} ${a.centreName ?? ""} ${a.clubName ?? ""}`)))
    .filter((a) => !parsed.free || !a.priceCents)
    .filter((a) => parsed.maxPriceEuro === null || a.priceCents === null || a.priceCents <= parsed.maxPriceEuro * 100)
    .filter((a) => parsed.timeOfDay === null || bucketTimeOfDay(a.time) === parsed.timeOfDay);

  const scored = await scoreActivities(matchingActivities, now, residentId, residentHomeCounty);
  scored.sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date) || a.item.time.localeCompare(b.item.time));
  const activities = scored.map((e) => e.item);

  // Logged per listing type independently, not just when both are empty —
  // one query box searches centres and clubs simultaneously, so "no clubs
  // matched" and "no centres matched" are two different demand signals
  // (see routes/vendor.ts GET /demand, which scopes by vendor_type/county).
  // Deliberately not extended to activities yet — the vendor/admin Demand
  // tab's scope is centre/club vendor_type, which doesn't have an
  // equivalent for a zero-result activity search.
  const queryText = q.trim().slice(0, 500);
  const county = parsed.county ?? "";
  // A category-only browse (no typed words) isn't a demand signal.
  if (queryText && centres.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'centre', ?)`).run(queryText, county).catch(() => {});
  }
  if (queryText && clubs.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'club', ?)`).run(queryText, county).catch(() => {});
  }
  // IA spec §16 — demand intelligence previously only covered centres/clubs;
  // activities (games/sessions) and experiences are just as real a signal
  // of unmet demand, and getDemandSignals()'s own WHERE clause already
  // treats an unrecognised listing_type as "show everywhere" (listing_type
  // = '' OR listing_type = ?), so no query-side change was needed there.
  if (queryText && matchingActivities.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'activity', ?)`).run(queryText, county).catch(() => {});
  }
  if (queryText && experiences.length === 0) {
    await db.prepare(`INSERT INTO search_misses (query_text, listing_type, county) VALUES (?, 'experience', ?)`).run(queryText, county).catch(() => {});
  }

  // Programmes: the public browse list's own rules (published, organisation
  // active, approved parent, an upcoming session). Circles: active and open or
  // approval only — never invite-only; approval Circles get teaser fields.
  const programmes: ProgrammeSearchResult[] = ((await listProgramsForBrowse(parsed.county ?? undefined)) as unknown as Record<string, unknown>[])
    .filter((p) => allowed(2, String(p.id)) && (catPrograms.has(String(p.id)) || matchesKeywords(`${p.title} ${p.description ?? ""} ${p.listingName ?? ""} ${p.category ?? ""}`)))
    .filter((p) => !parsed.free || !p.priceCents)
    .filter((p) => parsed.maxPriceEuro === null || !p.priceCents || Number(p.priceCents) <= parsed.maxPriceEuro * 100)
    .slice(0, 30)
    .map((p) => ({
      id: String(p.id),
      title: String(p.title),
      parentName: (p.listingName as string | null) ?? null,
      area: (p.area as string | null) ?? null,
      county: (p.county as string | null) ?? null,
      nextSessionDate: (p.nextSessionDate as string | null) ?? null,
      priceCents: p.priceCents === null || p.priceCents === undefined ? null : Number(p.priceCents),
      imageUrl: (p.imageUrl as string | null) ?? null,
    }));
  const circleRows = (await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.activity_label, c.area, c.county, c.about, (SELECT COUNT(*) FROM circle_members cm WHERE cm.circle_id = c.id) as members
       FROM circles c WHERE c.status = 'active' AND c.join_mode IN ('open', 'approval') ${parsed.county ? "AND c.county = ?" : ""} ORDER BY c.county = ? DESC, c.name LIMIT 200`
    )
    .all(...(parsed.county ? [parsed.county] : []), residentHomeCounty ?? "")) as { id: string; slug: string | null; name: string; activity_label: string; area: string; county: string; about: string | null; members: number | string }[];
  const circles: CircleSearchResult[] = circleRows
    .filter((c) => allowed(3, c.id) && (catCircles.has(c.id) || matchesKeywords(`${c.name} ${c.activity_label} ${c.about ?? ""}`)))
    .slice(0, 30)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name, activityLabel: c.activity_label, area: c.area, county: c.county, members: Number(c.members) }));

  return { parsed, centres, clubs, activities, experiences, programmes, circles };
}

searchRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const filter = { categorySlug: str(req.query.categorySlug), subcategorySlug: str(req.query.subcategorySlug) };
  if (!q.trim() && !filter.categorySlug && !filter.subcategorySlug) return res.json({ parsed: null, centres: [], clubs: [], activities: [], experiences: [], programmes: [], circles: [] });

  const result = await runStructuredSearch(q, req.resident?.id ?? null, req.resident?.homeCounty ?? null, filter);
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch {
    // No X-Client-Id header (e.g. a bot, or an older client build) —
    // logging is best-effort, never a reason to fail a search request.
  }
  // Category system — which categories the query resolved to, so reports can group by id.
  const tax = categoriesForSearch(await loadTaxonomy(), q);
  void logEvent("search_performed", { residentId: req.resident?.id ?? null, clientId, metadata: { query: q, categoryIds: tax.categoryIds, subcategoryIds: tax.subcategoryIds } });
  res.json({ ...result, activities: await withGameCardFacts(result.activities, req.resident?.id ?? null) });
});
