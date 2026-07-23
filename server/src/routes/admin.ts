import crypto from "node:crypto";
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- platform stats ----------------------------------------------------

adminRouter.get("/stats", (_req, res) => {
  const centresPending = db.prepare(`SELECT COUNT(*) as n FROM centres WHERE status = 'pending'`).get() as { n: number };
  const clubsPending = db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE status = 'pending'`).get() as { n: number };
  const vendorCount = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'vendor'`).get() as { n: number };
  const totalListings = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM centres WHERE status != 'deleted') +
        (SELECT COUNT(*) FROM clubs WHERE status != 'deleted') as n`
    )
    .get() as { n: number };
  const reviewCount = db.prepare(`SELECT COUNT(*) as n FROM reviews`).get() as { n: number };

  res.json({
    centresPending: centresPending.n,
    clubsPending: clubsPending.n,
    vendorCount: vendorCount.n,
    totalListings: totalListings.n,
    reviewCount: reviewCount.n,
  });
});

// --- vendor management -------------------------------------------------

adminRouter.get("/vendors", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, email, name, status, created_at as createdAt,
              (SELECT COUNT(*) FROM centres WHERE vendor_id = users.id) as centreCount,
              (SELECT COUNT(*) FROM clubs WHERE vendor_id = users.id) as clubCount
       FROM users WHERE role = 'vendor' ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/vendors/:id/status", (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved or suspended" });
  }
  const info = db.prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'vendor'`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  res.json({ ok: true });
});

// --- listing moderation --------------------------------------------------

adminRouter.get("/listings/pending", (_req, res) => {
  const centres = db
    .prepare(
      `SELECT c.id, c.name, c.status, u.email as vendorEmail, u.name as vendorName
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  const clubs = db
    .prepare(
      `SELECT c.id, c.name, c.status, u.email as vendorEmail, u.name as vendorName
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  res.json({ centres, clubs });
});

adminRouter.get("/listings", (_req, res) => {
  const centres = db
    .prepare(
      `SELECT c.id, c.name, c.status, u.email as vendorEmail
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY c.name`
    )
    .all();
  const clubs = db
    .prepare(
      `SELECT c.id, c.name, c.status, u.email as vendorEmail
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY c.name`
    )
    .all();
  res.json({ centres, clubs });
});

adminRouter.put("/centres/:id/status", (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const info = db.prepare(`UPDATE centres SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json(getCentre(req.params.id));
});

adminRouter.put("/clubs/:id/status", (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const info = db.prepare(`UPDATE clubs SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json(getClub(req.params.id));
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

adminRouter.put("/centres/:id", (req, res) => {
  const b = req.body as CentreInput;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb)
       WHERE id = ?`
    ).run(b.name, b.area, b.county, b.capacity, b.from, b.managedBy, b.image, b.blurb, req.params.id);
    if (b.amenities) {
      db.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(req.params.id);
      b.amenities.forEach((a, i) =>
        db
          .prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`)
          .run(req.params.id, a, i)
      );
    }
  });
  tx();
  const centre = getCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  res.json(centre);
});

adminRouter.delete("/centres/:id", (req, res) => {
  const info = db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
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

adminRouter.put("/clubs/:id", (req, res) => {
  const b = req.body as ClubInput;
  const tx = db.transaction(() => {
    db.prepare(
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
      db.prepare(`DELETE FROM club_includes WHERE club_id = ?`).run(req.params.id);
      b.includes.forEach((item, i) =>
        db.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(req.params.id, item, i)
      );
    }
  });
  tx();
  const club = getClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });
  res.json(club);
});

adminRouter.delete("/clubs/:id", (req, res) => {
  const info = db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json({ ok: true });
});

adminRouter.delete("/centres/:centreId/rooms/:roomId", (req, res) => {
  const info = db
    .prepare(`DELETE FROM rooms WHERE centre_id = ? AND id = ?`)
    .run(req.params.centreId, req.params.roomId);
  if (info.changes === 0) return res.status(404).json({ error: "Room not found" });
  res.json(getCentre(req.params.centreId));
});

// --- review moderation -----------------------------------------------------

adminRouter.get("/reviews", (_req, res) => {
  const rows = db.prepare(`SELECT * FROM reviews ORDER BY created_at DESC`).all();
  res.json(rows);
});

adminRouter.put("/reviews/:id/unhide", (req, res) => {
  const info = db.prepare(`UPDATE reviews SET hidden = 0 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found" });
  res.json({ ok: true });
});

// Room id generation for admin-created rooms on any centre (parity with vendor route).
adminRouter.post("/centres/:id/rooms", (req, res) => {
  const b = req.body as { name?: string; cap?: number; rate?: number; desc?: string };
  if (!b.name || !b.cap || !b.rate) return res.status(400).json({ error: "name, cap and rate are required" });
  const centre = getCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });

  const roomId = crypto.randomUUID();
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM rooms WHERE centre_id = ?`).get(req.params.id) as {
    count: number;
  };
  db.prepare(
    `INSERT INTO rooms (id, centre_id, name, cap, rate, desc, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(roomId, req.params.id, b.name, b.cap, b.rate, b.desc ?? "", count);
  res.status(201).json(getCentre(req.params.id));
});

// --- coupons (platform-wide, admin-managed discount codes) -----------------

interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

adminRouter.get("/coupons", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, code, kind, amount, max_uses as maxUses, used_count as usedCount,
              expires_at as expiresAt, active, created_at as createdAt
       FROM coupons ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.post("/coupons", (req, res) => {
  const b = req.body as CouponInput;
  if (!b.code || !b.kind || !b.amount) return res.status(400).json({ error: "code, kind and amount are required" });
  if (!["percent", "fixed"].includes(b.kind)) return res.status(400).json({ error: "kind must be percent or fixed" });
  if (b.kind === "percent" && (b.amount <= 0 || b.amount > 100)) return res.status(400).json({ error: "Percent amount must be 1-100" });

  const code = b.code.trim().toUpperCase();
  try {
    db.prepare(
      `INSERT INTO coupons (code, kind, amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(code, b.kind, b.amount, b.maxUses ?? null, b.expiresAt ?? null);
  } catch {
    return res.status(409).json({ error: "That code already exists" });
  }
  res.status(201).json({ ok: true });
});

adminRouter.put("/coupons/:id/active", (req, res) => {
  const { active } = req.body as { active?: boolean };
  const info = db.prepare(`UPDATE coupons SET active = ? WHERE id = ?`).run(active ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

adminRouter.delete("/coupons/:id", (req, res) => {
  const info = db.prepare(`DELETE FROM coupons WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});
