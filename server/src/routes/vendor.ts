import crypto from "node:crypto";
import { Router } from "express";
import { requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";

export const vendorRouter = Router();
vendorRouter.use(requireVendor);

// --- helpers -----------------------------------------------------------

function ownsCentre(vendorId: string, centreId: string): boolean {
  const row = db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(centreId) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && row.vendor_id === vendorId;
}

function ownsClub(vendorId: string, clubId: string): boolean {
  const row = db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(clubId) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && row.vendor_id === vendorId;
}

// --- listings overview ---------------------------------------------------

vendorRouter.get("/listings", (req, res) => {
  const centres = db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt,
              (SELECT COUNT(*) FROM bookings b WHERE b.centre_id = c.id AND b.payment_status = 'paid') as bookingsCount
       FROM centres c WHERE c.vendor_id = ? ORDER BY c.name`
    )
    .all(req.user!.id);
  const clubs = db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt,
              (SELECT COUNT(*) FROM registrations r WHERE r.club_id = c.id AND r.payment_status = 'paid') as bookingsCount
       FROM clubs c WHERE c.vendor_id = ? ORDER BY c.name`
    )
    .all(req.user!.id);
  res.json({ centres, clubs });
});

vendorRouter.get("/stats", (req, res) => {
  const vendorId = req.user!.id;
  const centresLive = db
    .prepare(`SELECT COUNT(*) as n FROM centres WHERE vendor_id = ? AND status = 'approved'`)
    .get(vendorId) as { n: number };
  const clubsLive = db
    .prepare(`SELECT COUNT(*) as n FROM clubs WHERE vendor_id = ? AND status = 'approved'`)
    .get(vendorId) as { n: number };
  const totalBookings = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid') +
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? AND r.payment_status = 'paid') as n`
    )
    .get(vendorId, vendorId) as { n: number };
  const totalViews = db
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(views), 0) FROM centres WHERE vendor_id = ?) +
        (SELECT COALESCE(SUM(views), 0) FROM clubs WHERE vendor_id = ?) as n`
    )
    .get(vendorId, vendorId) as { n: number };
  res.json({
    centresLive: centresLive.n,
    clubsLive: clubsLive.n,
    totalBookings: totalBookings.n,
    totalViews: totalViews.n,
  });
});

// --- centres ---------------------------------------------------------------

vendorRouter.get("/centres/:id", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  res.json(getCentre(req.params.id));
});

interface CentreInput {
  name: string;
  area: string;
  county: string;
  capacity: number;
  from: number;
  managedBy: string;
  image?: string;
  images?: string[];
  blurb: string;
  amenities?: string[];
  opensAt?: string;
  closesAt?: string;
}

vendorRouter.post("/centres", (req, res) => {
  const b = req.body as CentreInput;
  if (!b.name || !b.area || !b.county || !b.blurb) return res.status(400).json({ error: "Missing required fields" });

  const id = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at, opens_at, closes_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, '', ?, ?, ?, 'pending', datetime('now'), ?, ?)`
    ).run(
      id,
      b.name,
      b.area,
      b.county,
      b.capacity ?? 0,
      b.from ?? 0,
      b.managedBy ?? "",
      (b.images ?? [])[0] ?? b.image ?? "",
      b.blurb,
      req.user!.id,
      b.opensAt ?? "09:00",
      b.closesAt ?? "21:00"
    );
    (b.amenities ?? []).forEach((a, i) =>
      db.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(id, a, i)
    );
    (b.images ?? []).forEach((url, i) =>
      db.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i)
    );
  });
  tx();
  res.status(201).json(getCentre(id));
});

vendorRouter.put("/centres/:id", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<CentreInput>;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at)
       WHERE id = ?`
    ).run(
      b.name,
      b.area,
      b.county,
      b.capacity,
      b.from,
      b.managedBy,
      b.images ? b.images[0] ?? "" : b.image,
      b.blurb,
      b.opensAt,
      b.closesAt,
      req.params.id
    );
    if (b.amenities) {
      db.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(req.params.id);
      b.amenities.forEach((a, i) =>
        db
          .prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`)
          .run(req.params.id, a, i)
      );
    }
    if (b.images) {
      db.prepare(`DELETE FROM centre_images WHERE centre_id = ?`).run(req.params.id);
      b.images.forEach((url, i) =>
        db.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`).run(req.params.id, url, i)
      );
    }
  });
  tx();
  res.json(getCentre(req.params.id));
});

vendorRouter.delete("/centres/:id", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --- rooms (nested under a vendor's own centre) -----------------------------

interface RoomInput {
  name: string;
  cap: number;
  rate: number;
  desc?: string;
}

vendorRouter.post("/centres/:id/rooms", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as RoomInput;
  if (!b.name || !b.cap || !b.rate) return res.status(400).json({ error: "name, cap and rate are required" });

  const roomId = crypto.randomUUID();
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM rooms WHERE centre_id = ?`).get(req.params.id) as {
    count: number;
  };
  db.prepare(
    `INSERT INTO rooms (id, centre_id, name, cap, rate, desc, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(roomId, req.params.id, b.name, b.cap, b.rate, b.desc ?? "", count);
  res.status(201).json(getCentre(req.params.id));
});

vendorRouter.put("/centres/:id/rooms/:roomId", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<RoomInput>;
  const info = db
    .prepare(
      `UPDATE rooms SET name = COALESCE(?, name), cap = COALESCE(?, cap), rate = COALESCE(?, rate), desc = COALESCE(?, desc)
       WHERE centre_id = ? AND id = ?`
    )
    .run(b.name, b.cap, b.rate, b.desc, req.params.id, req.params.roomId);
  if (info.changes === 0) return res.status(404).json({ error: "Room not found" });
  res.json(getCentre(req.params.id));
});

vendorRouter.delete("/centres/:id/rooms/:roomId", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const info = db.prepare(`DELETE FROM rooms WHERE centre_id = ? AND id = ?`).run(req.params.id, req.params.roomId);
  if (info.changes === 0) return res.status(404).json({ error: "Room not found" });
  res.json(getCentre(req.params.id));
});

