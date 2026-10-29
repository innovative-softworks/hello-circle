// Category system (docs/hellocircle-category-decision-report.md, approved
// 2026-10-22). Listing type → Category → Subcategory → Tags.
//
// Three additive tables (created in db/index.ts → initTaxonomySchema below):
//   taxonomy_categories  one adjacency list for categories AND subcategories
//   taxonomy_aliases     normalised legacy text / synonyms / merged slugs → id
//   listing_taxonomy     one primary (category, subcategory) per listing
// No listing table is altered, no FKs (CLAUDE.md) — integrity is enforced
// here on write, by the delete guard in the admin routes, and by
// integrityIssues() below. Free-text activity_label / sport stay as titles.
//
// Rollback: the `categories_enabled` setting off (UI falls back to today),
// then drop the three tables. Nothing else is touched.

import { db, getSetting, setSetting } from "./db/index.js";
import { discoverableGameSql } from "./gameVisibility.js";
import { irelandTodayIso } from "./irelandTime.js";
import { orgActiveSql } from "./orgSql.js";
import { venuePagesPublic } from "./venueLaunch.js";

// --- Families and listing types --------------------------------------------

/** Discovery families a category can apply to (the decision report's A/X/V/P/C/K/N). */
export const FAMILIES = ["activity", "experience", "volunteer", "programme", "circle", "club", "venue"] as const;
export type Family = (typeof FAMILIES)[number];

/** Backend listing types a listing_taxonomy row can point at. */
export const TAXONOMY_LISTING_TYPES = ["game", "experience", "program", "circle", "club", "centre"] as const;
export type TaxonomyListingType = (typeof TAXONOMY_LISTING_TYPES)[number];

export function isFamily(v: unknown): v is Family {
  return typeof v === "string" && (FAMILIES as readonly string[]).includes(v);
}
export function isTaxonomyListingType(v: unknown): v is TaxonomyListingType {
  return typeof v === "string" && (TAXONOMY_LISTING_TYPES as readonly string[]).includes(v);
}

/** The family a listing belongs to. Volunteer listings are experiences of kind 'volunteer'. */
export function familyOf(type: TaxonomyListingType, experienceKind?: string | null): Family {
  switch (type) {
    case "game":
      return "activity";
    case "experience":
      return experienceKind === "volunteer" ? "volunteer" : "experience";
    case "program":
      return "programme";
    case "circle":
      return "circle";
    case "club":
      return "club";
    case "centre":
      return "venue";
  }
}

// --- Seed (the approved first release) -------------------------------------

interface SeedCategory {
  id: string;
  name: string;
  families: Family[];
  icon: string;
  description: string;
  subs: [id: string, name: string][];
  /** false = kept as an inactive row (brief items not in the first release). */
  active?: boolean;
}

const A: Family = "activity", X: Family = "experience", V: Family = "volunteer", P: Family = "programme", C: Family = "circle", K: Family = "club", N: Family = "venue";

