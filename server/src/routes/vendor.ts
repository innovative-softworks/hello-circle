import crypto from "node:crypto";
import { Router } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { approximateCoords, db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { sendMail } from "../email.js";

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

// --- listing claims ----------------------------------------------------------
// Lets an already-approved vendor take ownership of a listing that was
// seeded/added with no owning vendor (vendor_id IS NULL — e.g. every seed
// centre/club today). Approval (see admin.ts) is what actually sets
// vendor_id; submitting a claim just records the request.

interface ClaimInput {
  listingType: "centre" | "club";
  listingId: string;
  message?: string;
}

vendorRouter.post("/claims", async (req, res) => {
  const b = req.body as ClaimInput;
  if (!b.listingType || !b.listingId || !["centre", "club"].includes(b.listingType)) {
    return res.status(400).json({ error: "listingType and listingId are required" });
  }

  const table = b.listingType === "centre" ? "centres" : "clubs";
  const expectedVendorType = b.listingType === "centre" ? "community" : "sports";
  if (req.user!.vendorType !== expectedVendorType) {
    return res.status(403).json({
      error: b.listingType === "centre" ? "Only community centre vendors can claim a centre" : "Only sports club vendors can claim a club",
    });
  }

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
  const { lat, lng } = approximateCoords(b.county, id);
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at, opens_at, closes_at, payment_method, map_url, lat, lng)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?, ?, ?)`
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
      lng
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
  // A county change moves the county-centroid the map pin approximates —
  // re-jitter from the new county; otherwise leave the existing pin alone.
  const coords = b.county ? approximateCoords(b.county, req.params.id) : { lat: undefined, lng: undefined };

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at), payment_method = COALESCE(?, payment_method),
       is_open = COALESCE(?, is_open), map_url = COALESCE(?, map_url), lat = COALESCE(?, lat), lng = COALESCE(?, lng)
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
      coords.lat,
      coords.lng,
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

// --- per-day opening hours (Phase B) — optional; a centre with none set
// keeps using its single opens_at/closes_at window (see availability.ts's
// hoursFor()). --------------------------------------------------------

vendorRouter.get("/centres/:id/hours", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(`SELECT day_of_week as dayOfWeek, opens_at as opensAt, closes_at as closesAt, closed FROM centre_hours WHERE centre_id = ? ORDER BY day_of_week`)
    .all(req.params.id);
  res.json(rows);
});

vendorRouter.put("/centres/:id/hours", async (req, res) => {
  if (!(await ownsCentre(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
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
  /** Nullable = unlimited (MVP — see clubs.capacity / waitlist_entries). */
  capacity?: number | null;
}

vendorRouter.post("/clubs", async (req, res) => {
  const b = req.body as ClubInput;
  if (!b.name || !b.sport || !b.area || !b.county || !b.blurb) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const id = crypto.randomUUID();
  const { lat, lng } = approximateCoords(b.county, id);
  await db.transaction(async (tx) => {
    await tx.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at, payment_method, map_url, capacity, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?, ?)`
    ).run(id, b.name, b.sport, b.area, b.county, b.ages ?? "", b.price ?? 0, b.unit ?? "year", b.trial ? 1 : 0, (b.images ?? [])[0] ?? b.image ?? "", b.blurb, req.user!.id, b.paymentMethod ?? "online", b.mapUrl ?? "", b.capacity ?? null, lat, lng);
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
  const coords = b.county ? approximateCoords(b.county, req.params.id) : { lat: undefined, lng: undefined };

  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE clubs SET name = COALESCE(?, name), sport = COALESCE(?, sport), area = COALESCE(?, area),
       county = COALESCE(?, county), ages = COALESCE(?, ages), price = COALESCE(?, price), unit = COALESCE(?, unit),
       trial = COALESCE(?, trial), image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb),
       payment_method = COALESCE(?, payment_method), map_url = COALESCE(?, map_url),
       capacity = CASE WHEN ? THEN capacity ELSE ? END,
       lat = COALESCE(?, lat), lng = COALESCE(?, lng)
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
              b.notes, b.total_cents as totalCents, b.created_at as createdAt, b.status,
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
              r.created_at as createdAt, r.status, c.name as clubName, c.sport
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

// --- Programs, sessions, attendance (Phase B) -------------------------
// See server/src/db/index.ts's programs/program_sessions/program_enrollments
// comments for the model. Deliberately independent of centre-hire and
// club-registration — this is new activity types only, not a migration.

interface ProgramInput {
  listingType: "centre" | "club";
  listingId: string;
  title: string;
  description: string;
  ageRange?: string;
  imageUrl?: string;
  priceCents?: number;
  capacity?: number | null;
}

async function ownsListing(vendorId: string, listingType: "centre" | "club", listingId: string): Promise<boolean> {
  return listingType === "centre" ? ownsCentre(vendorId, listingId) : ownsClub(vendorId, listingId);
}

