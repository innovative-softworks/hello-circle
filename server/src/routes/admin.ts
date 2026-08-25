import crypto from "node:crypto";
import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { writeAudit } from "../audit.js";
import { approximateCoords, db } from "../db/index.js";
import { FEATURE_FLAG_KEYS, getCentre, getClub, getDemandSignals, orgFeatureFlagsById } from "../db/queries.js";
import { endOfIrelandDay } from "../irelandTime.js";
import { NOTIFICATION_TEMPLATE_KEYS } from "../notificationTemplates.js";
import { generateSlug } from "../slugify.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- platform stats ----------------------------------------------------

adminRouter.get("/stats", async (_req, res) => {
  const centresPending = (await db.prepare(`SELECT COUNT(*) as n FROM centres WHERE status = 'pending'`).get()) as { n: number };
  const clubsPending = (await db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE status = 'pending'`).get()) as { n: number };
  const experiencesPending = (await db.prepare(`SELECT COUNT(*) as n FROM experiences WHERE status = 'pending'`).get()) as { n: number };
  const vendorCount = (await db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'vendor'`).get()) as { n: number };
  const totalListings = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM centres WHERE status != 'deleted') +
        (SELECT COUNT(*) FROM clubs WHERE status != 'deleted') +
        (SELECT COUNT(*) FROM experiences WHERE status != 'deleted') as n`
    )
    .get()) as { n: number };
  const reviewCount = (await db.prepare(`SELECT COUNT(*) as n FROM reviews`).get()) as { n: number };
  // Folded in from the old /platform-admin dashboard — genuinely new signals,
  // not shown anywhere else in this dashboard.
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
  });
});

// --- vendor management -------------------------------------------------

adminRouter.get("/vendors", async (_req, res) => {
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

adminRouter.put("/vendors/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved or suspended" });
  }
  // Vendor account approval and listing approval are deliberately separate
  // steps: approving the account only lets the vendor log in and finish
  // setting up their listing (rooms/price/photos/etc) — the listing itself
  // still needs its own admin review once that setup is done.
  const before = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(req.params.id)) as { status: string } | undefined;
  const info = await db.prepare(`UPDATE users SET status = ? WHERE id = ? AND role = 'vendor'`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  writeAudit({ actorUserId: req.user!.id, action: "vendor.status_changed", objectType: "user", objectId: req.params.id, previousValue: before?.status, newValue: status });
  res.json({ ok: true });
});

// --- Host tier applications (IA spec five-layer audit) --------------------
// A resident's application to become a verified community Host — badge-
// only trust signal (see games.ts/circles.ts), never a gate on hosting.
// Mirrors the vendor moderation pair above exactly: a pending queue plus a
// single status-mutating endpoint, audited the same way.

adminRouter.get("/host-applications", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, name, email, host_bio as bio, host_phone as phone, host_applied_at as appliedAt
       FROM residents WHERE host_status = 'pending' ORDER BY host_applied_at`
    )
    .all();
  res.json(rows);
});

adminRouter.put("/host-applications/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["verified", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be verified or rejected" });
  }
  const before = (await db.prepare(`SELECT host_status FROM residents WHERE id = ?`).get(req.params.id)) as { host_status: string } | undefined;
  const info = await db
    .prepare(`UPDATE residents SET host_status = ?, host_decided_at = NOW() WHERE id = ? AND host_status = 'pending'`)
    .run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "No pending host application for this resident" });
  writeAudit({ actorUserId: req.user!.id, action: "resident.host_status_changed", objectType: "resident_host_application", objectId: req.params.id, previousValue: before?.host_status, newValue: status });
  res.json({ ok: true });
});

// --- listing moderation --------------------------------------------------

const PENDING_CENTRE_COLUMNS = `c.id, c.name, c.status, c.area, c.county, c.capacity, c.from_price as \`from\`, c.managed_by as managedBy,
              c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured`;
const PENDING_CLUB_COLUMNS = `c.id, c.name, c.status, c.sport, c.area, c.county, c.ages, c.price, c.unit,
              c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured`;
// experiences has no `ph`/`sport` — image_url/blurb/kind/price_cents stand
// in as the fields an admin triage card needs at a glance.
const PENDING_EXPERIENCE_COLUMNS = `c.id, c.name, c.status, c.kind, c.area, c.county, c.price_cents as \`from\`,
              c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured`;