export const CATEGORY_SEED: SeedCategory[] = [
  { id: "soccer", name: "Soccer", families: [A, P, C, K], icon: "Goal", description: "Five-a-side, seven-a-side and full-sided soccer, from kickabouts to leagues.", subs: [["5-a-side", "5-a-side"], ["7-a-side", "7-a-side"], ["11-a-side", "11-a-side"], ["futsal", "Futsal"], ["casual-kickabout", "Casual kickabout"]] },
  { id: "gaelic-games", name: "Gaelic games", families: [A, P, C, K], icon: "Shield", description: "Gaelic football, hurling, camogie, handball and rounders.", subs: [["gaelic-football", "Gaelic football"], ["hurling", "Hurling"], ["camogie", "Camogie"], ["handball", "Handball"], ["rounders", "Rounders"]] },
  { id: "racket-sports", name: "Racket sports", families: [A, P, C, K], icon: "Volleyball", description: "Badminton, tennis, padel, squash, table tennis and pickleball.", subs: [["badminton", "Badminton"], ["tennis", "Tennis"], ["padel", "Padel"], ["squash", "Squash"], ["table-tennis", "Table tennis"], ["pickleball", "Pickleball"]] },
  { id: "team-sports", name: "Team sports", families: [A, P, C, K], icon: "Users", description: "Basketball, volleyball, cricket, rugby, hockey and netball.", subs: [["basketball", "Basketball"], ["volleyball", "Volleyball"], ["cricket", "Cricket"], ["rugby", "Rugby"], ["hockey", "Hockey"], ["netball", "Netball"]] },
  { id: "fitness-wellness", name: "Fitness & wellness", families: [A, X, P, C, K], icon: "HeartPulse", description: "Yoga, pilates, running, bootcamps, gym, athletics and gymnastics.", subs: [["yoga", "Yoga"], ["pilates", "Pilates"], ["hiit", "HIIT"], ["running", "Running"], ["bootcamp", "Bootcamp"], ["gym", "Gym"], ["athletics", "Athletics"], ["gymnastics", "Gymnastics"]] },
  { id: "outdoors", name: "Outdoors & adventure", families: [A, X, C, K], icon: "Mountain", description: "Hiking, walking, cycling, camping, climbing and orienteering.", subs: [["hiking", "Hiking"], ["walking", "Walking"], ["cycling", "Cycling"], ["camping", "Camping"], ["climbing", "Climbing"], ["orienteering", "Orienteering"]] },
  { id: "water", name: "Water sports", families: [A, X, P, C, K], icon: "Waves", description: "Swimming, kayaking, paddleboarding, surfing, sailing, rowing and coasteering.", subs: [["swimming", "Swimming"], ["kayaking", "Kayaking"], ["paddleboarding", "Paddleboarding"], ["surfing", "Surfing"], ["sailing", "Sailing"], ["rowing", "Rowing"], ["coasteering", "Coasteering"]] },
  { id: "dance", name: "Dance", families: [A, P, C, K], icon: "Music2", description: "Irish dance, salsa, ballet, hip-hop and contemporary.", subs: [["irish-dance", "Irish dance"], ["salsa", "Salsa"], ["ballet", "Ballet"], ["hip-hop", "Hip-hop"], ["contemporary", "Contemporary"]] },
  { id: "martial-arts", name: "Martial arts & boxing", families: [A, P, K], icon: "Swords", description: "Boxing, karate, judo, taekwondo and Brazilian jiu-jitsu.", subs: [["boxing", "Boxing"], ["karate", "Karate"], ["judo", "Judo"], ["taekwondo", "Taekwondo"], ["bjj", "Brazilian jiu-jitsu"]] },
  { id: "games-social", name: "Games & social", families: [A, C], icon: "Dices", description: "Board games, chess, quizzes, card games, darts and pool.", subs: [["board-games", "Board games"], ["chess", "Chess"], ["quiz", "Quiz nights"], ["card-games", "Card games"], ["darts-pool", "Darts & pool"]] },
  { id: "meetups", name: "Meetups & community", families: [A, C], icon: "Coffee", description: "Coffee mornings, language exchange, newcomers, networking and book clubs.", subs: [["coffee", "Coffee meetups"], ["language-exchange", "Language exchange"], ["newcomers", "Newcomer meetups"], ["networking", "Networking"], ["community-gathering", "Community gatherings"], ["book-club", "Book club"]] },
  { id: "arts-crafts", name: "Arts & crafts", families: [A, X, P, C], icon: "Palette", description: "Pottery, painting, photography, crafts, creative writing and woodwork.", subs: [["pottery", "Pottery"], ["painting", "Painting"], ["photography", "Photography"], ["crafts", "Crafts"], ["creative-writing", "Creative writing"], ["woodwork", "Woodwork"]] },
  { id: "music", name: "Music", families: [X, P, C], icon: "Music", description: "Guitar, piano, singing, trad music and live music.", subs: [["guitar", "Guitar"], ["piano", "Piano"], ["singing", "Singing"], ["trad-music", "Trad music"], ["live-music", "Live music"]] },
  { id: "food-drink", name: "Food & drink", families: [X, P, C], icon: "UtensilsCrossed", description: "Cooking, baking, food tours and tastings.", subs: [["cooking", "Cooking"], ["baking", "Baking"], ["food-tours", "Food tours"], ["tastings", "Tastings"]] },
  { id: "culture-heritage", name: "Culture & heritage", families: [X], icon: "Landmark", description: "Heritage tours, city walks, museums and theatre.", subs: [["heritage-tours", "Heritage tours"], ["city-walks", "City walks"], ["museums", "Museums"], ["theatre", "Theatre"]] },
  // Participation Phase 1 (2026-10-29) — community events: cultural, faith and
  // community celebrations. "Culture & heritage" covers tours, museums and
  // theatre, not gatherings, so this is its own category (owner decision).
  { id: "culture-faith-celebrations", name: "Culture, faith & celebrations", families: [X, C], icon: "PartyPopper", description: "Cultural festivals, faith gatherings, community celebrations and fundraisers.", subs: [["cultural-festivals", "Cultural festivals"], ["faith-gatherings", "Faith gatherings"], ["community-celebrations", "Community celebrations"], ["fundraisers", "Fundraisers"]] },
  { id: "learning", name: "Learning & skills", families: [P], icon: "GraduationCap", description: "Languages, coding, tutoring, first aid and professional skills.", subs: [["languages", "Languages"], ["coding", "Coding"], ["tutoring", "Tutoring"], ["first-aid", "First aid"], ["professional-skills", "Professional skills"]] },
  { id: "kids-family", name: "Kids & family", families: [X, P], icon: "Baby", description: "After-school clubs, camps, early learning and family days out.", subs: [["after-school", "After-school"], ["camps", "Camps"], ["early-learning", "Early learning"], ["family-days", "Family days"]] },
  { id: "volunteering", name: "Volunteering & causes", families: [V, C], icon: "HandHeart", description: "Environment, community support, charity and animal welfare.", subs: [["environment", "Environment & clean-ups"], ["community", "Community support"], ["charity", "Charity & fundraising"], ["animals", "Animal welfare"]] },
  { id: "spaces-community", name: "Community halls & rooms", families: [N], icon: "Building2", description: "Community halls, meeting rooms, function rooms and classrooms.", subs: [["community-hall", "Community hall"], ["meeting-room", "Meeting room"], ["function-room", "Function room"], ["classroom", "Classroom"]] },
  { id: "spaces-sport", name: "Sports facilities", families: [N], icon: "Dumbbell", description: "Sports halls, pitches, courts, pools and studios.", subs: [["sports-hall", "Sports hall"], ["pitch", "Pitch"], ["court", "Court"], ["pool", "Pool"], ["studio", "Studio"]] },
  { id: "spaces-creative", name: "Creative & specialist spaces", families: [N], icon: "Brush", description: "Art studios, rehearsal rooms, kitchens and makerspaces.", subs: [["art-studio", "Art studio"], ["rehearsal-room", "Rehearsal room"], ["kitchen", "Kitchen"], ["makerspace", "Makerspace"]] },
  // Kept as inactive rows, ready to switch on from the admin area.
  { id: "nature-wildlife", name: "Nature & wildlife", families: [X, C], icon: "Bird", description: "Wildlife watching, birdwatching and forest walks.", subs: [["birdwatching", "Birdwatching"], ["wildlife-watching", "Wildlife watching"], ["forest-walks", "Forest walks"]], active: false },
  { id: "day-trips", name: "Day trips & excursions", families: [X], icon: "Bus", description: "Group day trips, scenic excursions and weekends away.", subs: [["group-day-trips", "Group day trips"], ["scenic-excursions", "Scenic excursions"]], active: false },
  { id: "technology", name: "Technology", families: [P], icon: "Cpu", description: "Robotics, digital skills and AI workshops.", subs: [["robotics", "Robotics"], ["digital-skills", "Digital skills"]], active: false },
  { id: "parents-families", name: "Parents & families", families: [C], icon: "Users", description: "New parents, family outings and parenting groups.", subs: [["new-parents", "New parents"], ["family-outings", "Family outings"]], active: false },
];

