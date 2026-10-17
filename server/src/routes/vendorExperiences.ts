import { assertCreatorStillMember } from "../orgStatus.js";
import { cancelExperienceBookingAsProvider } from "../hallBookingCancel.js";
import crypto from "node:crypto";
import { refundOnProviderCancel } from "../providerCancelRefund.js";
import { occupiesCapacitySql, releaseCoupon, releaseRedemption, startIsInFuture } from "../bookingIntegrity.js";
import { syncOrderFromSource } from "../commerce/engine.js";
import { matchExperienceSupply } from "../participationIntents.js";
import { Router } from "express";
import { requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { refundPaidOnce } from "../checkoutService.js";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { HOST_ATTENDANCE_STATUSES } from "../attendanceState.js";
import { orgFeatureFlags } from "../db/queries.js";
import { exceedsGalleryLimit, GALLERY_LIMITS } from "../media/quotas.js";
import { notifyCancellation, notifyRefund } from "../notifications.js";
import { notifyVendorFollowers } from "./follows.js";
import { generateSlug } from "../slugify.js";
import { ConflictError, invalidCoordinateReason } from "../util.js";

// Adventures & Experiences — vendor-side CRUD, split out the same way
// vendorListings.ts/vendorPrograms.ts are (see CLAUDE.md). Mounted under
// vendorRouter in vendor.ts, which applies requireVendor/attachVendorIds
// first. Neither `centre_manager` nor `facility_manager` maps cleanly onto
// a standalone third listing type, so either role is accepted here — an
// invited staff member assigned either can manage Experiences; an org
// owner is unrestricted regardless (see auth.ts's hasPlatformRole).

export const vendorExperiencesRouter = Router();

const EXPERIENCE_ROLES = ["centre_manager", "facility_manager"] as const;

interface ExperienceInput {
  kind?: "adventure" | "experience" | "volunteer";
  /** Release 5 — volunteer listings. */
  skillsRequired?: string;
  cause?: string;
  minAge?: number | null;
  title: string;
  area?: string;
  county?: string;
  lat?: number | null;
  lng?: number | null;
  meetingPoint?: string;
  blurb: string;
  description?: string;
  difficulty?: string;
  durationMinutes?: number;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  terrainType?: string;
  fitnessRequirements?: string;
  itinerary?: string;
  equipmentProvided?: string;
  equipmentRequired?: string;
  transportInfo?: string;
  safetyInfo?: string;
  weatherPolicy?: string;
  eligibility?: string;
  cancellationTerms?: string;
  priceCents?: number;
  capacity?: number;
  paymentMethod?: "online" | "cash";
  imageUrl?: string;
  images?: string[];
}

const EXPERIENCE_KINDS = ["experience", "adventure", "volunteer"] as const;

// Release 5 — volunteer-only fields (skills needed, cause, minimum age) and
// the "volunteering is free" rule, applied after either the create INSERT
// or the partial-update UPDATE so neither big statement needs to change.
// The price rule keys off the row's *effective* kind, so switching an
// existing listing to volunteer also zeroes its price.
async function applyVolunteerFields(tx: Pick<typeof db, "prepare">, id: string, b: Partial<ExperienceInput>) {
  // Only fields actually sent are touched; "" / null clears.
  if (b.skillsRequired !== undefined) await tx.prepare(`UPDATE experiences SET skills_required = ? WHERE id = ?`).run(b.skillsRequired.trim() || null, id);
  if (b.cause !== undefined) await tx.prepare(`UPDATE experiences SET cause = ? WHERE id = ?`).run(b.cause.trim().slice(0, 100), id);
  if (b.minAge !== undefined) await tx.prepare(`UPDATE experiences SET min_age = ? WHERE id = ?`).run(b.minAge && b.minAge > 0 ? Math.floor(b.minAge) : null, id);
  await tx.prepare(`UPDATE experiences SET price_cents = 0 WHERE id = ? AND kind = 'volunteer'`).run(id);
}

async function ownsExperience(vendorIds: string[], id: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM experiences WHERE id = ?`).get(id)) as { vendor_id: string } | undefined;
  return !!row && vendorIds.includes(row.vendor_id);
}

vendorExperiencesRouter.get("/experiences", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT id, kind, title, status, area, county, price_cents as priceCents, capacity, views, created_at as createdAt, image_url as imageUrl
       FROM experiences WHERE vendor_id IN (${ids.map(() => "?").join(", ")}) ORDER BY created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

// HC-QA-061 — the vendor editor reads camelCase (client `Experience`), but
// this route used to return the raw snake_case row, so every multi-word
// field (price_cents, duration_minutes, meeting_point, …) hydrated as
// undefined and the editor showed €NaN / form defaults. The raw columns are
// kept for backward compatibility; the camelCase fields are authoritative.
function toVendorExperienceJson(row: Record<string, any>, images: string[]) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    blurb: row.blurb,
    description: row.description,
    difficulty: row.difficulty,
    area: row.area,
    county: row.county,
    lat: num(row.lat),
    lng: num(row.lng),
    locationSource: row.location_source || "unknown",
    meetingPoint: row.meeting_point,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    capacity: row.capacity,
    paymentMethod: row.payment_method,
    distanceKm: num(row.distance_km),
    elevationGainM: row.elevation_gain_m,
    terrainType: row.terrain_type,
    fitnessRequirements: row.fitness_requirements,
    itinerary: row.itinerary,
    equipmentProvided: row.equipment_provided,
    equipmentRequired: row.equipment_required,
    transportInfo: row.transport_info,
    safetyInfo: row.safety_info,
    accessibilityInfo: row.accessibility_info || null,
    weatherPolicy: row.weather_policy,
    eligibility: row.eligibility,
    cancellationTerms: row.cancellation_terms,
    skillsRequired: row.skills_required || null,
    cause: row.cause || null,
    minAge: row.min_age ?? null,
    imageUrl: row.image_url,
    slug: row.slug,
    featured: !!row.featured,
    createdAt: row.created_at,
    images,
  };
}

/** HC-QA-061 — money/capacity fields must be real non-negative integers
 * (a display or parsing slip must never be persisted). Only checks fields
 * that are actually present, matching the COALESCE partial-update style. */
function invalidExperienceNumbers(b: Record<string, unknown>): string | null {
  const intOk = (v: unknown, min: number) => typeof v === "number" && Number.isInteger(v) && v >= min;
  if (b.priceCents !== undefined && b.priceCents !== null && !intOk(b.priceCents, 0)) return "Price must be zero or more, in whole cents";
  if (b.durationMinutes !== undefined && b.durationMinutes !== null && !intOk(b.durationMinutes, 1)) return "Duration must be a whole number of minutes";
  if (b.capacity !== undefined && b.capacity !== null && !intOk(b.capacity, 1)) return "Capacity must be at least 1";
  return null;
}

vendorExperiencesRouter.get("/experiences/:id", async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const row = await db.prepare(`SELECT * FROM experiences WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const images = await db.prepare(`SELECT url FROM experience_images WHERE experience_id = ? ORDER BY sort_order`).all(req.params.id);
  res.json(toVendorExperienceJson(row as Record<string, any>, (images as { url: string }[]).map((i) => i.url)));
});

