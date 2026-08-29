import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { buildIcsEvent } from "../ics.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { BadRequestError, ConflictError, clientIdFrom, generateRef, isValidEmail } from "../util.js";

// Adventures & Experiences — a standalone third listing type alongside
// centres/clubs (not nested under either), added post-IA-spec-audit. Same
// vendor_id/org ownership and approved-only public-read contract as
// centres/clubs (see db/index.ts's experiences/experience_sessions/
// experience_bookings comments), but booked per-session (a single
// departure), not per-listing the way a centre room booking is, and not a
// multi-session enrollment the way a Program is — see vendorExperiences.ts
// for the vendor-side CRUD half of this feature.

interface ExperienceRow {
  id: string;
  vendor_id: string;
  kind: "adventure" | "experience";
  title: string;
  area: string;
  county: string;
  lat: number | null;
  lng: number | null;
  meeting_point: string;
  blurb: string;
  description: string;
  difficulty: string;
  duration_minutes: number;
  fitness_requirements: string;
  itinerary: string;
  equipment_provided: string;
  equipment_required: string;
  transport_info: string;
  safety_info: string;
  weather_policy: string;
  eligibility: string;
  cancellation_terms: string;
  price_cents: number;
  capacity: number;
  payment_method: string;
  image_url: string;
  status: string;
  views: number;
  featured: number;
  slug: string | null;
  created_at: string;
  distance_km: string | null;
  elevation_gain_m: number | null;
  terrain_type: string;
  vendor_business_name: string;
  vendor_name: string;
  vendor_provider_tier: string;
}

async function toExperienceJson(row: ExperienceRow) {
  const images = (await db
    .prepare(`SELECT url FROM experience_images WHERE experience_id = ? ORDER BY sort_order`)
    .all(row.id)) as { url: string }[];
  const sessions = (await db
    .prepare(
      `SELECT id, date, time, capacity, status FROM experience_sessions
       WHERE experience_id = ? AND status = 'scheduled' AND date >= CURDATE() ORDER BY date, time`
    )
    .all(row.id)) as { id: string; date: string; time: string; capacity: number | null; status: string }[];
  const withAvailability = await Promise.all(
    sessions.map(async (s) => {
      const cap = s.capacity ?? row.capacity;
      const { n: booked } = (await db
        .prepare(
          `SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings
           WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`
        )
        .get(s.id)) as { n: number };
      return { id: s.id, date: s.date, time: s.time, capacity: cap, spotsLeft: Math.max(0, cap - Number(booked)) };
    })
  );
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    area: row.area,
    county: row.county,
    lat: row.lat,
    lng: row.lng,
    meetingPoint: row.meeting_point,
    blurb: row.blurb,
    description: row.description,
    difficulty: row.difficulty,
    durationMinutes: row.duration_minutes,
    fitnessRequirements: row.fitness_requirements,
    itinerary: row.itinerary,
    equipmentProvided: row.equipment_provided,
    equipmentRequired: row.equipment_required,
    transportInfo: row.transport_info,
    safetyInfo: row.safety_info,
    weatherPolicy: row.weather_policy,
    eligibility: row.eligibility,
    cancellationTerms: row.cancellation_terms,
    priceCents: row.price_cents,
    capacity: row.capacity,
    paymentMethod: row.payment_method,
    imageUrl: row.image_url,
    images: images.map((i) => i.url),
    sessions: withAvailability,
    featured: !!row.featured,
    slug: row.slug,
    createdAt: row.created_at,
    // DECIMAL columns come back from mysql2 as strings, not numbers, unless
    // decimalNumbers is set on the pool (it isn't) — coerce here, same
    // pattern vendor.ts's rating/totalViews coercion already uses.
    distanceKm: row.distance_km === null ? null : Number(row.distance_km),
    elevationGainM: row.elevation_gain_m,
    terrainType: row.terrain_type,
    // Vendor identity ("Hosted by") — the same businessName-or-name and
    // providerTier-derived verified flag providers.ts already returns for
    // a vendor's own public profile page; joined in here so the listing
    // itself can show/link to it without a second round trip.
    vendorId: row.vendor_id,
    vendorName: row.vendor_business_name || row.vendor_name,
    vendorVerified: row.vendor_provider_tier !== "standard",
  };
}

export const experiencesRouter = Router();