adminRouter.get("/listings/pending", async (_req, res) => {
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
adminRouter.get("/listings", async (_req, res) => {
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

adminRouter.put("/centres/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status === "approved" && (await vendorNotApprovedFor("centres", req.params.id))) {
    return res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
  }
  const info = await db.prepare(`UPDATE centres SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json(await getCentre(req.params.id));
});

adminRouter.put("/clubs/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status === "approved" && (await vendorNotApprovedFor("clubs", req.params.id))) {
    return res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
  }
  const info = await db.prepare(`UPDATE clubs SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json(await getClub(req.params.id));
});

adminRouter.put("/experiences/:id/status", async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !["pending", "approved", "rejected", "deleted"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status === "approved" && (await vendorNotApprovedFor("experiences", req.params.id))) {
    return res.status(409).json({ error: "Approve the vendor's account before approving their listing" });
  }
  const info = await db.prepare(`UPDATE experiences SET status = ? WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Experience not found" });
  res.json({ ok: true });
});

// Bounded "featured" flag (IA spec §16) — the entire CMS surface: one
// boolean per listing table, toggled here, sorted first in public listing
// order (see db/queries.ts listCentres/listClubs, routes/experiences.ts).
const FEATURED_TABLES = { centres: "centres", clubs: "clubs", experiences: "experiences" } as const;

adminRouter.put("/:table(centres|clubs|experiences)/:id/featured", async (req, res) => {
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

adminRouter.get("/claims", async (_req, res) => {
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

adminRouter.put("/claims/:id/status", async (req, res) => {
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
    await db.prepare(`UPDATE listing_claims SET status = 'rejected', decided_at = NOW() WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true });
  }

  // Same guard as listing-status approval: the claiming vendor's own account
  // has to be approved before their claim can be.
  const vendor = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(claim.vendorId)) as { status: string } | undefined;
  if (!vendor || vendor.status !== "approved") {
    return res.status(409).json({ error: "Approve the vendor's account before approving their claim" });
  }

  const table = claim.listingType === "centre" ? "centres" : "clubs";
  try {
    await db.transaction(async (tx) => {
      // vendor_id IS NULL guard: if the listing got claimed by someone else
      // since this claim was submitted, this affects 0 rows and the whole
      // approval rolls back instead of silently overwriting the real owner.
      const result = await tx.prepare(`UPDATE ${table} SET vendor_id = ? WHERE id = ? AND vendor_id IS NULL`).run(claim.vendorId, claim.listingId);
      if (result.changes === 0) throw new Error("ALREADY_CLAIMED");
      await tx.prepare(`UPDATE listing_claims SET status = 'approved', decided_at = NOW() WHERE id = ?`).run(req.params.id);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_CLAIMED") {
      return res.status(409).json({ error: "This listing has already been claimed by another vendor" });
    }
    throw e;
  }
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

adminRouter.put("/centres/:id", async (req, res) => {
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
  res.json(centre);
});

adminRouter.delete("/centres/:id", async (req, res) => {
  const info = await db.prepare(`UPDATE centres SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
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

adminRouter.put("/clubs/:id", async (req, res) => {
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
  res.json(club);
});

adminRouter.delete("/clubs/:id", async (req, res) => {
  const info = await db.prepare(`UPDATE clubs SET status = 'deleted' WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json({ ok: true });
});

// --- review moderation -----------------------------------------------------

adminRouter.get("/reviews", async (_req, res) => {
  const rows = await db.prepare(`SELECT * FROM reviews ORDER BY created_at DESC`).all();
  res.json(rows);
});

adminRouter.put("/reviews/:id/unhide", async (req, res) => {
  const info = await db.prepare(`UPDATE reviews SET hidden = 0 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found" });
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

adminRouter.get("/coupons", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, code, kind, amount, max_uses as maxUses, used_count as usedCount,
              expires_at as expiresAt, active, created_at as createdAt
       FROM coupons ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

adminRouter.post("/coupons", async (req, res) => {
  const b = req.body as CouponInput;
  if (!b.code || !b.kind || !b.amount) return res.status(400).json({ error: "code, kind and amount are required" });
  if (!["percent", "fixed"].includes(b.kind)) return res.status(400).json({ error: "kind must be percent or fixed" });
  if (b.kind === "percent" && (b.amount <= 0 || b.amount > 100)) return res.status(400).json({ error: "Percent amount must be 1-100" });

  const code = b.code.trim().toUpperCase();
  // The admin picks a plain calendar date ("expires 25 Dec") — that should
  // mean valid through the end of that day in Ireland, not midnight UTC.
  const expiresAt = b.expiresAt ? endOfIrelandDay(b.expiresAt) : null;
  try {
    await db.prepare(
      `INSERT INTO coupons (code, kind, amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(code, b.kind, b.amount, b.maxUses ?? null, expiresAt);
  } catch {
    return res.status(409).json({ error: "That code already exists" });
  }
  res.status(201).json({ ok: true });
});

adminRouter.put("/coupons/:id/active", async (req, res) => {
  const { active } = req.body as { active?: boolean };
  const info = await db.prepare(`UPDATE coupons SET active = ? WHERE id = ?`).run(active ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

adminRouter.delete("/coupons/:id", async (req, res) => {
  const info = await db.prepare(`DELETE FROM coupons WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
});

// --- multi-tenant org hierarchy scaffolding (FUTURE, best-effort) ----------
// Data-model only — no tenant isolation is enforced anywhere else in the app
// (every query is still platform-wide). See plan doc "Not yet" section.

adminRouter.get("/organisations", async (_req, res) => {
  const rows = await db.prepare(`SELECT id, name, kind, created_at as createdAt FROM organisations ORDER BY name`).all();
  res.json(rows);
});

adminRouter.post("/organisations", async (req, res) => {
  const { name, kind } = req.body as { name?: string; kind?: string };
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, ?)`).run(id, name, kind ?? "council");
  res.status(201).json({ id });
});

// Feature flags (implementation backlog #5) — real per-org capability
// toggles, admin-only (never vendor-self-serve, see routes/org.ts's
// read-only counterpart). Gates 3 real features: Open Booking, Programs,
// Experiences — see orgFeatureFlags()'s own comment for the enabled-by-
// default (opt-out) convention.
adminRouter.get("/organisations/:id/flags", async (req, res) => {
  const flags = await orgFeatureFlagsById(req.params.id);
  res.json(flags);
});

adminRouter.put("/organisations/:id/flags/:key", async (req, res) => {
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

adminRouter.put("/centres/:id/organisation", async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const info = await db.prepare(`UPDATE centres SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Centre not found" });
  res.json({ ok: true });
});

adminRouter.put("/clubs/:id/organisation", async (req, res) => {
  const { organisationId } = req.body as { organisationId: string | null };
  const info = await db.prepare(`UPDATE clubs SET org_id = ? WHERE id = ?`).run(organisationId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Club not found" });
  res.json({ ok: true });
});

// --- RBAC + marketplace-tier scaffolding (FUTURE, best-effort) -------------

const PLATFORM_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"];

adminRouter.put("/vendors/:id/platform-role", async (req, res) => {
  const { platformRole } = req.body as { platformRole: string | null };
  if (platformRole !== null && !PLATFORM_ROLES.includes(platformRole)) {
    return res.status(400).json({ error: `platformRole must be one of ${PLATFORM_ROLES.join(", ")}, or null` });
  }
  const before = (await db.prepare(`SELECT platform_role as platformRole FROM users WHERE id = ?`).get(req.params.id)) as { platformRole: string | null } | undefined;
  const info = await db.prepare(`UPDATE users SET platform_role = ? WHERE id = ? AND role = 'vendor'`).run(platformRole, req.params.id);
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

adminRouter.put("/vendors/:id/provider-tier", async (req, res) => {
  const { providerTier } = req.body as { providerTier?: string };
  if (!providerTier || !["standard", "verified", "featured"].includes(providerTier)) {
    return res.status(400).json({ error: "providerTier must be standard, verified or featured" });
  }
  const info = await db.prepare(`UPDATE users SET provider_tier = ? WHERE id = ? AND role = 'vendor'`).run(providerTier, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Vendor not found" });
  res.json({ ok: true });
});

// --- demand intelligence (NEXT) — platform-wide view ------------------------

adminRouter.get("/demand", async (_req, res) => {
  const rows = await getDemandSignals({ limit: 50 });
  res.json(rows);
});

// --- reports queue (moved from platformAdmin.ts — the only genuinely
// distinct piece of that page's "Moderation" tab; report creation itself is
// public, see routes/reports.ts) ---------------------------------------

adminRouter.get("/reports", async (req, res) => {
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
adminRouter.get("/reports/:id/case", async (req, res) => {
  const report = (await db
    .prepare(`SELECT id, target_type as targetType, target_id as targetId, reason, status, admin_notes as adminNotes, reporter_client_id as reporterClientId, created_at as createdAt FROM reports WHERE id = ?`)
    .get(req.params.id)) as { id: number; targetType: string; targetId: string; reason: string; status: string; adminNotes: string | null; reporterClientId: string; createdAt: string } | undefined;
  if (!report) return res.status(404).json({ error: "Report not found" });

  let target: Record<string, unknown> | null = null;
  if (report.targetType === "circle") {
    target = (await db.prepare(`SELECT id, name, status, created_by_resident_id as createdByResidentId FROM circles WHERE id = ?`).get(report.targetId)) as Record<string, unknown> | undefined ?? null;
  } else if (report.targetType === "review") {
    target = (await db.prepare(`SELECT id, listing_type as listingType, listing_id as listingId, name, comment, hidden FROM reviews WHERE id = ?`).get(report.targetId)) as Record<string, unknown> | undefined ?? null;
  }

  // Every other report ever filed against the same target — the
  // "case-linking" the spec asks for, so a pattern of repeat complaints is
  // visible instead of triaging each report in isolation.
  const related = await db
    .prepare(`SELECT id, reason, status, created_at as createdAt FROM reports WHERE target_type = ? AND target_id = ? AND id != ? ORDER BY created_at DESC`)
    .all(report.targetType, report.targetId, report.id);

  res.json({ report, target, relatedReports: related });
});

adminRouter.put("/reports/:id", async (req, res) => {
  const { status, notes } = req.body as { status?: string; notes?: string };
  if (status && !["dismissed", "actioned", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be dismissed, actioned or suspended" });
  }
  if (!status && notes === undefined) return res.status(400).json({ error: "Nothing to update" });

  let suspendedAction: string | null = null;
  if (status === "suspended") {
    const report = (await db.prepare(`SELECT target_type as targetType, target_id as targetId FROM reports WHERE id = ?`).get(req.params.id)) as
      | { targetType: string; targetId: string }
      | undefined;
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.targetType === "circle") {
      await db.prepare(`UPDATE circles SET status = 'closed' WHERE id = ?`).run(report.targetId);
      suspendedAction = "circle closed";
    } else if (report.targetType === "review") {
      await db.prepare(`UPDATE reviews SET hidden = 1 WHERE id = ?`).run(report.targetId);
      suspendedAction = "review hidden";
    }
    await writeAudit({ actorUserId: req.user!.id, action: "suspend_by_report", objectType: report.targetType, objectId: report.targetId, newValue: { reportId: req.params.id } });
  }

  const info = await db
    .prepare(`UPDATE reports SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes) WHERE id = ?`)
    .run(status, notes, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Report not found" });
  res.json({ ok: true, suspendedAction });
});

// --- audit log (moved from platformAdmin.ts) ----------------------------

adminRouter.get("/audit", async (req, res) => {
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

// --- support console (moved from platformAdmin.ts) ------------------------

// Platform-wide booking/registration explorer (IA spec §16) — extended
// from search-only to also cover games/circles (previously invisible to
// admin support search entirely) and to browse recent activity with no
// query, not just search-by-ref/email. Still bounded (LIMIT 20 per type,
// 'recent' capped the same way) — a real audit/export tool, not this.
adminRouter.get("/support/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const like = `%${q}%`;
  const [bookings, registrations, users, games, circles] = await Promise.all([
    q
      ? db.prepare(`SELECT ref, name, email, date, time, status, payment_status as paymentStatus FROM bookings WHERE ref = ? OR email LIKE ? LIMIT 20`).all(q, like)
      : db.prepare(`SELECT ref, name, email, date, time, status, payment_status as paymentStatus FROM bookings ORDER BY created_at DESC LIMIT 20`).all(),
    q
      ? db.prepare(`SELECT ref, g_first as gFirst, g_last as gLast, email, status, payment_status as paymentStatus FROM registrations WHERE ref = ? OR email LIKE ? LIMIT 20`).all(q, like)
      : db.prepare(`SELECT ref, g_first as gFirst, g_last as gLast, email, status, payment_status as paymentStatus FROM registrations ORDER BY created_at DESC LIMIT 20`).all(),
    q ? db.prepare(`SELECT id, email, name, role, status FROM users WHERE email LIKE ? LIMIT 20`).all(like) : [],
    q
      ? db.prepare(`SELECT id, activity_label as activityLabel, date, time, status, booking_ref as bookingRef FROM games WHERE id = ? OR activity_label LIKE ? LIMIT 20`).all(q, like)
      : db.prepare(`SELECT id, activity_label as activityLabel, date, time, status, booking_ref as bookingRef FROM games ORDER BY created_at DESC LIMIT 20`).all(),
    q
      ? db.prepare(`SELECT id, name, activity_label as activityLabel, status, created_at as createdAt FROM circles WHERE id = ? OR name LIKE ? LIMIT 20`).all(q, like)
      : db.prepare(`SELECT id, name, activity_label as activityLabel, status, created_at as createdAt FROM circles ORDER BY created_at DESC LIMIT 20`).all(),
  ]);
  res.json({ bookings, registrations, users, games, circles });
});

// Open Bookings & Circle activity (IA spec §16) — a bounded admin view of
// two surfaces that had no admin visibility at all before this pass: Open
// Bookings (a room booking that spawned a joinable game — games.booking_ref
// is set) and Circle membership counts, both capped at 50 most recent.
adminRouter.get("/activity-overview", async (_req, res) => {
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

adminRouter.get("/status", async (_req, res) => {
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

adminRouter.get("/notification-templates", async (_req, res) => {
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

adminRouter.put("/notification-templates/:key", async (req, res) => {
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
adminRouter.delete("/notification-templates/:key", async (req, res) => {
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

adminRouter.get("/place-suggestions", async (req, res) => {
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

adminRouter.put("/place-suggestions/:id/status", async (req, res) => {
  const { status } = req.body as { status?: "approved" | "rejected" };
  if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });

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

  let publishedListingId: string | null = null;
  if (status === "approved") {
    const listingId = crypto.randomUUID();
    const county = suggestion.county || "Dublin";
    const { lat, lng } = approximateCoords(county, listingId);
    const slug = await generateSlug(suggestion.category === "centre" ? "centres" : "clubs", suggestion.suggested_name);
    if (suggestion.category === "centre") {
      await db.transaction(async (tx) => {
        await tx
          .prepare(
            `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, created_at, opens_at, closes_at, payment_method, lat, lng, phone, accessibility, slug)
             VALUES (?, ?, ?, ?, 0, 0, 0, 0, '', '', '', ?, 'approved', NOW(), '09:00', '21:00', 'cash', ?, ?, '', '', ?)`
          )
          .run(listingId, suggestion.suggested_name, suggestion.area, county, suggestion.description, lat, lng, slug);
        await tx
          .prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method, active) VALUES (?, ?, 'Main Room', 0, 0, '', 0, 'cash', 1)`)
          .run(crypto.randomUUID(), listingId);
      });
    } else {
      await db
        .prepare(
          `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, status, created_at, payment_method, lat, lng, phone, accessibility, category, slug)
           VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, '', '', ?, 'approved', NOW(), 'cash', ?, ?, '', '', '', ?)`
        )
        .run(listingId, suggestion.suggested_name, suggestion.area, county, suggestion.description, lat, lng, slug);
    }
    publishedListingId = listingId;
  }

  await db
    .prepare(`UPDATE place_suggestions SET status = ?, published_listing_id = ?, reviewed_at = NOW() WHERE id = ?`)
    .run(status, publishedListingId, req.params.id);
  await writeAudit({
    actorUserId: req.user!.id,
    action: status === "approved" ? "place_suggestion.approved" : "place_suggestion.rejected",
    objectType: "place_suggestion",
    objectId: req.params.id,
    newValue: { publishedListingId },
  });
  res.json({ ok: true, publishedListingId });
});