/** [alias text, target id, needsReview]. Names and slugs of every row are added automatically. */
const ALIAS_SEED: [string, string, boolean?][] = [
  // Legacy full labels (taxonomy doc §4) — exact matches, checked first.
  ["Five-a-side Football", "5-a-side"],
  ["Badminton Doubles", "badminton"],
  ["Tennis Doubles", "tennis"],
  ["Pickup Basketball", "basketball"],
  ["Saturday Parkrun", "running"],
  ["Couch to 5k Running Group", "running"],
  ["Yoga in the Park", "yoga"],
  ["Hiking Group Walk", "hiking"],
  ["Evening Cycling Spin", "cycling"],
  ["Swimming Squad Session", "swimming"],
  ["Chess Club Meetup", "chess"],
  ["Board Games Night", "board-games"],
  ["Coffee & Chat Meetup", "coffee"],
  ["Book Club Discussion", "book-club"],
  ["Photography Walk", "photography"],
  // ACTIVITY_CATEGORIES (client) / club sports.
  ["GAA", "gaelic-games"],
  ["Martial Arts", "martial-arts"],
  ["Fitness & Wellness", "fitness-wellness"],
  ["Arts & Crafts", "arts-crafts"],
  ["Community & Social", "meetups"],
  ["Kids & Family", "kids-family"],
  // MARKET_CATEGORIES (server).
  ["Fitness", "fitness-wellness"],
  ["Kids activities", "kids-family"],
  ["Arts", "arts-crafts"],
  ["Learning", "learning"],
  ["Community events", "community-gathering"],
  ["Outdoor", "outdoors"],
  ["Wellbeing", "fitness-wellness"],
  // Synonyms (demandNormalize.ts plus common variants).
  ["five-a-side", "5-a-side"],
  ["5 a side", "5-a-side"],
  ["five a side football", "5-a-side"],
  ["kickabout", "casual-kickabout"],
  ["parkrun", "running"],
  ["jogging", "running"],
  ["5k", "running"],
  ["run", "running"],
  ["hike", "hiking"],
  ["hillwalking", "hiking"],
  ["hill walking", "hiking"],
  ["trek", "hiking"],
  ["walk", "walking"],
  ["coastal walk", "walking"],
  ["scramble", "climbing"],
  ["bouldering", "climbing"],
  ["climbing wall", "climbing"],
  ["cycle", "cycling"],
  ["bike", "cycling"],
  ["swim", "swimming"],
  ["sea swim", "swimming"],
  ["kayak", "kayaking"],
  ["surf", "surfing"],
  ["sup", "paddleboarding"],
  ["ping pong", "table-tennis"],
  ["workout", "gym"],
  ["sourdough", "baking"],
  ["bake", "baking"],
  ["tasting", "tastings"],
  ["food market", "food-tours"],
  ["food tour", "food-tours"],
  ["trad", "trad-music"],
  ["trad music session", "trad-music"],
  ["engraving", "crafts"],
  ["toddler", "early-learning"],
  ["sensory play", "early-learning"],
  ["after school", "after-school"],
  ["camp", "camps"],
  ["coffee", "coffee"],
  ["book club", "book-club"],
  ["community hall", "community-hall"],
  ["community centre", "community-hall"],
  ["community rooms", "community-hall"],
  ["community hub", "community-hall"],
  ["parish centre", "community-hall"],
  ["parish hall", "community-hall"],
  ["sports hall", "sports-hall"],
  ["sports hub", "sports-hall"],
  ["sports complex", "sports-hall"],
  // Never auto-applied — the listing waits in the admin "Uncategorised" view.
  ["football", "soccer", true],
  ["multi sport", "team-sports", true],
  ["multi sports", "team-sports", true],
  ["walking tour", "heritage-tours", true],
  ["waterford crystal", "culture-heritage", true],
  ["brunch", "food-drink", true],
  // Generic venue words — a starting suggestion for an admin, never applied.
  ["hall", "community-hall", true],
  ["pavilion", "community-hall", true],
  ["hub", "community-hall", true],
  ["complex", "sports-hall", true],
];

/** Descriptive discovery tags (approved additions). Stored in listing_attributes
 * next to — but separate from — the participation attributes. */
export const DISCOVERY_TAGS = ["indoor", "outdoor", "evening", "weekend", "tournament", "festival", "fundraiser", "seasonal", "women_only", "over_50s"] as const;
export type DiscoveryTag = (typeof DISCOVERY_TAGS)[number];

export function sanitizeTags(values: unknown): DiscoveryTag[] {
  if (!Array.isArray(values)) return [];
  return DISCOVERY_TAGS.filter((t) => values.includes(t));
}

// --- Normalisation and matching ---------------------------------------------

/** Lower-cased, "&" → "and", punctuation → spaces, collapsed. Used for aliases and labels alike. */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  families: string;
  icon: string | null;
  image_url: string | null;
  sort_order: number;
  active: number;
  discoverable: number;
  featured: number;
  archived_at: string | Date | null;
  seo_title: string | null;
  seo_description: string | null;
  row_version: number;
  created_at: string | Date;
  updated_at: string | Date;
  /** Configuration Phase E (categoryPolicy.ts) — added columns. */
  moderation_policy?: string | null;
  suggested_form?: string | null;
}

interface AliasRow {
  alias_norm: string;
  category_id: string;
  source: string;
  needs_review: number;
}

export interface TaxonomyIndex {
  byId: Map<string, CategoryRow>;
  aliases: AliasRow[];
}

/** Every row (including inactive/archived) + aliases. ~150 rows; read per call. */
export async function loadTaxonomy(): Promise<TaxonomyIndex> {
  const rows = (await db.prepare(`SELECT * FROM taxonomy_categories ORDER BY sort_order, name`).all()) as CategoryRow[];
  const aliases = (await db.prepare(`SELECT alias_norm, category_id, source, needs_review FROM taxonomy_aliases`).all()) as AliasRow[];
  return { byId: new Map(rows.map((r) => [r.id, r])), aliases };
}

export function familiesOf(row: Pick<CategoryRow, "families">): Family[] {
  return row.families.split(",").filter(isFamily);
}

/** {categoryId, subcategoryId} for an id that may be either. */
function resolveTarget(index: TaxonomyIndex, id: string): { categoryId: string; subcategoryId: string | null } | null {
  const row = index.byId.get(id);
  if (!row) return null;
  return row.parent_id ? { categoryId: row.parent_id, subcategoryId: row.id } : { categoryId: row.id, subcategoryId: null };
}

export interface MatchResult {
  status: "matched" | "ambiguous" | "none";
  categoryId: string | null;
  subcategoryId: string | null;
  /** Every distinct category the text pointed at (for the admin review view). */
  candidates: string[];
}

/**
 * Deterministic matcher used by the backfill and the admin "suggest" view.
 * 1. The whole label equals an alias → that target.
 * 2. Otherwise every alias found as whole words; an alias contained in a
 *    longer hit is dropped; any needs-review hit, or hits in more than one
 *    category, make the result ambiguous. Hits in one category but several
 *    subcategories give the category alone. Hits whose category doesn't
 *    apply to the family are ignored. Nothing is guessed.
 */
export function matchLabel(index: TaxonomyIndex, text: string, family: Family): MatchResult {
  const norm = normalizeAlias(text);
  const none: MatchResult = { status: "none", categoryId: null, subcategoryId: null, candidates: [] };
  if (!norm) return none;
  const applies = (categoryId: string) => {
    const cat = index.byId.get(categoryId);
    return !!cat && familiesOf(cat).includes(family);
  };
  const exact = index.aliases.find((a) => a.alias_norm === norm && !a.needs_review);
  if (exact) {
    const t = resolveTarget(index, exact.category_id);
    if (t && applies(t.categoryId)) return { status: "matched", ...t, candidates: [t.categoryId] };
  }
  const padded = ` ${norm} `;
  let hits = index.aliases.filter((a) => padded.includes(` ${a.alias_norm} `));
  hits = hits.filter((h) => !hits.some((o) => o !== h && o.alias_norm.length > h.alias_norm.length && ` ${o.alias_norm} `.includes(` ${h.alias_norm} `)));
  const targets = hits
    .map((h) => ({ h, t: resolveTarget(index, h.category_id) }))
    .filter((x): x is { h: AliasRow; t: { categoryId: string; subcategoryId: string | null } } => !!x.t && applies(x.t.categoryId));
  if (targets.length === 0) return none;
  const categories = [...new Set(targets.map((x) => x.t.categoryId))];
  if (targets.some((x) => x.h.needs_review) || categories.length > 1) {
    return { status: "ambiguous", categoryId: null, subcategoryId: null, candidates: categories };
  }
  const subs = [...new Set(targets.map((x) => x.t.subcategoryId).filter((s): s is string => !!s))];
  return { status: "matched", categoryId: categories[0], subcategoryId: subs.length === 1 ? subs[0] : null, candidates: categories };
}

