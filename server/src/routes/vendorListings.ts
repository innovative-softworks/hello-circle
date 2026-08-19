import crypto from "node:crypto";
import { Router } from "express";
import { requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { approximateCoords, db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { inClause, ownsCentre, ownsClub, recomputeCentreRollup } from "./vendorHelpers.js";

// Own-listing CRUD: overview/stats, claims, centres (+ rooms, blocked
// dates, per-day hours), clubs — split out of the original single
// vendor.ts (see CLAUDE.md). Mounted under vendorRouter in vendor.ts,
// which applies requireVendor/attachVendorIds before this router — every
// handler below assumes req.user/req.vendorIds are already populated.

export const vendorListingsRouter = Router();

// --- listings overview ---------------------------------------------------

vendorListingsRouter.get("/listings", async (req, res) => {
  const ids = req.vendorIds!;
  // Live rating/review count from the real `reviews` table — `centres.rating`/
  // `.reviews` are stale seed-time columns the rest of the app already
  // bypasses (see queries.ts's reviewStats()), and `clubs` never had those
  // columns at all.
  const centres = await db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt, c.image_url as image,
              c.blurb, c.capacity, c.from_price as fromPrice,
              COALESCE((SELECT AVG(rv.rating) FROM reviews rv WHERE rv.listing_type = 'centre' AND rv.listing_id = c.id AND rv.hidden = 0), 0) as rating,
              (SELECT COUNT(*) FROM reviews rv WHERE rv.listing_type = 'centre' AND rv.listing_id = c.id AND rv.hidden = 0) as reviews,
              (SELECT COUNT(*) FROM bookings b WHERE b.centre_id = c.id AND b.payment_status = 'paid') as bookingsCount
       FROM centres c WHERE c.vendor_id IN (${inClause(ids)}) ORDER BY c.name`
    )
    .all(...ids);
  const clubs = await db
    .prepare(
      `SELECT c.id, c.name, c.status, c.area, c.county, c.views, c.created_at as createdAt, c.image_url as image,
              c.blurb, c.ages, c.price, c.unit,
              COALESCE((SELECT AVG(rv.rating) FROM reviews rv WHERE rv.listing_type = 'club' AND rv.listing_id = c.id AND rv.hidden = 0), 0) as rating,
              (SELECT COUNT(*) FROM reviews rv WHERE rv.listing_type = 'club' AND rv.listing_id = c.id AND rv.hidden = 0) as reviews,
              (SELECT COUNT(*) FROM registrations r WHERE r.club_id = c.id AND r.payment_status = 'paid') as bookingsCount
       FROM clubs c WHERE c.vendor_id IN (${inClause(ids)}) ORDER BY c.name`
    )
    .all(...ids);
  // mysql2 returns AVG()'s DECIMAL result as a string, not a number, unless
  // decimalNumbers is set on the pool (it isn't) — coerce before sending.
  const withNumericRating = (rows: any[]) => rows.map((r) => ({ ...r, rating: Math.round(Number(r.rating) * 10) / 10 }));
  res.json({ centres: withNumericRating(centres), clubs: withNumericRating(clubs) });
});

vendorListingsRouter.get("/stats", async (req, res) => {
  const ids = req.vendorIds!;
  const in1 = inClause(ids);
  const centresLive = (await db
    .prepare(`SELECT COUNT(*) as n FROM centres WHERE vendor_id IN (${in1}) AND status = 'approved'`)
    .get(...ids)) as { n: number };
  const clubsLive = (await db
    .prepare(`SELECT COUNT(*) as n FROM clubs WHERE vendor_id IN (${in1}) AND status = 'approved'`)
    .get(...ids)) as { n: number };
  const totalBookings = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid') +
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid') as n`
    )
    .get(...ids, ...ids)) as { n: number };
  const totalViews = (await db
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(views), 0) FROM centres WHERE vendor_id IN (${in1})) +
        (SELECT COALESCE(SUM(views), 0) FROM clubs WHERE vendor_id IN (${in1})) as n`
    )
    .get(...ids, ...ids)) as { n: number };
  res.json({
    centresLive: centresLive.n,
    clubsLive: clubsLive.n,
    totalBookings: totalBookings.n,
    // SUM(...) + SUM(...) comes back as a DECIMAL from MySQL, which mysql2
    // returns as a string (not a number) without decimalNumbers set on the
    // pool — same class of issue as the rating coercion in /listings above.
    totalViews: Number(totalViews.n),
  });
});

// --- listing claims ----------------------------------------------------------
// Lets an already-approved vendor take ownership of a listing that was
// seeded/added with no owning vendor (vendor_id IS NULL — e.g. every seed
// centre/club today). Approval (see admin.ts) is what actually sets
// vendor_id; submitting a claim just records the request. Deliberately NOT
// org-scoped — a claim is a personal request made by whoever submits it,
// not yet something the org owns.

interface ClaimInput {
  listingType: "centre" | "club";
  listingId: string;
  message?: string;
}

vendorListingsRouter.post("/claims", async (req, res) => {
  const b = req.body as ClaimInput;
  if (!b.listingType || !b.listingId || !["centre", "club"].includes(b.listingType)) {
    return res.status(400).json({ error: "listingType and listingId are required" });
  }

  // A vendor's signup-time vendorType only picks their initial listing's
  // type — it's never enforced as a hard boundary on listing creation (see
  // POST /centres, /clubs below: only platform-role gated, not vendorType),
  // so claiming an unclaimed listing of the *other* type is allowed too.
  const table = b.listingType === "centre" ? "centres" : "clubs";

  const listing = (await db.prepare(`SELECT vendor_id FROM ${table} WHERE id = ?`).get(b.listingId)) as
    | { vendor_id: string | null }
    | undefined;
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  if (listing.vendor_id !== null) return res.status(409).json({ error: "This listing has already been claimed" });

  const existing = await db
    .prepare(`SELECT id FROM listing_claims WHERE listing_type = ? AND listing_id = ? AND vendor_id = ? AND status = 'pending'`)
    .get(b.listingType, b.listingId, req.user!.id);
  if (existing) return res.status(409).json({ error: "You already have a pending claim for this listing" });

  await db
    .prepare(`INSERT INTO listing_claims (listing_type, listing_id, vendor_id, message) VALUES (?, ?, ?, ?)`)
    .run(b.listingType, b.listingId, req.user!.id, b.message ?? "");
  res.status(201).json({ ok: true });
});

// --- centres ---------------------------------------------------------------

vendorListingsRouter.get("/centres/:id", async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  res.json(await getCentre(req.params.id));
});

interface CentreInput {
  name: string;
  area: string;
  county: string;
  /** Only used to seed the centre's starter room at creation — see rooms
   * CRUD below. Ignored by PUT /centres/:id; capacity/rate/payment become
   * per-room fields, and centres.capacity/from_price are a computed rollup
   * (see recomputeCentreRollup) rather than vendor-editable. */
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
  phone?: string;
  accessibility?: string[];
}

vendorListingsRouter.post("/centres", requirePlatformRole("centre_manager"), async (req, res) => {
  const b = req.body as CentreInput;
  if (!b.name || !b.area || !b.county || !b.blurb) return res.status(400).json({ error: "Missing required fields" });

  const id = crypto.randomUUID();
  const { lat, lng } = approximateCoords(b.county, id);
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at, opens_at, closes_at, payment_method, map_url, lat, lng, phone, accessibility)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`
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
      b.mapUrl ?? "",
      lat,
      lng,
      b.phone ?? "",
      (b.accessibility ?? []).join(",")
    );
    for (const [i, a] of (b.amenities ?? []).entries()) {
      await tx.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(id, a, i);
    }
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
    // Every new centre starts with one real, named, editable room — a
    // vendor with just one hall never has to think about "rooms" at all,
    // but the concept is real from the start rather than synced/hidden.
    await tx.prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method, active) VALUES (?, ?, 'Main Room', ?, ?, '', 0, ?, 1)`
    ).run(crypto.randomUUID(), id, b.capacity ?? 0, b.from ?? 0, b.paymentMethod ?? "online");
  });
  writeAudit({ actorUserId: req.user!.id, action: "centre.created", objectType: "centre", objectId: id, newValue: { name: b.name, county: b.county } });
  res.status(201).json(await getCentre(id));
});

vendorListingsRouter.put("/centres/:id", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<CentreInput>;
  const before = (await db.prepare(`SELECT name, capacity, from_price FROM centres WHERE id = ?`).get(req.params.id)) as Record<string, unknown> | undefined;
  // A county change moves the county-centroid the map pin approximates —
  // re-jitter from the new county; otherwise leave the existing pin alone.
  const coords = b.county ? approximateCoords(b.county, req.params.id) : { lat: undefined, lng: undefined };

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at),
       is_open = COALESCE(?, is_open), map_url = COALESCE(?, map_url), lat = COALESCE(?, lat), lng = COALESCE(?, lng),
       phone = COALESCE(?, phone), accessibility = COALESCE(?, accessibility)
       WHERE id = ?`
    ).run(
      b.name,
      b.area,
      b.county,
      b.managedBy,
      b.images ? b.images[0] ?? "" : b.image,
      b.blurb,
      b.opensAt,
      b.closesAt,
      b.isOpen === undefined ? undefined : b.isOpen ? 1 : 0,
      b.mapUrl,
      coords.lat,
      coords.lng,
      b.phone,
      b.accessibility ? b.accessibility.join(",") : undefined,
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
  });
  writeAudit({ actorUserId: req.user!.id, action: "centre.updated", objectType: "centre", objectId: req.params.id, previousValue: before, newValue: b });
  res.json(await getCentre(req.params.id));
});

