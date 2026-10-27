// Read-only report of listings that have no category (category system,
// 2026-10-22): what the matcher read, what it would suggest, how confident,
// and why. Never writes anything — suggestions are for a person to approve
// in Admin → Categories → Uncategorised.
//
//   npx tsx src/scripts/categoryReport.ts            # hello_circle_dev only
//   npx tsx src/scripts/categoryReport.ts --allow-db=<name>   # any other database, named explicitly (e.g. a live inventory)
//
// Output: Markdown on stdout.
import "dotenv/config";

const allow = process.argv.find((a) => a.startsWith("--allow-db="))?.slice("--allow-db=".length);
const dbName = process.env.DB_NAME ?? "hello_circle";
if (dbName !== "hello_circle_dev" && dbName !== allow) {
  console.error(`Refusing to read "${dbName}". This report runs on hello_circle_dev, or on another database only with --allow-db=${dbName}.`);
  process.exit(1);
}

const { db } = await import("../db/index.js");
const { listingLabels, loadTaxonomy, suggestionFor, TAXONOMY_LISTING_TYPES } = await import("../taxonomy.js");

const TITLE: Record<string, string> = {
  game: "SELECT id, activity_label as title FROM games",
  experience: "SELECT id, title FROM experiences",
  program: "SELECT id, title FROM programs",
  circle: "SELECT id, name as title FROM circles",
  club: "SELECT id, name as title FROM clubs",
  centre: "SELECT id, name as title FROM centres",
};
const LABEL: Record<string, string> = { game: "Activity", experience: "Experience", program: "Programme", circle: "Circle", club: "Club", centre: "Venue" };

const index = await loadTaxonomy();
const assigned = new Set(((await db.prepare(`SELECT listing_type, listing_id FROM listing_taxonomy`).all()) as { listing_type: string; listing_id: string }[]).map((r) => `${r.listing_type}:${r.listing_id}`));
const titles = new Map<string, string>();
for (const t of TAXONOMY_LISTING_TYPES) for (const r of (await db.prepare(TITLE[t]).all()) as { id: string; title: string }[]) titles.set(`${t}:${r.id}`, r.title);

const rows = (await listingLabels()).filter((l) => !assigned.has(`${l.type}:${l.id}`));
const name = (id: string | null) => (id ? index.byId.get(id)?.name ?? id : "—");
const esc = (s: string) => s.replace(/\|/g, "\\|");

console.log(`# Uncategorised listings — ${dbName}\n`);
console.log(`Generated ${new Date().toISOString().slice(0, 16)}Z. Read-only; nothing was assigned. Every row needs a person to approve it.\n`);
const counts = { medium: 0, low: 0, none: 0 };
console.log("| # | Type | Listing ID | Title | Existing classification (text read) | Suggested category | Suggested subcategory | Confidence | Reason | Manual approval |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
rows.forEach((l, i) => {
  const s = suggestionFor(index, l);
  counts[s.confidence] += 1;
  const existing = [...l.labels.filter(Boolean), ...(l.parentSport ? [`parent club sport: ${l.parentSport}`] : [])].join(" · ");
  const candidates = s.candidates.length > 1 ? ` (candidates: ${s.candidates.map(name).join(", ")})` : "";
  console.log(
    `| ${i + 1} | ${LABEL[l.type]} | \`${l.id}\` | ${esc(titles.get(`${l.type}:${l.id}`) ?? "")} | ${esc(existing) || "—"} | ${name(s.categoryId)}${candidates} | ${name(s.subcategoryId)} | ${s.confidence} | ${esc(s.reason)} | Yes |`
  );
});
console.log(`\n**Totals:** ${rows.length} listings — ${counts.medium} medium (one clear suggestion), ${counts.low} low (several candidates or a review-only word), ${counts.none} none (no suggestion).`);
process.exit(0);
