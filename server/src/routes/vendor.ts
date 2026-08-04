import crypto from "node:crypto";
import { Router } from "express";
import { requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";

export const vendorRouter = Router();
vendorRouter.use(requireVendor);

// --- helpers -----------------------------------------------------------

async function ownsCentre(vendorId: string, centreId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM centres WHERE id = ?`).get(centreId)) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && row.vendor_id === vendorId;
}

async function ownsClub(vendorId: string, clubId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(clubId)) as
    | { vendor_id: string | null }
    | undefined;
  return !!row && row.vendor_id === vendorId;
}

// --- listings overview ---------------------------------------------------

vendorRouter.get("/listings", async (req, res) => {
  const centres = await db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt, c.image_url as image,
              (SELECT COUNT(*) FROM bookings b WHERE b.centre_id = c.id AND b.payment_status = 'paid') as bookingsCount
       FROM centres c WHERE c.vendor_id = ? ORDER BY c.name`
    )
    .all(req.user!.id);
  const clubs = await db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt, c.image_url as image,
              (SELECT COUNT(*) FROM registrations r WHERE r.club_id = c.id AND r.payment_status = 'paid') as bookingsCount
       FROM clubs c WHERE c.vendor_id = ? ORDER BY c.name`
    )
    .all(req.user!.id);
  res.json({ centres, clubs });
});

vendorRouter.get("/stats", async (req, res) => {
  const vendorId = req.user!.id;
  const centresLive = (await db
    .prepare(`SELECT COUNT(*) as n FROM centres WHERE vendor_id = ? AND status = 'approved'`)
    .get(vendorId)) as { n: number };
  const clubsLive = (await db
    .prepare(`SELECT COUNT(*) as n FROM clubs WHERE vendor_id = ? AND status = 'approved'`)
    .get(vendorId)) as { n: number };
  const totalBookings = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid') +
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? AND r.payment_status = 'paid') as n`
    )
    .get(vendorId, vendorId)) as { n: number };
  const totalViews = (await db
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(views), 0) FROM centres WHERE vendor_id = ?) +
        (SELECT COALESCE(SUM(views), 0) FROM clubs WHERE vendor_id = ?) as n`
    )
    .get(vendorId, vendorId)) as { n: number };
  res.json({
    centresLive: centresLive.n,
    clubsLive: clubsLive.n,
    totalBookings: totalBookings.n,
    totalViews: totalViews.n,
  });
});

// --- centres ---------------------------------------------------------------

vendorRouter.get("/centres/:id", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  res.json(await getCentre(req.params.id));
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
  paymentMethod?: "online" | "cash";
  isOpen?: boolean;
  mapUrl?: string;
}

vendorRouter.post("/centres", async (req, res) => {
  const b = req.body as CentreInput;
  if (!b.name || !b.area || !b.county || !b.blurb) return res.status(400).json({ error: "Missing required fields" });

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at, opens_at, closes_at, payment_method, map_url)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?)`
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
      b.closesAt ?? "21:00",
      b.paymentMethod ?? "online",
      b.mapUrl ?? ""
    );
    for (const [i, a] of (b.amenities ?? []).entries()) {
      await tx.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(id, a, i);
    }
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
    // "Rooms" is a pure internal implementation detail (booking/availability
    // stay keyed by room_id) — every centre gets exactly one, kept in sync
    // with its own capacity/rate/payment method on every save.
    await tx.prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, '', ?, ?, '', 0, ?)`
    ).run(crypto.randomUUID(), id, b.capacity ?? 0, b.from ?? 0, b.paymentMethod ?? "online");
  });
  res.status(201).json(await getCentre(id));
});

vendorRouter.put("/centres/:id", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<CentreInput>;

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at), payment_method = COALESCE(?, payment_method),
       is_open = COALESCE(?, is_open), map_url = COALESCE(?, map_url)
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
      b.paymentMethod,
      b.isOpen === undefined ? undefined : b.isOpen ? 1 : 0,
      b.mapUrl,
      req.params.id
    );
    if (b.amenities) {
      await tx.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(req.params.id);
      for (const [i, a] of b.amenities.entries()) {
        await tx.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(req.params.id, a, i);
      }
    }
    if (b.images) {
      await tx.prepare(`DELETE FROM centre_images WHERE centre_id = ?`).run(req.params.id);
      for (const [i, url] of b.images.entries()) {
        await tx.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`).run(req.params.id, url, i);
      }
    }
    await tx.prepare(
      `UPDATE rooms SET cap = COALESCE(?, cap), rate = COALESCE(?, rate), payment_method = COALESCE(?, payment_method) WHERE centre_id = ?`
    ).run(b.capacity, b.from, b.paymentMethod, req.params.id);
  });
  res.json(await getCentre(req.params.id));
});