vendorExperiencesRouter.post("/experiences", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  const b = req.body as Partial<ExperienceInput> & { title: string };
  // Relaxed to just a title (Form System Audit, Phase 5 fast-follow — same
  // draft-row-first pattern as POST /centres/POST /clubs): a Guided Flow
  // wizard creates this row after its first step, then fills in the rest
  // across later steps' PUTs, until POST /experiences/:id/publish flips it
  // to 'pending' once title+blurb are both actually present.
  if (!b.title) return res.status(400).json({ error: "A title is required" });
  const numberError = invalidExperienceNumbers(b as Record<string, unknown>);
  if (numberError) return res.status(400).json({ error: numberError });
  const coordError = invalidCoordinateReason(b.lat, b.lng);
  if (coordError) return res.status(400).json({ error: coordError });
  if (exceedsGalleryLimit("experience", (b.images ?? []).length)) {
    return res.status(400).json({ error: `An experience can have at most ${GALLERY_LIMITS.experience} photos (cover + gallery)` });
  }
  // Feature flags (implementation backlog #5) — admin can disable
  // Experiences for an org; server-enforced, not just a hidden button.
  if (!(await orgFeatureFlags(req.user!.id)).experiences) {
    return res.status(403).json({ error: "Experiences aren't enabled for your organisation" });
  }

  const id = crypto.randomUUID();
  const slug = await generateSlug("experiences", b.title);
  // Unlike centres/clubs, an Experience has no approximateCoords()
  // fallback — a meeting point with no supplied address just stays
  // uncoordinated (spec: "do not fabricate a pin"), so the only two
  // real states here are 'confirmed' (vendor picked one via AddressSearch)
  // or the column's own 'unknown' default (nothing supplied yet).
  const locationSource = b.lat !== undefined && b.lng !== undefined && b.lat !== null && b.lng !== null ? "confirmed" : undefined;
  await db.transaction(async (tx) => {
    // D-08: refuse if the creator was removed from the organisation meanwhile.
    await assertCreatorStillMember(tx, req.user!);
    await tx
      .prepare(
        `INSERT INTO experiences (id, vendor_id, kind, title, area, county, lat, lng, location_source, meeting_point, blurb, description,
          difficulty, duration_minutes, distance_km, elevation_gain_m, terrain_type, fitness_requirements, itinerary, equipment_provided, equipment_required,
          transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity,
          payment_method, image_url, status, slug)
         VALUES (@id, @vendorId, @kind, @title, @area, @county, @lat, @lng, COALESCE(@locationSource, 'unknown'), @meetingPoint, @blurb, @description,
          @difficulty, @durationMinutes, @distanceKm, @elevationGainM, @terrainType, @fitnessRequirements, @itinerary, @equipmentProvided, @equipmentRequired,
          @transportInfo, @safetyInfo, @weatherPolicy, @eligibility, @cancellationTerms, @priceCents, @capacity,
          @paymentMethod, @imageUrl, 'draft', @slug)`
      )
      .run({
        id,
        slug,
        vendorId: req.user!.id,
        kind: b.kind === "adventure" || b.kind === "volunteer" ? b.kind : "experience",
        title: b.title,
        area: b.area ?? "",
        county: b.county ?? "",
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        locationSource,
        meetingPoint: b.meetingPoint ?? "",
        blurb: b.blurb ?? "",
        description: b.description ?? "",
        difficulty: b.difficulty ?? "",
        durationMinutes: b.durationMinutes ?? 120,
        distanceKm: b.distanceKm ?? null,
        elevationGainM: b.elevationGainM ?? null,
        terrainType: b.terrainType ?? "",
        fitnessRequirements: b.fitnessRequirements ?? "",
        itinerary: b.itinerary ?? "",
        equipmentProvided: b.equipmentProvided ?? "",
        equipmentRequired: b.equipmentRequired ?? "",
        transportInfo: b.transportInfo ?? "",
        safetyInfo: b.safetyInfo ?? "",
        weatherPolicy: b.weatherPolicy ?? "",
        eligibility: b.eligibility ?? "",
        cancellationTerms: b.cancellationTerms ?? "",
        // Volunteering is always free — never trust a client price for it.
        priceCents: b.kind === "volunteer" ? 0 : b.priceCents ?? 0,
        capacity: b.capacity ?? 8,
        paymentMethod: b.paymentMethod ?? "online",
        imageUrl: (b.images ?? [])[0] ?? b.imageUrl ?? "",
      });
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO experience_images (experience_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
    await applyVolunteerFields(tx, id, b);
  });
  const fromDemand = (req.body as { fromDemand?: string }).fromDemand;
  if (fromDemand) void logEvent("host_created_from_demand", { metadata: { kind: "experience", id, clusterKey: fromDemand, userId: req.user!.id } });
  res.status(201).json({ id });
});

