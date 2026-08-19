import { Router } from "express";
import { requirePlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { getDemandSignals } from "../db/queries.js";
import { inClause } from "./vendorHelpers.js";

// Phase C: participant directory, insights, CSV export, payments summary,
// demand intelligence — split out of the original single vendor.ts (see
// CLAUDE.md). Mounted under vendorRouter in vendor.ts, which applies
// requireVendor/attachVendorIds first.

export const vendorInsightsRouter = Router();

// --- participant directory (Phase C) ------------------------------------
// Searchable across everyone with a paid booking/registration on any of
// this vendor's own listings — previously only visible inline per-row on
// the flat Bookings tab.

vendorInsightsRouter.get("/participants", async (req, res) => {
  const ids = req.vendorIds!;
  const in1 = inClause(ids);
  const q = typeof req.query.q === "string" ? `%${req.query.q}%` : "%";
  const rows = await db
    .prepare(
      `SELECT b.name, b.email, b.phone, 'booking' as kind, c.name as listingName, b.created_at as lastActivity
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid' AND (b.name LIKE ? OR b.email LIKE ?)
       UNION ALL
       SELECT CONCAT(r.g_first, ' ', r.g_last) as name, r.email, r.phone, 'registration' as kind, c.name as listingName, r.created_at as lastActivity
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid' AND (r.g_first LIKE ? OR r.g_last LIKE ? OR r.email LIKE ?)
       ORDER BY lastActivity DESC LIMIT 200`
    )
    .all(...ids, q, q, ...ids, q, q, q);
  res.json(rows);
});

// --- insights / reports (Phase C) ---------------------------------------
// Decision-focused aggregates, not vanity charting — participation,
// cancellation rate, and a day/hour utilisation grid for hall bookings (the
// one listing type with a real time dimension today).

vendorInsightsRouter.get("/insights", async (req, res) => {
  const ids = req.vendorIds!;
  const in1 = inClause(ids);
  const totals = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid') as totalBookings,
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.status = 'cancelled') as cancelledBookings,
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid') as totalRegistrations,
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.status = 'cancelled') as cancelledRegistrations,
        (SELECT COUNT(DISTINCT b.client_id) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid') as uniqueBookers`
    )
    .get(...ids, ...ids, ...ids, ...ids, ...ids)) as Record<string, number>;

  const utilisation = await db
    .prepare(
      `SELECT DAYOFWEEK(b.date) as dayOfWeek, SUBSTRING(b.time, 1, 2) as hour, COUNT(*) as n
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid'
       GROUP BY dayOfWeek, hour`
    )
    .all(...ids);

  res.json({ totals, utilisation });
});

vendorInsightsRouter.get("/reports/bookings.csv", requirePlatformRole("finance", "read_only_analyst"), async (req, res) => {
  const ids = req.vendorIds!;
  const rows = (await db
    .prepare(
      `SELECT b.ref, c.name as centre, b.date, b.time, b.duration, b.guests, b.name, b.email, b.total_cents as totalCents, b.status
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${inClause(ids)}) ORDER BY b.date DESC`
    )
    .all(...ids)) as Record<string, unknown>[];
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

vendorInsightsRouter.get("/payments", requirePlatformRole("finance"), async (req, res) => {
  const ids = req.vendorIds!;
  const in1 = inClause(ids);
  const [bookings, registrations] = await Promise.all([
    db
      .prepare(
        `SELECT b.ref, 'booking' as kind, c.name as listingName, b.total_cents as totalCents, b.created_at as createdAt, b.payment_status as paymentStatus
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) ORDER BY b.created_at DESC LIMIT 100`
      )
      .all(...ids),
    db
      .prepare(
        `SELECT r.ref, 'registration' as kind, c.name as listingName, r.total_cents as totalCents, r.created_at as createdAt, r.payment_status as paymentStatus
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) ORDER BY r.created_at DESC LIMIT 100`
      )
      .all(...ids),
  ]);
  const all = [...bookings, ...registrations].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalPaidCents = all.filter((r: any) => r.paymentStatus === "paid").reduce((sum: number, r: any) => sum + r.totalCents, 0);
  res.json({ transactions: all.slice(0, 150), totalPaidCents });
});

// --- demand intelligence (NEXT) -------------------------------------------
// Aggregated read of server/src/routes/search.ts's logged zero-result
// searches. Scoped to this vendor's own listing type + county by default —
// pass ?scope=all for the unscoped, platform-wide view (real signal too;
// not hidden, just not the default).

vendorInsightsRouter.get("/demand", requirePlatformRole("finance", "read_only_analyst"), async (req, res) => {
  const scopeToOwn = req.query.scope !== "all";
  const listingType = req.user!.vendorType === "community" ? "centre" : "club";
  const rows = await getDemandSignals(
    scopeToOwn ? { listingType, county: req.user!.county || undefined, limit: 25 } : { limit: 25 }
  );
  res.json(rows);
});
