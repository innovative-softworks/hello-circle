import { Router, type Request, type Response } from "express";
import { assertPlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { getListingAttributes, setListingAttributes } from "../listingAttributes.js";

export const vendorParticipationRouter = Router();

// "Participation experience" editor (community participation upgrade,
// Release 2) — host-selected attributes plus the what-to-expect fields each
// vendor listing type was missing. Deliberately its own small endpoint
// rather than more fields on the existing program/experience/club PUTs:
// those are big multi-section forms, and keeping this separate means these
// fields can never be clobbered by (or clobber) a save of the main form.
// Mounted under routes/vendor.ts, so requireVendor/attachVendorIds already
// ran; ownership and role gating mirror each type's own edit route exactly.

type VendorListingType = "program" | "experience" | "club";

// Which what-to-expect columns each type accepts through this editor.
const FIELDS: Record<VendorListingType, { key: "arrivalInstructions" | "accessibilityInfo"; column: string }[]> = {
  program: [
    { key: "arrivalInstructions", column: "arrival_instructions" },
    { key: "accessibilityInfo", column: "accessibility_info" },
  ],
  experience: [{ key: "accessibilityInfo", column: "accessibility_info" }],
  club: [],
};
const TABLE: Record<VendorListingType, string> = { program: "programs", experience: "experiences", club: "clubs" };

/** Owns + role check; sends the error response itself and returns false on failure. */
async function authorize(req: Request, res: Response, type: VendorListingType, id: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id as vendorId${type === "program" ? ", listing_type as listingType" : ""} FROM ${TABLE[type]} WHERE id = ?`).get(id)) as
    | { vendorId: string; listingType?: "centre" | "club" }
    | undefined;
  if (!row || !req.vendorIds!.includes(row.vendorId)) {
    res.status(403).json({ error: "Not your listing" });
    return false;
  }
  if (type === "program") return assertPlatformRole(req, res, row.listingType === "centre" ? "centre_manager" : "facility_manager");
  if (type === "experience") return assertPlatformRole(req, res, "centre_manager", "facility_manager");
  return assertPlatformRole(req, res, "facility_manager");
}

function parseType(raw: string): VendorListingType | null {
  return raw === "program" || raw === "experience" || raw === "club" ? raw : null;
}

async function readFields(type: VendorListingType, id: string): Promise<Record<string, string | null>> {
  const fields = FIELDS[type];
  const cols = [...fields.map((f) => f.column), "circle_id"];
  const row = (await db.prepare(`SELECT ${cols.join(", ")} FROM ${TABLE[type]} WHERE id = ?`).get(id)) as Record<string, string | null>;
  return { ...Object.fromEntries(fields.map((f) => [f.key, row?.[f.column] ?? ""])), circleId: row?.circle_id ?? null };
}

// Circles this vendor's org may name as a listing's official Circle
// (Release 3): ones organised by a resident account linked to any user in
// the org (users.resident_id — the HelloCircle Manage bridge). A vendor
// can't attach someone else's Circle just by knowing its id.
async function linkableCircles(vendorIds: string[]): Promise<{ id: string; name: string; slug: string | null }[]> {
  if (!vendorIds.length) return [];
  return (await db
    .prepare(
      `SELECT DISTINCT c.id, c.name, c.slug FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id AND cm.role = 'organiser'
       JOIN users u ON u.resident_id = cm.resident_id
       WHERE u.id IN (${vendorIds.map(() => "?").join(", ")}) AND c.status = 'active'
       ORDER BY c.name`
    )
    .all(...vendorIds)) as { id: string; name: string; slug: string | null }[];
}

vendorParticipationRouter.get("/participation/circles", async (req, res) => {
  res.json(await linkableCircles(req.vendorIds!));
});

vendorParticipationRouter.get("/participation/:type/:id", async (req, res) => {
  const type = parseType(req.params.type);
  if (!type) return res.status(400).json({ error: "type must be program, experience or club" });
  if (!(await authorize(req, res, type, req.params.id))) return;
  res.json({ attributes: await getListingAttributes(type, req.params.id), ...(await readFields(type, req.params.id)) });
});

vendorParticipationRouter.put("/participation/:type/:id", async (req, res) => {
  const type = parseType(req.params.type);
  if (!type) return res.status(400).json({ error: "type must be program, experience or club" });
  if (!(await authorize(req, res, type, req.params.id))) return;
  const b = req.body as { attributes?: unknown; arrivalInstructions?: string; accessibilityInfo?: string; circleId?: string | null };

  if (b.circleId !== undefined) {
    if (b.circleId !== null && !(await linkableCircles(req.vendorIds!)).some((c) => c.id === b.circleId)) {
      return res.status(403).json({ error: "You can only link a Circle organised by someone in your organisation" });
    }
    await db.prepare(`UPDATE ${TABLE[type]} SET circle_id = ? WHERE id = ?`).run(b.circleId, req.params.id);
  }
  if (b.attributes !== undefined) await setListingAttributes(type, req.params.id, b.attributes);
  // Only the fields this type supports, and only those actually sent —
  // "" clears, omitted leaves the stored value alone.
  const sent = FIELDS[type].filter((f) => typeof b[f.key] === "string");
  if (sent.length) {
    await db
      .prepare(`UPDATE ${TABLE[type]} SET ${sent.map((f) => `${f.column} = ?`).join(", ")} WHERE id = ?`)
      .run(...sent.map((f) => (b[f.key] as string).trim().slice(0, 2000) || null), req.params.id);
  }
  res.json({ attributes: await getListingAttributes(type, req.params.id), ...(await readFields(type, req.params.id)) });
});
