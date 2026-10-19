import crypto from "node:crypto";
import { matchExperienceSupply } from "../participationIntents.js";
import { DEFAULT_WEIGHTS, getRecommendationWeights, setRecommendationWeights, validateWeights } from "../recommendationWeights.js";
import { Router } from "express";
import { sendMail } from "../email.js";
import { CLIENT_URL } from "../stripe.js";
import { ADMIN_ROLES, requireAdmin } from "../auth.js";
import { writeAudit } from "../audit.js";
import { approximateCoords, db, getSetting, setSetting } from "../db/index.js";
import { FEATURE_FLAG_KEYS, getAnalyticsFunnel, getCentre, getClub, getDemandSignals, getIntentClusters, getLiquidityScores, getMarketCategories, getParticipationStats, getReferralAttribution, getSupplyOverview, MARKET_CATEGORIES, orgFeatureFlagsById, type MarketCategory } from "../db/queries.js";
import { endOfIrelandDay, irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { couponAmountError, parseCouponLimits } from "../pricing.js";
import { adminCommerceRouter } from "./adminCommerce.js";
import { adminFinanceRouter } from "./adminFinance.js";
import { adminHelpRouter } from "./help.js";
import { adminPoliciesRouter } from "./policies.js";
import { adminComplaintsRouter } from "./complaints.js";
import { adminTraderRouter } from "./traders.js";
import { NOTIFICATION_TEMPLATE_KEYS } from "../notificationTemplates.js";
import { notifyResident } from "../notifications.js";
import { notifyVendorFollowers } from "./follows.js";
import { generateSlug } from "../slugify.js";
import { adminCan, adminRoleOf, ensureAdminCan, permissionsOf, requireAdminPermission } from "../adminPermissions.js";
import { EXPLANATION_MAX, NOTE_MAX, decisionHistory, parseDecisionReason, recordDecision, type DecisionReason } from "../moderationDecisions.js";
import { adminOperationsRouter } from "./adminOperations.js";
import { adminPrivacyRouter } from "./adminPrivacy.js";
import { isValidEmail } from "../util.js";
import { InviteError, createAdminInvite, listAdminInvites, revokeAdminInvite } from "../adminInvites.js";
import { MfaError, resetMfa } from "../adminMfa.js";
import { decodeCursor, encodeCursor, pageLimit } from "../supportLookup.js";
import { listingPage, listingSummary, listingsOfVendor, vendorPage, vendorRecord } from "../adminListPages.js";
import { ModerationError, REASON_REQUIRED, applyReportAction, reinstateListing, resolveReportTarget, unhideChatMessage, type ReportTargetType } from "../reportModeration.js";
import { NEXT_STEPS, notifyApplicant, notifyPartner } from "../moderationNotify.js";
import { orgSummary, setOrgStatus } from "../orgSuspension.js";
import { ORDER_KINDS, orderDetail, ordersForPerson, searchOrders, type OrderKind } from "../supportLookup.js";

export const adminRouter = Router();
// Authentication only (401 / 403 for non-admins). What each admin may do is
// declared per route with requireAdminPermission() — D-02, adminPermissions.ts.
// The mounted sub-routers declare their own per-route permissions too; there
// is no mount-level role guard any more, so a read-only support permission
// (e.g. finance.payment_state.view) can reach exactly the routes it names.
adminRouter.use(requireAdmin);
adminRouter.use("/commerce", adminCommerceRouter);
adminRouter.use("/finance", adminFinanceRouter);
adminRouter.use("/operations", adminOperationsRouter);
adminRouter.use("/privacy", adminPrivacyRouter);
adminRouter.use("/help", adminHelpRouter);
adminRouter.use("/policies", adminPoliciesRouter);
adminRouter.use("/complaints", adminComplaintsRouter);
adminRouter.use("/traders", adminTraderRouter);

// --- D-02: the signed-in admin's own permissions --------------------------------
// The client mirrors this list in navigation, buttons and direct page access;
// the server still decides every request itself. An admin with an empty or
// unknown role gets 403 here too (and the client shows "no admin role").
adminRouter.get("/permissions", requireAdminPermission("workspace.view"), (req, res) => {
  res.json({ role: adminRoleOf(req.user), permissions: permissionsOf(req.user) });
});

// --- D-03: decision history for a record ------------------------------------------
// Internal notes are included only for roles with decisions.internal_notes.view.
const DECISION_OBJECT_TYPES = ["centre", "club", "experience", "vendor", "claim", "host_application", "place_suggestion", "organisation"];
adminRouter.get("/decisions", requireAdminPermission("decisions.view"), async (req, res) => {
  const objectType = String(req.query.objectType ?? "");
  const objectId = String(req.query.objectId ?? "");
  if (!DECISION_OBJECT_TYPES.includes(objectType) || !objectId) return res.status(400).json({ error: "objectType and objectId are required" });
  const includeNotes = adminCan(req.user, "decisions.internal_notes.view");
  res.json({ includesInternalNotes: includeNotes, decisions: await decisionHistory(objectType, objectId, includeNotes) });
});

// --- admin sub-roles (Revenue & Connect Stage 2a, risk P1-1) -------------------
// Only a super admin assigns roles; nobody changes their own role, and the
// last super admin can't be demoted (so the platform can't lock itself out).
adminRouter.get("/admins", requireAdminPermission("admins.manage"), async (_req, res) => {
  const rows = await db
    // D-02: an empty or unknown role is shown as such (it grants nothing), never as super.
    .prepare(`SELECT id, email, name, admin_role as adminRole, created_at as createdAt, mfa_secret_enc IS NOT NULL as mfaEnrolled FROM users WHERE role = 'admin' ORDER BY created_at`)
    .all();
  res.json((rows as { mfaEnrolled: number }[]).map((r) => ({ ...r, mfaEnrolled: Number(r.mfaEnrolled) === 1 })));
});

// OG-06 — admin invitations (adminInvites.ts): super only, 72-hour single-use links.
adminRouter.get("/admins/invites", requireAdminPermission("admins.manage"), async (_req, res) => {
  res.json(await listAdminInvites());
});

adminRouter.post("/admins/invites", requireAdminPermission("admins.manage"), async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
  try {
    res.status(201).json(await createAdminInvite({ email, adminRole: String(req.body?.adminRole ?? ""), inviter: req.user! }));
  } catch (e) {
    if (e instanceof InviteError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

adminRouter.delete("/admins/invites/:id", requireAdminPermission("admins.manage"), async (req, res) => {
  try {
    await revokeAdminInvite(Number(req.params.id), req.user!);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof InviteError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// OG-07 — recovery when an admin has lost both their phone and recovery codes:
// another super admin resets their two-step sign-in (they set it up again).
adminRouter.post("/admins/:id/mfa/reset", requireAdminPermission("admins.manage"), async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10) return res.status(400).json({ error: "Give a reason of at least 10 characters" });
  try {
    await resetMfa(req.params.id, req.user!.id, reason.slice(0, 500));
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof MfaError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

adminRouter.put("/admins/:id/role", requireAdminPermission("admins.manage"), async (req, res) => {
  const { adminRole, reason } = req.body as { adminRole?: string; reason?: string };
  if (!adminRole || !(ADMIN_ROLES as readonly string[]).includes(adminRole)) return res.status(400).json({ error: `adminRole must be one of ${ADMIN_ROLES.join(", ")}` });
  if (typeof reason !== "string" || reason.trim().length < 5) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  if (req.params.id === req.user!.id) return res.status(403).json({ error: "You can't change your own admin role" });
  try {
    const before = await db.transaction(async (tx) => {
      // Lock every super admin row first, always in id order, then the target:
      // two concurrent demotions queue behind each other instead of
      // deadlocking, and the second one sees the first one's result.
      // Only a real super counts — an empty role grants nothing (D-02).
      const supers = (await tx.prepare(`SELECT id FROM users WHERE role = 'admin' AND admin_role = 'super' ORDER BY id FOR UPDATE`).all()) as { id: string }[];
      const target = (await tx.prepare(`SELECT admin_role as role FROM users WHERE id = ? AND role = 'admin' FOR UPDATE`).get(req.params.id)) as { role: string | null } | undefined;
      if (!target) throw new Error("NOT_FOUND");
      if (target.role === "super" && adminRole !== "super" && supers.length <= 1) throw new Error("LAST_SUPER");
      await tx.prepare(`UPDATE users SET admin_role = ? WHERE id = ?`).run(adminRole, req.params.id);
      return target.role;
    });
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "admin.role_changed", objectType: "user", objectId: req.params.id, previousValue: { adminRole: before }, newValue: { adminRole }, reason: reason.trim() });
    res.json({ id: req.params.id, adminRole });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return res.status(404).json({ error: "Admin not found" });
    if (e instanceof Error && e.message === "LAST_SUPER") return res.status(409).json({ error: "At least one super admin must remain" });
    throw e;
  }
});

// --- platform stats ----------------------------------------------------

adminRouter.get("/stats", requireAdminPermission("workspace.view"), async (_req, res) => {
  const centresPending = (await db.prepare(`SELECT COUNT(*) as n FROM centres WHERE status = 'pending'`).get()) as { n: number };
  const clubsPending = (await db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE status = 'pending'`).get()) as { n: number };
  const experiencesPending = (await db.prepare(`SELECT COUNT(*) as n FROM experiences WHERE status = 'pending'`).get()) as { n: number };
  const vendorCount = (await db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'vendor'`).get()) as { n: number };
  // "draft" (Form System Audit, Phase 5 — Guided Flow creation wizard)
  // hasn't been submitted for review yet, same reasoning as excluding
  // 'deleted' — an admin has nothing to act on for either.
  const totalListings = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM centres WHERE status NOT IN ('deleted', 'draft')) +
        (SELECT COUNT(*) FROM clubs WHERE status NOT IN ('deleted', 'draft')) +
        (SELECT COUNT(*) FROM experiences WHERE status NOT IN ('deleted', 'draft')) as n`
    )
    .get()) as { n: number };
  const reviewCount = (await db.prepare(`SELECT COUNT(*) as n FROM reviews`).get()) as { n: number };
  // Folded in from the old /platform-admin dashboard. "Today" is the Irish
  // calendar day (DATETIMEs are UTC, so a bare CURDATE() would be the
  // server's day), and it counts all five participation tables plus passes,
  // not only hall bookings and club registrations.
  const dayStart = irelandWallTimeToUtc(irelandTodayIso());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const ORDER_TABLES = [
    ["bookings", "created_at"],
    ["registrations", "created_at"],
    ["program_enrollments", "created_at"],
    ["game_participants", "joined_at"],
    ["experience_bookings", "created_at"],
    ["passes", "created_at"],
  ] as const;
  const countAcross = async (where: (col: string) => string, params: unknown[]) => {
    const sql = ORDER_TABLES.map(([t, col]) => `(SELECT COUNT(*) FROM ${t} WHERE ${where(col)})`).join(" + ");
    const row = (await db.prepare(`SELECT ${sql} as n`).get(...ORDER_TABLES.flatMap(() => params))) as { n: number | string };
    return Number(row.n);
  };
  const newToday = await countAcross((col) => `${col} >= ? AND ${col} < ?`, [dayStart, dayEnd]);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const failedPayments7d = await countAcross((col) => `payment_status = 'failed' AND ${col} >= ?`, [weekAgo]);
  // Kept for older clients (same meaning as before: server date, two tables, all time).
  const bookingsToday = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings WHERE DATE(created_at) = CURDATE()) +
        (SELECT COUNT(*) FROM registrations WHERE DATE(created_at) = CURDATE()) as n`
    )
    .get()) as { n: number };
  const paymentFailures = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings WHERE payment_status = 'failed') +
        (SELECT COUNT(*) FROM registrations WHERE payment_status = 'failed') as n`
    )
    .get()) as { n: number };
  const openReports = (await db.prepare(`SELECT COUNT(*) as n FROM reports WHERE status = 'pending'`).get()) as { n: number };

  res.json({
    centresPending: centresPending.n,
    clubsPending: clubsPending.n,
    experiencesPending: experiencesPending.n,
    vendorCount: vendorCount.n,
    totalListings: totalListings.n,
    reviewCount: reviewCount.n,
    bookingsToday: bookingsToday.n,
    paymentFailures: paymentFailures.n,
    openReports: openReports.n,
    newToday,
    failedPayments7d,
  });
});

// --- vendor management -------------------------------------------------

adminRouter.get("/vendors", requireAdminPermission("partners.view"), async (req, res) => {
  // OG-24 — numbered pages (?page, with ?q, ?view, ?type): what the Vendors
  // page shows, with its status-tab counts (adminListPages.ts).
  if (req.query.page !== undefined) {
    const { q, view, type, page, pageSize } = req.query;
    return res.json(await vendorPage({ q: String(q ?? ""), view: String(view ?? ""), type: String(type ?? ""), page, pageSize }));
  }
  // OG-24 — paged mode (?limit / ?cursor, with ?q and ?status); the
  // unparameterised call returns every partner as before.
  if (req.query.limit !== undefined || req.query.cursor !== undefined) {
    const where = [`role = 'vendor'`];
    const params: unknown[] = [];
    if (typeof req.query.status === "string" && ["pending", "approved", "suspended"].includes(req.query.status)) {
      where.push(`status = ?`);
      params.push(req.query.status);
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const like = `%${req.query.q.trim().slice(0, 100)}%`;
      where.push(`(email LIKE ? OR name LIKE ? OR business_name LIKE ?)`);
      params.push(like, like, like);
    }
    const after = decodeCursor(req.query.cursor);
    if (after) {
      where.push(`(created_at < ? OR (created_at = ? AND id < ?))`);
      params.push(after.at, after.at, after.key);
    }
    const limit = pageLimit(req.query.limit);
    const rows = (await db
      .prepare(
        `SELECT id, email, name, status, created_at as createdAt, vendor_type as vendorType, business_name as businessName, county, org_id as orgId, provider_tier as providerTier, invited_staff as invitedStaff,
                (SELECT COUNT(*) FROM centres WHERE vendor_id = users.id) as centreCount, (SELECT COUNT(*) FROM clubs WHERE vendor_id = users.id) as clubCount
         FROM users WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`
      )
      .all(...params)) as { id: string; createdAt: string }[];
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return res.json({ items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
  }
  const rows = await db
    .prepare(
      `SELECT id, email, name, status, created_at as createdAt,
              vendor_type as vendorType, business_name as businessName, address, county, mobile, landline, description,
              org_id as orgId, platform_role as platformRole, provider_tier as providerTier, invited_staff as invitedStaff,
              (SELECT COUNT(*) FROM centres WHERE vendor_id = users.id) as centreCount,
              (SELECT COUNT(*) FROM clubs WHERE vendor_id = users.id) as clubCount
       FROM users WHERE role = 'vendor' ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

// OG-24 — one partner's record page, without loading every partner.
adminRouter.get("/vendors/:id/summary", requireAdminPermission("partners.view"), async (req, res) => {
  const vendor = await vendorRecord(req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  res.json(vendor);
});

adminRouter.get("/vendors/:id/listings", requireAdminPermission("listings.view"), async (req, res) => {
  res.json(await listingsOfVendor(req.params.id));
});

adminRouter.put("/vendors/:id/status", requireAdminPermission("partners.approve"), async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved or suspended" });
  }
  // Vendor account approval and listing approval are deliberately separate
  // steps: approving the account only lets the vendor log in and finish
  // setting up their listing (rooms/price/photos/etc) — the listing itself
  // still needs its own admin review once that setup is done.
  const before = (await db.prepare(`SELECT status, email, name FROM users WHERE id = ? AND role = 'vendor'`).get(req.params.id)) as { status: string; email: string; name: string } | undefined;
  if (!before) return res.status(404).json({ error: "Vendor not found" });
  // D-02: approving a pending account is support work; suspending,
  // reinstating (suspended → approved) and moving back to pending are super-only.
  const isPlainApproval = status === "approved" && before.status !== "suspended";
  if (!isPlainApproval && !ensureAdminCan(req, res, "partners.suspend")) return;
  // D-03: suspension needs a reason category + explanation the partner sees;
  // reinstatement may carry an optional message; both may add an internal note.
  const reinstating = status === "approved" && before.status === "suspended";
  let reason: DecisionReason | null = null;
  if (reinstating) {
    // Optional message to the partner and optional internal note; no category.
    const message = typeof req.body.explanation === "string" ? req.body.explanation.trim() : "";
    const note = typeof req.body.internalNote === "string" ? req.body.internalNote.trim() : "";
    if (message.length > EXPLANATION_MAX || note.length > NOTE_MAX) return res.status(400).json({ error: "The message or note is too long" });
    reason = message || note ? { category: "", explanation: message, internalNote: note || null } : null;
  } else if (status === "suspended") {
    const parsed = parseDecisionReason(req.body, "suspension", true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    reason = parsed.reason;
  }
  // HC-QA-058 — only a real transition counts (`status <> ?` makes the
  // affected-row count mean "this call changed it"), so retries and
  // concurrent approvals send at most one approval email; re-setting the
  // same status stays an idempotent 200.
  const outcome = await db.transaction(async (tx) => {
    // D-02: transition only from the status the permission check above was
    // based on — a support "approve" must not reinstate an account a super
    // admin suspended in the meantime.
    const info = await tx.prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'vendor' AND status = ? AND status <> ?`).run(status, req.params.id, before.status, status);
    if (info.changes !== 1) {
      const now = (await tx.prepare(`SELECT status FROM users WHERE id = ? AND role = 'vendor'`).get(req.params.id)) as { status: string } | undefined;
      return { transitioned: false, decisionId: null as number | null, raced: !!now && now.status !== status };
    }
    const decisionId = await recordDecision(tx, {
      objectType: "vendor",
      objectId: req.params.id,
      action: status === "suspended" ? "partner.suspended" : reinstating ? "partner.reinstated" : status === "approved" ? "partner.approved" : "partner.pending",
      previousState: before.status,
      newState: status,
      reason,
      actorUserId: req.user!.id,
    });
    return { transitioned: true, decisionId, raced: false };
  });
  if (outcome.raced) return res.status(409).json({ error: "This account's status changed while you were deciding. Reload and try again." });
  writeAudit({
    actorUserId: req.user!.id,
    action: "vendor.status_changed",
    objectType: "user",
    objectId: req.params.id,
    previousValue: before.status,
    newValue: { status, decisionId: outcome.decisionId, ...(reason?.category ? { reasonCategory: reason.category } : {}) },
  });
  res.json({ ok: true });
  if (outcome.transitioned && status === "approved" && !reinstating) {
    void sendMail({
      to: before.email,
      subject: "Your Hello Circle vendor account is approved",
      text: `Hi ${before.name || "there"},\n\nGood news — your Hello Circle vendor account has been approved. You can now log in to finish setting up your listing (photos, rooms, prices and opening hours):\n\n${CLIENT_URL}/login\n\nYour listing itself still gets a quick review once it's ready to go live.\n\nThanks for using Hello Circle.`,
      cta: { label: "Log in", url: `${CLIENT_URL}/login` },
    });
  }
  if (outcome.transitioned && status === "suspended") {
    void notifyPartner(req.params.id, {
      title: "Your HelloCircle partner account has been suspended",
      intro: "Your HelloCircle partner account has been suspended. You can't sign in to the Partner workspace until it's reinstated. Existing customer bookings aren't changed by this.",
      kind: "suspension",
      reason,
      nextSteps: NEXT_STEPS.suspension,
    });
  }
  if (outcome.transitioned && reinstating) {
    void notifyPartner(req.params.id, {
      title: "Your HelloCircle partner account has been reinstated",
      intro: `Your HelloCircle partner account has been reinstated. You can sign in again at ${CLIENT_URL}/login.${reason?.explanation ? `\n\n${reason.explanation}` : ""}`,
      kind: "suspension",
      reason: null,
      nextSteps: "",
    });
  }
});

// --- Host tier applications (IA spec five-layer audit) --------------------
// A resident's application to become a verified community Host — badge-
// only trust signal (see games.ts/circles.ts), never a gate on hosting.
// Mirrors the vendor moderation pair above exactly: a pending queue plus a
// single status-mutating endpoint, audited the same way.

adminRouter.get("/host-applications", requireAdminPermission("queues.view"), async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, name, email, host_bio as bio, host_phone as phone, host_applied_at as appliedAt
       FROM residents WHERE host_status = 'pending' ORDER BY host_applied_at`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/host-applications/:id/status", requireAdminPermission("queues.decide"), async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["verified", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be verified or rejected" });
  }
  // D-03: a declined application needs a reason the applicant sees.
  const parsed = parseDecisionReason(req.body, "application_rejection", status === "rejected");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const reason = status === "rejected" ? parsed.reason : null;
  const decisionId = await db.transaction(async (tx) => {
    const info = await tx
      .prepare(`UPDATE residents SET host_status = ?, host_decided_at = NOW() WHERE id = ? AND host_status = 'pending'`)
      .run(status, req.params.id);
    if (info.changes === 0) return null;
    return recordDecision(tx, { objectType: "host_application", objectId: req.params.id, action: `host_application.${status}`, previousState: "pending", newState: status, reason, actorUserId: req.user!.id });
  });
  if (decisionId === null) return res.status(404).json({ error: "No pending host application for this resident" });
  writeAudit({ actorUserId: req.user!.id, action: "resident.host_status_changed", objectType: "resident_host_application", objectId: req.params.id, previousValue: "pending", newValue: { status, decisionId, ...(reason ? { reasonCategory: reason.category } : {}) } });
  res.json({ ok: true });
  if (status === "rejected") {
    void notifyApplicant(req.params.id, {
      title: "Your Verified Host application",
      intro: "HelloCircle reviewed your Verified Host application and didn't approve it this time.",
      kind: "application_rejection",
      reason,
      nextSteps: NEXT_STEPS.host,
    });
  }
});

// --- listing moderation --------------------------------------------------

const PENDING_CENTRE_COLUMNS = `c.id, c.name, c.status, c.area, c.county, c.capacity, c.from_price as \`from\`, c.managed_by as managedBy,
              c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`;
const PENDING_CLUB_COLUMNS = `c.id, c.name, c.status, c.sport, c.area, c.county, c.ages, c.price, c.unit,
              c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`;
// experiences has no `ph`/`sport` — image_url/blurb/kind/price_cents stand
// in as the fields an admin triage card needs at a glance.
const PENDING_EXPERIENCE_COLUMNS = `c.id, c.name, c.status, c.kind, c.area, c.county, c.price_cents as \`from\`,
              c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`;

adminRouter.get("/listings/pending", requireAdminPermission("listings.view"), async (_req, res) => {
  const centres = await db
    .prepare(
      `SELECT ${PENDING_CENTRE_COLUMNS}
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  const clubs = await db
    .prepare(
      `SELECT ${PENDING_CLUB_COLUMNS}
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.name`
    )
    .all();
  const experiences = await db
    .prepare(
      `SELECT ${PENDING_EXPERIENCE_COLUMNS.replace("c.name", "c.title as name")}
       FROM experiences c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.status = 'pending' ORDER BY c.title`
    )
    .all();
  res.json({ centres, clubs, experiences });
});

// Pending listings sort first (regardless of name) so an admin doing
// triage sees what needs a decision without scanning the whole
// alphabetical list — everything else stays alphabetical within its group.
adminRouter.get("/listings", requireAdminPermission("listings.view"), async (req, res) => {
  // OG-24 — numbered pages (?page, with ?q, ?type, ?view, ?county, ?show,
  // ?sort): what the All listings page shows, with its counts.
  if (req.query.page !== undefined) {
    const { q, type, view, county, show, sort, page, pageSize } = req.query;
    return res.json(await listingPage({ q: String(q ?? ""), type: String(type ?? ""), view: String(view ?? ""), county: String(county ?? ""), show: String(show ?? ""), sort: String(sort ?? ""), page, pageSize }));
  }
  // OG-24 — paged mode (?limit / ?cursor, with ?q, ?type and ?status): one
  // newest-first list across centres, clubs and experiences. The
  // unparameterised call keeps returning every listing grouped by type.
  if (req.query.limit !== undefined || req.query.cursor !== undefined) {
    const types = (["centre", "club", "experience"] as const).filter((t) => !req.query.type || req.query.type === t);
    const after = decodeCursor(req.query.cursor);
    const limit = pageLimit(req.query.limit);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const status = typeof req.query.status === "string" ? req.query.status.slice(0, 20) : "";
    const per = await Promise.all(
      types.map(async (type) => {
        const table = type === "centre" ? "centres" : type === "club" ? "clubs" : "experiences";
        const nameCol = type === "experience" ? "l.title" : "l.name";
        const where: string[] = [];
        const params: unknown[] = [];
        if (q) {
          where.push(`(${nameCol} LIKE ? OR l.county LIKE ? OR u.business_name LIKE ?)`);
          params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (status) {
          where.push(`l.status = ?`);
          params.push(status);
        }
        if (after) {
          where.push(`(COALESCE(l.created_at, CAST('2000-01-01 00:00:00' AS DATETIME)) < ? OR (COALESCE(l.created_at, CAST('2000-01-01 00:00:00' AS DATETIME)) = ? AND l.id < ?))`);
          params.push(after.at, after.at, after.key);
        }
        return (await db
          .prepare(
            `SELECT '${type}' as type, l.id, ${nameCol} as name, l.status, l.county, l.vendor_id as vendorId, u.business_name as partnerName,
                    COALESCE(l.created_at, CAST('2000-01-01 00:00:00' AS DATETIME)) as createdAt
             FROM ${table} l LEFT JOIN users u ON u.id = l.vendor_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY COALESCE(l.created_at, CAST('2000-01-01 00:00:00' AS DATETIME)) DESC, l.id DESC LIMIT ${limit + 1}`
          )
          .all(...params)) as { type: string; id: string; createdAt: string | Date }[];
      })
    );
    const merged = per.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const items = merged.slice(0, limit);
    const last = items[items.length - 1];
    return res.json({ items, nextCursor: merged.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
  }
  const centres = await db
    .prepare(
      `SELECT ${PENDING_CENTRE_COLUMNS}
       FROM centres c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY (c.status = 'pending') DESC, c.name`
    )
    .all();
  const clubs = await db
    .prepare(
      `SELECT ${PENDING_CLUB_COLUMNS}
       FROM clubs c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY (c.status = 'pending') DESC, c.name`
    )
    .all();
  const experiences = await db
    .prepare(
      `SELECT ${PENDING_EXPERIENCE_COLUMNS.replace("c.name", "c.title as name")}
       FROM experiences c LEFT JOIN users u ON u.id = c.vendor_id ORDER BY (c.status = 'pending') DESC, c.title`
    )
    .all();
  res.json({ centres, clubs, experiences });
});

// OG-24 — one listing's summary row (its record page, opened from a paged list).
adminRouter.get("/listings/:type/:id/summary", requireAdminPermission("listings.view"), async (req, res) => {
  const row = await listingSummary(req.params.type, req.params.id);
  if (!row) return res.status(404).json({ error: "Listing not found" });
  res.json(row);
});

// Everything a reviewer needs to see before publishing a listing (admin
// "Pending approvals" review page): photos, the full description and what
// can actually be booked. Read-only, any status (pending included).
adminRouter.get("/listings/:type/:id/detail", requireAdminPermission("listings.view"), async (req, res) => {
  const { type, id } = req.params;
  const images = async (table: string, col: string) =>
    ((await db.prepare(`SELECT url FROM ${table} WHERE ${col} = ? ORDER BY sort_order`).all(id)) as { url: string }[]).map((r) => r.url);
  if (type === "centre") {
    const c = (await db.prepare(`SELECT image_url, blurb, opens_at, closes_at FROM centres WHERE id = ?`).get(id)) as { image_url: string; blurb: string; opens_at: string; closes_at: string } | undefined;
    if (!c) return res.status(404).json({ error: "Listing not found" });
    const rooms = await db.prepare(`SELECT name, cap AS capacity, rate, \`desc\` AS description, payment_method AS paymentMethod, active FROM rooms WHERE centre_id = ? ORDER BY sort_order`).all(id);
    const hours = await db.prepare(`SELECT day_of_week AS day, opens_at AS opensAt, closes_at AS closesAt, closed FROM centre_hours WHERE centre_id = ? ORDER BY day_of_week`).all(id);
    const amenities = ((await db.prepare(`SELECT amenity FROM centre_amenities WHERE centre_id = ? ORDER BY sort_order`).all(id)) as { amenity: string }[]).map((r) => r.amenity);
    const gallery = await images("centre_images", "centre_id");
    return res.json({ type, images: gallery.length ? gallery : c.image_url ? [c.image_url] : [], description: c.blurb, centre: { rooms, hours, opensAt: c.opens_at, closesAt: c.closes_at, amenities } });
  }
  if (type === "club") {
    const c = (await db.prepare(`SELECT image_url, blurb, sport, ages, price, unit, trial FROM clubs WHERE id = ?`).get(id)) as { image_url: string; blurb: string; sport: string; ages: string; price: number; unit: string; trial: number } | undefined;
    if (!c) return res.status(404).json({ error: "Listing not found" });
    const sessions = await db.prepare(`SELECT day_of_week AS day, time, label, capacity, active FROM club_sessions WHERE club_id = ? ORDER BY day_of_week, time`).all(id);
    const includes = ((await db.prepare(`SELECT item FROM club_includes WHERE club_id = ? ORDER BY sort_order`).all(id)) as { item: string }[]).map((r) => r.item);
    const gallery = await images("club_images", "club_id");
    return res.json({ type, images: gallery.length ? gallery : c.image_url ? [c.image_url] : [], description: c.blurb, club: { sport: c.sport, ages: c.ages, price: c.price, unit: c.unit, trial: !!c.trial, includes, sessions } });
  }
  if (type === "experience") {
    const e = (await db
      .prepare(`SELECT image_url, blurb, description, kind, price_cents, capacity, duration_minutes, meeting_point, difficulty FROM experiences WHERE id = ?`)
      .get(id)) as { image_url: string; blurb: string; description: string; kind: string; price_cents: number; capacity: number; duration_minutes: number; meeting_point: string; difficulty: string } | undefined;
    if (!e) return res.status(404).json({ error: "Listing not found" });
    const sessions = await db
      .prepare(`SELECT date, time, capacity, status FROM experience_sessions WHERE experience_id = ? AND date >= ? ORDER BY date, time LIMIT 6`)
      .all(id, irelandTodayIso());
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM experience_sessions WHERE experience_id = ?`).get(id)) as { n: number | string };
    const gallery = await images("experience_images", "experience_id");
    return res.json({
      type,
      images: gallery.length ? gallery : e.image_url ? [e.image_url] : [],
      description: e.description || e.blurb,
      experience: { kind: e.kind, priceCents: e.price_cents, capacity: e.capacity, durationMinutes: e.duration_minutes, meetingPoint: e.meeting_point, difficulty: e.difficulty, upcomingSessions: sessions, totalSessions: Number(total.n) },
    });
  }
  res.status(400).json({ error: "Unknown listing type" });
});

/** A listing can't go live before the vendor account behind it has been
 * vetted — mirrors the "Approve" button being disabled client-side in
 * AdminDashboard.tsx. Grandfathered listings with no vendor (vendor_id
 * NULL) are exempt, matching how they're already treated as pre-approved
 * elsewhere. */
async function vendorNotApprovedFor(table: "centres" | "clubs" | "experiences", id: string): Promise<boolean> {
  const row = (await db
    .prepare(`SELECT u.status FROM ${table} c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.id = ?`)
    .get(id)) as { status: string | null } | undefined;
  return !!row?.status && row.status !== "approved";
}

// Notifies a newly-approved listing's vendor's followers (Follow feature) —
// fire-and-forget, never blocks the approval response. A no-op for a
// listing with no vendor_id (grandfathered pre-vendor seed rows).
async function notifyFollowersOfNewListing(table: "centres" | "clubs" | "experiences", id: string) {
  const nameCol = table === "experiences" ? "title" : "name";
  const row = (await db.prepare(`SELECT vendor_id as vendorId, ${nameCol} as name FROM ${table} WHERE id = ?`).get(id)) as { vendorId: string | null; name: string } | undefined;
  if (row?.vendorId) {
    await notifyVendorFollowers(row.vendorId, { title: "New listing", body: `${row.name} is now live on HelloCircle.`, ref: id });
  }
}

// Listing moderation status (centres, clubs, experiences). The lifecycle is
// unchanged: any of pending / approved / rejected / deleted can be set, as
// before. D-02: "deleted" needs listings.delete (super). D-03: a rejection
// needs a reason category + partner-visible explanation (optional internal
// note); every status change is recorded in moderation_decisions and the
// owning partner is told about a rejection.
const LISTING_STATUS_TABLES = {
  centres: { objectType: "centre", label: "Centre", audit: "centre.status_changed" },
  clubs: { objectType: "club", label: "Club", audit: "club.status_changed" },
  experiences: { objectType: "experience", label: "Experience", audit: "experience.status_changed" },
} as const;

async function setListingStatus(table: keyof typeof LISTING_STATUS_TABLES, req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const meta = LISTING_STATUS_TABLES[table];
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return false;
  }
  if (status === "deleted" && !ensureAdminCan(req, res, "listings.delete")) return false;
  const parsed = parseDecisionReason(req.body, "listing_rejection", status === "rejected");
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return false;
  }
  // A reason is only stored for a rejection; other moves record the decision alone.
  const reason = status === "rejected" ? parsed.reason : null;
  if (status === "approved" && (await vendorNotApprovedFor(table, req.params.id))) {
    res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
    return false;
  }
  const result = await db.transaction(async (tx) => {
    const before = (await tx.prepare(`SELECT status, vendor_id as vendorId, name FROM ${table} WHERE id = ? FOR UPDATE`).get(req.params.id)) as { status: string; vendorId: string | null; name: string } | undefined;
    if (!before) return null;
    // D-03: the same decision sent again (a retry, a double click, two admins
    // at once) changes nothing: same status and an identical latest decision →
    // no new decision, audit entry or partner notice. A different reason is a
    // correction and is recorded. Runs under the row lock, so concurrent
    // duplicates see each other.
    if (before.status === status) {
      const latest = (await tx
        .prepare(`SELECT action, reason_category AS category, explanation, internal_note AS note FROM moderation_decisions WHERE object_type = ? AND object_id = ? ORDER BY id DESC LIMIT 1`)
        .get(meta.objectType, req.params.id)) as { action: string; category: string | null; explanation: string | null; note: string | null } | undefined;
      const same =
        !!latest &&
        latest.action === `listing.${status}` &&
        (latest.category ?? null) === (reason?.category ?? null) &&
        (latest.explanation ?? null) === (reason?.explanation ?? null) &&
        (latest.note ?? null) === (reason?.internalNote ?? null);
      if (same) return { before, decisionId: null as number | null, repeat: true };
    }
    await tx.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(status, req.params.id);
    const decisionId = await recordDecision(tx, {
      objectType: meta.objectType,
      objectId: req.params.id,
      action: `listing.${status}`,
      previousState: before.status,
      newState: status,
      reason,
      actorUserId: req.user!.id,
    });
    return { before, decisionId, repeat: false };
  });
  if (!result) {
    res.status(404).json({ error: `${meta.label} not found` });
    return false;
  }
  if (result.repeat) return true;
  await writeAudit({
    actorUserId: req.user!.id,
    action: meta.audit,
    objectType: meta.objectType,
    objectId: req.params.id,
    previousValue: { status: result.before.status },
    newValue: { status, decisionId: result.decisionId, ...(reason ? { reasonCategory: reason.category } : {}) },
  });
  if (status === "rejected") {
    await notifyPartner(result.before.vendorId, {
      title: `Your listing "${result.before.name}" wasn't approved`,
      intro: `HelloCircle reviewed "${result.before.name}" and didn't approve it.`,
      kind: "listing_rejection",
      reason,
      nextSteps: NEXT_STEPS.listing,
      listingType: meta.objectType,
      listingId: req.params.id,
    });
  }
  return true;
}

adminRouter.put("/centres/:id/status", requireAdminPermission("listings.moderate"), async (req, res) => {
  if (!(await setListingStatus("centres", req, res))) return;
  if (req.body.status === "approved") await notifyFollowersOfNewListing("centres", req.params.id);
  res.json(await getCentre(req.params.id));
});

adminRouter.put("/clubs/:id/status", requireAdminPermission("listings.moderate"), async (req, res) => {
  if (!(await setListingStatus("clubs", req, res))) return;
  if (req.body.status === "approved") await notifyFollowersOfNewListing("clubs", req.params.id);
  res.json(await getClub(req.params.id));
});

adminRouter.put("/experiences/:id/status", requireAdminPermission("listings.moderate"), async (req, res) => {
  if (!(await setListingStatus("experiences", req, res))) return;
  if (req.body.status === "approved") {
    await notifyFollowersOfNewListing("experiences", req.params.id);
    await matchExperienceSupply(req.params.id); // Release 6 — close the demand loop
  }
  res.json({ ok: true });
});

// Bounded "featured" flag (IA spec §16) — the entire CMS surface: one
// boolean per listing table, toggled here, sorted first in public listing
// order (see db/queries.ts listCentres/listClubs, routes/experiences.ts).
const FEATURED_TABLES = { centres: "centres", clubs: "clubs", experiences: "experiences" } as const;

adminRouter.put("/:table(centres|clubs|experiences)/:id/featured", requireAdminPermission("listings.feature"), async (req, res) => {
  const table = FEATURED_TABLES[req.params.table as keyof typeof FEATURED_TABLES];
  const { featured } = req.body as { featured?: boolean };
  const info = await db.prepare(`UPDATE ${table} SET featured = ? WHERE id = ?`).run(featured ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Listing not found" });
  await writeAudit({ actorUserId: req.user!.id, action: featured ? "feature" : "unfeature", objectType: table.slice(0, -1), objectId: req.params.id });
  res.json({ ok: true });
});

// --- listing claims ----------------------------------------------------------
// A vendor's request to take ownership of a listing with no owner yet
// (vendor_id IS NULL — see routes/vendor.ts's POST /claims). Approving one
// sets vendor_id on the listing; this is ownership, not the listing's own
// publication status handled above.

adminRouter.get("/claims", requireAdminPermission("queues.view"), async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT cl.id, cl.listing_type as listingType, cl.listing_id as listingId, cl.message, cl.status, cl.created_at as createdAt,
              u.id as vendorId, u.name as vendorName, u.email as vendorEmail, u.status as vendorStatus,
              COALESCE(c.name, cb.name) as listingName
       FROM listing_claims cl
       JOIN users u ON u.id = cl.vendor_id
       LEFT JOIN centres c ON cl.listing_type = 'centre' AND c.id = cl.listing_id
       LEFT JOIN clubs cb ON cl.listing_type = 'club' AND cb.id = cl.listing_id
       WHERE cl.status = 'pending'
       ORDER BY cl.created_at`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/claims/:id/status", requireAdminPermission("queues.decide"), async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be approved or rejected" });
  }

  const claim = (await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId, vendor_id as vendorId, status FROM listing_claims WHERE id = ?`)
    .get(req.params.id)) as { listingType: "centre" | "club"; listingId: string; vendorId: string; status: string } | undefined;
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  if (claim.status !== "pending") return res.status(409).json({ error: "This claim has already been decided" });

  if (status === "rejected") {
    // D-03: a rejected claim needs a reason the claimant sees.
    const parsed = parseDecisionReason(req.body, "application_rejection", true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const reason = parsed.reason;
    const decisionId = await db.transaction(async (tx) => {
      const info = await tx.prepare(`UPDATE listing_claims SET status = 'rejected', decided_at = NOW() WHERE id = ? AND status = 'pending'`).run(req.params.id);
      if (info.changes !== 1) return null;
      return recordDecision(tx, { objectType: "claim", objectId: String(req.params.id), action: "claim.rejected", previousState: "pending", newState: "rejected", reason, actorUserId: req.user!.id });
    });
    if (decisionId === null) return res.status(409).json({ error: "This claim has already been decided" });
    await writeAudit({ actorUserId: req.user!.id, action: "claim.rejected", objectType: claim.listingType, objectId: claim.listingId, previousValue: { claimId: req.params.id, status: "pending" }, newValue: { status: "rejected", vendorId: claim.vendorId, decisionId, reasonCategory: reason?.category } });
    res.json({ ok: true });
    const listing = (await db.prepare(`SELECT name FROM ${claim.listingType === "centre" ? "centres" : "clubs"} WHERE id = ?`).get(claim.listingId)) as { name: string } | undefined;
    void notifyPartner(claim.vendorId, {
      title: `Your claim on "${listing?.name ?? "a listing"}" wasn't approved`,
      intro: `HelloCircle reviewed your claim to manage "${listing?.name ?? "this listing"}" and didn't approve it.`,
      kind: "application_rejection",
      reason,
      nextSteps: NEXT_STEPS.claim,
      listingType: claim.listingType,
      listingId: claim.listingId,
    });
    return;
  }

  // Same guard as listing-status approval: the claiming vendor's own account
  // has to be approved before their claim can be.
  const vendor = (await db.prepare(`SELECT status, org_id AS orgId, invited_staff AS invitedStaff FROM users WHERE id = ?`).get(claim.vendorId)) as
    | { status: string; orgId: string | null; invitedStaff: number }
    | undefined;
  if (!vendor || vendor.status !== "approved") {
    return res.status(409).json({ error: "Approve the vendor's account before approving their claim" });
  }
  // D-08: a claim from someone who has since been removed from their
  // organisation can't be approved — the listing would belong to no organisation.
  if (vendor.invitedStaff && !vendor.orgId) return res.status(409).json({ error: "The person who made this claim is no longer a member of an organisation" });

  const table = claim.listingType === "centre" ? "centres" : "clubs";
  try {
    await db.transaction(async (tx) => {
      // vendor_id IS NULL guard: if the listing got claimed by someone else
      // since this claim was submitted, this affects 0 rows and the whole
      // approval rolls back instead of silently overwriting the real owner.
      const result = await tx.prepare(`UPDATE ${table} SET vendor_id = ? WHERE id = ? AND vendor_id IS NULL`).run(claim.vendorId, claim.listingId);
      if (result.changes === 0) throw new Error("ALREADY_CLAIMED");
      await tx.prepare(`UPDATE listing_claims SET status = 'approved', decided_at = NOW() WHERE id = ?`).run(req.params.id);
      await recordDecision(tx, { objectType: "claim", objectId: String(req.params.id), action: "claim.approved", previousState: "pending", newState: "approved", reason: null, actorUserId: req.user!.id });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_CLAIMED") {
      return res.status(409).json({ error: "This listing has already been claimed by another vendor" });
    }
    throw e;
  }
  await writeAudit({ actorUserId: req.user!.id, action: "claim.approved", objectType: claim.listingType, objectId: claim.listingId, previousValue: { claimId: req.params.id, vendorId: null }, newValue: { status: "approved", vendorId: claim.vendorId } });
  res.json({ ok: true });
});

// --- full CRUD on any listing (edit/delete regardless of owner) ------------

interface CentreInput {
  name?: string;
  area?: string;
  county?: string;
  capacity?: number;
  from?: number;
  managedBy?: string;
  image?: string;
  blurb?: string;
  amenities?: string[];
}

adminRouter.put("/centres/:id", requireAdminPermission("listings.edit"), async (req, res) => {
  const b = req.body as CentreInput;
  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE centres SET name = COALESCE(?, name), area = COALESCE(?, area), county = COALESCE(?, county),
       capacity = COALESCE(?, capacity), from_price = COALESCE(?, from_price), managed_by = COALESCE(?, managed_by),
       image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb)
       WHERE id = ?`
    ).run(b.name, b.area, b.county, b.capacity, b.from, b.managedBy, b.image, b.blurb, req.params.id);
    if (b.amenities) {
      await tx.prepare(`DELETE FROM centre_amenities WHERE centre_id = ?`).run(req.params.id);
      for (const [i, a] of b.amenities.entries()) {
        await tx.prepare(`INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`).run(req.params.id, a, i);
      }
    }
  });
  const centre = await getCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "centre.updated_by_admin", objectType: "centre", objectId: req.params.id, newValue: b });
  res.json(centre);
});

adminRouter.delete("/centres/:id", requireAdminPermission("listings.delete"), async (req, res) => {
  const before = (await db.prepare(`SELECT status FROM centres WHERE id = ?`).get(req.params.id)) as { status: string } | undefined;
  const info = await db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "centre.deleted_by_admin", objectType: "centre", objectId: req.params.id, previousValue: { status: before?.status ?? null }, newValue: { status: "deleted" } });
  res.json({ ok: true });
});

interface ClubInput {
  name?: string;
  sport?: string;
  area?: string;
  county?: string;
  ages?: string;
  price?: number;
  unit?: string;
  trial?: boolean;
  image?: string;
  blurb?: string;
  includes?: string[];
}

adminRouter.put("/clubs/:id", requireAdminPermission("listings.edit"), async (req, res) => {
  const b = req.body as ClubInput;
  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE clubs SET name = COALESCE(?, name), sport = COALESCE(?, sport), area = COALESCE(?, area),
       county = COALESCE(?, county), ages = COALESCE(?, ages), price = COALESCE(?, price), unit = COALESCE(?, unit),
       trial = COALESCE(?, trial), image_url = COALESCE(?, image_url), blurb = COALESCE(?, blurb)
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
      b.image,
      b.blurb,
      req.params.id
    );
    if (b.includes) {
      await tx.prepare(`DELETE FROM club_includes WHERE club_id = ?`).run(req.params.id);
      for (const [i, item] of b.includes.entries()) {
        await tx.prepare(`INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`).run(req.params.id, item, i);
      }
    }
  });
  const club = await getClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "club.updated_by_admin", objectType: "club", objectId: req.params.id, newValue: b });
  res.json(club);
});

adminRouter.delete("/clubs/:id", requireAdminPermission("listings.delete"), async (req, res) => {
  const before = (await db.prepare(`SELECT status FROM clubs WHERE id = ?`).get(req.params.id)) as { status: string } | undefined;
  const info = await db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "club.deleted_by_admin", objectType: "club", objectId: req.params.id, previousValue: { status: before?.status ?? null }, newValue: { status: "deleted" } });
  res.json({ ok: true });
});

// --- review moderation -----------------------------------------------------

adminRouter.get("/reviews", requireAdminPermission("reviews.view"), async (_req, res) => {
  const rows = await db.prepare(`SELECT * FROM reviews ORDER BY created_at DESC`).all();
  res.json(rows);
});

adminRouter.put("/reviews/:id/unhide", requireAdminPermission("reviews.moderate"), async (req, res) => {
  const info = await db.prepare(`UPDATE reviews SET hidden = 0 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "review.unhidden", objectType: "review", objectId: req.params.id, previousValue: { hidden: true }, newValue: { hidden: false } });
  res.json({ ok: true });
});