/** Category ids a free-text search term points at (search.ts): non-review exact or whole-word hits, any family. */
export function categoriesForSearch(index: TaxonomyIndex, text: string): { categoryIds: string[]; subcategoryIds: string[] } {
  const norm = normalizeAlias(text);
  if (!norm) return { categoryIds: [], subcategoryIds: [] };
  const padded = ` ${norm} `;
  const categoryIds = new Set<string>();
  const subcategoryIds = new Set<string>();
  for (const a of index.aliases) {
    if (!padded.includes(` ${a.alias_norm} `)) continue;
    const t = resolveTarget(index, a.category_id);
    if (!t) continue;
    // A needs-review alias ("football") widens search to every candidate
    // instead of being applied to listings — search can show both.
    if (a.needs_review && a.alias_norm === "football") {
      categoryIds.add("soccer");
      categoryIds.add("gaelic-games");
      continue;
    }
    if (t.subcategoryId) subcategoryIds.add(t.subcategoryId);
    else categoryIds.add(t.categoryId);
  }
  return { categoryIds: [...categoryIds], subcategoryIds: [...subcategoryIds] };
}

// --- Schema, seed, backfill -------------------------------------------------

export async function initTaxonomySchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS taxonomy_categories (
      id VARCHAR(64) NOT NULL,
      parent_id VARCHAR(64) NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      description VARCHAR(500) NULL,
      families VARCHAR(200) NOT NULL,
      icon VARCHAR(40) NULL,
      image_url VARCHAR(500) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      discoverable TINYINT(1) NOT NULL DEFAULT 0,
      featured TINYINT(1) NOT NULL DEFAULT 0,
      archived_at DATETIME NULL,
      seo_title VARCHAR(120) NULL,
      seo_description VARCHAR(300) NULL,
      row_version INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_taxonomy_slug (slug),
      KEY idx_taxonomy_parent (parent_id, sort_order)
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS taxonomy_aliases (
      alias_norm VARCHAR(191) NOT NULL,
      category_id VARCHAR(64) NOT NULL,
      source VARCHAR(20) NOT NULL,
      needs_review TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (alias_norm),
      KEY idx_alias_category (category_id)
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS listing_taxonomy (
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      category_id VARCHAR(64) NOT NULL,
      subcategory_id VARCHAR(64) NULL,
      assigned_by VARCHAR(20) NOT NULL,
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (listing_type, listing_id),
      KEY idx_lt_category (category_id, listing_type),
      KEY idx_lt_subcategory (subcategory_id)
    )
  `);
  await seedTaxonomy();
  // Once per database: a later boot must never re-add an assignment an
  // admin removed.
  if ((await getSetting("taxonomy_backfill_v1", "")) === "") {
    const report = await backfillListingTaxonomy();
    // app_settings.value is VARCHAR(255): "<iso>|game:matched/ambiguous/unmatched,…".
    await setSetting("taxonomy_backfill_v1", `${new Date().toISOString().slice(0, 19)}|${formatBackfillReport(report)}`);
  }
}

/** Inserts missing seed rows/aliases only — never overwrites an admin edit. */
export async function seedTaxonomy(): Promise<void> {
  let order = 0;
  for (const cat of CATEGORY_SEED) {
    order += 10;
    const active = cat.active === false ? 0 : 1;
    await db
      .prepare(
        `INSERT INTO taxonomy_categories (id, parent_id, name, slug, description, families, icon, sort_order, active, discoverable)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`
      )
      .run(cat.id, cat.name, cat.id, cat.description, cat.families.join(","), cat.icon, order, active, active);
    let subOrder = 0;
    for (const [subId, subName] of cat.subs) {
      subOrder += 10;
      await db
        .prepare(
          `INSERT INTO taxonomy_categories (id, parent_id, name, slug, families, sort_order, active, discoverable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`
        )
        .run(subId, cat.id, subName, subId, cat.families.join(","), subOrder, active, active);
    }
  }
  const aliases: [string, string, string, number][] = [];
  for (const cat of CATEGORY_SEED) {
    aliases.push([normalizeAlias(cat.name), cat.id, "slug", 0], [normalizeAlias(cat.id), cat.id, "slug", 0]);
    for (const [subId, subName] of cat.subs) aliases.push([normalizeAlias(subName), subId, "slug", 0], [normalizeAlias(subId), subId, "slug", 0]);
  }
  for (const [text, id, review] of ALIAS_SEED) aliases.push([normalizeAlias(text), id, review ? "synonym" : "legacy", review ? 1 : 0]);
  for (const [norm, id, source, review] of aliases) {
    if (!norm) continue;
    // First writer wins (ON DUPLICATE KEY no-op): a seed alias never re-points an admin's merge alias.
    await db.prepare(`INSERT INTO taxonomy_aliases (alias_norm, category_id, source, needs_review) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE alias_norm = alias_norm`).run(norm, id, source, review);
  }
}

export interface BackfillCounts {
  matched: number;
  ambiguous: number;
  unmatched: number;
}
export type BackfillReport = Record<TaxonomyListingType, BackfillCounts>;

export function formatBackfillReport(report: BackfillReport): string {
  return TAXONOMY_LISTING_TYPES.map((t) => `${t}:${report[t].matched}/${report[t].ambiguous}/${report[t].unmatched}`).join(",");
}

interface ListingLabel {
  type: TaxonomyListingType;
  id: string;
  family: Family;
  labels: string[];
  /** Programmes: the parent club's sport — a second opinion, never applied alone. */
  parentSport?: string | null;
}

/** Every listing with the text the matcher reads, in priority order. */
export async function listingLabels(): Promise<ListingLabel[]> {
  const out: ListingLabel[] = [];
  for (const r of (await db.prepare(`SELECT id, activity_label FROM games`).all()) as { id: string; activity_label: string }[]) {
    out.push({ type: "game", id: r.id, family: "activity", labels: [r.activity_label] });
  }
  for (const r of (await db.prepare(`SELECT id, activity_label, name FROM circles`).all()) as { id: string; activity_label: string; name: string }[]) {
    out.push({ type: "circle", id: r.id, family: "circle", labels: [r.activity_label, r.name] });
  }
  for (const r of (await db.prepare(`SELECT id, sport, name FROM clubs`).all()) as { id: string; sport: string | null; name: string }[]) {
    out.push({ type: "club", id: r.id, family: "club", labels: r.sport ? [r.sport] : [r.name] });
  }
  for (const r of (await db.prepare(`SELECT id, name FROM centres`).all()) as { id: string; name: string }[]) {
    out.push({ type: "centre", id: r.id, family: "venue", labels: [r.name] });
  }
  for (const r of (await db.prepare(`SELECT id, title, kind FROM experiences`).all()) as { id: string; title: string; kind: string }[]) {
    out.push({ type: "experience", id: r.id, family: familyOf("experience", r.kind), labels: [r.title] });
  }
  for (const r of (await db
    .prepare(`SELECT p.id, p.title, p.category, cl.sport FROM programs p LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id`)
    .all()) as { id: string; title: string; category: string | null; sport: string | null }[]) {
    out.push({ type: "program", id: r.id, family: "programme", labels: [r.title, ...(r.category ? [r.category] : [])], parentSport: r.sport });
  }
  return out;
}

/** The matcher's verdict for one listing (labels tried in order; first non-"none" wins). */
export function classifyListing(index: TaxonomyIndex, listing: ListingLabel): MatchResult & { suggestion: string | null } {
  let result: MatchResult = { status: "none", categoryId: null, subcategoryId: null, candidates: [] };
  for (const label of listing.labels) {
    if (!label) continue;
    result = matchLabel(index, label, listing.family);
    if (result.status !== "none") break;
  }
  let suggestion: string | null = null;
  if (listing.parentSport) {
    const parent = matchLabel(index, listing.parentSport, listing.family);
    if (parent.status === "matched") {
      if (result.status === "none") {
        // Title says nothing about the sport: the club's sport is only a suggestion.
        suggestion = parent.categoryId;
        return { status: "ambiguous", categoryId: null, subcategoryId: null, candidates: [parent.categoryId!], suggestion };
      }
      if (result.status === "matched" && result.categoryId !== parent.categoryId) {
        return { status: "ambiguous", categoryId: null, subcategoryId: null, candidates: [result.categoryId!, parent.categoryId!], suggestion: parent.categoryId };
      }
    }
  }
  return { ...result, suggestion: result.candidates[0] ?? null };
}

export interface Suggestion {
  categoryId: string | null;
  subcategoryId: string | null;
  /** "medium": one category suggested by the text or parent club; "low": several candidates or a review-only word; "none": nothing matched. */
  confidence: "medium" | "low" | "none";
  reason: string;
  candidates: string[];
}

/** Every whole-word alias hit in a text, with its target (for explaining a suggestion). */
function aliasHits(index: TaxonomyIndex, text: string): { alias: string; categoryId: string; subcategoryId: string | null; review: boolean }[] {
  const padded = ` ${normalizeAlias(text)} `;
  const out: { alias: string; categoryId: string; subcategoryId: string | null; review: boolean }[] = [];
  for (const a of index.aliases) {
    if (!padded.includes(` ${a.alias_norm} `)) continue;
    const t = resolveTarget(index, a.category_id);
    if (t) out.push({ alias: a.alias_norm, ...t, review: Number(a.needs_review) === 1 });
  }
  return out;
}

/** What an admin should consider for an unassigned listing. Never applied automatically. */
export function suggestionFor(index: TaxonomyIndex, listing: ListingLabel): Suggestion {
  const verdict = classifyListing(index, listing);
  const name = (id: string | null) => (id ? index.byId.get(id)?.name ?? id : "");
  const hits = listing.labels.flatMap((l) => (l ? aliasHits(index, l) : []));
  const subFor = (cat: string | null) => {
    const subs = [...new Set(hits.filter((h) => h.categoryId === cat && h.subcategoryId).map((h) => h.subcategoryId as string))];
    return subs.length === 1 ? subs[0] : null;
  };
  if (verdict.status === "matched") return { categoryId: verdict.categoryId, subcategoryId: verdict.subcategoryId, confidence: "medium", reason: "Exact match (would be assigned by the backfill)", candidates: verdict.candidates };
  if (verdict.status === "ambiguous") {
    const reviewWord = hits.find((h) => h.review);
    if (listing.parentSport && verdict.candidates.length === 1) {
      const parent = matchLabel(index, listing.parentSport, listing.family);
      return { categoryId: verdict.suggestion, subcategoryId: parent.categoryId === verdict.suggestion ? parent.subcategoryId : null, confidence: "medium", reason: `Title names no sport; the parent club's sport is "${listing.parentSport}"`, candidates: verdict.candidates };
    }
    if (reviewWord && verdict.candidates.length <= 1) {
      return { categoryId: verdict.suggestion, subcategoryId: subFor(verdict.suggestion), confidence: "low", reason: `"${reviewWord.alias}" is a general word — check before assigning`, candidates: verdict.candidates };
    }
    return {
      categoryId: verdict.suggestion,
      subcategoryId: subFor(verdict.suggestion),
      confidence: "low",
      reason: `Title points at ${verdict.candidates.map(name).join(" and ")}${listing.parentSport ? ` (parent club: ${listing.parentSport})` : ""}`,
      candidates: verdict.candidates,
    };
  }
  return { categoryId: null, subcategoryId: null, confidence: "none", reason: "No known activity or space word in the title", candidates: [] };
}

