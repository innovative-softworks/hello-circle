import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { hashPassword, verifyPassword } from "../auth.js";
import { dataDir } from "../dataDir.js";
import { db } from "../db/index.js";
import { getRoutineSuggestions, listResidentParticipation, reviewStats } from "../db/queries.js";
import { irelandTodayIso } from "../irelandTime.js";
import { MOOD_KEYWORDS } from "./discover.js";
import { getResidentPasswordHash, requireResident, setResidentPassword, updateResident } from "../residents.js";
import { GUEST_SESSION_COOKIE, destroyGuestSession } from "../guestAuth.js";
import { passwordLoginLimiter } from "../rateLimit.js";
import { stripe } from "../stripe.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const residentsRouter = Router();

// Profile photo — same multer pipeline/mimetype allowlist as
// routes/uploads.ts, duplicated rather than reused because that router is
// deliberately requireVendorOrAdmin-gated and shouldn't grow a resident
// carve-out; this one is requireResident-gated instead and writes into the
// same shared uploads/ dir either way, so both are served identically by
// index.ts's existing /uploads static mount.
const AVATAR_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const avatarUploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(avatarUploadDir, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: avatarUploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${AVATAR_MIME_EXT[file.mimetype] ?? ""}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in AVATAR_MIME_EXT)) return cb(new Error("Only JPEG, PNG or WebP images are allowed"));
    cb(null, true);
  },
});

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
              accessibility_prefs as accessibilityPrefs, search_radius_km as searchRadiusKm,
              host_status as hostStatus, host_bio as hostBio, host_phone as hostPhone,
              goals, pref_group_size as prefGroupSize, pref_beginner_friendly as prefBeginnerFriendly,
              pref_solo_friendly as prefSoloFriendly, pref_budget as prefBudget,
              hide_from_familiar_count as hideFromFamiliarCount, discoverable_by_name as discoverableByName,
              (password_hash IS NOT NULL) as hasPassword, (email_verified_at IS NOT NULL) as emailVerified
       FROM residents WHERE id = ?`
    )
    .get(req.resident.id)) as {
    interests: string | null;
    availability: string | null;
    onboardingCompleted: number;
    notificationPrefs: string | null;
    accessibilityPrefs: string | null;
    searchRadiusKm: number;
    hostStatus: "none" | "pending" | "verified" | "rejected";
    hostBio: string | null;
    hostPhone: string;
    goals: string | null;
    prefGroupSize: string;
    prefBeginnerFriendly: number;
    prefSoloFriendly: number;
    prefBudget: string;
    hideFromFamiliarCount: number;
    discoverableByName: number;
    hasPassword: number;
    emailVerified: number;
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
      hostStatus: row.hostStatus,
      hostBio: row.hostBio ?? "",
      hostPhone: row.hostPhone,
      goals: row.goals ? row.goals.split(",").filter(Boolean) : [],
      prefGroupSize: row.prefGroupSize,
      prefBeginnerFriendly: !!row.prefBeginnerFriendly,
      prefSoloFriendly: !!row.prefSoloFriendly,
      prefBudget: row.prefBudget,
      hideFromFamiliarCount: !!row.hideFromFamiliarCount,
      discoverableByName: !!row.discoverableByName,
      hasPassword: !!row.hasPassword,
      emailVerified: !!row.emailVerified,
    },
  });
});

residentsRouter.put("/me", requireResident, async (req, res) => {
  const { name, homeCounty, homeLat, homeLng } = req.body as { name?: string; homeCounty?: string; homeLat?: number; homeLng?: number };
  await updateResident(req.resident!.id, { name, homeCounty, homeLat, homeLng });
  res.json({ ok: true });
});

residentsRouter.post("/me/avatar", requireResident, avatarUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const url = `/uploads/${req.file.filename}`;
  const previous = req.resident!.avatarUrl;
  await db.prepare(`UPDATE residents SET avatar_url = ? WHERE id = ?`).run(url, req.resident!.id);
  // Best-effort cleanup of the file it's replacing — never blocks the
  // response on it, matching this app's general "an upload failure never
  // blocks the thing it's attached to" convention (see notifications.ts).
  if (previous) {
    fs.unlink(path.join(dataDir, previous), () => {});
  }
  res.status(201).json({ avatarUrl: url });
});

residentsRouter.delete("/me/avatar", requireResident, async (req, res) => {
  const previous = req.resident!.avatarUrl;
  await db.prepare(`UPDATE residents SET avatar_url = NULL WHERE id = ?`).run(req.resident!.id);
  if (previous) {
    fs.unlink(path.join(dataDir, previous), () => {});
  }
  res.json({ ok: true });
});

residentsRouter.use((err: Error, _req: unknown, res: import("express").Response, next: (err?: unknown) => void) => {
  if (err instanceof multer.MulterError || err.message.includes("images are allowed")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Account deactivation (Profile redesign follow-up) — soft, self-reversing
// (see db/index.ts's `deactivated_at` schema comment for why this isn't a
// real delete, and guestAuth.ts's createGuestSession() for the reactivate-
// on-next-sign-in side). Ends the current session immediately, same as a
// manual sign-out, since staying "logged in" while deactivated makes no
// sense — every page here reads req.resident, which a redeactivated row
// would still populate.
residentsRouter.post("/me/deactivate", requireResident, async (req, res) => {
  await db.prepare(`UPDATE residents SET deactivated_at = NOW() WHERE id = ?`).run(req.resident!.id);
  const token = req.cookies?.[GUEST_SESSION_COOKIE] as string | undefined;
  if (token) await destroyGuestSession(token);
  res.clearCookie(GUEST_SESSION_COOKIE);
  res.json({ ok: true });
});

// Data export ("download my data") — a single JSON snapshot of everything
// this resident's own settings pages already show them piecemeal (profile,
// household, favourites, notifications, blocked people, reports). Bookings/
// registrations/receipts already have their own full history under My Life/
// Receipts and aren't re-aggregated here — this is the account/profile side
// of "my data", not a GDPR-certified full export of every payment record.
residentsRouter.get("/me/export", requireResident, async (req, res) => {
  const residentId = req.resident!.id;
  // Reports are keyed by X-Client-Id, not resident id — reporting itself
  // never required being signed in (see routes/reports.ts) — so this only
  // finds reports filed from the same browser/device requesting the export,
  // same scoping GET /reports/mine already uses.
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch {
    // No/invalid X-Client-Id — export everything else, just skip reports.
  }
  const [profileRow, household, favourites, notifications, blocked, reports] = await Promise.all([
    db.prepare(`SELECT * FROM residents WHERE id = ?`).get(residentId),
    db.prepare(`SELECT first_name, last_name, dob, guardian_consent_given FROM household_members WHERE resident_id = ?`).all(residentId),
    db.prepare(`SELECT listing_type, listing_id, status FROM favourites WHERE resident_id = ?`).all(residentId),
    db.prepare(`SELECT title, body, created_at, \`read\` FROM notifications WHERE resident_id = ?`).all(residentId),
    db.prepare(`SELECT blocked_resident_id, created_at FROM blocked_residents WHERE blocker_resident_id = ?`).all(residentId),
    clientId
      ? db.prepare(`SELECT target_type, reason, status, created_at FROM reports WHERE reporter_client_id = ?`).all(clientId)
      : [],
  ]);
  const profile = profileRow as Record<string, unknown> | undefined;
  if (profile) delete profile.password_hash;
  res.setHeader("Content-Disposition", `attachment; filename="hellocircle-data-${residentId}.json"`);
  res.json({ exportedAt: new Date().toISOString(), profile, household, favourites, notifications, blocked, reports });
});