// --- coupons (platform-wide, admin-managed discount codes) -----------------

interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

adminRouter.get("/coupons", requireAdminPermission("coupons.manage"), async (_req, res) => {
  const rows = (await db
    .prepare(
      `SELECT c.id, c.code, c.kind, c.amount, c.max_uses as maxUses, c.used_count as usedCount,
              c.expires_at as expiresAt, c.active, c.created_at as createdAt,
              c.funding, c.platform_share_bps as platformShareBps, c.min_spend_cents as minSpendCents, c.max_discount_cents as maxDiscountCents,
              c.per_customer_limit as perCustomerLimit, c.starts_at as startsAt, c.archived_at as archivedAt,
              c.created_by_vendor_id as createdByVendorId, c.created_by_resident_id as createdByResidentId,
              (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') as confirmedRedemptions,
              (SELECT COALESCE(SUM(r.platform_funded_minor), 0) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'confirmed') as platformFundedMinor
       FROM coupons c ORDER BY c.created_at DESC`
    )
    .all()) as Record<string, any>[];
  res.json(rows.map((r) => ({ ...r, confirmedRedemptions: Number(r.confirmedRedemptions), platformFundedMinor: Number(r.platformFundedMinor) })));
});

/** Commerce Engine Phase 3 — every admin coupon change carries a reason. */
function couponReason(body: unknown): string | null {
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" && reason.trim().length >= 5 ? reason.trim().slice(0, 2000) : null;
}