// --- rooms (independently bookable spaces within a centre) -----------------

interface RoomInput {
  name: string;
  cap: number;
  rate: number;
  desc?: string;
  paymentMethod?: "online" | "cash";
  active?: boolean;
}

vendorListingsRouter.get("/centres/:id/rooms", async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT id, centre_id as centreId, name, cap, rate, \`desc\`, payment_method as paymentMethod, active
       FROM rooms WHERE centre_id = ? ORDER BY sort_order`
    )
    .all(req.params.id);
  res.json(rows);
});

vendorListingsRouter.post("/centres/:id/rooms", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as RoomInput;
  if (!b.name) return res.status(400).json({ error: "Room name is required" });

  const sortRow = (await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM rooms WHERE centre_id = ?`).get(req.params.id)) as { next: number };
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(id, req.params.id, b.name, b.cap ?? 0, b.rate ?? 0, b.desc ?? "", sortRow.next, b.paymentMethod ?? "online");
  await recomputeCentreRollup(req.params.id);
  writeAudit({ actorUserId: req.user!.id, action: "room.created", objectType: "room", objectId: id, newValue: { centreId: req.params.id, name: b.name } });
  res.status(201).json({ id });
});

vendorListingsRouter.put("/centres/:id/rooms/:roomId", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<RoomInput>;

  if (b.active === false) {
    const otherActive = (await db
      .prepare(`SELECT COUNT(*) as n FROM rooms WHERE centre_id = ? AND active = 1 AND id != ?`)
      .get(req.params.id, req.params.roomId)) as { n: number };
    if (otherActive.n === 0) return res.status(409).json({ error: "A centre must have at least one bookable room" });
  }

  const info = await db
    .prepare(
      `UPDATE rooms SET name = COALESCE(?, name), cap = COALESCE(?, cap), rate = COALESCE(?, rate),
       \`desc\` = COALESCE(?, \`desc\`), payment_method = COALESCE(?, payment_method), active = COALESCE(?, active)
       WHERE id = ? AND centre_id = ?`
    )
    .run(b.name, b.cap, b.rate, b.desc, b.paymentMethod, b.active === undefined ? undefined : b.active ? 1 : 0, req.params.roomId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Room not found" });

  await recomputeCentreRollup(req.params.id);
  writeAudit({ actorUserId: req.user!.id, action: "room.updated", objectType: "room", objectId: req.params.roomId, newValue: b });
  res.json({ ok: true });
});

