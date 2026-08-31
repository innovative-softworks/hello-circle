import crypto from "node:crypto";
import { Router } from "express";
import { requirePlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { orgFeatureFlags } from "../db/queries.js";
import { notifyVendorFollowers } from "./follows.js";
import { generateSlug } from "../slugify.js";

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
  kind?: "adventure" | "experience";
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

vendorExperiencesRouter.get("/experiences/:id", async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const row = await db.prepare(`SELECT * FROM experiences WHERE id = ?`).get(req.params.id);
  const images = await db.prepare(`SELECT url FROM experience_images WHERE experience_id = ? ORDER BY sort_order`).all(req.params.id);
  res.json({ ...(row as object), images: (images as { url: string }[]).map((i) => i.url) });
});

vendorExperiencesRouter.post("/experiences", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  const b = req.body as Partial<ExperienceInput> & { title: string };
  // Relaxed to just a title (Form System Audit, Phase 5 fast-follow — same
  // draft-row-first pattern as POST /centres/POST /clubs): a Guided Flow
  // wizard creates this row after its first step, then fills in the rest
  // across later steps' PUTs, until POST /experiences/:id/publish flips it
  // to 'pending' once title+blurb are both actually present.
  if (!b.title) return res.status(400).json({ error: "A title is required" });
  // Feature flags (implementation backlog #5) — admin can disable
  // Experiences for an org; server-enforced, not just a hidden button.
  if (!(await orgFeatureFlags(req.user!.id)).experiences) {
    return res.status(403).json({ error: "Experiences aren't enabled for your organisation" });
  }

  const id = crypto.randomUUID();
  const slug = await generateSlug("experiences", b.title);
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO experiences (id, vendor_id, kind, title, area, county, lat, lng, meeting_point, blurb, description,
          difficulty, duration_minutes, distance_km, elevation_gain_m, terrain_type, fitness_requirements, itinerary, equipment_provided, equipment_required,
          transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity,
          payment_method, image_url, status, slug)
         VALUES (@id, @vendorId, @kind, @title, @area, @county, @lat, @lng, @meetingPoint, @blurb, @description,
          @difficulty, @durationMinutes, @distanceKm, @elevationGainM, @terrainType, @fitnessRequirements, @itinerary, @equipmentProvided, @equipmentRequired,
          @transportInfo, @safetyInfo, @weatherPolicy, @eligibility, @cancellationTerms, @priceCents, @capacity,
          @paymentMethod, @imageUrl, 'draft', @slug)`
      )
      .run({
        id,
        slug,
        vendorId: req.user!.id,
        kind: b.kind === "adventure" ? "adventure" : "experience",
        title: b.title,
        area: b.area ?? "",
        county: b.county ?? "",
        lat: b.lat ?? null,
        lng: b.lng ?? null,
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
        priceCents: b.priceCents ?? 0,
        capacity: b.capacity ?? 8,
        paymentMethod: b.paymentMethod ?? "online",
        imageUrl: (b.images ?? [])[0] ?? b.imageUrl ?? "",
      });
    for (const [i, url] of (b.images ?? []).entries()) {
      await tx.prepare(`INSERT INTO experience_images (experience_id, url, sort_order) VALUES (?, ?, ?)`).run(id, url, i);
    }
  });
  res.status(201).json({ id });
});

vendorExperiencesRouter.put("/experiences/:id", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  // Same convention as centres/clubs' PUT: status is never settable here —
  // approve/reject is an admin-only decision (admin.ts's dedicated status
  // endpoint), and a vendor's own "remove" path is the DELETE below (soft-
  // delete to 'deleted'), not this general-purpose edit endpoint.
  const b = req.body as Partial<ExperienceInput>;
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE experiences SET
          kind = COALESCE(?, kind), title = COALESCE(?, title), area = COALESCE(?, area), county = COALESCE(?, county),
          lat = COALESCE(?, lat), lng = COALESCE(?, lng), meeting_point = COALESCE(?, meeting_point),
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
  });
  res.json({ ok: true });
});

vendorExperiencesRouter.post("/experiences/:id/publish", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const row = (await db.prepare(`SELECT title, blurb, status FROM experiences WHERE id = ?`).get(req.params.id)) as
    | { title: string; blurb: string; status: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Listing not found" });
  if (row.status !== "draft") return res.status(400).json({ error: "This listing has already been submitted" });
  const missing = [!row.title && "a title", !row.blurb && "a short blurb"].filter(Boolean) as string[];
  if (missing.length) {
    return res.status(400).json({ error: `This listing is missing ${missing.join(", ")} — go back and fill that in before publishing.` });
  }
  await db.prepare(`UPDATE experiences SET status = 'pending' WHERE id = ?`).run(req.params.id);
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
    .prepare(`SELECT id, date, time, capacity, status FROM experience_sessions WHERE experience_id = ? ORDER BY date, time`)
    .all(req.params.id);
  res.json(rows);
});

vendorExperiencesRouter.post("/experiences/:id/sessions", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const { date, time, capacity } = req.body as { date?: string; time?: string; capacity?: number };
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, capacity) VALUES (?, ?, ?, ?, ?)`)
    .run(id, req.params.id, date, time, capacity ?? null);

  // Follow feature — a new session on an existing listing only reaches
  // followers who opted into every update, not everyone following this
  // vendor (unlike a brand-new listing going live, which is Highlights-
  // worthy for everyone — see admin.ts's notifyFollowersOfNewListing).
  const experience = (await db.prepare(`SELECT vendor_id as vendorId, title FROM experiences WHERE id = ?`).get(req.params.id)) as { vendorId: string | null; title: string } | undefined;
  if (experience?.vendorId) {
    await notifyVendorFollowers(experience.vendorId, { title: "New session added", body: `A new session was added for ${experience.title} on ${date}.`, ref: id }, "everything");
  }

  res.status(201).json({ id });
});

vendorExperiencesRouter.delete("/experiences/:id/sessions/:sessionId", requirePlatformRole(...EXPERIENCE_ROLES), async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  await db.prepare(`UPDATE experience_sessions SET status = 'cancelled' WHERE id = ? AND experience_id = ?`).run(req.params.sessionId, req.params.id);
  res.json({ ok: true });
});

vendorExperiencesRouter.get("/experiences/:id/bookings", async (req, res) => {
  if (!(await ownsExperience(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT eb.id, eb.ref, eb.participant_name as participantName, eb.email, eb.phone, eb.party_size as partySize,
              eb.total_cents as totalCents, eb.status, eb.created_at as createdAt, es.date, es.time
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.experience_id = ? AND eb.payment_status = 'paid' ORDER BY es.date, es.time`
    )
    .all(req.params.id);
  res.json(rows);
});