adminRouter.post("/coupons", requireAdminPermission("coupons.manage"), async (req, res) => {
  const b = req.body as CouponInput & { funding?: string; platformShareBps?: unknown; reason?: unknown } & Record<string, unknown>;
  if (!b.code || !b.kind || !b.amount) return res.status(400).json({ error: "code, kind and amount are required" });
  const amountError = couponAmountError(b.kind, b.amount);
  if (amountError) return res.status(400).json({ error: amountError });
  const reason = couponReason(b);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  // Admin coupons are HelloCircle-funded, or split with the partner. A
  // partner-funded coupon is created by the partner themselves (vendor/host
  // routes), never on their behalf.
  const funding = b.funding ?? "platform";
  if (funding !== "platform" && funding !== "split") return res.status(400).json({ error: "Admin coupons are HelloCircle-funded or split-funded" });
  let platformShareBps = 10_000;
  if (funding === "split") {
    if (typeof b.platformShareBps !== "number" || !Number.isInteger(b.platformShareBps) || b.platformShareBps < 1 || b.platformShareBps > 9_999) {
      return res.status(400).json({ error: "A split coupon needs HelloCircle's share between 0.01% and 99.99%" });
    }
    platformShareBps = b.platformShareBps;
  }
  const limits = parseCouponLimits(b);
  if (!limits.ok) return res.status(400).json({ error: limits.error });

  const code = b.code.trim().toUpperCase();
  // The admin picks a plain calendar date ("expires 25 Dec") — that should
  // mean valid through the end of that day in Ireland, not midnight UTC.
  const expiresAt = b.expiresAt ? endOfIrelandDay(b.expiresAt) : null;
  try {
    await db
      .prepare(
        `INSERT INTO coupons (code, kind, amount, max_uses, expires_at, funding, platform_share_bps, min_spend_cents, max_discount_cents, per_customer_limit, starts_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(code, b.kind, b.amount, b.maxUses ?? null, expiresAt, funding, platformShareBps, limits.limits.minSpendCents, limits.limits.maxDiscountCents, limits.limits.perCustomerLimit, limits.limits.startsAt);
  } catch {
    return res.status(409).json({ error: "That code already exists" });
  }
  await writeAudit({
    actorUserId: req.user!.id,
    actorKind: "user",
    action: "coupon.created",
    objectType: "coupon",
    objectId: code,
    newValue: { kind: b.kind, amount: b.amount, maxUses: b.maxUses ?? null, expiresAt, funding, platformShareBps, ...limits.limits },
    reason,
  });
  res.status(201).json({ ok: true });
});

adminRouter.put("/coupons/:id/active", requireAdminPermission("coupons.manage"), async (req, res) => {
  const { active } = req.body as { active?: boolean };
  const reason = couponReason(req.body);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  const before = (await db.prepare(`SELECT code, active FROM coupons WHERE id = ? AND archived_at IS NULL`).get(req.params.id)) as { code: string; active: number } | undefined;
  if (!before) return res.status(404).json({ error: "Coupon not found" });
  await db.prepare(`UPDATE coupons SET active = ? WHERE id = ?`).run(active ? 1 : 0, req.params.id);
  await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: active ? "coupon.resumed" : "coupon.paused", objectType: "coupon", objectId: before.code, previousValue: { active: !!before.active }, newValue: { active: !!active }, reason });
  res.json({ ok: true });
});

/** Archive, never hard-delete (commerce audit R6): historical orders keep a
 * coupon_code with no foreign key, so the row must stay resolvable. */
adminRouter.delete("/coupons/:id", requireAdminPermission("coupons.delete"), async (req, res) => {
  const reason = couponReason(req.body);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  const before = (await db.prepare(`SELECT code FROM coupons WHERE id = ? AND archived_at IS NULL`).get(req.params.id)) as { code: string } | undefined;
  if (!before) return res.status(404).json({ error: "Coupon not found" });
  await db.prepare(`UPDATE coupons SET active = 0, archived_at = NOW() WHERE id = ?`).run(req.params.id);
  await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "coupon.archived", objectType: "coupon", objectId: before.code, newValue: { archived: true }, reason });
  res.json({ ok: true });
});

// --- multi-tenant org hierarchy scaffolding (FUTURE, best-effort) ----------
// Data-model only — no tenant isolation is enforced anywhere else in the app
// (every query is still platform-wide). See plan doc "Not yet" section.

adminRouter.get("/organisations", requireAdminPermission("orgs.view"), async (_req, res) => {
  // D-01: status and member count, so suspended partner organisations are visible in the list.
  const rows = await db
    .prepare(
      `SELECT o.id, o.name, o.kind, o.status, o.status_changed_at as statusChangedAt, o.created_at as createdAt,
              (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) as memberCount
       FROM organisations o ORDER BY o.name`
    )
    .all();
  res.json((rows as { memberCount: number | string }[]).map((r) => ({ ...r, memberCount: Number(r.memberCount) })));
});

// --- D-01: organisation record and suspension --------------------------------

adminRouter.get("/organisations/:id", requireAdminPermission("orgs.view"), async (req, res) => {
  const summary = await orgSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: "Organisation not found" });
  res.json(summary);
});

/** Suspend or reinstate a whole organisation — every member and every listing
 * it owns, whoever created it. Super only. A suspension needs a reason
 * category and an explanation the members see (D-03); reinstatement takes an
 * optional message. Listing statuses are never changed. */
adminRouter.put("/organisations/:id/status", requireAdminPermission("orgs.suspend"), async (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== "suspended" && status !== "active") return res.status(400).json({ error: "status must be suspended or active" });
  let reason: DecisionReason | null = null;
  if (status === "suspended") {
    const parsed = parseDecisionReason(req.body, "suspension", true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    reason = parsed.reason;
  } else {
    const message = typeof req.body.explanation === "string" ? req.body.explanation.trim() : "";
    const note = typeof req.body.internalNote === "string" ? req.body.internalNote.trim() : "";
    if (message.length > EXPLANATION_MAX || note.length > NOTE_MAX) return res.status(400).json({ error: "The message or note is too long" });
    reason = message || note ? { category: "", explanation: message, internalNote: note || null } : null;
  }
  const result = await setOrgStatus(req.params.id, status, reason, req.user!);
  if (!result.ok) return res.status(404).json({ error: "Organisation not found" });
  res.json({ ok: true, status: result.status, changed: result.changed });
});

adminRouter.post("/organisations", requireAdminPermission("orgs.manage"), async (req, res) => {
  const { name, kind } = req.body as { name?: string; kind?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, ?)`).run(id, name, kind ?? "council");
  await writeAudit({ actorUserId: req.user!.id, action: "organisation.created", objectType: "organisation", objectId: id, newValue: { name, kind: kind ?? "council" } });
  res.status(201).json({ id });
});

// Feature flags (implementation backlog #5) — real per-org capability
// toggles, admin-only (never vendor-self-serve, see routes/org.ts's
// read-only counterpart). Gates 3 real features: Open Booking, Programs,
// Experiences — see orgFeatureFlags()'s own comment for the enabled-by-
// default (opt-out) convention.
adminRouter.get("/organisations/:id/flags", requireAdminPermission("orgs.view"), async (req, res) => {
  const flags = await orgFeatureFlagsById(req.params.id);
  res.json(flags);
});

adminRouter.put("/organisations/:id/flags/:key", requireAdminPermission("orgs.manage"), async (req, res) => {
  const key = req.params.key;
  if (!(FEATURE_FLAG_KEYS as readonly string[]).includes(key)) {
    return res.status(400).json({ error: `key must be one of ${FEATURE_FLAG_KEYS.join(", ")}` });
  }
  const { enabled } = req.body as { enabled?: boolean };
  await db
    .prepare(`INSERT INTO feature_flags (org_id, flag_key, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`)
    .run(req.params.id, key, enabled ? 1 : 0);
  await writeAudit({ actorUserId: req.user!.id, action: "org.flag_changed", objectType: "organisation", objectId: req.params.id, newValue: { key, enabled: !!enabled } });
  res.json({ ok: true });
});

adminRouter.put("/centres/:id/organisation", requireAdminPermission("orgs.manage"), async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const before = (await db.prepare(`SELECT org_id AS orgId FROM centres WHERE id = ?`).get(req.params.id)) as { orgId: string | null } | undefined;
  const info = await db.prepare(`UPDATE centres SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "centre.organisation_assigned", objectType: "centre", objectId: req.params.id, previousValue: { organisationId: before?.orgId ?? null }, newValue: { organisationId } });
  res.json({ ok: true });
});

adminRouter.put("/clubs/:id/organisation", requireAdminPermission("orgs.manage"), async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const before = (await db.prepare(`SELECT org_id AS orgId FROM clubs WHERE id = ?`).get(req.params.id)) as { orgId: string | null } | undefined;
  const info = await db.prepare(`UPDATE clubs SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "club.organisation_assigned", objectType: "club", objectId: req.params.id, previousValue: { organisationId: before?.orgId ?? null }, newValue: { organisationId } });
  res.json({ ok: true });
});