// --- blocked dates/slots ("close" a date for a festival, or block one slot) -

interface BlockInput {
  roomId?: string | null; // omitted/null = applies to every room in the centre
  date: string;
  time?: string | null; // omitted/null = the whole day
  reason?: string;
}

vendorRouter.get("/centres/:id/blocks", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const rows = db
    .prepare(
      `SELECT rb.id, rb.room_id as roomId, r.name as roomName, rb.date, rb.time, rb.reason, rb.created_at as createdAt
       FROM room_blocks rb LEFT JOIN rooms r ON r.id = rb.room_id
       WHERE rb.centre_id = ? ORDER BY rb.date, rb.time IS NULL DESC, rb.time`
    )
    .all(req.params.id);
  res.json(rows);
});

vendorRouter.post("/centres/:id/blocks", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as BlockInput;
  if (!b.date) return res.status(400).json({ error: "date is required" });
  if (b.roomId) {
    const room = db.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ?`).get(b.roomId, req.params.id);
    if (!room) return res.status(404).json({ error: "Room not found" });
  }
  const info = db
    .prepare(`INSERT INTO room_blocks (centre_id, room_id, date, time, reason) VALUES (?, ?, ?, ?, ?)`)
    .run(req.params.id, b.roomId ?? null, b.date, b.time ?? null, b.reason ?? "");
  res.status(201).json({ id: info.lastInsertRowid });
});

vendorRouter.delete("/centres/:id/blocks/:blockId", (req, res) => {
  if (!ownsCentre(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const info = db.prepare(`DELETE FROM room_blocks WHERE id = ? AND centre_id = ?`).run(req.params.blockId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Block not found" });
  res.json({ ok: true });
});

vendorRouter.get("/clubs/:id", (req, res) => {
  if (!ownsClub(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  res.json(getClub(req.params.id));
});

// --- clubs -------------------------------------------------------------------

interface ClubInput {
  name: string;
  sport: string;
  area: string;
  county: string;
  ages: string;
  price: number;
  unit: string;
  trial?: boolean;
  image?: string;
  images?: string[];
  blurb: string;
  includes?: string[];
}

vendorRouter.post("/clubs", (req, res) => {
  const b = req.body as ClubInput;
  if (!b.name || !b.sport || !b.area || !b.county || !b.blurb) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'pending', datetime('now'))`
    ).run(id, b.name, b.sport, b.area, b.county, b.ages ?? "", b.price ?? 0, b.unit ?? "year", b.trial ? 1 : 0, (b.images ?? [])[0] ?? b.image ?? "", b.blurb, req.user!.id);
    (b.includes ?? []).forEach((item, i) =>
      db.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(id, item, i)
    );
    (b.images ?? []).forEach((url, i) =>
      db.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i)
    );
  });
  tx();
  res.status(201).json(getClub(id));
});

vendorRouter.put("/clubs/:id", (req, res) => {
  if (!ownsClub(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<ClubInput>;

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
      b.images ? b.images[0] ?? "" : b.image,
      b.blurb,
      req.params.id
    );
    if (b.includes) {
      db.prepare(`DELETE FROM club_includes WHERE club_id = ?`).run(req.params.id);
      b.includes.forEach((item, i) =>
        db.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(req.params.id, item, i)
      );
    }
    if (b.images) {
      db.prepare(`DELETE FROM club_images WHERE club_id = ?`).run(req.params.id);
      b.images.forEach((url, i) =>
        db.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`).run(req.params.id, url, i)
      );
    }
  });
  tx();
  res.json(getClub(req.params.id));
});

vendorRouter.delete("/clubs/:id", (req, res) => {
  if (!ownsClub(req.user!.id, req.params.id)) return res.status(403).json({ error: "Not your listing" });
  db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --- read-only visibility into bookings/registrations for own listings -----

vendorRouter.get("/bookings", (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.event_type as eventType, b.guests, b.name, b.email, b.phone,
              b.notes, b.total_cents as totalCents, b.created_at as createdAt,
              c.name as centreName, r.name as roomName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       JOIN rooms r ON r.centre_id = b.centre_id AND r.id = b.room_id
       WHERE c.vendor_id = ? AND b.payment_status = 'paid'
       ORDER BY b.created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorRouter.get("/registrations", (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.dob,
              r.g_first as gFirst, r.g_last as gLast, r.email, r.phone, r.trial, r.total_cents as totalCents,
              r.created_at as createdAt, c.name as clubName, c.sport
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id = ? AND r.payment_status = 'paid'
       ORDER BY r.created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

// --- notifications (new bookings/registrations on the vendor's own listings) -

vendorRouter.get("/notifications", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, kind, title, body, listing_type as listingType, listing_id as listingId, ref, read, created_at as createdAt
       FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorRouter.post("/notifications/:id/read", (req, res) => {
  const info = db.prepare(`UPDATE notifications SET read = 1 WHERE id = ? AND recipient_id = ?`).run(req.params.id, req.user!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