vendorExperiencesRouter.put("/experiences/:id", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  // Same convention as centres/clubs' PUT: status is never settable here —
  // approve/reject is an admin-only decision (admin.ts's dedicated status
  // endpoint), and a vendor's own "remove" path is the DELETE below (soft-
  // delete to 'deleted'), not this general-purpose edit endpoint.
  const b = req.body as Partial<ExperienceInput>;
  // `kind` goes straight into the UPDATE below — only the real kinds.
  if (b.kind !== undefined && !EXPERIENCE_KINDS.includes(b.kind)) return res.status(400).json({ error: `kind must be one of: ${EXPERIENCE_KINDS.join(", ")}` });
  const coordError = invalidCoordinateReason(b.lat, b.lng);
  if (coordError) return res.status(400).json({ error: coordError });
  const numberError = invalidExperienceNumbers(b as Record<string, unknown>);
  if (numberError) return res.status(400).json({ error: numberError });
  if (b.images && exceedsGalleryLimit("experience", b.images.length)) {
    return res.status(400).json({ error: `An experience can have at most ${GALLERY_LIMITS.experience} photos (cover + gallery)` });
  }
  // 'confirmed' only when a real (non-null) pair is supplied — leaves the
  // column untouched (COALESCE) for any other save, same discipline as
  // centres/clubs' PUT handlers.
  const locationSource = b.lat !== undefined && b.lng !== undefined && b.lat !== null && b.lng !== null ? "confirmed" : undefined;
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE experiences SET
          kind = COALESCE(?, kind), title = COALESCE(?, title), area = COALESCE(?, area), county = COALESCE(?, county),
          lat = COALESCE(?, lat), lng = COALESCE(?, lng), location_source = COALESCE(?, location_source), meeting_point = COALESCE(?, meeting_point),
          blurb = COALESCE(?, blurb), description = COALESCE(?, description), difficulty = COALESCE(?, difficulty),
          duration_minutes = COALESCE(?, duration_minutes), distance_km = COALESCE(?, distance_km),
          elevation_gain_m = COALESCE(?, elevation_gain_m), terrain_type = COALESCE(?, terrain_type),
          fitness_requirements = COALESCE(?, fitness_requirements),
          itinerary = COALESCE(?, itinerary), equipment_provided = COALESCE(?, equipment_provided),
          equipment_required = COALESCE(?, equipment_required), transport_info = COALESCE(?, transport_info),
          safety_info = COALESCE(?, safety_info), weather_policy = COALESCE(?, weather_policy),
          eligibility = COALESCE(?, eligibility), cancellation_terms = COALESCE(?, cancellation_terms),
          price_cents = COALESCE(?, price_cents), capacity = COALESCE(?, capacity),
          payment_method = COALESCE(?, payment_method), image_url = COALESCE(?, image_url)
         WHERE id = ?`
      )
      .run(
        b.kind,
        b.title,
        b.area,
        b.county,
        b.lat,
        b.lng,
        locationSource,
        b.meetingPoint,
        b.blurb,
        b.description,
        b.difficulty,
        b.durationMinutes,
        b.distanceKm,
        b.elevationGainM,
        b.terrainType,
        b.fitnessRequirements,
        b.itinerary,
        b.equipmentProvided,
        b.equipmentRequired,
        b.transportInfo,
        b.safetyInfo,
        b.weatherPolicy,
        b.eligibility,
        b.cancellationTerms,
        b.priceCents,
        b.capacity,
        b.paymentMethod,
        b.images ? b.images[0] ?? "" : undefined,
        req.params.id
      );
    if (b.images) {
      await tx.prepare(`DELETE FROM experience_images WHERE experience_id = ?`).run(req.params.id);
      for (const [i, url] of b.images.entries()) {
        await tx.prepare(`INSERT INTO experience_images (experience_id, url, sort_order) VALUES (?, ?, ?)`).run(req.params.id, url, i);
      }
    }
    await applyVolunteerFields(tx, req.params.id, b);
  });
  res.json({ ok: true });
});

vendorExperiencesRouter.post("/experiences/:id/publish", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const row = (await db.prepare(`SELECT title, blurb, status FROM experiences WHERE id = ?`).get(req.params.id)) as
    | { title: string; blurb: string; status: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Listing not found" });
  if (row.status !== "draft" && row.status !== "rejected") return res.status(400).json({ error: "This listing has already been submitted" });
  const missing = [!row.title && "a title", !row.blurb && "a short blurb"].filter(Boolean) as string[];
  if (missing.length) {
    return res.status(400).json({ error: `This listing is missing ${missing.join(", ")} — go back and fill that in before publishing.` });
  }
  await db.prepare(`UPDATE experiences SET status = 'pending' WHERE id = ?`).run(req.params.id);
  writeAudit({ actorUserId: req.user!.id, action: "experience.published", objectType: "experience", objectId: req.params.id, previousValue: { status: row.status }, newValue: { title: row.title } });
  res.json(await db.prepare(`SELECT id FROM experiences WHERE id = ?`).get(req.params.id));
});

vendorExperiencesRouter.delete("/experiences/:id", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE experiences SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// --- sessions (bookable departures) ----------------------------------------

vendorExperiencesRouter.get("/experiences/:id/sessions", async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(`SELECT id, date, time, capacity, status, sales_close_at as salesCloseAt, series_id as seriesId FROM experience_sessions WHERE experience_id = ? ORDER BY date, time`)
    .all(req.params.id);
  res.json(rows);
});

vendorExperiencesRouter.post("/experiences/:id/sessions", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const { date, time, capacity, repeatWeeks, salesCloseHours } = req.body as { date?: string; time?: string; capacity?: number; repeatWeeks?: number; salesCloseHours?: number };
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Use a date (YYYY-MM-DD) and a time (HH:MM)" });
  // OG-19 — repeating departures: the same time every week for up to 26 weeks.
  const weeks = repeatWeeks === undefined || repeatWeeks === null ? 1 : Number(repeatWeeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) return res.status(400).json({ error: "Repeat for between 1 and 26 weeks" });
  // OG-19 — bookings close this many hours before each departure starts (optional).
  const closeHours = salesCloseHours === undefined || salesCloseHours === null ? null : Number(salesCloseHours);
  if (closeHours !== null && (!Number.isInteger(closeHours) || closeHours < 0 || closeHours > 720)) return res.status(400).json({ error: "Close bookings between 0 and 720 hours before the start" });
  if (capacity !== undefined && capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) return res.status(400).json({ error: "Capacity must be a whole number of at least 1" });
  const seriesId = weeks > 1 ? crypto.randomUUID() : null;
  const ids: string[] = [];
  const [hh, mm] = time.split(":").map(Number);
  for (let w = 0; w < weeks; w++) {
    const day = new Date(Date.parse(`${date}T12:00:00Z`) + w * 7 * 86_400_000).toISOString().slice(0, 10);
    const sid = crypto.randomUUID();
    const closeAt = closeHours === null ? null : new Date(irelandWallTimeToUtc(day, hh, mm).getTime() - closeHours * 3_600_000);
    await db
      .prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, capacity, sales_close_at, series_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(sid, req.params.id, day, time, capacity ?? null, closeAt, seriesId);
    ids.push(sid);
  }
  const id = ids[0];

  // Follow feature — a new session on an existing listing only reaches
  // followers who opted into every update, not everyone following this
  // vendor (unlike a brand-new listing going live, which is Highlights-
  // worthy for everyone — see admin.ts's notifyFollowersOfNewListing).
  const experience = (await db.prepare(`SELECT vendor_id as vendorId, title FROM experiences WHERE id = ?`).get(req.params.id)) as { vendorId: string | null; title: string } | undefined;
  if (experience?.vendorId) {
    await notifyVendorFollowers(experience.vendorId, { title: "New session added", body: `A new session was added for ${experience.title} on ${date}.`, ref: id }, "everything");
  }

  await matchExperienceSupply(req.params.id); // Release 6 — a new date is new supply
  res.status(201).json({ id, ids, seriesId });
});

// OG-19 — change one departure's capacity or booking cut-off. Capacity can't
// drop below the places already taken; nothing about prices changes.
vendorExperiencesRouter.put("/experiences/:id/sessions/:sessionId", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const { capacity, salesCloseAt, salesCloseHours } = req.body as { capacity?: number | null; salesCloseAt?: string | null; salesCloseHours?: number | null };
  const result = await db.transaction(async (tx) => {
    const session = (await tx.prepare(`SELECT id, status, date, time FROM experience_sessions WHERE id = ? AND experience_id = ? FOR UPDATE`).get(req.params.sessionId, req.params.id)) as { id: string; status: string; date: string; time: string } | undefined;
    if (!session) return { status: 404, error: "Departure not found" };
    if (session.status !== "scheduled") return { status: 409, error: "This departure is no longer running" };
    if (capacity !== undefined && capacity !== null) {
      if (!Number.isInteger(capacity) || capacity < 1) return { status: 400, error: "Capacity must be a whole number of at least 1" };
      const { n } = (await tx.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ${occupiesCapacitySql()}`).get(session.id)) as { n: number | string };
      if (capacity < Number(n)) return { status: 409, error: `${n} places are already taken — capacity can't be lower than that` };
    }
    // The cut-off can be given as hours before the (Ireland wall-clock) start, or as an instant.
    if (salesCloseHours !== undefined && salesCloseHours !== null && (!Number.isInteger(salesCloseHours) || salesCloseHours < 0 || salesCloseHours > 720)) return { status: 400, error: "Close bookings between 0 and 720 hours before the start" };
    const [hh, mm] = session.time.split(":").map(Number);
    const close =
      salesCloseHours !== undefined
        ? salesCloseHours === null
          ? null
          : new Date(irelandWallTimeToUtc(session.date, hh, mm).getTime() - salesCloseHours * 3_600_000)
        : salesCloseAt === undefined
          ? undefined
          : salesCloseAt === null || salesCloseAt === ""
            ? null
            : new Date(salesCloseAt);
    if (close instanceof Date && Number.isNaN(close.getTime())) return { status: 400, error: "That closing time isn't valid" };
    await tx
      .prepare(`UPDATE experience_sessions SET capacity = COALESCE(?, capacity), sales_close_at = IF(?, ?, sales_close_at) WHERE id = ?`)
      .run(capacity ?? null, close !== undefined ? 1 : 0, close ?? null, session.id);
    return { status: 200 };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  await writeAudit({ actorUserId: req.user!.id, action: "experience_session.updated", objectType: "experience_session", objectId: req.params.sessionId, newValue: { capacity, salesCloseAt, salesCloseHours } });
  res.json({ ok: true });
});

