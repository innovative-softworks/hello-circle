import crypto from "node:crypto";
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { endOfIrelandDay } from "../irelandTime.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- platform stats ----------------------------------------------------

adminRouter.get("/stats", async (_req, res) => {
  const centresPending = (await db.prepare(`SELECT COUNT(*) as n FROM centres WHERE status = 'pending'`).get()) as { n: number };
  const clubsPending = (await db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE status = 'pending'`).get()) as { n: number };
  const vendorCount = (await db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'vendor'`).get()) as { n: number };
  const totalListings = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM centres WHERE status != 'deleted') +
        (SELECT COUNT(*) FROM clubs WHERE status != 'deleted') as n`
    )
    .get()) as { n: number };
  const reviewCount = (await db.prepare(`SELECT COUNT(*) as n FROM reviews`).get()) as { n: number };

  res.json({
    centresPending: centresPending.n,
    clubsPending: clubsPending.n,
    vendorCount: vendorCount.n,
    totalListings: totalListings.n,
    reviewCount: reviewCount.n,
  });
});

// --- vendor management -------------------------------------------------

adminRouter.get("/vendors", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, email, name, status, created_at as createdAt,
              vendor_type as vendorType, business_name as businessName, address, county, mobile, landline, description,
              (SELECT COUNT(*) FROM centres WHERE vendor_id = users.id) as centreCount,
              (SELECT COUNT(*) FROM clubs WHERE vendor_id = users.id) as clubCount
       FROM users WHERE role = 'vendor' ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/vendors/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved or suspended" });
  }
  // Vendor account approval and listing approval are deliberately separate
  // steps: approving the account only lets the vendor log in and finish
  // setting up their listing (rooms/price/photos/etc) — the listing itself
  // still needs its own admin review once that setup is done.
  const info = await db.prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'vendor'`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  res.json({ ok: true });
});

// --- listing moderation --------------------------------------------------

const PENDING_CENTRE_COLUMNS = `c.id, c.name, c.status, c.area, c.county, c.capacity, c.from_price as \`from\`, c.managed_by as managedBy,
              c.ph, c.image_url as image, c.blurb, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus`;
const PENDING_CLUB_COLUMNS = `c.id, c.name, c.status, c.sport, c.area, c.county, c.ages, c.price, c.unit,
              c.ph, c.image_url as image, c.blurb, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus`;

adminRouter.get("/listings/pending", async (_req, res) => {
  const centres = await db
    .prepare(
      `SELECT ${PENDING_CENTRE_COLUMNS}
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  const clubs = await db
    .prepare(
      `SELECT ${PENDING_CLUB_COLUMNS}
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  res.json({ centres, clubs });
});

adminRouter.get("/listings", async (_req, res) => {
  const centres = await db
    .prepare(
      `SELECT ${PENDING_CENTRE_COLUMNS}
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY c.name`
    )
    .all();
  const clubs = await db
    .prepare(
      `SELECT ${PENDING_CLUB_COLUMNS}
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY c.name`
    )
    .all();
  res.json({ centres, clubs });
});

/** A listing can't go live before the vendor account behind it has been
 * vetted — mirrors the "Approve" button being disabled client-side in
 * AdminDashboard.tsx. Grandfathered listings with no vendor (vendor_id
 * NULL) are exempt, matching how they're already treated as pre-approved
 * elsewhere. */
async function vendorNotApprovedFor(table: "centres" | "clubs", id: string): Promise<boolean> {
  const row = (await db
    .prepare(`SELECT u.status FROM ${table} c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.id = ?`)
    .get(id)) as { status: string | null } | undefined;
  return !!row?.status && row.status !== "approved";
}

adminRouter.put("/centres/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status === "approved" && (await vendorNotApprovedFor("centres", req.params.id))) {
    return res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
  }
  const info = await db.prepare(`UPDATE centres SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json(await getCentre(req.params.id));
});

adminRouter.put("/clubs/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status === "approved" && (await vendorNotApprovedFor("clubs", req.params.id))) {
    return res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
  }
  const info = await db.prepare(`UPDATE clubs SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json(await getClub(req.params.id));
});

// --- listing claims ----------------------------------------------------------
// A vendor's request to take ownership of a listing with no owner yet
// (vendor_id IS NULL — see routes/vendor.ts's POST /claims). Approving one
// sets vendor_id on the listing; this is ownership, not the listing's own
// publication status handled above.

