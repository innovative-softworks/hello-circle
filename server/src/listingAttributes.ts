import { db } from "./db/index.js";
import { PARTICIPATION_ATTRIBUTES, sanitizeAttributes, type ParticipationAttribute } from "./participationVocab.js";

// Host-selected participation attributes (Release 2) — one polymorphic
// table for every listing type rather than a comma-joined column per table,
// because Release 4's For You scoring and filters need to query them. Same
// listing_type/listing_id shape as reviews/favourites; no FK (none anywhere
// in this schema — see CLAUDE.md).

export type AttributeListingType = "game" | "program" | "experience" | "club";

export async function getListingAttributes(type: AttributeListingType, id: string): Promise<ParticipationAttribute[]> {
  const rows = (await db.prepare(`SELECT attr FROM listing_attributes WHERE listing_type = ? AND listing_id = ?`).all(type, id)) as { attr: string }[];
  const set = new Set(rows.map((r) => r.attr));
  // Canonical order (the display priority), not insertion order.
  return PARTICIPATION_ATTRIBUTES.filter((a) => set.has(a));
}

/** Replaces the whole set — the editor always sends every selected value. */
export async function setListingAttributes(type: AttributeListingType, id: string, values: unknown): Promise<ParticipationAttribute[]> {
  const attrs = sanitizeAttributes(values);
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM listing_attributes WHERE listing_type = ? AND listing_id = ?`).run(type, id);
    for (const attr of attrs) {
      await tx.prepare(`INSERT INTO listing_attributes (listing_type, listing_id, attr) VALUES (?, ?, ?)`).run(type, id, attr);
    }
  });
  return attrs;
}

/** Official-Circle summary for a listing's public detail response (Release
 * 3) — same circleId/circleName/circleSlug shape games already return.
 * Nulls when unset or the Circle is no longer active. */
export async function officialCircleSummary(table: "programs" | "experiences" | "clubs", id: string): Promise<{ circleId: string | null; circleName: string | null; circleSlug: string | null }> {
  const row = (await db
    .prepare(`SELECT c.id, c.name, c.slug FROM ${table} l JOIN circles c ON c.id = l.circle_id AND c.status = 'active' WHERE l.id = ?`)
    .get(id)) as { id: string; name: string; slug: string | null } | undefined;
  return { circleId: row?.id ?? null, circleName: row?.name ?? null, circleSlug: row?.slug ?? null };
}