/** Inserts exact matches for listings that have no row yet. Re-running is a no-op. */
export async function backfillListingTaxonomy(): Promise<BackfillReport> {
  const index = await loadTaxonomy();
  const report = Object.fromEntries(TAXONOMY_LISTING_TYPES.map((t) => [t, { matched: 0, ambiguous: 0, unmatched: 0 }])) as BackfillReport;
  const existing = new Set(((await db.prepare(`SELECT listing_type, listing_id FROM listing_taxonomy`).all()) as { listing_type: string; listing_id: string }[]).map((r) => `${r.listing_type}:${r.listing_id}`));
  for (const listing of await listingLabels()) {
    const key = `${listing.type}:${listing.id}`;
    if (existing.has(key)) {
      report[listing.type].matched += 1;
      continue;
    }
    const result = classifyListing(index, listing);
    if (result.status === "matched" && result.categoryId) {
      await db
        .prepare(`INSERT INTO listing_taxonomy (listing_type, listing_id, category_id, subcategory_id, assigned_by) VALUES (?, ?, ?, ?, 'backfill') ON DUPLICATE KEY UPDATE listing_id = listing_id`)
        .run(listing.type, listing.id, result.categoryId, result.subcategoryId);
      report[listing.type].matched += 1;
    } else if (result.status === "ambiguous") {
      report[listing.type].ambiguous += 1;
    } else {
      report[listing.type].unmatched += 1;
    }
  }
  return report;
}

// --- Read helpers -------------------------------------------------------------

