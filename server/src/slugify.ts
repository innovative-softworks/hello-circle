import { db } from "./db/index.js";

// Slugs (master-prompt punch list #1) — lowercase, hyphenated, ASCII-only.
// Uniqueness is enforced here (check-then-insert with a short random
// suffix on collision), not a DB constraint — see db/index.ts's own note
// on why a formal UNIQUE index isn't worth it at this table's scale.

export function slugifyBase(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const SLUG_TABLES = ["centres", "clubs", "experiences", "circles"] as const;
export type SlugTable = (typeof SLUG_TABLES)[number];

/** Generates a unique slug for a new row of the given table, checking
 * against every other slug already in that table. Never throws — a
 * degenerate title (empty after stripping) still gets a usable slug via
 * the random suffix alone. */
export async function generateSlug(table: SlugTable, name: string): Promise<string> {
  const base = slugifyBase(name) || "listing";
  let candidate = base;
  let attempt = 0;
  while (true) {
    const existing = await db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(candidate);
    if (!existing) return candidate;
    attempt += 1;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (attempt > 5) return `${base}-${Date.now().toString(36)}`;
  }
}

/** One-off backfill for rows created before slugs existed (seed data,
 * anything inserted directly) — run once at boot, skips any row that
 * already has a slug. Cheap at this table's scale (tens of rows). */
export async function backfillSlugs(): Promise<void> {
  for (const table of SLUG_TABLES) {
    const nameColumn = table === "experiences" ? "title" : "name";
    const rows = (await db.prepare(`SELECT id, ${nameColumn} as name FROM ${table} WHERE slug IS NULL OR slug = ''`).all()) as {
      id: string;
      name: string;
    }[];
    for (const row of rows) {
      const slug = await generateSlug(table, row.name);
      await db.prepare(`UPDATE ${table} SET slug = ? WHERE id = ?`).run(slug, row.id);
    }
  }
}