// --- RBAC + marketplace-tier scaffolding (FUTURE, best-effort) -------------

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"];

adminRouter.put("/vendors/:id/platform-role", requireAdminPermission("partners.platform_role"), async (req, res) => {
  const { platformRole } = req.body as { platformRole: string | null };
  if (platformRole !== null && !PLATFORM_ROLES.includes(platformRole)) {
    return res.status(400).json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(", ")}, or null` });
  }
  const before = (await db.prepare(`SELECT platform_role as platformRole FROM users WHERE id = ?`).get(req.params.id)) as { platformRole: string | null } | undefined;
  // D-08: bump row_version so an owner's open Staff page sees the change (409 on a stale write).
  const info = await db.prepare(`UPDATE users SET platform_role = ?, row_version = row_version + 1 WHERE id = ? AND role = 'vendor'`).run(platformRole, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  writeAudit({
    actorUserId: req.user!.id,
    action: "vendor.platform_role_changed",
    objectType: "user",
    objectId: req.params.id,
    previousValue: before?.platformRole ?? null,
    newValue: platformRole,
  });
  res.json({ ok: true });
});

adminRouter.put("/vendors/:id/provider-tier", requireAdminPermission("partners.tier"), async (req, res) => {
  const { providerTier } = req.body as { providerTier?: string };
  if (!providerTier || !["standard", "verified", "featured"].includes(providerTier)) {
    return res.status(400).json({ error: "providerTier must be standard, verified or featured" });
  }
  const before = (await db.prepare(`SELECT provider_tier AS tier FROM users WHERE id = ? AND role = 'vendor'`).get(req.params.id)) as { tier: string } | undefined;
  const info = await db.prepare(`UPDATE users SET provider_tier = ? WHERE id = ? AND role = 'vendor'`).run(providerTier, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "vendor.provider_tier_changed", objectType: "user", objectId: req.params.id, previousValue: { providerTier: before?.tier ?? null }, newValue: { providerTier } });
  res.json({ ok: true });
});

// --- demand intelligence (NEXT) — platform-wide view ------------------------

adminRouter.get("/demand", requireAdminPermission("insights.view"), async (_req, res) => {
  const rows = await getDemandSignals({ limit: 50 });
  res.json(rows);
});

// Explicit unmet-demand clusters (participation-intent plan Phase 1) —
// unlike the passive query-text signal above, these are resident-linkable,
// actionable rows: an admin can directly notify the people behind a cluster.
adminRouter.get("/demand/intents", requireAdminPermission("insights.view"), async (_req, res) => {
  const rows = await getIntentClusters({ minCount: 1 });
  res.json(rows);
});

// Marketplace health / liquidity (participation-intent plan Phase 2) — one
// combined read for the admin dashboard's Marketplace Health tab, kept
// separate from the two demand-only routes above.
adminRouter.get("/marketplace-health", requireAdminPermission("insights.view"), async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const [supply, participation, liquidity] = await Promise.all([getSupplyOverview(), getParticipationStats(), getLiquidityScores(county)]);
  res.json({ supply, participation, liquidity });
});

// Referral attribution (participation-intent plan Phase 3) — best-effort
// only, see getReferralAttribution's own docstring for why this is never a
// hard link.
adminRouter.get("/referrals", requireAdminPermission("insights.view"), async (_req, res) => {
  const rows = await getReferralAttribution();
  res.json(rows);
});

// Minimal funnel rollup (post-audit hardening pass) — a single grouped
// count over analytics_events, not a new analytics product. See
// analytics.ts/getAnalyticsFunnel's own comments.
adminRouter.get("/analytics/funnel", requireAdminPermission("insights.view"), async (req, res) => {
  const windowDays = typeof req.query.windowDays === "string" ? parseInt(req.query.windowDays, 10) : 30;
  const rows = await getAnalyticsFunnel(Number.isFinite(windowDays) ? windowDays : 30);
  res.json(rows);
});

// Market/category launch config (participation-intent plan Phase 4) — same
// enabled-by-default/opt-out shape and GET/PUT split as the org feature-flag
// routes above, scoped by county instead of org.
// Recommendation weights (community participation upgrade, Release 4) —
// how much each For You signal can contribute. Runtime-configurable here,
// never hardcoded at call sites; see recommendationWeights.ts.
adminRouter.get("/recommendation-weights", requireAdminPermission("insights.view"), async (_req, res) => {
  res.json({ weights: await getRecommendationWeights(), defaults: DEFAULT_WEIGHTS });
});

adminRouter.put("/recommendation-weights", requireAdminPermission("platform.settings"), async (req, res) => {
  const next = validateWeights(req.body?.weights);
  if (!next) return res.status(400).json({ error: "Each weight must be a number from 0 to 100" });
  const before = await getRecommendationWeights();
  await setRecommendationWeights(next);
  await writeAudit({ actorUserId: req.user!.id, action: "recommendation_weights.updated", objectType: "app_setting", objectId: "recommendation_weights", previousValue: before, newValue: next });
  res.json({ weights: next });
});

adminRouter.get("/market-categories", requireAdminPermission("insights.view"), async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : "";
  if (!county) return res.status(400).json({ error: "county is required" });
  const flags = await getMarketCategories(county);
  res.json(flags);
});

adminRouter.put("/market-categories", requireAdminPermission("platform.settings"), async (req, res) => {
  const { county, category, enabled } = req.body as { county?: string; category?: string; enabled?: boolean };
  if (!county) return res.status(400).json({ error: "county is required" });
  if (!category || !(MARKET_CATEGORIES as readonly string[]).includes(category)) {
    return res.status(400).json({ error: `category must be one of ${MARKET_CATEGORIES.join(", ")}` });
  }
  await db
    .prepare(`INSERT INTO market_categories (county, category, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`)
    .run(county, category as MarketCategory, enabled ? 1 : 0);
  await writeAudit({ actorUserId: req.user!.id, action: "market_category.changed", objectType: "market_category", objectId: `${county}::${category}`, newValue: { enabled: !!enabled } });
  res.json({ ok: true });
});

adminRouter.post("/demand/intents/notify", requireAdminPermission("demand.notify"), async (req, res) => {
  const { activityLabel, county } = req.body as { activityLabel?: string; county?: string };
  if (!activityLabel) return res.status(400).json({ error: "activityLabel is required" });

  const rows = (await db
    .prepare(
      `SELECT DISTINCT resident_id as residentId FROM participation_intents
       WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
         AND (cluster_key = ? OR activity_label = ?) AND county = ? AND resident_id IS NOT NULL`
    )
    .all(activityLabel.toLowerCase(), activityLabel, county ?? "")) as { residentId: string }[];

  const ref = `${activityLabel}::${county ?? ""}`;
  for (const row of rows) {
    await notifyResident({
      residentId: row.residentId,
      kind: "intent_match",
      title: `Enough people are interested in ${activityLabel}`,
      body: `${rows.length} people${county ? ` near ${county}` : ""} want to do this — want to start a plan?`,
      listingType: "intent",
      listingId: ref,
      ref,
    });
  }

  await writeAudit({ actorUserId: req.user!.id, action: "demand.intents_notified", objectType: "participation_intent_cluster", objectId: ref, newValue: { notified: rows.length } });
  res.json({ ok: true, notified: rows.length });
});

// --- reports queue (moved from platformAdmin.ts — the only genuinely
// distinct piece of that page's "Moderation" tab; report creation itself is
// public, see routes/reports.ts) ---------------------------------------

adminRouter.get("/reports", requireAdminPermission("reports.view"), async (req, res) => {
  const all = req.query.status === "all";
  const rows = await db
    .prepare(
      `SELECT id, target_type as targetType, target_id as targetId, reason, status, admin_notes as adminNotes, created_at as createdAt
       FROM reports ${all ? "" : "WHERE status = 'pending'"} ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

// Trust & Safety case view (IA spec §16) — resolves a report's
// target_type/target_id into something an admin can actually read, rather
// than a bare id. Only the two surfaces reports.ts's own comment says can
// be reported today (circles, reviews) — anything else comes back
// unresolved rather than guessing at a table.
adminRouter.get("/reports/:id/case", requireAdminPermission("reports.view"), async (req, res) => {
  const report = (await db
    .prepare(`SELECT id, target_type as targetType, target_id as targetId, reason, status, admin_notes as adminNotes, reporter_client_id as reporterClientId, created_at as createdAt FROM reports WHERE id = ?`)
    .get(req.params.id)) as { id: number; targetType: string; targetId: string; reason: string; status: string; adminNotes: string | null; reporterClientId: string; createdAt: string } | undefined;
  if (!report) return res.status(404).json({ error: "Report not found" });

  // OG-03 — every reportable type resolves, with what acting on it would affect.
  const target = await resolveReportTarget(report.targetType, report.targetId);

  // Every other report ever filed against the same target — the
  // "case-linking" the spec asks for, so a pattern of repeat complaints is
  // visible instead of triaging each report in isolation.
  const related = await db
    .prepare(`SELECT id, reason, status, created_at as createdAt FROM reports WHERE target_type = ? AND target_id = ? AND id != ? ORDER BY created_at DESC`)
    .all(report.targetType, report.targetId, report.id);

  res.json({ report, target, relatedReports: related });
});

adminRouter.put("/reports/:id", requireAdminPermission("reports.moderate"), async (req, res) => {
  const { status, notes, statementOfReasons } = req.body as { status?: string; notes?: string; statementOfReasons?: string };
  if (status && !["dismissed", "actioned", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be dismissed, actioned or suspended" });
  }
  if (!status && notes === undefined) return res.status(400).json({ error: "Nothing to update" });

  // OG-03 / DEC-10 — "suspended" changes the reported content's state (type by
  // type, reportModeration.ts). The report is only updated when that change
  // actually happened; otherwise the admin is told why and nothing is recorded.
  let suspendedAction: string | null = null;
  let actionTaken: string | null = null;
  if (status === "suspended") {
    const report = (await db.prepare(`SELECT id, target_type as targetType, target_id as targetId, status FROM reports WHERE id = ?`).get(req.params.id)) as
      | { id: number; targetType: string; targetId: string; status: string }
      | undefined;
    if (!report) return res.status(404).json({ error: "Report not found" });
    const parsed = parseDecisionReason(req.body, "suspension", REASON_REQUIRED.includes(report.targetType as ReportTargetType));
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      const done = await applyReportAction(report, req.user!.id, parsed.reason);
      suspendedAction = done.summary;
      actionTaken = done.action;
    } catch (e) {
      if (e instanceof ModerationError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  }

  const info = await db
    .prepare(
      `UPDATE reports SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes), action_taken = COALESCE(?, action_taken),
        statement_of_reasons = COALESCE(?, statement_of_reasons), decided_by = IF(? IS NULL, decided_by, ?), decided_at = IF(? IS NULL, decided_at, NOW()) WHERE id = ?`
    )
    // Stage 4 — the statement of reasons (DSA art. 17) and decider are kept with the decision; the decider can't later decide an appeal of it.
    .run(
      status,
      notes,
      actionTaken,
      typeof statementOfReasons === "string" && statementOfReasons.trim()
        ? statementOfReasons.trim().slice(0, 5000)
        : typeof req.body?.explanation === "string" && status === "suspended"
          ? req.body.explanation.trim().slice(0, 5000)
          : null,
      status ?? null,
      req.user!.id,
      status ?? null,
      req.params.id
    );
  if (info.changes === 0) return res.status(404).json({ error: "Report not found" });
  res.json({ ok: true, suspendedAction });
});

// OG-03 — reversing a moderation action. A suspended listing goes back to the
// status it had; a hidden chat message is shown again. Both are audited.
adminRouter.post("/moderation/:type(centre|club|experience)/:id/reinstate", requireAdminPermission("listings.moderate"), async (req, res) => {
  // Reinstatement has no category: an optional message to the partner (recorded).
  const explanation = typeof req.body?.explanation === "string" ? req.body.explanation.trim().slice(0, EXPLANATION_MAX) : "";
  const reason: DecisionReason | null = explanation ? { category: "", explanation, internalNote: null } : null;
  try {
    res.json(await reinstateListing(req.params.type as "centre" | "club" | "experience", req.params.id, req.user!.id, reason));
  } catch (e) {
    if (e instanceof ModerationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

adminRouter.post("/moderation/chat-messages/:id/unhide", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  try {
    await unhideChatMessage(req.params.id, req.user!.id, reason.slice(0, 500));
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ModerationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// --- audit log (moved from platformAdmin.ts) ----------------------------

adminRouter.get("/audit", requireAdminPermission("audit.view"), async (req, res) => {
  const actorUserId = typeof req.query.actorUserId === "string" ? req.query.actorUserId : undefined;
  // OG-24 — paged mode (?limit / ?cursor): the whole history, newest first,
  // with filters; the unparameterised call below is kept for older callers.
  if (req.query.limit !== undefined || req.query.cursor !== undefined) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (actorUserId) {
      where.push(`al.actor_user_id = ?`);
      params.push(actorUserId);
    }
    for (const [key, col] of [["objectType", "al.object_type"], ["objectId", "al.object_id"]] as const) {
      const v = req.query[key];
      if (typeof v === "string" && v) {
        where.push(`${col} = ?`);
        params.push(v.slice(0, 191));
      }
    }
    if (typeof req.query.action === "string" && req.query.action) {
      where.push(`al.action LIKE ?`);
      params.push(`${req.query.action.slice(0, 80)}%`);
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const like = `%${req.query.q.trim().slice(0, 100)}%`;
      where.push(`(al.action LIKE ? OR al.object_id LIKE ? OR u.email LIKE ? OR al.reason LIKE ?)`);
      params.push(like, like, like, like);
    }
    const after = decodeCursor(req.query.cursor);
    if (after) {
      where.push(`(al.created_at < ? OR (al.created_at = ? AND al.id < ?))`);
      params.push(after.at, after.at, Number(after.key));
    }
    const limit = pageLimit(req.query.limit, 50);
    const rows = (await db
      .prepare(
        `SELECT al.id, al.actor_user_id as actorUserId, u.email as actorEmail, al.action, al.object_type as objectType, al.object_id as objectId,
                al.previous_value as previousValue, al.new_value as newValue, al.reason, al.created_at as createdAt
         FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY al.created_at DESC, al.id DESC LIMIT ${limit + 1}`
      )
      .all(...params)) as { id: number; createdAt: string }[];
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return res.json({ items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, String(last.id)) : null });
  }
  const rows = actorUserId
    ? await db
        .prepare(
          `SELECT al.id, al.actor_user_id as actorUserId, u.email as actorEmail, al.action, al.object_type as objectType, al.object_id as objectId,
                  al.previous_value as previousValue, al.new_value as newValue, al.reason, al.created_at as createdAt
           FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.actor_user_id = ? ORDER BY al.created_at DESC LIMIT 200`
        )
        .all(actorUserId)
    : await db
        .prepare(
          `SELECT al.id, al.actor_user_id as actorUserId, u.email as actorEmail, al.action, al.object_type as objectType, al.object_id as objectId,
                  al.previous_value as previousValue, al.new_value as newValue, al.reason, al.created_at as createdAt
           FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id ORDER BY al.created_at DESC LIMIT 200`
        )
        .all();
  res.json(rows);
});

// --- support console (moved from platformAdmin.ts) ------------------------

// Platform-wide booking/registration explorer (IA spec §16) — extended
// from search-only to also cover games/circles (previously invisible to
// admin support search entirely) and to browse recent activity with no
// query, not just search-by-ref/email. Still bounded (LIMIT 20 per type,
// 'recent' capped the same way) — a real audit/export tool, not this.
// Support console (2026-10-16): one search across all six kinds of order,
// residents (magic-link customers), partner/admin accounts, games and
// circles. Matches an exact reference, or part of an email, name or listing.
// Blank query = the most recent orders only. Read-only.
adminRouter.get("/support/search", requireAdminPermission("support.search"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  const like = `%${q}%`;
  const orders = await searchOrders(q, q ? 40 : 20);
  if (!q) return res.json({ query: "", people: [], orders, games: [], circles: [] });
  const [residents, users, games, circles] = await Promise.all([
    db.prepare(`SELECT id, email, name, home_county AS county, created_at AS createdAt FROM residents WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 20`).all(like, like) as Promise<{ id: string; email: string; name: string; county: string; createdAt: string }[]>,
    db.prepare(`SELECT id, email, name, role, status, created_at AS createdAt FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 20`).all(like, like) as Promise<{ id: string; email: string; name: string; role: string; status: string; createdAt: string }[]>,
    db.prepare(`SELECT id, activity_label AS activityLabel, date, time, status, booking_ref AS bookingRef, location_text AS place FROM games WHERE id = ? OR activity_label LIKE ? OR booking_ref = ? ORDER BY created_at DESC LIMIT 20`).all(q, like, q),
    db
      .prepare(`SELECT c.id, c.name, c.activity_label AS activityLabel, c.status, c.county, (SELECT COUNT(*) FROM circle_members cm WHERE cm.circle_id = c.id) AS memberCount FROM circles c WHERE c.id = ? OR c.name LIKE ? ORDER BY c.created_at DESC LIMIT 20`)
      .all(q, like),
  ]);
  // One "person" per email: a resident account and a partner/admin login with
  // the same email are the same human, shown once.
  const byEmail = new Map<string, { email: string; name: string; resident: boolean; account: { role: string; status: string } | null; createdAt: string }>();
  for (const r of residents) byEmail.set(r.email.toLowerCase(), { email: r.email, name: r.name, resident: true, account: null, createdAt: r.createdAt });
  for (const u of users) {
    const k = u.email.toLowerCase();
    const cur = byEmail.get(k);
    if (cur) cur.account = { role: u.role, status: u.status };
    else byEmail.set(k, { email: u.email, name: u.name, resident: false, account: { role: u.role, status: u.status }, createdAt: u.createdAt });
  }
  // Customers who ordered without ever signing in only exist on their orders.
  for (const o of orders) {
    if (!o.email) continue;
    const k = o.email.toLowerCase();
    if (!byEmail.has(k) && (o.email.toLowerCase().includes(q.toLowerCase()) || (o.name ?? "").toLowerCase().includes(q.toLowerCase()))) byEmail.set(k, { email: o.email, name: o.name ?? "", resident: false, account: null, createdAt: o.createdAt });
  }
  res.json({ query: q, people: [...byEmail.values()].slice(0, 20), orders, games, circles: (circles as { memberCount: unknown }[]).map((c) => ({ ...c, memberCount: Number(c.memberCount) })) });
});

/** Everything support needs about one email address. */
adminRouter.get("/support/people/:email", requireAdminPermission("support.search"), async (req, res) => {
  const email = String(req.params.email).trim();
  if (!email) return res.status(400).json({ error: "Email required" });
  const resident = (await db.prepare(`SELECT id, name, home_county AS county, created_at AS createdAt FROM residents WHERE email = ?`).get(email)) as { id: string; name: string; county: string; createdAt: string } | undefined;
  const account = (await db.prepare(`SELECT id, name, role, status, created_at AS createdAt FROM users WHERE email = ?`).get(email)) as { id: string; name: string; role: string; status: string; createdAt: string } | undefined;
  const household = resident ? ((await db.prepare(`SELECT COUNT(*) AS n FROM household_members WHERE resident_id = ?`).get(resident.id)) as { n: number | string }) : null;
  const orders = await ordersForPerson(email, resident?.id ?? null);
  if (!resident && !account && orders.length === 0) return res.status(404).json({ error: "Nobody with that email" });
  res.json({
    email,
    name: resident?.name || account?.name || orders.find((o) => o.name)?.name || "",
    resident: resident ? { ...resident, householdMembers: Number(household?.n ?? 0) } : null,
    account: account ?? null,
    orders,
  });
});

/** One order, read-only, for support (no ledger or provider detail). */
adminRouter.get("/support/orders/:kind/:ref", requireAdminPermission("support.search"), async (req, res) => {
  const kind = req.params.kind as OrderKind;
  if (!ORDER_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown order type" });
  const detail = await orderDetail(kind, String(req.params.ref));
  if (!detail) return res.status(404).json({ error: "Order not found" });
  res.json(detail);
});

// Open Bookings & Circle activity (IA spec §16) — a bounded admin view of
// two surfaces that had no admin visibility at all before this pass: Open
// Bookings (a room booking that spawned a joinable game — games.booking_ref
// is set) and Circle membership counts, both capped at 50 most recent.
adminRouter.get("/activity-overview", requireAdminPermission("support.search"), async (_req, res) => {
  const [openBookings, circleActivity] = await Promise.all([
    db
      .prepare(
        `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.status, g.booking_ref as bookingRef,
                b.ref as bookingRefFull, b.name as bookingName, c.name as centreName
         FROM games g
         JOIN bookings b ON b.ref = g.booking_ref
         LEFT JOIN centres c ON c.id = b.centre_id
         WHERE g.booking_ref IS NOT NULL
         ORDER BY g.created_at DESC LIMIT 50`
      )
      .all(),
    db
      .prepare(
        `SELECT c.id, c.name, c.activity_label as activityLabel, c.status, c.created_at as createdAt,
                (SELECT COUNT(*) FROM circle_members cm WHERE cm.circle_id = c.id) as memberCount
         FROM circles c ORDER BY c.created_at DESC LIMIT 50`
      )
      .all(),
  ]);
  res.json({ openBookings, circleActivity });
});

// --- system status (moved from platformAdmin.ts — best-effort, not real
// monitoring) ----------------------------------------------------------

adminRouter.get("/status", requireAdminPermission("workspace.view"), async (_req, res) => {
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

// --- notification templates (implementation backlog #2) -------------------
// Override layer over notifications.ts's own hardcoded fallbacks — see
// notificationTemplates.ts's own comment for the exact scope (the shared
// notifyNewBookingOrRegistration()/notifyCancellation() functions, not
// every notification call site in the app).

adminRouter.get("/notification-templates", requireAdminPermission("templates.view"), async (_req, res) => {
  const rows = (await db
    .prepare(`SELECT template_key as templateKey, subject_template as subjectTemplate, title_template as titleTemplate, body_template as bodyTemplate, updated_at as updatedAt FROM notification_templates`)
    .all()) as { templateKey: string; subjectTemplate: string | null; titleTemplate: string | null; bodyTemplate: string | null; updatedAt: string }[];
  const byKey = new Map(rows.map((r) => [r.templateKey, r]));
  res.json(
    NOTIFICATION_TEMPLATE_KEYS.map((t) => ({
      ...t,
      subjectTemplate: byKey.get(t.key)?.subjectTemplate ?? null,
      titleTemplate: byKey.get(t.key)?.titleTemplate ?? null,
      bodyTemplate: byKey.get(t.key)?.bodyTemplate ?? null,
      updatedAt: byKey.get(t.key)?.updatedAt ?? null,
    }))
  );
});

adminRouter.put("/notification-templates/:key", requireAdminPermission("templates.edit"), async (req, res) => {
  const known = NOTIFICATION_TEMPLATE_KEYS.find((t) => t.key === req.params.key);
  if (!known) return res.status(400).json({ error: "Unknown template key" });
  const { subjectTemplate, titleTemplate, bodyTemplate } = req.body as { subjectTemplate?: string | null; titleTemplate?: string | null; bodyTemplate?: string | null };
  await db
    .prepare(
      `INSERT INTO notification_templates (template_key, description, subject_template, title_template, body_template) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE subject_template = VALUES(subject_template), title_template = VALUES(title_template), body_template = VALUES(body_template)`
    )
    .run(req.params.key, known.description, subjectTemplate || null, titleTemplate || null, bodyTemplate || null);
  await writeAudit({ actorUserId: req.user!.id, action: "notification_template.updated", objectType: "notification_template", objectId: req.params.key });
  res.json({ ok: true });
});

// Reverts to the hardcoded fallback — deletes the override row entirely
// rather than setting empty strings, so renderTemplate()'s "row missing"
// path (not "row with empty templates") is what runs.
adminRouter.delete("/notification-templates/:key", requireAdminPermission("templates.delete"), async (req, res) => {
  await db.prepare(`DELETE FROM notification_templates WHERE template_key = ?`).run(req.params.key);
  await writeAudit({ actorUserId: req.user!.id, action: "notification_template.reset", objectType: "notification_template", objectId: req.params.key });
  res.json({ ok: true });
});

// --- community-contributed places (master-prompt punch list #4) ----------
// Approving auto-publishes a real, minimal, unclaimed listing (vendor_id
// left NULL — the exact same "platform-curated" shape seed.ts already uses)
// rather than just flipping a status an admin would have to act on again
// separately. A centre always needs >=1 active room (existing invariant,
// see CLAUDE.md's Rooms architecture note) so approval creates one default
// room too.

adminRouter.get("/place-suggestions", requireAdminPermission("queues.view"), async (req, res) => {
  const all = req.query.status === "all";
  const rows = await db
    .prepare(
      `SELECT id, suggested_name as suggestedName, category, area, county, description, contact_info as contactInfo,
              status, published_listing_id as publishedListingId, created_at as createdAt
       FROM place_suggestions ${all ? "" : "WHERE status = 'pending'"} ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/place-suggestions/:id/status", requireAdminPermission("queues.decide"), async (req, res) => {
  const { status } = req.body as { status?: "approved" | "rejected" };
  if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });
  // D-03: a rejected suggestion needs a reason the person who suggested it sees.
  const parsedReason = parseDecisionReason(req.body, "application_rejection", status === "rejected");
  if (!parsedReason.ok) return res.status(400).json({ error: parsedReason.error });
  const reason = status === "rejected" ? parsedReason.reason : null;

  const suggestion = (await db.prepare(`SELECT * FROM place_suggestions WHERE id = ?`).get(req.params.id)) as
    | {
        id: string;
        suggested_name: string;
        category: "centre" | "club";
        area: string;
        county: string;
        description: string;
        status: string;
      }
    | undefined;
  if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
  if (suggestion.status !== "pending") return res.status(409).json({ error: "Already reviewed" });

  // D-03: claim the pending suggestion, create the listing (approval), mark it
  // decided and record the decision in one transaction under a row lock, so a
  // retry or two admins at once can't decide it twice (two decisions, two
  // notices, or two published listings).
  const listingId = crypto.randomUUID();
  const county = suggestion.county || "Dublin";
  const slug = status === "approved" ? await generateSlug(suggestion.category === "centre" ? "centres" : "clubs", suggestion.suggested_name) : "";
  const outcome = await db.transaction(async (tx) => {
    const locked = (await tx.prepare(`SELECT status FROM place_suggestions WHERE id = ? FOR UPDATE`).get(req.params.id)) as { status: string } | undefined;
    if (!locked || locked.status !== "pending") return null;
    let published: string | null = null;
    if (status === "approved") {
      const { lat, lng } = approximateCoords(county, listingId);
      if (suggestion.category === "centre") {
        await tx
          .prepare(
            `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, created_at, opens_at, closes_at, payment_method, lat, lng, location_source, phone, accessibility, slug)
             VALUES (?, ?, ?, ?, 0, 0, 0, 0, '', '', '', ?, 'approved', NOW(), '09:00', '21:00', 'cash', ?, ?, 'approximate', '', '', ?)`
          )
          .run(listingId, suggestion.suggested_name, suggestion.area, county, suggestion.description, lat, lng, slug);
        await tx
          .prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method, active) VALUES (?, ?, 'Main Room', 0, 0, '', 0, 'cash', 1)`)
          .run(crypto.randomUUID(), listingId);
      } else {
        await tx
          .prepare(
            `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, status, created_at, payment_method, lat, lng, location_source, phone, accessibility, category, slug)
             VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, '', '', ?, 'approved', NOW(), 'cash', ?, ?, 'approximate', '', '', '', ?)`
          )
          .run(listingId, suggestion.suggested_name, suggestion.area, county, suggestion.description, lat, lng, slug);
      }
      published = listingId;
    }
    await tx.prepare(`UPDATE place_suggestions SET status = ?, published_listing_id = ?, reviewed_at = NOW() WHERE id = ?`).run(status, published, req.params.id);
    const decisionId = await recordDecision(tx, { objectType: "place_suggestion", objectId: req.params.id, action: `place_suggestion.${status}`, previousState: "pending", newState: status, reason, actorUserId: req.user!.id });
    return { published, decisionId };
  });
  if (!outcome) return res.status(409).json({ error: "Already reviewed" });
  const publishedListingId = outcome.published;
  const decisionId = outcome.decisionId;
  await writeAudit({
    actorUserId: req.user!.id,
    action: status === "approved" ? "place_suggestion.approved" : "place_suggestion.rejected",
    objectType: "place_suggestion",
    objectId: req.params.id,
    previousValue: { status: "pending" },
    newValue: { status, publishedListingId, decisionId, ...(reason ? { reasonCategory: reason.category } : {}) },
  });
  res.json({ ok: true, publishedListingId });
  // Residents who suggested while signed in are told in the app; anonymous
  // suggestions show the explanation on the suggester's own suggestions list.
  if (status === "rejected") {
    const owner = (await db.prepare(`SELECT resident_id as residentId FROM place_suggestions WHERE id = ?`).get(req.params.id)) as { residentId: string | null } | undefined;
    void notifyApplicant(owner?.residentId ?? null, {
      title: `Your place suggestion "${suggestion.suggested_name}"`,
      intro: `HelloCircle reviewed your suggestion "${suggestion.suggested_name}" and isn't adding it.`,
      kind: "application_rejection",
      reason,
      nextSteps: NEXT_STEPS.suggestion,
      email: false,
      suggestionId: req.params.id,
    });
  }
});

// Maps kill switch (Maps cost-control follow-up pass, review point #3) — a
// real runtime toggle, not the build-time VITE_MAPBOX_ENABLED env var. GET
// here is the same read GET /api/config (public) exposes, duplicated only
// so the admin UI can show current state without relying on the public
// route's own cache timing; PUT is the actual admin action, audited like
// every other admin mutation in this file.
adminRouter.get("/config/maps-enabled", requireAdminPermission("workspace.view"), async (_req, res) => {
  const enabled = (await getSetting("maps_enabled", "true")) !== "false";
  res.json({ enabled });
});

adminRouter.put("/config/maps-enabled", requireAdminPermission("platform.settings"), async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  const before = (await getSetting("maps_enabled", "true")) !== "false";
  await setSetting("maps_enabled", enabled ? "true" : "false");
  await writeAudit({
    actorUserId: req.user!.id,
    action: "config.maps_enabled_changed",
    objectType: "app_settings",
    objectId: "maps_enabled",
    previousValue: { enabled: before },
    newValue: { enabled },
  });
  res.json({ enabled });
});