export interface ListingTaxonomy {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  subcategorySlug: string | null;
  /** false when the category was deactivated/archived after assignment. */
  active: boolean;
}

export async function getListingTaxonomy(type: TaxonomyListingType, id: string): Promise<ListingTaxonomy | null> {
  const row = (await db
    .prepare(
      `SELECT lt.category_id, c.name as cname, c.slug as cslug, c.active as cactive, c.archived_at as carchived,
              lt.subcategory_id, s.name as sname, s.slug as sslug, s.active as sactive, s.archived_at as sarchived
       FROM listing_taxonomy lt
       JOIN taxonomy_categories c ON c.id = lt.category_id
       LEFT JOIN taxonomy_categories s ON s.id = lt.subcategory_id
       WHERE lt.listing_type = ? AND lt.listing_id = ?`
    )
    .get(type, id)) as
    | { category_id: string; cname: string; cslug: string; cactive: number; carchived: unknown; subcategory_id: string | null; sname: string | null; sslug: string | null; sactive: number | null; sarchived: unknown }
    | undefined;
  if (!row) return null;
  const subOk = row.subcategory_id ? Number(row.sactive) === 1 && !row.sarchived : true;
  return {
    categoryId: row.category_id,
    categoryName: row.cname,
    categorySlug: row.cslug,
    subcategoryId: row.subcategory_id,
    subcategoryName: row.sname,
    subcategorySlug: row.sslug,
    active: Number(row.cactive) === 1 && !row.carchived && subOk,
  };
}

/** Bulk version for list endpoints: "type:id" → taxonomy. */
export async function getListingTaxonomyMany(type: TaxonomyListingType, ids: string[]): Promise<Map<string, ListingTaxonomy>> {
  const out = new Map<string, ListingTaxonomy>();
  if (ids.length === 0) return out;
  const rows = (await db
    .prepare(
      `SELECT lt.listing_id, lt.category_id, c.name as cname, c.slug as cslug, c.active as cactive, c.archived_at as carchived,
              lt.subcategory_id, s.name as sname, s.slug as sslug
       FROM listing_taxonomy lt JOIN taxonomy_categories c ON c.id = lt.category_id LEFT JOIN taxonomy_categories s ON s.id = lt.subcategory_id
       WHERE lt.listing_type = ? AND lt.listing_id IN (${ids.map(() => "?").join(",")})`
    )
    .all(type, ...ids)) as { listing_id: string; category_id: string; cname: string; cslug: string; cactive: number; carchived: unknown; subcategory_id: string | null; sname: string | null; sslug: string | null }[];
  for (const r of rows) {
    out.set(r.listing_id, {
      categoryId: r.category_id,
      categoryName: r.cname,
      categorySlug: r.cslug,
      subcategoryId: r.subcategory_id,
      subcategoryName: r.sname,
      subcategorySlug: r.sslug,
      active: Number(r.cactive) === 1 && !r.carchived,
    });
  }
  return out;
}

/** WHERE fragment for list endpoints: `EXISTS (…)` on listing_taxonomy, or null when no filter. */
export async function taxonomyFilter(
  type: TaxonomyListingType,
  idColumn: string,
  query: Record<string, unknown>
): Promise<{ sql: string; params: string[] } | null | "none"> {
  const raw = (k: string) => (typeof query[k] === "string" && (query[k] as string).trim() ? (query[k] as string).trim() : null);
  const cat = raw("categoryId") ?? raw("categorySlug");
  const sub = raw("subcategoryId") ?? raw("subcategorySlug");
  if (!cat && !sub) return null;
  const index = await loadTaxonomy();
  const resolve = (v: string | null) => {
    if (!v) return null;
    const direct = index.byId.get(v) ?? [...index.byId.values()].find((r) => r.slug === v);
    if (direct) return direct;
    // A merged/renamed slug keeps working through its alias.
    const alias = index.aliases.find((a) => a.alias_norm === normalizeAlias(v) && (a.source === "merge" || a.source === "slug"));
    return alias ? index.byId.get(alias.category_id) ?? null : null;
  };
  const c = resolve(cat);
  const s = resolve(sub);
  if ((cat && !c) || (sub && !s)) return "none"; // unknown → empty result, not every row
  const clauses: string[] = [];
  const params: string[] = [type];
  if (s) {
    clauses.push("_lt.subcategory_id = ?");
    params.push(s.id);
  } else if (c) {
    // A subcategory passed as the category still filters correctly.
    clauses.push(c.parent_id ? "_lt.subcategory_id = ?" : "_lt.category_id = ?");
    params.push(c.id);
  }
  return { sql: `EXISTS (SELECT 1 FROM listing_taxonomy _lt WHERE _lt.listing_type = ? AND _lt.listing_id = ${idColumn} AND ${clauses.join(" AND ")})`, params };
}

/** Public visibility per family — the same rules as each family's public list
 * (approval, lifecycle, organisation active, venue gate). Counts never come
 * from listing_taxonomy alone. Returns null when the family is gated. */
export type ExperiencePageKind = "adventure" | "experience" | "event";

function publicJoinFor(family: Family, experienceKind?: ExperiencePageKind, eventsOn = false): { sql: string; params: unknown[] } | null {
  const today = irelandTodayIso();
  switch (family) {
    case "activity":
      return { sql: `JOIN games g ON lt.listing_type = 'game' AND g.id = lt.listing_id AND g.status = 'open' AND ${discoverableGameSql("g")} AND g.date >= ?`, params: [today] };
    case "circle":
      return { sql: `JOIN circles ci ON lt.listing_type = 'circle' AND ci.id = lt.listing_id AND ci.status = 'active' AND ci.join_mode IN ('open', 'approval')`, params: [] };
    case "experience": {
      // Adventures, Experiences and (Participation Phase 1) community Events are
      // separate pages over the same family. Events count only while
      // participation.events is on.
      const kindSql = experienceKind ? "e.kind = ?" : eventsOn ? "e.kind != 'volunteer'" : "e.kind NOT IN ('volunteer', 'event')";
      const gate = experienceKind === "event" && !eventsOn ? " AND 1 = 0" : "";
      return {
        sql: `JOIN experiences e ON lt.listing_type = 'experience' AND e.id = lt.listing_id AND e.status = 'approved' AND ${kindSql}${gate} AND ${orgActiveSql("e.vendor_id")}`,
        params: experienceKind ? [experienceKind] : [],
      };
    }
    case "volunteer":
      return { sql: `JOIN experiences e ON lt.listing_type = 'experience' AND e.id = lt.listing_id AND e.status = 'approved' AND e.kind = 'volunteer' AND ${orgActiveSql("e.vendor_id")}`, params: [] };
    case "programme":
      return {
        sql: `JOIN programs p ON lt.listing_type = 'program' AND p.id = lt.listing_id AND p.status = 'published' AND ${orgActiveSql("p.vendor_id")}
              AND EXISTS (SELECT 1 FROM program_sessions ps WHERE ps.program_id = p.id AND ps.status != 'cancelled' AND ps.date >= ?)`,
        params: [today],
      };
    case "club":
      return venuePagesPublic() ? { sql: `JOIN clubs cl ON lt.listing_type = 'club' AND cl.id = lt.listing_id AND cl.status = 'approved' AND ${orgActiveSql("cl.vendor_id")}`, params: [] } : null;
    case "venue":
      return venuePagesPublic() ? { sql: `JOIN centres ce ON lt.listing_type = 'centre' AND ce.id = lt.listing_id AND ce.status = 'approved' AND ${orgActiveSql("ce.vendor_id")}`, params: [] } : null;
  }
}