// Both public reads join `users` for vendor identity ("Hosted by" —
// businessName-or-name + a verified flag off provider_tier, same derivation
// providers.ts uses for a vendor's own profile page). Conditions are
// qualified with `e.` throughout since `users` has its own `county` column
// (the vendor's own county, unrelated to the listing's) that would
// otherwise collide with the bare column name.
experiencesRouter.get("/", async (req, res) => {
  const { kind, county } = req.query as { kind?: string; county?: string };
  const conditions = [`e.status = 'approved'`];
  const params: string[] = [];
  if (kind === "adventure" || kind === "experience") {
    conditions.push(`e.kind = ?`);
    params.push(kind);
  }
  if (county) {
    conditions.push(`e.county = ?`);
    params.push(county);
  }
  const rows = (await db
    .prepare(
      `SELECT e.*, u.business_name as vendor_business_name, u.name as vendor_name, u.provider_tier as vendor_provider_tier
       FROM experiences e JOIN users u ON u.id = e.vendor_id
       WHERE ${conditions.join(" AND ")} ORDER BY e.featured DESC, e.created_at DESC`
    )
    .all(...params)) as ExperienceRow[];
  res.json(await Promise.all(rows.map(toExperienceJson)));
});

// Same "approved only" contract as getApprovedCentre/getApprovedClub — a
// pending/rejected/deleted experience has no public detail page. Vendors see
// every status of their own via GET /vendor/experiences instead. Slug-or-id
// resolution (master-prompt punch list #1) — same convention as centres/
// clubs/circles.
experiencesRouter.get("/:id", async (req, res) => {
  const row = (await db
    .prepare(
      `SELECT e.*, u.business_name as vendor_business_name, u.name as vendor_name, u.provider_tier as vendor_provider_tier
       FROM experiences e JOIN users u ON u.id = e.vendor_id
       WHERE (e.slug = ? OR e.id = ?) AND e.status = 'approved'`
    )
    .get(req.params.id, req.params.id)) as ExperienceRow | undefined;
  if (!row) return res.status(404).json({ error: "Experience not found" });
  await db.prepare(`UPDATE experiences SET views = views + 1 WHERE id = ?`).run(row.id);
  res.json(await toExperienceJson(row));
});

interface BookBody {
  participantName: string;
  email: string;
  phone?: string;
  partySize?: number;
  couponCode?: string;
}

