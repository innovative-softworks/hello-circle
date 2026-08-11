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