vendorRouter.get("/programs", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, listing_type as listingType, listing_id as listingId, title, status, price_cents as priceCents, capacity, created_at as createdAt
       FROM programs WHERE vendor_id = ? ORDER BY created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorRouter.post("/programs", async (req, res) => {
  const b = req.body as ProgramInput;
  if (!b.listingType || !b.listingId || !b.title || !b.description) return res.status(400).json({ error: "Missing required fields" });
  if (!(await ownsListing(req.user!.id, b.listingType, b.listingId))) return res.status(403).json({ error: "Not your listing" });

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, age_range, image_url, price_cents, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, b.listingType, b.listingId, req.user!.id, b.title, b.description, b.ageRange ?? "", b.imageUrl ?? "", b.priceCents ?? 0, b.capacity ?? null);
  res.status(201).json({ id });
});

async function ownsProgram(vendorId: string, programId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM programs WHERE id = ?`).get(programId)) as { vendor_id: string } | undefined;
  return !!row && row.vendor_id === vendorId;
}

vendorRouter.put("/programs/:id", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your program" });
  const b = req.body as Partial<ProgramInput> & { status?: string };
  await db
    .prepare(
      `UPDATE programs SET title = COALESCE(?, title), description = COALESCE(?, description), age_range = COALESCE(?, age_range),
       image_url = COALESCE(?, image_url), price_cents = COALESCE(?, price_cents), status = COALESCE(?, status),
       capacity = CASE WHEN ? THEN capacity ELSE ? END
       WHERE id = ?`
    )
    .run(b.title, b.description, b.ageRange, b.imageUrl, b.priceCents, b.status, b.capacity === undefined ? 1 : 0, b.capacity === undefined ? null : b.capacity, req.params.id);
  res.json({ ok: true });
});

vendorRouter.delete("/programs/:id", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your program" });
  await db.prepare(`UPDATE programs SET status = 'archived' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

vendorRouter.post("/programs/:id/sessions", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your program" });
  const { date, time, durationMinutes, capacity } = req.body as { date?: string; time?: string; durationMinutes?: number; capacity?: number };
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO program_sessions (id, program_id, date, time, duration_minutes, capacity) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, req.params.id, date, time, durationMinutes ?? 60, capacity ?? null);
  res.status(201).json({ id });
});

vendorRouter.delete("/programs/:programId/sessions/:sessionId", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.programId))) return res.status(403).json({ error: "Not your program" });
  await db.prepare(`UPDATE program_sessions SET status = 'cancelled' WHERE id = ? AND program_id = ?`).run(req.params.sessionId, req.params.programId);
  res.json({ ok: true });
});

vendorRouter.get("/programs/:id/enrollments", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your program" });
  const rows = await db
    .prepare(
      `SELECT id, ref, participant_name as participantName, participant_dob as participantDob, email, phone, total_cents as totalCents, created_at as createdAt, status
       FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' ORDER BY created_at DESC`
    )
    .all(req.params.id);
  res.json(rows);
});

// Per-session attendance (Phase B) — reuses the generic attendance table
// from Tier 3's manual check-in, keyed by a composite ref rather than a new
// table, since the shape (kind, ref, checked_in_at, checked_in_by) already
// fits exactly.
vendorRouter.post("/program-sessions/:sessionId/attendance/:enrollmentId", async (req, res) => {
  const session = (await db.prepare(`SELECT program_id as programId FROM program_sessions WHERE id = ?`).get(req.params.sessionId)) as { programId: string } | undefined;
  if (!session || !(await ownsProgram(req.user!.id, session.programId))) return res.status(403).json({ error: "Not your session" });
  const ref = `${req.params.sessionId}:${req.params.enrollmentId}`;
  await db
    .prepare(`INSERT INTO attendance (kind, ref, checked_in_by) VALUES ('program_session', ?, ?) ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by)`)
    .run(ref, req.user!.id);
  res.json({ ok: true });
});