adminRouter.get("/claims", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT cl.id, cl.listing_type as listingType, cl.listing_id as listingId, cl.message, cl.status, cl.created_at as createdAt,
              u.id as vendorId, u.name as vendorName, u.email as vendorEmail, u.status as vendorStatus,
              COALESCE(c.name, cb.name) as listingName
       FROM listing_claims cl
       JOIN users u ON u.id = cl.vendor_id
       LEFT JOIN centres c ON cl.listing_type = 'centre' AND c.id = cl.listing_id
       LEFT JOIN clubs cb ON cl.listing_type = 'club' AND cb.id = cl.listing_id
       WHERE cl.status = 'pending'
       ORDER BY cl.created_at`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/claims/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be approved or rejected" });
  }

  const claim = (await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId, vendor_id as vendorId, status FROM listing_claims WHERE id = ?`)
    .get(req.params.id)) as { listingType: "centre" | "club"; listingId: string; vendorId: string; status: string } | undefined;
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  if (claim.status !== "pending") return res.status(409).json({ error: "This claim has already been decided" });

  if (status === "rejected") {
    await db.prepare(`UPDATE listing_claims SET status = 'rejected', decided_at = NOW() WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true });
  }

  // Same guard as listing-status approval: the claiming vendor's own account
  // has to be approved before their claim can be.
  const vendor = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(claim.vendorId)) as { status: string } | undefined;
  if (!vendor || vendor.status !== "approved") {
    return res.status(409).json({ error: "Approve the vendor's account before approving their claim" });
  }

  const table = claim.listingType === "centre" ? "centres" : "clubs";
  try {
    await db.transaction(async (tx) => {
      // vendor_id IS NULL guard: if the listing got claimed by someone else
      // since this claim was submitted, this affects 0 rows and the whole
      // approval rolls back instead of silently overwriting the real owner.
      const result = await tx.prepare(`UPDATE ${table} SET vendor_id = ? WHERE id = ? AND vendor_id IS NULL`).run(claim.vendorId, claim.listingId);
      if (result.changes === 0) throw new Error("ALREADY_CLAIMED");
      await tx.prepare(`UPDATE listing_claims SET status = 'approved', decided_at = NOW() WHERE id = ?`).run(req.params.id);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_CLAIMED") {
      return res.status(409).json({ error: "This listing has already been claimed by another vendor" });
    }
    throw e;
  }
  res.json({ ok: true });
});

// --- full CRUD on any listing (edit/delete regardless of owner) ------------

interface CentreInput {
  name?: string;
  area?: string;
  county?: string;
  capacity?: number;
  from?: number;
  managedBy?: string;
  image?: string;
  blurb?: string;
  amenities?: string[];
}

adminRouter.put("/centres/:id", async (req, res) => {
  const b = req.body as CentreInput;
  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb)
       WHERE id = ?`
    ).run(b.name, b.area, b.county, b.capacity, b.from, b.managedBy, b.image, b.blurb, req.params.id);
    if (b.amenities) {
      await tx.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(req.params.id);
      for (const [i, a] of b.amenities.entries()) {
        await tx.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(req.params.id, a, i);
      }
    }
  });
  const centre = await getCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  res.json(centre);
});

adminRouter.delete("/centres/:id", async (req, res) => {
  const info = await db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json({ ok: true });
});

interface ClubInput {
  name?: string;
  sport?: string;
  area?: string;
  county?: string;
  ages?: string;
  price?: number;
  unit?: string;
  trial?: boolean;
  image?: string;
  blurb?: string;
  includes?: string[];
}

adminRouter.put("/clubs/:id", async (req, res) => {
  const b = req.body as ClubInput;
  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE clubs SET name = COALESCE(?, name), sport = COALESCE(?, sport), area = COALESCE(?, area),
       county = COALESCE(?, county), ages = COALESCE(?, ages), price = COALESCE(?, price), unit = COALESCE(?, unit),
       trial = COALESCE(?, trial), image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb)
       WHERE id = ?`
    ).run(
      b.name,
      b.sport,
      b.area,
      b.county,
      b.ages,
      b.price,
      b.unit,
      b.trial === undefined ? undefined : b.trial ? 1 : 0,
      b.image,
      b.blurb,
      req.params.id
    );
    if (b.includes) {
      await tx.prepare(`DELETE FROM club_includes WHERE club_id = ?`).run(req.params.id);
      for (const [i, item] of b.includes.entries()) {
        await tx.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(req.params.id, item, i);
      }
    }
  });
  const club = await getClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });
  res.json(club);
});

adminRouter.delete("/clubs/:id", async (req, res) => {
  const info = await db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json({ ok: true });
});

// --- review moderation -----------------------------------------------------

adminRouter.get("/reviews", async (_req, res) => {
  const rows = await db.prepare(`SELECT * FROM reviews ORDER BY created_at DESC`).all();
  res.json(rows);
});

adminRouter.put("/reviews/:id/unhide", async (req, res) => {
  const info = await db.prepare(`UPDATE reviews SET hidden = 0 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found" });
  res.json({ ok: true });
});