/** Live public counts per category and subcategory id for one family. */
export async function publicCounts(family: Family, experienceKind?: ExperiencePageKind): Promise<Map<string, number>> {
  const eventsOn = family === "experience" ? (await getSetting("participation.events", "false")) === "true" : false;
  const join = publicJoinFor(family, experienceKind, eventsOn);
  const counts = new Map<string, number>();
  if (!join) return counts;
  const rows = (await db
    .prepare(`SELECT lt.category_id as c, lt.subcategory_id as s, COUNT(*) as n FROM listing_taxonomy lt ${join.sql} GROUP BY lt.category_id, lt.subcategory_id`)
    .all(...join.params)) as { c: string; s: string | null; n: number | string }[];
  for (const r of rows) {
    const n = Number(r.n);
    counts.set(r.c, (counts.get(r.c) ?? 0) + n);
    if (r.s) counts.set(r.s, (counts.get(r.s) ?? 0) + n);
  }
  return counts;
}

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  imageUrl: string | null;
  families: Family[];
  count: number;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  subcategories: { id: string; slug: string; name: string; count: number }[];
}

function isLive(r: CategoryRow): boolean {
  return Number(r.active) === 1 && Number(r.discoverable) === 1 && !r.archived_at;
}

/** Public category list. With a family: only categories that apply to it AND
 * have live inventory there (or are featured). Without a family: counts
 * summed over every family the category applies to. */
export async function listPublicCategories(family: Family | null, experienceKind?: ExperiencePageKind): Promise<PublicCategory[]> {
  if ((await getSetting("categories_enabled", "1")) !== "1") return [];
  const index = await loadTaxonomy();
  const families: Family[] = family ? [family] : [...FAMILIES];
  const counts = new Map<string, number>();
  for (const f of families) for (const [k, n] of await publicCounts(f, f === "experience" ? experienceKind : undefined)) counts.set(k, (counts.get(k) ?? 0) + n);
  const rows = [...index.byId.values()];
  const out: PublicCategory[] = [];
  for (const cat of rows.filter((r) => !r.parent_id && isLive(r))) {
    const fams = familiesOf(cat);
    if (family && !fams.includes(family)) continue;
    const count = counts.get(cat.id) ?? 0;
    if (count === 0 && Number(cat.featured) !== 1) continue;
    out.push({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      imageUrl: cat.image_url,
      families: fams,
      count,
      featured: Number(cat.featured) === 1,
      seoTitle: cat.seo_title,
      seoDescription: cat.seo_description,
      subcategories: rows
        .filter((s) => s.parent_id === cat.id && isLive(s) && (counts.get(s.id) ?? 0) > 0)
        .map((s) => ({ id: s.id, slug: s.slug, name: s.name, count: counts.get(s.id) ?? 0 })),
    });
  }
  return out;
}

export interface PickerCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  subcategories: { id: string; name: string }[];
  /** Phase E — the organisation may only use some subcategories, so one must be chosen. */
  subcategoryRequired?: boolean;
}

/** Selectable options for a create/edit form: active, not archived, valid for the family. */
export async function pickerOptions(family: Family): Promise<PickerCategory[]> {
  const index = await loadTaxonomy();
  const rows = [...index.byId.values()];
  const ok = (r: CategoryRow) => Number(r.active) === 1 && !r.archived_at;
  return rows
    .filter((r) => !r.parent_id && ok(r) && familiesOf(r).includes(family))
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      subcategories: rows.filter((s) => s.parent_id === c.id && ok(s)).map((s) => ({ id: s.id, name: s.name })),
    }));
}

// --- Write validation -----------------------------------------------------------

export class TaxonomyValidationError extends Error {}

/**
 * Checks a submitted (categoryId, subcategoryId) for a listing. `undefined`
 * categoryId = field not sent (leave unchanged); `null`/"" = clear it.
 * An inactive or archived category may be KEPT on an existing listing (it
 * was valid when chosen) but never newly chosen.
 */
export async function validateAssignment(
  family: Family,
  categoryId: unknown,
  subcategoryId: unknown,
  current: { categoryId: string; subcategoryId: string | null } | null
): Promise<{ categoryId: string; subcategoryId: string | null } | null | undefined> {
  if (categoryId === undefined && subcategoryId === undefined) return undefined;
  if (categoryId === null || categoryId === "") return null;
  if (typeof categoryId !== "string" || (subcategoryId !== undefined && subcategoryId !== null && typeof subcategoryId !== "string")) {
    throw new TaxonomyValidationError("Category must be a category id");
  }
  const sub = typeof subcategoryId === "string" && subcategoryId !== "" ? subcategoryId : null;
  const index = await loadTaxonomy();
  const cat = index.byId.get(categoryId);
  if (!cat || cat.parent_id) throw new TaxonomyValidationError("Unknown category");
  if (!familiesOf(cat).includes(family)) throw new TaxonomyValidationError(`${cat.name} isn't available for this kind of listing`);
  const unchanged = current && current.categoryId === categoryId;
  if ((Number(cat.active) !== 1 || cat.archived_at) && !unchanged) throw new TaxonomyValidationError(`${cat.name} is no longer offered — choose another category`);
  if (sub) {
    const s = index.byId.get(sub);
    if (!s || s.parent_id !== cat.id) throw new TaxonomyValidationError("That subcategory doesn't belong to the chosen category");
    const subUnchanged = unchanged && current!.subcategoryId === sub;
    if ((Number(s.active) !== 1 || s.archived_at) && !subUnchanged) throw new TaxonomyValidationError(`${s.name} is no longer offered — choose another`);
  }
  return { categoryId: cat.id, subcategoryId: sub };
}

export async function setListingTaxonomy(
  type: TaxonomyListingType,
  id: string,
  value: { categoryId: string; subcategoryId: string | null } | null,
  assignedBy: "host" | "vendor" | "admin" | "backfill"
): Promise<void> {
  if (value === null) {
    await db.prepare(`DELETE FROM listing_taxonomy WHERE listing_type = ? AND listing_id = ?`).run(type, id);
    return;
  }
  await db
    .prepare(
      `INSERT INTO listing_taxonomy (listing_type, listing_id, category_id, subcategory_id, assigned_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), subcategory_id = VALUES(subcategory_id), assigned_by = VALUES(assigned_by), assigned_at = CURRENT_TIMESTAMP,
         needs_review = IF(VALUES(assigned_by) = 'admin', 0, needs_review)`
    )
    .run(type, id, value.categoryId, value.subcategoryId, assignedBy);
}