// OG-19 — move a booking to another departure of the same experience, when
// the customer asked for it (the partner confirms that; a change the partner
// wants needs the customer's agreement, DEC-17 — cancel instead otherwise).
// Same booking, same payment; the target departure's capacity is re-checked
// under its row lock.
vendorExperiencesRouter.post("/experiences/:id/bookings/:bookingId/move", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const { sessionId, customerAsked, note } = req.body as { sessionId?: string; customerAsked?: boolean; note?: string };
  if (customerAsked !== true) return res.status(400).json({ error: "Confirm the customer asked for this move — otherwise cancel the booking (they're refunded in full)" });
  if (!sessionId) return res.status(400).json({ error: "Choose the departure to move to" });
  try {
    const moved = await db.transaction(async (tx) => {
      const b = (await tx
        .prepare(`SELECT eb.ref, eb.session_id as sessionId, eb.party_size as partySize, eb.status, eb.payment_status as paymentStatus FROM experience_bookings eb WHERE eb.id = ? AND eb.experience_id = ? FOR UPDATE`)
        .get(req.params.bookingId, req.params.id)) as { ref: string; sessionId: string; partySize: number; status: string; paymentStatus: string } | undefined;
      if (!b) throw new ConflictError("Booking not found");
      if (b.status === "cancelled" || b.paymentStatus !== "paid") throw new ConflictError("Only a confirmed booking can be moved");
      if (b.sessionId === sessionId) throw new ConflictError("It's already on that departure");
      const target = (await tx
        .prepare(`SELECT es.id, es.date, es.time, es.status, COALESCE(es.capacity, e.capacity) as cap FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id WHERE es.id = ? AND es.experience_id = ? FOR UPDATE`)
        .get(sessionId, req.params.id)) as { id: string; date: string; time: string; status: string; cap: number } | undefined;
      if (!target || target.status !== "scheduled") throw new ConflictError("That departure isn't running");
      if (!startIsInFuture(target.date, target.time)) throw new ConflictError("That departure has already started");
      const { n } = (await tx.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ${occupiesCapacitySql()}`).get(target.id)) as { n: number | string };
      if (Number(n) + b.partySize > Number(target.cap)) throw new ConflictError("Not enough places left on that departure");
      await tx.prepare(`UPDATE experience_bookings SET session_id = ? WHERE ref = ?`).run(target.id, b.ref);
      return { ref: b.ref, from: b.sessionId, to: target };
    });
    await writeAudit({ actorUserId: req.user!.id, action: "experience_booking.moved", objectType: "experience_booking", objectId: moved.ref, previousValue: { sessionId: moved.from }, newValue: { sessionId: moved.to.id, date: moved.to.date, time: moved.to.time, customerAsked: true }, reason: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : undefined });
    res.json({ ok: true, date: moved.to.date, time: moved.to.time });
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    throw e;
  }
});

vendorExperiencesRouter.delete("/experiences/:id/sessions/:sessionId", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  // HC-QA-040 — cancelling a session cancels its active bookings in the same
  // transaction (row-locked, idempotent): a repeat cancel finds nothing to do.
  // Paid bookings become status='cancelled'; since Booking UX Phase 6 each paid
  // online one is then refunded in full (refundOnProviderCancel, after the
  // transaction) — a failed refund leaves it in the "refund required" state
  // the vendor refund route acts on. Pending holds are released.
  const affected = await db.transaction(async (tx) => {
    const session = (await tx
      .prepare(`SELECT id, status, date, time FROM experience_sessions WHERE id = ? AND experience_id = ? FOR UPDATE`)
      .get(req.params.sessionId, req.params.id)) as { id: string; status: string; date: string; time: string } | undefined;
    if (!session || session.status === "cancelled") return { session, rows: [] as { ref: string; participantName: string; email: string; residentId: string | null }[] };
    await tx.prepare(`UPDATE experience_sessions SET status = 'cancelled' WHERE id = ?`).run(session.id);
    const rows = (await tx
      .prepare(`SELECT ref, participant_name as participantName, email, resident_id as residentId FROM experience_bookings WHERE session_id = ? AND status != 'cancelled' AND payment_status IN ('paid', 'pending')`)
      .all(session.id)) as { ref: string; participantName: string; email: string; residentId: string | null }[];
    await tx.prepare(`UPDATE experience_bookings SET status = 'cancelled' WHERE session_id = ? AND status != 'cancelled' AND payment_status IN ('paid', 'pending')`).run(session.id);
    // Commerce audit R28 — pending holds end here, so hand back the coupon use
    // each one reserved (endPendingHold's rule), in this same transaction.
    const pending = (await tx
      .prepare(`SELECT ref, coupon_code as couponCode FROM experience_bookings WHERE session_id = ? AND payment_status = 'pending' FOR UPDATE`)
      .all(session.id)) as { ref: string; couponCode: string | null }[];
    await tx.prepare(`UPDATE experience_bookings SET payment_status = 'failed' WHERE session_id = ? AND payment_status = 'pending'`).run(session.id);
    for (const p of pending) {
      await releaseCoupon(tx, p.couponCode);
      await releaseRedemption(tx, "experience_bookings", p.ref);
    }
    return { session, rows };
  });
  for (const b of affected.rows) await syncOrderFromSource("experience", b.ref);
  let refunded = 0;
  let refundsFailed = 0;
  if (affected.session && affected.rows.length) {
    const exp = (await db.prepare(`SELECT title, vendor_id as vendorId FROM experiences WHERE id = ?`).get(req.params.id)) as { title: string; vendorId: string };
    await writeAudit({
      actorUserId: req.user!.id,
      action: "experience_session.cancelled_by_vendor",
      objectType: "experience_session",
      objectId: req.params.sessionId,
      newValue: { status: "cancelled", bookingsCancelled: affected.rows.length },
    });
    for (const b of affected.rows) {
      const notifyParams = {
        kind: "experience",
        listingType: "experience",
        listingId: req.params.id,
        listingName: exp.title,
        vendorId: exp.vendorId,
        guestName: b.participantName,
        guestEmail: b.email,
        ref: b.ref,
        detailsText: `${affected.session.date} at ${affected.session.time} · ${exp.title} — this departure was cancelled by the host`,
        residentId: b.residentId,
      } as const;
      notifyCancellation(notifyParams).catch((e) => console.error("[notifications] session cancellation notify failed:", e));
      // Booking UX Phase 6 (B13) — every paid online booking on the cancelled departure is refunded in full.
      const refund = await refundOnProviderCancel({ table: "experience_bookings", ref: b.ref, actorUserId: req.user!.id, objectType: "experience_booking", notify: notifyParams });
      if (refund.refund === "refunded") refunded++;
      if (refund.refund === "failed") refundsFailed++;
    }
  }
  res.json({ ok: true, bookingsCancelled: affected.rows.length, refunded, refundsFailed });
});

// --- booking cancel + refund (Phase 0 protect) -------------------------
// Experience bookings previously had no vendor-facing cancel/refund route
// at all. Same shape as vendorOperations.ts's booking/registration
// cancel+refund and vendorPrograms.ts's enrollment cancel+refund above —
// status-only cancel, finance-gated Stripe refund with the
// payment_status='paid' idempotency guard built in from day one.

vendorExperiencesRouter.post("/experiences/:id/bookings/:bookingId/cancel", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const found = (await db.prepare(`SELECT ref FROM experience_bookings WHERE id = ? AND experience_id = ?`).get(req.params.bookingId, req.params.id)) as { ref: string } | undefined;
  if (!found) return res.status(404).json({ error: "Booking not found" });
  // Shared with HelloCircle admin cancellations (hallBookingCancel.ts).
  const result = await cancelExperienceBookingAsProvider({ ref: found.ref, actorUserId: req.user!.id, vendorIds: req.vendorIds!, action: "experience_booking.cancelled_by_vendor" });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, refund: result.refund, ...(result.refundError ? { refundError: result.refundError } : {}) });
});

vendorExperiencesRouter.post("/experiences/:id/bookings/:bookingId/refund", requirePlatformRole("finance"), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });

  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.payment_status as paymentStatus, eb.stripe_session_id as stripeSessionId, eb.participant_name as participantName, eb.email, eb.resident_id as residentId,
              es.date, es.time, e.title, e.vendor_id as vendorId
       FROM experience_bookings eb
       JOIN experience_sessions es ON es.id = eb.session_id
       JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.id = ? AND eb.experience_id = ?`
    )
    .get(req.params.bookingId, req.params.id)) as
    | { ref: string; paymentStatus: string; stripeSessionId: string | null; participantName: string; email: string; residentId: string | null; date: string; time: string; title: string; vendorId: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.paymentStatus === "refunded") return res.status(409).json({ error: "This booking has already been refunded" });
  if (row.paymentStatus !== "paid") return res.status(400).json({ error: "Only a paid booking can be refunded" });
  if (!row.stripeSessionId) return res.status(400).json({ error: "This was a cash booking — refund the participant directly, not through Stripe" });

  // HC-QA-051 — lock, re-check, refund and mark refunded in one transaction;
  // concurrent requests get 409 instead of each calling the provider.
  const result = await refundPaidOnce("experience_bookings", "ref = ?", [row.ref], row.stripeSessionId, "This booking has already been refunded", { actorUserId: req.user!.id, objectType: "experience_booking", objectId: row.ref });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await writeAudit({
    actorUserId: req.user!.id,
    action: result.reconciled ? "experience_booking.refund_reconciled_external" : "experience_booking.refunded_by_vendor",
    objectType: "experience_booking",
    objectId: row.ref,
    previousValue: { paymentStatus: row.paymentStatus },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents, source: result.reconciled ? "stripe_external" : "hellocircle" },
  });

  notifyRefund({
    kind: "experience",
    listingType: "experience",
    listingId: req.params.id,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.title}`,
    refundedCents: result.amountCents,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] experience booking refund notify failed:", e));

  res.json({ ok: true });
});

// Attendance for an experience booking (Release 3) — experiences had no
// check-in path at all. Same attendance table and present/no_show pair as
// the booking/registration check-in in vendorOperations.ts; kind
// 'experience', keyed on the booking ref. Only for a paid, not-cancelled
// booking whose session has started (you can't miss something in advance).
vendorExperiencesRouter.post("/experiences/:id/bookings/:ref/attendance", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const status = (req.body?.status ?? "present") as string;
  if (!(HOST_ATTENDANCE_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: "status must be present or no_show" });
  const row = (await db
    .prepare(
      `SELECT eb.status, eb.payment_status as paymentStatus, es.date FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.ref = ? AND eb.experience_id = ?`
    )
    .get(req.params.ref, req.params.id)) as { status: string; paymentStatus: string; date: string } | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.paymentStatus !== "paid" || row.status === "cancelled") return res.status(409).json({ error: "Only a paid, active booking can be marked" });
  if (row.date > irelandTodayIso()) return res.status(409).json({ error: "You can mark attendance once the session has started" });
  await db
    .prepare(
      `INSERT INTO attendance (kind, ref, checked_in_by, status, source) VALUES ('experience', ?, ?, ?, 'host_manual')
       ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by), status = VALUES(status), source = VALUES(source)`
    )
    .run(req.params.ref, req.user!.id, status);
  if (status === "present") void logEvent("attendance_confirmed", { metadata: { kind: "experience", ref: req.params.ref, by: "host" } });
  res.json({ ok: true, status });
});

vendorExperiencesRouter.get("/experiences/:id/bookings", async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = (await db
    .prepare(
      `SELECT eb.id, eb.ref, eb.participant_name as participantName, eb.email, eb.phone, eb.party_size as partySize,
              eb.total_cents as totalCents, eb.status, eb.created_at as createdAt, es.date, es.time, eb.session_id as sessionId,
              (SELECT a.status FROM attendance a WHERE a.kind = 'experience' AND a.ref = eb.ref) as attendance
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.experience_id = ? AND eb.payment_status = 'paid' ORDER BY es.date, es.time`
    )
    .all(req.params.id)) as { ref: string }[];
  // Booking UX Phase 4 (B7) — the named people in each party, seat order.
  const names = rows.length
    ? ((await db
        .prepare(`SELECT booking_ref as ref, name FROM experience_booking_participants WHERE booking_ref IN (${rows.map(() => "?").join(",")}) ORDER BY booking_ref, seat`)
        .all(...rows.map((r) => r.ref))) as { ref: string; name: string }[])
    : [];
  res.json(rows.map((r) => ({ ...r, participants: names.filter((n) => n.ref === r.ref).map((n) => n.name) })));
});
