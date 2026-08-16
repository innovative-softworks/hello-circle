import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { db } from "../db/index.js";

export const platformAdminRouter = Router();
platformAdminRouter.use(requireAdmin);

// Platform Admin (Phase D, best-effort — see plan doc "decisions" section:
// most of this is genuinely premature with one real tenant, built anyway at
// the requester's direction rather than skipped, and honestly labeled here
// as such). Reuses the existing admin role rather than inventing a separate
// "platform staff" identity — there is no real distinction to enforce yet
// between "runs this organisation" and "runs the platform" when there is
// exactly one organisation that matters.

platformAdminRouter.get("/dashboard", async (_req, res) => {
  const stats = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM organisations) as tenants,
        (SELECT COUNT(*) FROM centres WHERE status = 'approved') + (SELECT COUNT(*) FROM clubs WHERE status = 'approved') as activeListings,
        (SELECT COUNT(*) FROM bookings WHERE DATE(created_at) = CURDATE()) + (SELECT COUNT(*) FROM registrations WHERE DATE(created_at) = CURDATE()) as bookingsToday,
        (SELECT COUNT(*) FROM bookings WHERE payment_status = 'failed') + (SELECT COUNT(*) FROM registrations WHERE payment_status = 'failed') as paymentFailures,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending') as openReports`
    )
    .get()) as Record<string, number>;
  res.json(stats);
});

// --- tenants ---------------------------------------------------------------

platformAdminRouter.get("/tenants", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT o.id, o.name, o.kind, o.created_at as createdAt,
              (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) as userCount,
              (SELECT COUNT(*) FROM centres c WHERE c.vendor_id IN (SELECT id FROM users WHERE org_id = o.id)) +
              (SELECT COUNT(*) FROM clubs c WHERE c.vendor_id IN (SELECT id FROM users WHERE org_id = o.id)) as listingCount
       FROM organisations o ORDER BY o.created_at DESC`
    )
    .all();
  res.json(rows);
});

platformAdminRouter.get("/tenants/:id", async (req, res) => {
  const org = (await db.prepare(`SELECT id, name, kind, created_at as createdAt FROM organisations WHERE id = ?`).get(req.params.id)) as
    | { id: string; name: string; kind: string; createdAt: string }
    | undefined;
  if (!org) return res.status(404).json({ error: "Organisation not found" });
  const staff = await db.prepare(`SELECT id, name, email, platform_role as platformRole, invited_staff as invitedStaff, status FROM users WHERE org_id = ?`).all(req.params.id);
  const flags = await db.prepare(`SELECT flag_key as flagKey, enabled FROM feature_flags WHERE org_id = ?`).all(req.params.id);
  res.json({ org, staff, flags });
});

// --- platform users ----------------------------------------------------

platformAdminRouter.get("/users", async (_req, res) => {
  const rows = await db
    .prepare(`SELECT id, email, name, role, status, org_id as orgId, platform_role as platformRole, created_at as createdAt FROM users ORDER BY created_at DESC LIMIT 200`)
    .all();
  res.json(rows);
});

// --- feature flags (per org) --------------------------------------------

const DEFAULT_FLAGS = ["circles", "games", "search", "demand_intelligence"];

platformAdminRouter.get("/feature-flags/:orgId", async (req, res) => {
  const rows = (await db.prepare(`SELECT flag_key as flagKey, enabled FROM feature_flags WHERE org_id = ?`).all(req.params.orgId)) as {
    flagKey: string;
    enabled: number;
  }[];
  const set = new Map(rows.map((r) => [r.flagKey, !!r.enabled]));
  res.json(DEFAULT_FLAGS.map((key) => ({ flagKey: key, enabled: set.has(key) ? set.get(key) : true })));
});

platformAdminRouter.put("/feature-flags/:orgId", async (req, res) => {
  const { flagKey, enabled } = req.body as { flagKey?: string; enabled?: boolean };
  if (!flagKey || !DEFAULT_FLAGS.includes(flagKey)) return res.status(400).json({ error: `flagKey must be one of ${DEFAULT_FLAGS.join(", ")}` });
  await db
    .prepare(`INSERT INTO feature_flags (org_id, flag_key, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`)
    .run(req.params.orgId, flagKey, enabled ? 1 : 0);
  res.json({ ok: true });
});

// --- moderation (Phase D) -----------------------------------------------
// Report creation itself is public (see routes/reports.ts) — this is the
// review/resolve side only.

platformAdminRouter.get("/moderation/reports", async (_req, res) => {
  const rows = await db.prepare(`SELECT id, target_type as targetType, target_id as targetId, reason, status, created_at as createdAt FROM reports WHERE status = 'pending' ORDER BY created_at`).all();
  res.json(rows);
});

platformAdminRouter.put("/moderation/reports/:id", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["dismissed", "actioned"].includes(status)) return res.status(400).json({ error: "status must be dismissed or actioned" });
  const info = await db.prepare(`UPDATE reports SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Report not found" });
  res.json({ ok: true });
});

// --- audit log -----------------------------------------------------------

platformAdminRouter.get("/audit", async (req, res) => {
  const actorUserId = typeof req.query.actorUserId === "string" ? req.query.actorUserId : undefined;
  const rows = actorUserId
    ? await db
        .prepare(
          `SELECT al.id, al.actor_user_id as actorUserId, u.email as actorEmail, al.action, al.object_type as objectType, al.object_id as objectId,
                  al.previous_value as previousValue, al.new_value as newValue, al.created_at as createdAt
           FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.actor_user_id = ? ORDER BY al.created_at DESC LIMIT 200`
        )
        .all(actorUserId)
    : await db
        .prepare(
          `SELECT al.id, al.actor_user_id as actorUserId, u.email as actorEmail, al.action, al.object_type as objectType, al.object_id as objectId,
                  al.previous_value as previousValue, al.new_value as newValue, al.created_at as createdAt
           FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id ORDER BY al.created_at DESC LIMIT 200`
        )
        .all();
  res.json(rows);
});

// --- support console -----------------------------------------------------

platformAdminRouter.get("/support/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json({ bookings: [], registrations: [], users: [] });
  const like = `%${q}%`;
  const [bookings, registrations, users] = await Promise.all([
    db.prepare(`SELECT ref, name, email, date, time, status, payment_status as paymentStatus FROM bookings WHERE ref = ? OR email LIKE ? LIMIT 20`).all(q, like),
    db.prepare(`SELECT ref, g_first as gFirst, g_last as gLast, email, status, payment_status as paymentStatus FROM registrations WHERE ref = ? OR email LIKE ? LIMIT 20`).all(q, like),
    db.prepare(`SELECT id, email, name, role, status FROM users WHERE email LIKE ? LIMIT 20`).all(like),
  ]);
  res.json({ bookings, registrations, users });
});

// --- system status (best-effort — not real monitoring) ---------------------

platformAdminRouter.get("/status", async (_req, res) => {
  const dbOk = await db
    .prepare(`SELECT 1 as ok`)
    .get()
    .then(() => true)
    .catch(() => false);
  res.json({
    database: dbOk ? "ok" : "down",
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    smtpConfigured: !!process.env.SMTP_HOST,
  });
});