// --- Host tier (IA spec five-layer audit) ---------------------------------
// Badge-only trust signal, never a gate on hosting a Game/Circle — see
// games.ts/circles.ts, which surface hostVerified from host_status but
// never check it before allowing a create. Submitting this form is the
// guidelines acceptance for v1 — no separate accept/versioning step.
residentsRouter.post("/me/host-application", requireResident, async (req, res) => {
  const { bio, phone } = req.body as { bio?: string; phone?: string };
  if (!bio || !bio.trim()) return res.status(400).json({ error: "A short bio is required" });

  const current = (await db.prepare(`SELECT host_status as hostStatus FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { hostStatus: string }
    | undefined;
  if (current?.hostStatus === "pending" || current?.hostStatus === "verified") {
    return res.status(409).json({ error: "You already have a host application on file" });
  }

  await db
    .prepare(
      `UPDATE residents SET host_status = 'pending', host_bio = ?, host_phone = ?, host_applied_at = NOW(), host_decided_at = NULL WHERE id = ?`
    )
    .run(bio.trim(), phone ?? "", req.resident!.id);
  res.json({ ok: true });
});

// Host public profile (IA spec §5) — public, no auth required, and only
// ever resolves for a verified host. Never exposes email/phone; only what
// participation-relevant info the spec's own "Host public profile" screen
// asks for (activities hosted, verification, hosting experience).
//
// Now also carries isFollowing/followerCount (Follow feature) — this
// reverses this file's own prior comment ("no followers/likes/social
// popularity"), a real earlier design decision from the original IA spec,
// now superseded by explicit instruction to extend Follow to Hosts too.
residentsRouter.get("/:id/host-profile", async (req, res) => {
  const host = (await db.prepare(`SELECT id, name, host_bio as bio, host_status as hostStatus FROM residents WHERE id = ?`).get(req.params.id)) as
    | { id: string; name: string; bio: string | null; hostStatus: string }
    | undefined;
  if (!host || host.hostStatus !== "verified") return res.status(404).json({ error: "Host not found" });

  const today = irelandTodayIso();
  const games = await db
    .prepare(`SELECT id, activity_label as activityLabel, date, time FROM games WHERE host_resident_id = ? AND status = 'open' AND date >= ? ORDER BY date, time`)
    .all(req.params.id, today);
  const circles = await db
    .prepare(`SELECT id, name, activity_label as activityLabel, slug FROM circles WHERE created_by_resident_id = ? ORDER BY name`)
    .all(req.params.id);
  const { n: gamesHostedTotal } = (await db.prepare(`SELECT COUNT(*) as n FROM games WHERE host_resident_id = ?`).get(req.params.id)) as { n: number };
  // Host reviews (master-prompt punch list #3) — reuses the same
  // reviewStats() aggregation centres/clubs already use, just for
  // listing_type='host'.
  const { rating, reviews } = await reviewStats("host", req.params.id);
  const { n: followerCount } = (await db.prepare(`SELECT COUNT(*) as n FROM follows WHERE followed_type = 'host' AND followed_id = ?`).get(req.params.id)) as { n: number };
  const followRow = req.resident
    ? ((await db
        .prepare(`SELECT notification_level as notificationLevel FROM follows WHERE resident_id = ? AND followed_type = 'host' AND followed_id = ?`)
        .get(req.resident.id, req.params.id)) as { notificationLevel: "highlights" | "everything" } | undefined)
    : undefined;

  res.json({
    id: host.id,
    name: host.name,
    bio: host.bio ?? "",
    upcomingGames: games,
    circles,
    gamesHostedTotal,
    rating,
    reviews,
    followerCount: Number(followerCount),
    isFollowing: !!followRow,
    followNotificationLevel: followRow?.notificationLevel ?? "highlights",
  });
});

// --- Routines-as-an-object (IA spec §9) ------------------------------------
// A personal planning aid, never an automatic booking — see db/index.ts's
// routines table comment. `day_of_week` is MySQL's DAYOFWEEK() convention
// (1=Sunday..7=Saturday), matched by getRoutineSuggestions().

residentsRouter.get("/me/routine-suggestions", requireResident, async (req, res) => {
  res.json(await getRoutineSuggestions(req.resident!.id));
});

residentsRouter.get("/me/routines", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT r.id, r.activity_label as activityLabel, r.centre_id as centreId, c.name as centreName, r.day_of_week as dayOfWeek, r.time, r.status, r.created_at as createdAt
       FROM routines r LEFT JOIN centres c ON c.id = r.centre_id
       WHERE r.resident_id = ? AND r.status != 'cancelled' ORDER BY r.day_of_week, r.time`
    )
    .all(req.resident!.id);
  res.json(rows);
});

residentsRouter.post("/me/routines", requireResident, async (req, res) => {
  const { activityLabel, centreId, dayOfWeek, time } = req.body as { activityLabel?: string; centreId?: string; dayOfWeek?: number; time?: string };
  if (!activityLabel || dayOfWeek === undefined || dayOfWeek < 1 || dayOfWeek > 7) {
    return res.status(400).json({ error: "activityLabel and a valid dayOfWeek (1-7) are required" });
  }
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO routines (id, resident_id, activity_label, centre_id, day_of_week, time) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, req.resident!.id, activityLabel, centreId ?? null, dayOfWeek, time ?? "");
  res.status(201).json({ id });
});