vendorRouter.get("/programs/:id/sessions/:sessionId/attendance", async (req, res) => {
  if (!(await ownsProgram(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your program" });
  const rows = (await db.prepare(`SELECT ref FROM attendance WHERE kind = 'program_session' AND ref LIKE ?`).all(`${req.params.sessionId}:%`)) as { ref: string }[];
  res.json(rows.map((r) => r.ref.split(":")[1]));
});

// --- Schedule / Today's Operations (Phase B) --------------------------
// Aggregates the vendor's own program_sessions — the one genuinely new,
// generic "session" concept — for a given date range. Deliberately does
// NOT also try to fold in centre-hire bookings or club registrations onto
// the same calendar shape; those stay in their own existing screens (see
// plan doc: not migrating old flows onto the new model).

vendorRouter.get("/schedule", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : new Date().toISOString().slice(0, 10);
  const days = Math.min(Number(req.query.days) || 30, 90);
  const rows = await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes as durationMinutes, ps.capacity, p.title, p.id as programId,
              (SELECT COUNT(*) FROM program_enrollments pe WHERE pe.program_id = p.id AND pe.payment_status = 'paid' AND pe.status != 'cancelled') as enrolled
       FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
       WHERE p.vendor_id = ? AND ps.status != 'cancelled' AND ps.date >= ? AND ps.date <= DATE_ADD(?, INTERVAL ? DAY)
       ORDER BY ps.date, ps.time`
    )
    .all(req.user!.id, from, from, days);
  res.json(rows);
});

// --- club waitlist visibility (Tier 3 — was genuinely missing, not just
// missing UI: no route here saw a club's waitlist at all until now) --------

vendorRouter.get("/clubs/:id/waitlist", async (req, res) => {
  if (!(await ownsClub(req.user!.id, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT id, name, email, status, created_at as createdAt, offer_expires_at as offerExpiresAt
       FROM waitlist_entries WHERE listing_type = 'club' AND listing_id = ? AND status IN ('waiting', 'offered') ORDER BY id`
    )
    .all(req.params.id);
  res.json(rows);
});

// --- targeted communications (NEXT) ---------------------------------------
// Distinct from the automatic booking/registration notifications above — a
// vendor-authored message to everyone with a paid booking/registration on
// one of their own listings. Deliberately email-only (no in-app inbox for
// this yet) to keep this a small, self-contained addition.

interface MessageInput {
  listingType: "centre" | "club";
  listingId: string;
  subject: string;
  body: string;
}

vendorRouter.post("/messages", async (req, res) => {
  const b = req.body as MessageInput;
  if (!b.listingType || !b.listingId || !b.subject || !b.body) return res.status(400).json({ error: "Missing required fields" });
  const owns = b.listingType === "centre" ? await ownsCentre(req.user!.id, b.listingId) : await ownsClub(req.user!.id, b.listingId);
  if (!owns) return res.status(403).json({ error: "Not your listing" });

  const recipients = (
    b.listingType === "centre"
      ? await db.prepare(`SELECT DISTINCT email FROM bookings WHERE centre_id = ? AND payment_status = 'paid' AND status != 'cancelled'`).all(b.listingId)
      : await db.prepare(`SELECT DISTINCT email FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'`).all(b.listingId)
  ) as { email: string }[];

  await db
    .prepare(`INSERT INTO vendor_messages (vendor_id, listing_type, listing_id, subject, body) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user!.id, b.listingType, b.listingId, b.subject, b.body);

  for (const r of recipients) {
    await sendMail({ to: r.email, subject: b.subject, text: b.body }).catch((e) => console.error("[vendor messages] send failed:", e));
  }

  res.status(201).json({ ok: true, recipientCount: recipients.length });
});

vendorRouter.get("/messages", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, listing_type as listingType, listing_id as listingId, subject, body, created_at as createdAt
       FROM vendor_messages WHERE vendor_id = ? ORDER BY created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

// --- attendance check-in (FUTURE, best-effort) ----------------------------
// Manual: staff look up a booking/registration ref and mark it — no
// hardware/QR-scanning integration (see plan doc "Not yet" section).

vendorRouter.post("/checkin/:kind/:ref", async (req, res) => {
  const { kind, ref } = req.params as { kind: "booking" | "registration"; ref: string };
  if (kind !== "booking" && kind !== "registration") return res.status(400).json({ error: "kind must be booking or registration" });

  const table = kind === "booking" ? "bookings" : "registrations";
  const listingCol = kind === "booking" ? "centre_id" : "club_id";
  const listingTable = kind === "booking" ? "centres" : "clubs";
  const row = (await db
    .prepare(`SELECT t.${listingCol} as listingId, l.vendor_id as vendorId, t.payment_status as paymentStatus FROM ${table} t JOIN ${listingTable} l ON l.id = t.${listingCol} WHERE t.ref = ?`)
    .get(ref)) as { listingId: string; vendorId: string | null; paymentStatus: string } | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.vendorId !== req.user!.id) return res.status(403).json({ error: "Not your listing" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This isn't a paid booking/registration" });

  await db
    .prepare(`INSERT INTO attendance (kind, ref, checked_in_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by)`)
    .run(kind, ref, req.user!.id);
  res.json({ ok: true });
});

vendorRouter.get("/checkin/:kind/:ref", async (req, res) => {
  const row = await db.prepare(`SELECT checked_in_at as checkedInAt FROM attendance WHERE kind = ? AND ref = ?`).get(req.params.kind, req.params.ref);
  res.json({ checkedIn: !!row, checkedInAt: (row as { checkedInAt: string } | undefined)?.checkedInAt ?? null });
});

// --- participant directory (Phase C) ------------------------------------
// Searchable across everyone with a paid booking/registration on any of
// this vendor's own listings — previously only visible inline per-row on
// the flat Bookings tab.

vendorRouter.get("/participants", async (req, res) => {
  const q = typeof req.query.q === "string" ? `%${req.query.q}%` : "%";
  const rows = await db
    .prepare(
      `SELECT b.name, b.email, b.phone, 'booking' as kind, c.name as listingName, b.created_at as lastActivity
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id = ? AND b.payment_status = 'paid' AND (b.name LIKE ? OR b.email LIKE ?)
       UNION ALL
       SELECT CONCAT(r.g_first, ' ', r.g_last) as name, r.email, r.phone, 'registration' as kind, c.name as listingName, r.created_at as lastActivity
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id = ? AND r.payment_status = 'paid' AND (r.g_first LIKE ? OR r.g_last LIKE ? OR r.email LIKE ?)
       ORDER BY lastActivity DESC LIMIT 200`
    )
    .all(req.user!.id, q, q, req.user!.id, q, q, q);
  res.json(rows);
});

// --- insights / reports (Phase C) ---------------------------------------
// Decision-focused aggregates, not vanity charting — participation,
// cancellation rate, and a day/hour utilisation grid for hall bookings (the
// one listing type with a real time dimension today).

vendorRouter.get("/insights", async (req, res) => {
  const vendorId = req.user!.id;
  const totals = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid') as totalBookings,
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.status = 'cancelled') as cancelledBookings,
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? AND r.payment_status = 'paid') as totalRegistrations,
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? AND r.status = 'cancelled') as cancelledRegistrations,
        (SELECT COUNT(DISTINCT b.client_id) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid') as uniqueBookers`
    )
    .get(vendorId, vendorId, vendorId, vendorId, vendorId)) as Record<string, number>;

  const utilisation = await db
    .prepare(
      `SELECT DAYOFWEEK(b.date) as dayOfWeek, SUBSTRING(b.time, 1, 2) as hour, COUNT(*) as n
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id = ? AND b.payment_status = 'paid'
       GROUP BY dayOfWeek, hour`
    )
    .all(vendorId);

  res.json({ totals, utilisation });
});