vendorRouter.delete("/centres/:id", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --- blocked dates ("close" a date for a festival) --------------------------

interface BlockInput {
  date: string;
  reason?: string;
}

vendorRouter.get("/centres/:id/blocks", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT id, date, reason, created_at as createdAt
       FROM room_blocks WHERE centre_id = ? ORDER BY date`
    )
    .all(req.params.id);
  res.json(rows);
});

vendorRouter.post("/centres/:id/blocks", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as BlockInput;
  if (!b.date) return res.status(400).json({ error: "date is required" });
  const info = await db
    .prepare(`INSERT INTO room_blocks (centre_id, room_id, date, time, reason) VALUES (?, NULL, ?, NULL, ?)`)
    .run(req.params.id, b.date, b.reason ?? "");
  res.status(201).json({ id: info.lastInsertRowid });
});

vendorRouter.delete("/centres/:id/blocks/:blockId", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const info = await db.prepare(`DELETE FROM room_blocks WHERE id = ? AND centre_id = ?`).run(req.params.blockId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Block not found" });
  res.json({ ok: true });
});

vendorRouter.get("/clubs/:id", async (req, res) => {
  if (!(await ownsClub(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  res.json(await getClub(req.params.id));
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
  paymentMethod?: "online" | "cash";
  mapUrl?: string;
}

vendorRouter.post("/clubs", async (req, res) => {
  const b = req.body as ClubInput;
  if (!b.name || !b.sport || !b.area || !b.county || !b.blurb) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at, payment_method, map_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?)`
    ).run(id, b.name, b.sport, b.area, b.county, b.ages ?? "", b.price ?? 0, b.unit ?? "year", b.trial ? 1 : 0, (b.images ?? [])[0] ?? b.image ?? "", b.blurb, req.user!.id, b.paymentMethod ?? "online", b.mapUrl ?? "");
    for (const [i, item] of (b.includes ?? []).entries()) {
      await tx.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(id, item, i);
    }
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
  });
  res.status(201).json(await getClub(id));
});

vendorRouter.put("/clubs/:id", async (req, res) => {
  if (!(await ownsClub(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<ClubInput>;

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE clubs SET name = COALESCE(?, name), sport = COALESCE(?, sport), area = COALESCE(?, area),
       county = COALESCE(?, county), ages = COALESCE(?, ages), price = COALESCE(?, price), unit = COALESCE(?, unit),
       trial = COALESCE(?, trial), image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       payment_method = COALESCE(?, payment_method), map_url = COALESCE(?, map_url)
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
      b.paymentMethod,
      b.mapUrl,
      req.params.id
    );
    if (b.includes) {
      await tx.prepare(`DELETE FROM club_includes WHERE club_id = ?`).run(req.params.id);
      for (const [i, item] of b.includes.entries()) {
        await tx.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(req.params.id, item, i);
      }
    }
    if (b.images) {
      await tx.prepare(`DELETE FROM club_images WHERE club_id = ?`).run(req.params.id);
      for (const [i, url] of b.images.entries()) {
        await tx.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`).run(req.params.id, url, i);
      }
    }
  });
  res.json(await getClub(req.params.id));
});

vendorRouter.delete("/clubs/:id", async (req, res) => {
  if (!(await ownsClub(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --- read-only visibility into bookings/registrations for own listings -----

vendorRouter.get("/bookings", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.event_type as eventType, b.guests, b.name, b.email, b.phone,
              b.notes, b.total_cents as totalCents, b.created_at as createdAt,
              c.name as centreName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id = ? AND b.payment_status = 'paid'
       ORDER BY b.created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorRouter.get("/registrations", async (req, res) => {
  const rows = await db
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

vendorRouter.get("/notifications", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, kind, title, body, listing_type as listingType, listing_id as listingId, ref, \`read\`, created_at as createdAt
       FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorRouter.post("/notifications/:id/read", async (req, res) => {
  const info = await db.prepare(`UPDATE notifications SET \`read\` = 1 WHERE id = ? AND recipient_id = ?`).run(req.params.id, req.user!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