/**
 * One call for a create/edit route: validates body.categoryId/subcategoryId
 * against the listing's family and stores them. Throws
 * TaxonomyValidationError (→ 400) before anything is written when called
 * with `dryRun` first; routes call `checkListingCategoryBody` before their
 * own insert and `applyListingCategory` after it.
 */
export async function checkListingCategoryBody(
  type: TaxonomyListingType,
  listingId: string | null,
  body: Record<string, unknown>,
  experienceKind?: string | null
): Promise<{ categoryId: string; subcategoryId: string | null } | null | undefined> {
  const current = listingId ? await getListingTaxonomy(type, listingId) : null;
  return validateAssignment(familyOf(type, experienceKind), body.categoryId, body.subcategoryId, current);
}

export async function applyListingCategory(
  type: TaxonomyListingType,
  listingId: string,
  value: { categoryId: string; subcategoryId: string | null } | null | undefined,
  assignedBy: "host" | "vendor" | "admin"
): Promise<void> {
  if (value === undefined) return;
  await setListingTaxonomy(type, listingId, value, assignedBy);
}

// --- Tags ------------------------------------------------------------------------

export async function getListingTags(type: TaxonomyListingType, id: string): Promise<DiscoveryTag[]> {
  const rows = (await db.prepare(`SELECT attr FROM listing_attributes WHERE listing_type = ? AND listing_id = ?`).all(type, id)) as { attr: string }[];
  const set = new Set(rows.map((r) => r.attr));
  return DISCOVERY_TAGS.filter((t) => set.has(t));
}

/** Replaces only the discovery-tag rows; participation attributes are untouched. */
export async function setListingTags(type: TaxonomyListingType, id: string, values: unknown): Promise<DiscoveryTag[] | undefined> {
  if (values === undefined) return undefined;
  const tags = sanitizeTags(values);
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM listing_attributes WHERE listing_type = ? AND listing_id = ? AND attr IN (${DISCOVERY_TAGS.map(() => "?").join(",")})`).run(type, id, ...DISCOVERY_TAGS);
    for (const t of tags) await tx.prepare(`INSERT INTO listing_attributes (listing_type, listing_id, attr) VALUES (?, ?, ?)`).run(type, id, t);
  });
  return tags;
}

// --- Integrity --------------------------------------------------------------------

export interface IntegrityIssue {
  kind: "orphan_listing" | "unknown_category" | "wrong_family" | "subcategory_mismatch" | "depth";
  listingType?: string;
  listingId?: string;
  categoryId?: string;
  detail: string;
}

const TABLE_OF: Record<TaxonomyListingType, string> = { game: "games", experience: "experiences", program: "programs", circle: "circles", club: "clubs", centre: "centres" };

export async function integrityIssues(): Promise<IntegrityIssue[]> {
  const index = await loadTaxonomy();
  const issues: IntegrityIssue[] = [];
  for (const r of index.byId.values()) {
    if (!r.parent_id) continue;
    const parent = index.byId.get(r.parent_id);
    if (!parent) issues.push({ kind: "unknown_category", categoryId: r.id, detail: `Subcategory ${r.id} points at missing category ${r.parent_id}` });
    else if (parent.parent_id) issues.push({ kind: "depth", categoryId: r.id, detail: `${r.id} is nested more than two levels` });
  }
  const rows = (await db.prepare(`SELECT listing_type, listing_id, category_id, subcategory_id FROM listing_taxonomy`).all()) as { listing_type: string; listing_id: string; category_id: string; subcategory_id: string | null }[];
  const kinds = new Map(((await db.prepare(`SELECT id, kind FROM experiences`).all()) as { id: string; kind: string }[]).map((r) => [r.id, r.kind]));
  const existing = new Map<string, Set<string>>();
  for (const t of TAXONOMY_LISTING_TYPES) {
    existing.set(t, new Set(((await db.prepare(`SELECT id FROM ${TABLE_OF[t]}`).all()) as { id: string }[]).map((r) => String(r.id))));
  }
  for (const r of rows) {
    const base = { listingType: r.listing_type, listingId: r.listing_id, categoryId: r.category_id };
    if (!isTaxonomyListingType(r.listing_type) || !existing.get(r.listing_type)!.has(r.listing_id)) {
      issues.push({ ...base, kind: "orphan_listing", detail: `${r.listing_type} ${r.listing_id} no longer exists` });
      continue;
    }
    const cat = index.byId.get(r.category_id);
    if (!cat || cat.parent_id) {
      issues.push({ ...base, kind: "unknown_category", detail: `Category ${r.category_id} is missing or is a subcategory` });
      continue;
    }
    const fam = familyOf(r.listing_type, kinds.get(r.listing_id));
    if (!familiesOf(cat).includes(fam)) issues.push({ ...base, kind: "wrong_family", detail: `${cat.name} doesn't apply to ${fam}` });
    if (r.subcategory_id && index.byId.get(r.subcategory_id)?.parent_id !== r.category_id) {
      issues.push({ ...base, kind: "subcategory_mismatch", detail: `${r.subcategory_id} isn't under ${r.category_id}` });
    }
  }
  return issues;
}

export function listingTable(type: TaxonomyListingType): string {
  return TABLE_OF[type];
}

/** Fields every public detail response carries: `taxonomy` (breadcrumb) and discovery `tags`. */
export async function taxonomyFields(type: TaxonomyListingType, id: string): Promise<{ taxonomy: ListingTaxonomy | null; tags: DiscoveryTag[] }> {
  const [taxonomy, tags] = await Promise.all([getListingTaxonomy(type, id), getListingTags(type, id)]);
  return { taxonomy, tags };
}

/** Route helper: validates body.categoryId/subcategoryId for a create (listingId null) or
 * edit. Sends a 400 and returns false when invalid; otherwise the value to store
 * (undefined = not sent, leave unchanged). */
export async function categoryFromBody(
  res: { status: (code: number) => { json: (b: unknown) => unknown } },
  type: TaxonomyListingType,
  listingId: string | null,
  body: unknown,
  experienceKind?: string | null
): Promise<{ categoryId: string; subcategoryId: string | null } | null | undefined | false> {
  try {
    return await checkListingCategoryBody(type, listingId, (body ?? {}) as Record<string, unknown>, experienceKind);
  } catch (e) {
    if (e instanceof TaxonomyValidationError) {
      res.status(400).json({ error: e.message, field: "categoryId" });
      return false;
    }
    throw e;
  }
}