vendorListingsRouter.delete("/centres/:id", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  writeAudit({ actorUserId: req.user!.id, action: "centre.deleted", objectType: "centre", objectId: req.params.id });
  res.json({ ok: true });
});

// --- blocked dates ("close" a date for a festival) --------------------------

interface BlockInput {
  date: string;
  reason?: string;
  /** Omit/undefined = whole-centre block (blocks every room); set = only
   * that one room stays closed on this date, the rest of the centre's
   * rooms remain bookable. */
  roomId?: string;
}

vendorListingsRouter.get("/centres/:id/blocks", async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT id, date, reason, created_at as createdAt, room_id as roomId
       FROM room_blocks WHERE centre_id = ? ORDER BY date`
    )
    .all(req.params.id);
  res.json(rows);
});

vendorListingsRouter.post("/centres/:id/blocks", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as BlockInput;
  if (!b.date) return res.status(400).json({ error: "date is required" });
  if (b.roomId) {
    const room = (await db.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ?`).get(b.roomId, req.params.id)) as { id: string } | undefined;
    if (!room) return res.status(400).json({ error: "That room doesn't belong to this centre" });
  }
  const info = await db
    .prepare(`INSERT INTO room_blocks (centre_id, room_id, date, time, reason) VALUES (?, ?, ?, NULL, ?)`)
    .run(req.params.id, b.roomId ?? null, b.date, b.reason ?? "");
  res.status(201).json({ id: info.lastInsertRowid });
});