// --- coupons (platform-wide, admin-managed discount codes) -----------------

interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

adminRouter.get("/coupons", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, code, kind, amount, max_uses as maxUses, used_count as usedCount,
              expires_at as expiresAt, active, created_at as createdAt
       FROM coupons ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.post("/coupons", async (req, res) => {
  const b = req.body as CouponInput;
  if (!b.code || !b.kind || !b.amount) return res.status(400).json({ error: "code, kind and amount are required" });
  if (!["percent", "fixed"].includes(b.kind)) return res.status(400).json({ error: "kind must be percent or fixed" });
  if (b.kind === "percent" && (b.amount <= 0 || b.amount > 100)) return res.status(400).json({ error: "Percent amount must be 1-100" });

  const code = b.code.trim().toUpperCase();
  // The admin picks a plain calendar date ("expires 25 Dec") — that should
  // mean valid through the end of that day in Ireland, not midnight UTC.
  const expiresAt = b.expiresAt ? endOfIrelandDay(b.expiresAt) : null;
  try {
    await db.prepare(
      `INSERT INTO coupons (code, kind, amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(code, b.kind, b.amount, b.maxUses ?? null, expiresAt);
  } catch {
    return res.status(409).json({ error: "That code already exists" });
  }
  res.status(201).json({ ok: true });
});

adminRouter.put("/coupons/:id/active", async (req, res) => {
  const { active } = req.body as { active?: boolean };
  const info = await db.prepare(`UPDATE coupons SET active = ? WHERE id = ?`).run(active ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

adminRouter.delete("/coupons/:id", async (req, res) => {
  const info = await db.prepare(`DELETE FROM coupons WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

// --- multi-tenant org hierarchy scaffolding (FUTURE, best-effort) ----------
// Data-model only — no tenant isolation is enforced anywhere else in the app
// (every query is still platform-wide). See plan doc "Not yet" section.

adminRouter.get("/organisations", async (_req, res) => {
  const rows = await db.prepare(`SELECT id, name, kind, created_at as createdAt FROM organisations ORDER BY name`).all();
  res.json(rows);
});

adminRouter.post("/organisations", async (req, res) => {
  const { name, kind } = req.body as { name?: string; kind?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, ?)`).run(id, name, kind ?? "council");
  res.status(201).json({ id });
});

adminRouter.put("/centres/:id/organisation", async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const info = await db.prepare(`UPDATE centres SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json({ ok: true });
});

adminRouter.put("/clubs/:id/organisation", async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const info = await db.prepare(`UPDATE clubs SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json({ ok: true });
});

// --- RBAC + marketplace-tier scaffolding (FUTURE, best-effort) -------------

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"];

adminRouter.put("/vendors/:id/platform-role", async (req, res) => {
  const { platformRole } = req.body as { platformRole: string | null };
  if (platformRole !== null && !PLATFORM_ROLES.includes(platformRole)) {
    return res.status(400).json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(", ")}, or null` });
  }
  const info = await db.prepare(`UPDATE users SET platform_role = ? WHERE id = ? AND role = 'vendor'`).run(platformRole, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  res.json({ ok: true });
});

adminRouter.put("/vendors/:id/provider-tier", async (req, res) => {
  const { providerTier } = req.body as { providerTier?: string };
  if (!providerTier || !["standard", "verified", "featured"].includes(providerTier)) {
    return res.status(400).json({ error: "providerTier must be standard, verified or featured" });
  }
  const info = await db.prepare(`UPDATE users SET provider_tier = ? WHERE id = ? AND role = 'vendor'`).run(providerTier, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  res.json({ ok: true });
});

// --- demand intelligence (NEXT) — platform-wide view ------------------------

adminRouter.get("/demand", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT query_text as queryText, county, COUNT(*) as count, MAX(created_at) as lastSeenAt
       FROM search_misses GROUP BY query_text, county ORDER BY count DESC LIMIT 50`
    )
    .all();
  res.json(rows);
});
