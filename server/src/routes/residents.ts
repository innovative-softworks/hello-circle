import { Router } from "express";
import { db } from "../db/index.js";
import { listResidentParticipation } from "../db/queries.js";
import { requireResident, updateResident } from "../residents.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const residentsRouter = Router();

// Everything this person has done or is doing, across all 5 participation
// tables — the shared foundation Phase 0's per-type "mine" endpoints
// didn't need (they render rich, type-specific rows) but later
// aggregate-only consumers do (MyStuffContext's nav badge today; My Life/
// Participation Passport/My Places later — see the implementation plan).
// Guest-friendly like bookings/registrations/programs' own endpoints —
// games/circles simply come back empty for a signed-out visitor, since
// those always required a resident account to join in the first place.
residentsRouter.get("/me/participation", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const items = await listResidentParticipation(clientId, req.guestEmail ?? null, req.resident?.id ?? null);
  res.json(items);
});

residentsRouter.get("/me", async (req, res) => {
  if (!req.resident) return res.json({ resident: null });
  const row = (await db
    .prepare(
      `SELECT interests, availability, onboarding_completed as onboardingCompleted, notification_prefs as notificationPrefs,
              accessibility_prefs as accessibilityPrefs, search_radius_km as searchRadiusKm
       FROM residents WHERE id = ?`
    )
    .get(req.resident.id)) as {
    interests: string | null;
    availability: string | null;
    onboardingCompleted: number;
    notificationPrefs: string | null;
    accessibilityPrefs: string | null;
    searchRadiusKm: number;
  };
  res.json({
    resident: {
      ...req.resident,
      interests: row.interests ? row.interests.split(",").filter(Boolean) : [],
      availability: row.availability ? row.availability.split(",").filter(Boolean) : [],
      onboardingCompleted: !!row.onboardingCompleted,
      notificationPrefs: row.notificationPrefs ? JSON.parse(row.notificationPrefs) : null,
      accessibilityPrefs: row.accessibilityPrefs ? JSON.parse(row.accessibilityPrefs) : [],
      searchRadiusKm: row.searchRadiusKm,
    },
  });
});

residentsRouter.put("/me", requireResident, async (req, res) => {
  const { name, homeCounty } = req.body as { name?: string; homeCounty?: string };
  await updateResident(req.resident!.id, { name, homeCounty });
  res.json({ ok: true });
});

// --- onboarding (Phase A) ---------------------------------------------
// Signal-only: stored and returned, wired into recommendations later (see
// plan doc). Skippable at every step on the client — nothing here is ever
// required to keep using the app.

interface OnboardingBody {
  homeCounty?: string;
  searchRadiusKm?: number;
  interests?: string[];
  availability?: string[];
}

residentsRouter.put("/me/onboarding", requireResident, async (req, res) => {
  const b = req.body as OnboardingBody;
  await db
    .prepare(
      `UPDATE residents SET
        home_county = COALESCE(?, home_county),
        search_radius_km = COALESCE(?, search_radius_km),
        interests = COALESCE(?, interests),
        availability = COALESCE(?, availability),
        onboarding_completed = 1
       WHERE id = ?`
    )
    .run(b.homeCounty, b.searchRadiusKm, b.interests ? b.interests.join(",") : undefined, b.availability ? b.availability.join(",") : undefined, req.resident!.id);
  res.json({ ok: true });
});

residentsRouter.post("/me/onboarding/skip", requireResident, async (req, res) => {
  await db.prepare(`UPDATE residents SET onboarding_completed = 1 WHERE id = ?`).run(req.resident!.id);
  res.json({ ok: true });
});

// --- preferences (Phase A) ----------------------------------------------

residentsRouter.put("/me/notification-prefs", requireResident, async (req, res) => {
  await db.prepare(`UPDATE residents SET notification_prefs = ? WHERE id = ?`).run(JSON.stringify(req.body ?? {}), req.resident!.id);
  res.json({ ok: true });
});

residentsRouter.put("/me/accessibility-prefs", requireResident, async (req, res) => {
  const { prefs } = req.body as { prefs?: string[] };
  await db.prepare(`UPDATE residents SET accessibility_prefs = ? WHERE id = ?`).run(JSON.stringify(prefs ?? []), req.resident!.id);
  res.json({ ok: true });
});

// --- receipts / payment history (Phase A) -----------------------------
// Aggregates every paid line item across the four independent payment
// paths that exist in this codebase (bookings, registrations, games,
// passes) into one list — there is no shared "payments" table to query.

residentsRouter.get("/me/receipts", requireResident, async (req, res) => {
  const id = req.resident!.id;
  const [bookings, registrations, games, passes] = await Promise.all([
    db
      .prepare(
        `SELECT b.ref, 'booking' as kind, c.name as label, b.total_cents as totalCents, b.created_at as createdAt, b.payment_status as paymentStatus
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.resident_id = ? ORDER BY b.created_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT r.ref, 'registration' as kind, c.name as label, r.total_cents as totalCents, r.created_at as createdAt, r.payment_status as paymentStatus
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.resident_id = ? ORDER BY r.created_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT gp.ref, 'game' as kind, g.activity_label as label, COALESCE(g.price_cents, 0) as totalCents, gp.joined_at as createdAt, gp.payment_status as paymentStatus
         FROM game_participants gp JOIN games g ON g.id = gp.game_id WHERE gp.resident_id = ? AND gp.ref IS NOT NULL ORDER BY gp.joined_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT p.ref, 'pass' as kind, c.name as label, p.purchased_cents as totalCents, p.created_at as createdAt, p.payment_status as paymentStatus
         FROM passes p LEFT JOIN clubs c ON c.id = p.listing_id WHERE p.resident_id = ? ORDER BY p.created_at DESC`
      )
      .all(id),
  ]);
  const all = [...bookings, ...registrations, ...games, ...passes].sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(all);
});

// --- resident-facing notifications (MVP) ------------------------------
// Mirrors the shape of the existing vendor notification routes
// (routes/vendor.ts GET /notifications, POST /notifications/:id/read) —
// same table, just scoped by resident_id instead of recipient_id.

residentsRouter.get("/me/notifications", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, kind, title, body, listing_type as listingType, listing_id as listingId, ref, \`read\`, created_at as createdAt
       FROM notifications WHERE resident_id = ? ORDER BY created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

residentsRouter.post("/me/notifications/:id/read", requireResident, async (req, res) => {
  const info = await db.prepare(`UPDATE notifications SET \`read\` = 1 WHERE id = ? AND resident_id = ?`).run(req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
