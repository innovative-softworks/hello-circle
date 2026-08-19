import { db } from "../db/index.js";

// Shared across every vendor* route file — split out of the original
// single vendor.ts (see CLAUDE.md) so each domain file can import just what
// it needs without re-declaring these.

export function inClause(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

export async function ownsCentre(vendorIds: string[], centreId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(centreId)) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && !!row.vendor_id && vendorIds.includes(row.vendor_id);
}

export async function ownsClub(vendorIds: string[], clubId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(clubId)) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && !!row.vendor_id && vendorIds.includes(row.vendor_id);
}

export async function ownsListing(vendorIds: string[], listingType: "centre" | "club", listingId: string): Promise<boolean> {
  return listingType === "centre" ? ownsCentre(vendorIds, listingId) : ownsClub(vendorIds, listingId);
}

/** centres.capacity/from_price are a rollup over active rooms (MAX
 * capacity, MIN rate) — "cheapest/largest room" is what every read surface
 * (CentreCard, DiscoveryMap, Browse's price sort, admin's listing facts)
 * already displays as a single scalar. Every centre always has >= 1 active
 * room (enforced by the "last active room" guard in the rooms PUT handler
 * in vendorListings.ts, plus the zero-rooms backfill in initSchema()), so
 * this never runs over an empty set. */
export async function recomputeCentreRollup(centreId: string): Promise<void> {
  const row = (await db
    .prepare(`SELECT MAX(cap) as capacity, MIN(rate) as fromPrice FROM rooms WHERE centre_id = ? AND active = 1`)
    .get(centreId)) as { capacity: number | null; fromPrice: number | null };
  if (row.capacity === null || row.fromPrice === null) return;
  await db.prepare(`UPDATE centres SET capacity = ?, from_price = ? WHERE id = ?`).run(row.capacity, row.fromPrice, centreId);
}