residentsRouter.put("/me/routines/:id", requireResident, async (req, res) => {
  const { status, time } = req.body as { status?: string; time?: string };
  if (status !== undefined && !["active", "paused", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be active, paused or cancelled" });
  }
  const info = await db
    .prepare(`UPDATE routines SET status = COALESCE(?, status), time = COALESCE(?, time) WHERE id = ? AND resident_id = ?`)
    .run(status, time, req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Routine not found" });
  res.json({ ok: true });
});

// --- saved-search alerts (master-prompt punch list #5) -----------------
// Trigger-based matching happens at game-creation time — see
// ../searchAlerts.ts's matchSearchAlertsForGame(), called from
// games.ts's POST /.

residentsRouter.get("/me/search-alerts", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, county, keywords, mood, active, created_at as createdAt
       FROM search_alerts WHERE resident_id = ? ORDER BY created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

residentsRouter.post("/me/search-alerts", requireResident, async (req, res) => {
  const { county, keywords, mood } = req.body as { county?: string; keywords?: string; mood?: string };
  if (!county?.trim() && !keywords?.trim() && !mood?.trim()) {
    return res.status(400).json({ error: "Give at least a county, keywords, or a mood to match on" });
  }
  if (mood && !Object.keys(MOOD_KEYWORDS).includes(mood)) {
    return res.status(400).json({ error: "Unrecognised mood" });
  }
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO search_alerts (id, resident_id, county, keywords, mood) VALUES (?, ?, ?, ?, ?)`)
    .run(id, req.resident!.id, county?.trim() ?? "", keywords?.trim() || null, mood?.trim() || null);
  res.status(201).json({ id });
});

residentsRouter.put("/me/search-alerts/:id", requireResident, async (req, res) => {
  const { active } = req.body as { active?: boolean };
  if (active === undefined) return res.status(400).json({ error: "active is required" });
  const info = await db
    .prepare(`UPDATE search_alerts SET active = ? WHERE id = ? AND resident_id = ?`)
    .run(active ? 1 : 0, req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Alert not found" });
  res.json({ ok: true });
});

residentsRouter.delete("/me/search-alerts/:id", requireResident, async (req, res) => {
  const info = await db.prepare(`DELETE FROM search_alerts WHERE id = ? AND resident_id = ?`).run(req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Alert not found" });
  res.json({ ok: true });
});

// --- onboarding (Phase A) ---------------------------------------------
// Signal-only: stored and returned, wired into recommendations later (see
// plan doc). Skippable at every step on the client — nothing here is ever
// required to keep using the app.

// Mirrors client/src/types.ts's INTEREST_OPTIONS/AVAILABILITY_OPTIONS/
// GOAL_OPTIONS (no shared types package between client/server — see
// CLAUDE.md). interests/availability/goals are stored as comma-joined text
// (not a structured/queryable shape — a known, accepted gap), so a value
// containing a literal comma would silently split into malformed entries on
// the next read; the official client only ever sends values from these
// fixed lists, but nothing server-side enforced that. Filtering (rather than
// rejecting the whole request) matches the rest of onboarding's "never gates
// anything" behaviour — an unrecognized value is just dropped.
const INTEREST_OPTIONS = new Set(["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"]);
const AVAILABILITY_OPTIONS = new Set(["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Saturday", "Sunday"]);
const GOAL_OPTIONS = new Set(["Become more active", "Meet new people", "Find a hobby", "Get outdoors", "Try something new", "Do more with family", "Build a routine", "Explore my area"]);

function sanitizeOptions(values: string[] | undefined, allowed: Set<string>): string[] | undefined {
  return values ? values.filter((v) => allowed.has(v)) : undefined;
}

interface OnboardingBody {
  homeCounty?: string;
  searchRadiusKm?: number;
  interests?: string[];
  availability?: string[];
  /** IA spec §2 — "what would make life better right now", multi-select. */
  goals?: string[];
  /** IA spec §2's "participation comfort" step — travel distance and
   * preferred times already exist above (searchRadiusKm/availability), so
   * only the remaining 3 fields are collected here. Empty string means
   * no preference, not unset — never gates anything, same as every other
   * onboarding field. */
  prefGroupSize?: string;
  prefBeginnerFriendly?: boolean;
  prefSoloFriendly?: boolean;
  prefBudget?: string;
}

residentsRouter.put("/me/onboarding", requireResident, async (req, res) => {
  const b = req.body as OnboardingBody;
  const interests = sanitizeOptions(b.interests, INTEREST_OPTIONS);
  const availability = sanitizeOptions(b.availability, AVAILABILITY_OPTIONS);
  const goals = sanitizeOptions(b.goals, GOAL_OPTIONS);
  await db
    .prepare(
      `UPDATE residents SET
        home_county = COALESCE(?, home_county),
        search_radius_km = COALESCE(?, search_radius_km),
        interests = COALESCE(?, interests),
        availability = COALESCE(?, availability),
        goals = COALESCE(?, goals),
        pref_group_size = COALESCE(?, pref_group_size),
        pref_beginner_friendly = COALESCE(?, pref_beginner_friendly),
        pref_solo_friendly = COALESCE(?, pref_solo_friendly),
        pref_budget = COALESCE(?, pref_budget),
        onboarding_completed = 1
       WHERE id = ?`
    )
    .run(
      b.homeCounty,
      b.searchRadiusKm,
      interests ? interests.join(",") : undefined,
      availability ? availability.join(",") : undefined,
      goals ? goals.join(",") : undefined,
      b.prefGroupSize,
      b.prefBeginnerFriendly === undefined ? undefined : b.prefBeginnerFriendly ? 1 : 0,
      b.prefSoloFriendly === undefined ? undefined : b.prefSoloFriendly ? 1 : 0,
      b.prefBudget,
      req.resident!.id
    );
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

// --- native push (Capacitor migration Phase 5) --------------------------
// device_push_tokens is keyed by token, not resident_id, since the same
// device can sign out and back in as a different resident — the upsert
// repoints an existing device's row rather than accumulating stale ones.
residentsRouter.post("/me/push-token", requireResident, async (req, res) => {
  const { token, platform } = req.body as { token?: string; platform?: string };
  if (!token || !platform) return res.status(400).json({ error: "token and platform are required" });
  await db
    .prepare(
      `INSERT INTO device_push_tokens (resident_id, token, platform) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE resident_id = VALUES(resident_id), platform = VALUES(platform)`
    )
    .run(req.resident!.id, token, platform);
  res.json({ ok: true });
});

// Called on sign-out so a shared/reused device stops receiving push for an
// account that's no longer signed in on it.
residentsRouter.delete("/me/push-token", requireResident, async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "token is required" });
  await db.prepare(`DELETE FROM device_push_tokens WHERE resident_id = ? AND token = ?`).run(req.resident!.id, token);
  res.json({ ok: true });
});

// --- receipts / payment history (Phase A) -----------------------------
// Aggregates every paid line item across the four independent payment
// paths that exist in this codebase (bookings, registrations, games,
// passes) into one list — there is no shared "payments" table to query.

residentsRouter.get("/me/receipts", requireResident, async (req, res) => {
  const id = req.resident!.id;
  const [bookings, registrations, games, passes, programEnrollments] = await Promise.all([
    db
      .prepare(
        `SELECT b.ref, 'booking' as kind, c.name as label, b.total_cents as totalCents, b.created_at as createdAt, b.payment_status as paymentStatus,
                b.date as date, b.time as time, b.centre_id as centreId
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.resident_id = ? ORDER BY b.created_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT r.ref, 'registration' as kind, c.name as label, r.total_cents as totalCents, r.created_at as createdAt, r.payment_status as paymentStatus,
                NULL as date, NULL as time, NULL as centreId
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.resident_id = ? ORDER BY r.created_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT gp.ref, 'game' as kind, g.activity_label as label, COALESCE(g.price_cents, 0) as totalCents, gp.joined_at as createdAt, gp.payment_status as paymentStatus,
                NULL as date, NULL as time, NULL as centreId
         FROM game_participants gp JOIN games g ON g.id = gp.game_id WHERE gp.resident_id = ? AND gp.ref IS NOT NULL ORDER BY gp.joined_at DESC`
      )
      .all(id),
    db
      .prepare(
        `SELECT p.ref, 'pass' as kind, c.name as label, p.purchased_cents as totalCents, p.created_at as createdAt, p.payment_status as paymentStatus,
                NULL as date, NULL as time, NULL as centreId
         FROM passes p LEFT JOIN clubs c ON c.id = p.listing_id WHERE p.resident_id = ? ORDER BY p.created_at DESC`
      )
      .all(id),
    // Previously missing here — a resident tapping their own program
    // enrollment from My Life fell through to this same receipt lookup
    // (ParticipationRow's generic fallback) and found nothing, showing a
    // permanent "Loading…" instead of the QR/calendar receipt view.
    db
      .prepare(
        `SELECT pe.ref, 'program_enrollment' as kind, pr.title as label, pe.total_cents as totalCents, pe.created_at as createdAt, pe.payment_status as paymentStatus,
                NULL as date, NULL as time, NULL as centreId
         FROM program_enrollments pe JOIN programs pr ON pr.id = pe.program_id WHERE pe.resident_id = ? ORDER BY pe.created_at DESC`
      )
      .all(id),
  ]);
  const all = [...bookings, ...registrations, ...games, ...passes, ...programEnrollments].sort(
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

// --- Safety Centre (IA spec §13) ---------------------------------------
// Storage + visibility only, deliberately — see blocked_residents' own
// comment in db/index.ts. Nothing in chat/game-join reads this table yet;
// this is the resident-facing "who have I blocked" list itself.

residentsRouter.get("/me/blocked", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT b.blocked_resident_id as id, r.name, b.created_at as createdAt
       FROM blocked_residents b JOIN residents r ON r.id = b.blocked_resident_id
       WHERE b.blocker_resident_id = ? ORDER BY b.created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

residentsRouter.post("/me/blocked/:residentId", requireResident, async (req, res) => {
  if (req.params.residentId === req.resident!.id) return res.status(400).json({ error: "You can't block yourself" });
  await db
    .prepare(`INSERT IGNORE INTO blocked_residents (blocker_resident_id, blocked_resident_id) VALUES (?, ?)`)
    .run(req.resident!.id, req.params.residentId);
  res.json({ ok: true });
});

residentsRouter.delete("/me/blocked/:residentId", requireResident, async (req, res) => {
  await db.prepare(`DELETE FROM blocked_residents WHERE blocker_resident_id = ? AND blocked_resident_id = ?`).run(req.resident!.id, req.params.residentId);
  res.json({ ok: true });
});

// Privacy toggles: opt out of appearing in someone else's "familiar
// participants" count (read by countFamiliarCoParticipants() in
// queries.ts), and opt IN to being findable by GET /search below (off by
// default — see discoverable_by_name's own schema comment).
residentsRouter.put("/me/privacy-prefs", requireResident, async (req, res) => {
  const { hideFromFamiliarCount, discoverableByName } = req.body as { hideFromFamiliarCount?: boolean; discoverableByName?: boolean };
  await db
    .prepare(`UPDATE residents SET hide_from_familiar_count = COALESCE(?, hide_from_familiar_count), discoverable_by_name = COALESCE(?, discoverable_by_name) WHERE id = ?`)
    .run(hideFromFamiliarCount === undefined ? undefined : hideFromFamiliarCount ? 1 : 0, discoverableByName === undefined ? undefined : discoverableByName ? 1 : 0, req.resident!.id);
  res.json({ ok: true });
});

// Set/change password (My Life redesign) — lets an existing magic-link-only
// resident opt into password login later, from Profile. Changing an
// already-set password requires the current one; setting one for the first
// time doesn't, since there's nothing to prove yet beyond the session
// itself (the resident is already signed in via a verified magic link).
// Same passwordLoginLimiter budget as the login route itself, since this is
// still a place someone could try to guess a current password.
residentsRouter.put("/me/password", requireResident, passwordLoginLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const existing = await getResidentPasswordHash(req.resident!.email);
  if (existing?.passwordHash) {
    if (!currentPassword || !verifyPassword(currentPassword, existing.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }
  await setResidentPassword(req.resident!.id, hashPassword(newPassword));
  res.json({ ok: true, hasPassword: true });
});

// Circle invite picker (implementation backlog #3) — only ever matches
// residents who opted in via discoverable_by_name; never returns
// email/phone, matching the "no PII beyond a name" convention
// HostProfile/ProviderProfile already use for public-ish lookups.
residentsRouter.get("/search", requireResident, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return res.json([]);
  const rows = await db
    .prepare(
      `SELECT id, name FROM residents WHERE discoverable_by_name = 1 AND deactivated_at IS NULL AND id != ? AND name LIKE ? ORDER BY name LIMIT 10`
    )
    .all(req.resident!.id, `%${q}%`);
  res.json(rows);
});

// --- Payment methods (implementation backlog #1) --------------------------
// No separate "add a card" flow here — a card gets saved the idiomatic way
// for a Stripe-Checkout-based app: the "Save my payment details" checkbox
// checkoutService.ts's createCheckoutSession() now offers on every real
// purchase (see its own saved_payment_method_options comment). This is
// read/manage-only: list what's saved, set a default, remove one. 503s the
// same way every other Stripe-dependent route in this app does when
// unconfigured — never a hard crash.

residentsRouter.get("/me/payment-methods", requireResident, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });
  const row = (await db.prepare(`SELECT stripe_customer_id as stripeCustomerId FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { stripeCustomerId: string | null }
    | undefined;
  if (!row?.stripeCustomerId) return res.json({ methods: [], defaultMethodId: null });

  const [methods, customer] = await Promise.all([
    stripe.paymentMethods.list({ customer: row.stripeCustomerId, type: "card" }),
    stripe.customers.retrieve(row.stripeCustomerId),
  ]);
  const defaultMethodId =
    !customer.deleted && typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;

  res.json({
    methods: methods.data.map((m) => ({
      id: m.id,
      brand: m.card?.brand ?? "card",
      last4: m.card?.last4 ?? "????",
      expMonth: m.card?.exp_month ?? 0,
      expYear: m.card?.exp_year ?? 0,
    })),
    defaultMethodId,
  });
});

residentsRouter.put("/me/payment-methods/:id/default", requireResident, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });
  const row = (await db.prepare(`SELECT stripe_customer_id as stripeCustomerId FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { stripeCustomerId: string | null }
    | undefined;
  if (!row?.stripeCustomerId) return res.status(404).json({ error: "No saved payment methods" });
  await stripe.customers.update(row.stripeCustomerId, { invoice_settings: { default_payment_method: req.params.id } });
  res.json({ ok: true });
});

residentsRouter.delete("/me/payment-methods/:id", requireResident, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Payments aren't configured yet" });
  // detach() takes no customer id — the payment_method id alone identifies
  // it, but only after confirming it actually belongs to this resident's
  // customer, so one resident can't detach another's saved card by guessing
  // a payment_method id.
  const row = (await db.prepare(`SELECT stripe_customer_id as stripeCustomerId FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { stripeCustomerId: string | null }
    | undefined;
  if (!row?.stripeCustomerId) return res.status(404).json({ error: "No saved payment methods" });
  const method = await stripe.paymentMethods.retrieve(req.params.id);
  if (method.customer !== row.stripeCustomerId) return res.status(403).json({ error: "Not your payment method" });
  await stripe.paymentMethods.detach(req.params.id);
  res.json({ ok: true });
});