vendorListingsRouter.delete("/centres/:id/blocks/:blockId", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const info = await db.prepare(`DELETE FROM room_blocks WHERE id = ? AND centre_id = ?`).run(req.params.blockId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Block not found" });
  res.json({ ok: true });
});

// --- per-day opening hours (Phase B) — optional; a centre with none set
// keeps using its single opens_at/closes_at window (see availability.ts's
// hoursFor()). --------------------------------------------------------

vendorListingsRouter.get("/centres/:id/hours", async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(`SELECT day_of_week as dayOfWeek, opens_at as opensAt, closes_at as closesAt, closed FROM centre_hours WHERE centre_id = ? ORDER BY day_of_week`)
    .all(req.params.id);
  res.json(rows);
});

vendorListingsRouter.put("/centres/:id/hours", requirePlatformRole("centre_manager"), async (req, res) => {
  if (!(await ownsCentre(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const { days } = req.body as { days: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[] };
  if (!Array.isArray(days)) return res.status(400).json({ error: "days array is required" });
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM centre_hours WHERE centre_id = ?`).run(req.params.id);
    for (const d of days) {
      await tx
        .prepare(`INSERT INTO centre_hours (centre_id, day_of_week, opens_at, closes_at, closed) VALUES (?, ?, ?, ?, ?)`)
        .run(req.params.id, d.dayOfWeek, d.opensAt, d.closesAt, d.closed ? 1 : 0);
    }
  });
  res.json({ ok: true });
});

vendorListingsRouter.get("/clubs/:id", async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
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
  /** Nullable = unlimited (MVP — see clubs.capacity / waitlist_entries). */
  capacity?: number | null;
  phone?: string;
  accessibility?: string[];
  category?: string;
}

vendorListingsRouter.post("/clubs", requirePlatformRole("facility_manager"), async (req, res) => {
  const b = req.body as ClubInput;
  if (!b.name || !b.sport || !b.area || !b.county || !b.blurb) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const { lat, lng } = approximateCoords(b.county, id);
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at, payment_method, map_url, capacity, lat, lng, phone, accessibility, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, b.name, b.sport, b.area, b.county, b.ages ?? "", b.price ?? 0, b.unit ?? "year", b.trial ? 1 : 0, (b.images ?? [])[0] ?? b.image ?? "", b.blurb, req.user!.id, b.paymentMethod ?? "online", b.mapUrl ?? "", b.capacity ?? null, lat, lng, b.phone ?? "", (b.accessibility ?? []).join(","), b.category ?? "");
    for (const [i, item] of (b.includes ?? []).entries()) {
      await tx.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(id, item, i);
    }
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
  });
  writeAudit({ actorUserId: req.user!.id, action: "club.created", objectType: "club", objectId: id, newValue: { name: b.name, county: b.county } });
  res.status(201).json(await getClub(id));
});

vendorListingsRouter.put("/clubs/:id", requirePlatformRole("facility_manager"), async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const b = req.body as Partial<ClubInput>;
  const before = (await db.prepare(`SELECT name, price, capacity, payment_method FROM clubs WHERE id = ?`).get(req.params.id)) as Record<string, unknown> | undefined;
  const coords = b.county ? approximateCoords(b.county, req.params.id) : { lat: undefined, lng: undefined };

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE clubs SET name = COALESCE(?, name), sport = COALESCE(?, sport), area = COALESCE(?, area),
       county = COALESCE(?, county), ages = COALESCE(?, ages), price = COALESCE(?, price), unit = COALESCE(?, unit),
       trial = COALESCE(?, trial), image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       payment_method = COALESCE(?, payment_method), map_url = COALESCE(?, map_url),
       capacity = CASE WHEN ? THEN capacity ELSE ? END,
       lat = COALESCE(?, lat), lng = COALESCE(?, lng),
       phone = COALESCE(?, phone), accessibility = COALESCE(?, accessibility), category = COALESCE(?, category)
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
      b.capacity === undefined ? 1 : 0,
      b.capacity === undefined ? null : b.capacity,
      coords.lat,
      coords.lng,
      b.phone,
      b.accessibility ? b.accessibility.join(",") : undefined,
      b.category,
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
  writeAudit({ actorUserId: req.user!.id, action: "club.updated", objectType: "club", objectId: req.params.id, previousValue: before, newValue: b });
  res.json(await getClub(req.params.id));
});

vendorListingsRouter.delete("/clubs/:id", requirePlatformRole("facility_manager"), async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  writeAudit({ actorUserId: req.user!.id, action: "club.deleted", objectType: "club", objectId: req.params.id });
  res.json({ ok: true });
});