// Books ONE session (a specific departure) — party_size spots on it, not a
// multi-session enrollment. Row-locks the session the same way bookings.ts
// row-locks a room, so two checkouts can't both take the same last spots.
experiencesRouter.post("/:id/sessions/:sessionId/checkout", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const body = req.body as BookBody;
  if (!body.participantName || !body.email) return res.status(400).json({ error: "Participant name and email are required" });
  if (!isValidEmail(body.email)) return res.status(400).json({ error: "That doesn't look like a valid email address" });
  const partySize = body.partySize && body.partySize > 0 ? body.partySize : 1;

  const experience = (await db.prepare(`SELECT * FROM experiences WHERE id = ?`).get(req.params.id)) as ExperienceRow | undefined;
  if (!experience) return res.status(404).json({ error: "Experience not found" });
  if (experience.status !== "approved") return res.status(409).json({ error: "This listing is no longer open for booking" });

  const session = (await db
    .prepare(`SELECT id, capacity, status FROM experience_sessions WHERE id = ? AND experience_id = ?`)
    .get(req.params.sessionId, experience.id)) as { id: string; capacity: number | null; status: string } | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "scheduled") return res.status(409).json({ error: "This session is no longer open for booking" });

  const isCash = experience.payment_method === "cash";
  const subtotalCents = experience.price_cents * partySize;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (body.couponCode) {
    const result = await evaluateCoupon(body.couponCode, subtotalCents);
    if (!result.valid) return res.status(400).json({ error: result.error! });
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  const pricing = computePricing(subtotalCents, 0, discountCents, couponCode);
  const ref = generateRef("EX");

  try {
    await db.transaction(async (tx) => {
      await tx.prepare(`SELECT id FROM experience_sessions WHERE id = ? FOR UPDATE`).get(session.id);
      const cap = session.capacity ?? experience.capacity;
      const { n: booked } = (await tx
        .prepare(
          `SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings
           WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`
        )
        .get(session.id)) as { n: number };
      if (Number(booked) + partySize > cap) throw new ConflictError("Not enough spots left on this session");

      await tx
        .prepare(
          `INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size,
            subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status)
           VALUES (@ref, @experienceId, @sessionId, @clientId, @residentId, @participantName, @email, @phone, @partySize,
            @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status)`
        )
        .run({
          ref,
          experienceId: experience.id,
          sessionId: session.id,
          clientId,
          residentId: req.resident?.id ?? null,
          participantName: body.participantName,
          email: body.email,
          phone: body.phone ?? "",
          partySize,
          subtotalCents: pricing.taxableCents,
          discountCents: pricing.discountCents,
          vatCents: pricing.vatCents,
          platformFeeCents: pricing.platformFeeCents,
          couponCode: pricing.couponCode,
          totalCents: pricing.totalCents,
          status: isCash ? "paid" : "pending",
        });
    });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }

  const detailsText = `${body.participantName} · party of ${partySize} · €${(pricing.totalCents / 100).toFixed(2)}${isCash ? " due in cash on arrival" : " total"}`;

  if (isCash) {
    notifyNewBookingOrRegistration({
      kind: "booking",
      listingType: "experience",
      listingId: experience.id,
      listingName: experience.title,
      vendorId: experience.vendor_id,
      guestName: body.participantName,
      guestEmail: body.email,
      ref,
      detailsText,
    }).catch((e) => console.error("[notifications] experience booking notify failed:", e));
    if (req.resident?.id) await upgradeFavouriteStatus(req.resident.id, "experience", experience.id);
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100 });
  }

  const result = await createCheckoutSession({
    ref,
    type: "experience",
    customerEmail: body.email,
    residentId: req.resident?.id ?? null,
    lineItems: pricingLineItems(pricing, {
      name: experience.title,
      description: `${body.participantName} · party of ${partySize}${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
    }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM experience_bookings WHERE ref = ?`).run(ref);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE experience_bookings SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

// Every experience booking under this device's client_id or (if signed in)
// this resident's email — same OR-matched ownership pattern as
// GET /enrollments/mine on programs.ts.
experiencesRouter.get("/bookings/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = await db
    .prepare(
      `SELECT eb.ref, eb.experience_id as experienceId, eb.participant_name as participantName, eb.party_size as partySize,
              eb.total_cents as totalCents, eb.status, eb.payment_status as paymentStatus, eb.created_at as createdAt,
              e.title, e.image_url as imageUrl, e.kind, es.date, es.time
       FROM experience_bookings eb
       JOIN experiences e ON e.id = eb.experience_id
       JOIN experience_sessions es ON es.id = eb.session_id
       WHERE (eb.client_id = ? OR (eb.resident_id IS NOT NULL AND eb.resident_id = ?)) AND eb.payment_status = 'paid'
       ORDER BY eb.created_at DESC`
    )
    .all(clientId, req.resident?.id ?? "");
  res.json(rows);
});

experiencesRouter.get("/bookings/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = await db
    .prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM experience_bookings WHERE ref = ? AND client_id = ?`)
    .get(req.params.ref, clientId);
  if (!row) return res.status(404).json({ error: "Booking not found" });
  res.json(row);
});

// "Add to calendar" — same client_id ownership gate + server-generated .ics
// as bookings.ts's own GET /:ref/ics, adapted to a session's date/time
// (Ireland wall-clock, DST-aware) and the listing's duration_minutes for
// the event length instead of a fixed booking duration column.
experiencesRouter.get("/bookings/:ref/ics", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = (await db
    .prepare(
      `SELECT eb.ref, es.date, es.time, e.title, e.duration_minutes as durationMinutes, e.area, e.county, e.meeting_point as meetingPoint
       FROM experience_bookings eb
       JOIN experience_sessions es ON es.id = eb.session_id
       JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? AND eb.client_id = ? AND eb.payment_status = 'paid'`
    )
    .get(req.params.ref, clientId)) as
    | { ref: string; date: string; time: string; title: string; durationMinutes: number; area: string; county: string; meetingPoint: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });

  const [h, m] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, h, m);
  const end = new Date(start.getTime() + Math.max(30, row.durationMinutes) * 60 * 1000);
  const ics = buildIcsEvent({
    uid: `experience-booking-${row.ref}`,
    title: row.title,
    description: row.meetingPoint || undefined,
    location: `${row.area}, ${row.county}`,
    start,
    end,
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="experience-booking-${row.ref}.ics"`);
  res.send(ics);
});
