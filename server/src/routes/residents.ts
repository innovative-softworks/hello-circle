import crypto from "node:crypto";
import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth.js";
import { db } from "../db/index.js";
import { getRoutineSuggestions, listResidentParticipation, reviewStats } from "../db/queries.js";
import { MOOD_KEYWORDS } from "./discover.js";
import { getResidentPasswordHash, requireResident, setResidentPassword, updateResident } from "../residents.js";
import { passwordLoginLimiter } from "../rateLimit.js";
import { stripe } from "../stripe.js";
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
              accessibility_prefs as accessibilityPrefs, search_radius_km as searchRadiusKm,
              host_status as hostStatus, host_bio as hostBio, host_phone as hostPhone,
              goals, pref_group_size as prefGroupSize, pref_beginner_friendly as prefBeginnerFriendly,
              pref_solo_friendly as prefSoloFriendly, pref_budget as prefBudget,
              hide_from_familiar_count as hideFromFamiliarCount, discoverable_by_name as discoverableByName,
              (password_hash IS NOT NULL) as hasPassword
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
    },
  });
});

residentsRouter.put("/me", requireResident, async (req, res) => {
  const { name, homeCounty } = req.body as { name?: string; homeCounty?: string };
  await updateResident(req.resident!.id, { name, homeCounty });
  res.json({ ok: true });
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
residentsRouter.get("/:id/host-profile", async (req, res) => {
  const host = (await db.prepare(`SELECT id, name, host_bio as bio, host_status as hostStatus FROM residents WHERE id = ?`).get(req.params.id)) as
    | { id: string; name: string; bio: string | null; hostStatus: string }
    | undefined;
  if (!host || host.hostStatus !== "verified") return res.status(404).json({ error: "Host not found" });

  const today = new Date().toISOString().slice(0, 10);
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

  res.json({ id: host.id, name: host.name, bio: host.bio ?? "", upcomingGames: games, circles, gamesHostedTotal, rating, reviews });
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
      b.interests ? b.interests.join(",") : undefined,
      b.availability ? b.availability.join(",") : undefined,
      b.goals ? b.goals.join(",") : undefined,
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
      `SELECT id, name FROM residents WHERE discoverable_by_name = 1 AND id != ? AND name LIKE ? ORDER BY name LIMIT 10`
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