vendorRouter.get("/reports/bookings.csv", async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT b.ref, c.name as centre, b.date, b.time, b.duration, b.guests, b.name, b.email, b.total_cents as totalCents, b.status
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? AND b.payment_status = 'paid' ORDER BY b.date DESC`
    )
    .all(req.user!.id)) as Record<string, unknown>[];
  const header = "ref,centre,date,time,duration,guests,name,email,total_euro,status";
  const csvRows = rows.map((r) =>
    [r.ref, r.centre, r.date, r.time, r.duration, r.guests, r.name, r.email, ((r.totalCents as number) / 100).toFixed(2), r.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=bookings.csv");
  res.send([header, ...csvRows].join("\n"));
});

// --- payments summary (Phase C) -----------------------------------------
// Deliberately gated with requirePlatformRole('finance') — the one place in
// this codebase RBAC actually restricts an invited staff member's access
// rather than just recording a role field nobody checks. The org owner
// (invitedStaff=false) always passes regardless of role.

vendorRouter.get("/payments", requirePlatformRole("finance"), async (req, res) => {
  const vendorId = req.user!.id;
  const [bookings, registrations] = await Promise.all([
    db
      .prepare(
        `SELECT b.ref, 'booking' as kind, c.name as listingName, b.total_cents as totalCents, b.created_at as createdAt, b.payment_status as paymentStatus
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id = ? ORDER BY b.created_at DESC LIMIT 100`
      )
      .all(vendorId),
    db
      .prepare(
        `SELECT r.ref, 'registration' as kind, c.name as listingName, r.total_cents as totalCents, r.created_at as createdAt, r.payment_status as paymentStatus
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id = ? ORDER BY r.created_at DESC LIMIT 100`
      )
      .all(vendorId),
  ]);
  const all = [...bookings, ...registrations].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalPaidCents = all.filter((r: any) => r.paymentStatus === "paid").reduce((sum: number, r: any) => sum + r.totalCents, 0);
  res.json({ transactions: all.slice(0, 150), totalPaidCents });
});

// --- demand intelligence (NEXT) -------------------------------------------
// Aggregated read of server/src/routes/search.ts's logged zero-result
// searches, scoped to this vendor's own county/sport-ish relevance being
// left to them to judge — v1 just surfaces the raw aggregate, not
// personalised matching.

vendorRouter.get("/demand", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT query_text as queryText, county, COUNT(*) as count, MAX(created_at) as lastSeenAt
       FROM search_misses GROUP BY query_text, county ORDER BY count DESC LIMIT 25`
    )
    .all();
  res.json(rows);
});
