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

  const utilisation = (await db
    .prepare(
      `SELECT DAYOFWEEK(b.date) as dayOfWeek, SUBSTRING(b.time, 1, 2) as hour, COUNT(*) as n
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid'
       GROUP BY dayOfWeek, hour`
    )
    .all(...ids)) as { dayOfWeek: number; hour: string; n: number }[];

  // Host Manage spec §15's "decisions, not decorative charts" — a real
  // narrative sentence computed from the same utilisation grid above
  // (booking-count by day-of-week is the only time dimension this app
  // actually has for hall bookings), not a fabricated "fills X% faster"
  // velocity metric — there's no data on how long a slot takes to fill, so
  // that framing isn't honest to build. This compares real booking volume
  // by day-of-week instead.
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byDay = new Map<number, number>();
  for (const row of utilisation) byDay.set(row.dayOfWeek, (byDay.get(row.dayOfWeek) ?? 0) + row.n);
  let narrative: string | null = null;
  if (byDay.size > 1) {
    const totalBookingsSeen = [...byDay.values()].reduce((a, b) => a + b, 0);
    const [busiestDay, busiestCount] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const avgOtherDays = (totalBookingsSeen - busiestCount) / (byDay.size - 1);
    if (avgOtherDays > 0 && busiestCount > avgOtherDays) {
      const pct = Math.round(((busiestCount - avgOtherDays) / avgOtherDays) * 100);
      if (pct >= 10) narrative = `${DAY_NAMES[busiestDay - 1]} is your busiest day — ${pct}% more bookings than your other days average.`;
    }
  }

  // Booking-count delta vs. the prior calendar month, across bookings +
  // registrations combined — a simple real number, not a chart, per the
  // same "avoid decorative charts" instruction.
  const trendRow = (await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid' AND b.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) +
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid' AND r.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')) as thisMonth,
        (SELECT COUNT(*) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid' AND b.created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH) AND b.created_at < DATE_FORMAT(NOW(), '%Y-%m-01')) +
        (SELECT COUNT(*) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid' AND r.created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH) AND r.created_at < DATE_FORMAT(NOW(), '%Y-%m-01')) as lastMonth`
    )
    .get(...ids, ...ids, ...ids, ...ids)) as { thisMonth: number; lastMonth: number };
  const trend = {
    thisMonth: trendRow.thisMonth,
    lastMonth: trendRow.lastMonth,
    deltaPercent: trendRow.lastMonth > 0 ? Math.round(((trendRow.thisMonth - trendRow.lastMonth) / trendRow.lastMonth) * 100) : null,
  };

  res.json({ totals, utilisation, narrative, trend });
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
//
// Vendor Experience Polish — `totalPaidCents` used to be reduce()'d over
// the same 100-row-per-source `transactions` list this route returns for
// display, so once a vendor passed 100 paid bookings (or 100 paid
// registrations), older paid rows fell out of the LIMIT and silently
// stopped counting toward the total — a real undercount, not just a
// display truncation. It's now a separate true SUM(total_cents) aggregate
// with no row cap, computed independently of how many transactions are
// shown. Also extended to all four Vendor-ownable listing types (Centre
// bookings, Club registrations, Program enrollments, Experience bookings —
// see CLAUDE.md's "five separate participant tables" note and the Vendor
// Experience Audit's finding that Vendor already owns all four types) —
// the previous version only ever summed bookings+registrations, so a
// vendor with paid Program/Experience revenue was undercounted regardless
// of row count.

vendorInsightsRouter.get("/payments", requirePlatformRole("finance"), async (req, res) => {
  const ids = req.vendorIds!;
  const in1 = inClause(ids);
  const [bookings, registrations, programEnrollments, experienceBookings, totalRow] = await Promise.all([
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
    db
      .prepare(
        `SELECT pe.ref, 'program' as kind, p.title as listingName, pe.total_cents as totalCents, pe.created_at as createdAt, pe.payment_status as paymentStatus
         FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${in1}) ORDER BY pe.created_at DESC LIMIT 100`
      )
      .all(...ids),
    db
      .prepare(
        `SELECT eb.ref, 'experience' as kind, e.title as listingName, eb.total_cents as totalCents, eb.created_at as createdAt, eb.payment_status as paymentStatus
         FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id IN (${in1}) ORDER BY eb.created_at DESC LIMIT 100`
      )
      .all(...ids),
    db
      .prepare(
        `SELECT
          COALESCE((SELECT SUM(b.total_cents) FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${in1}) AND b.payment_status = 'paid'), 0) +
          COALESCE((SELECT SUM(r.total_cents) FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${in1}) AND r.payment_status = 'paid'), 0) +
          COALESCE((SELECT SUM(pe.total_cents) FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${in1}) AND pe.payment_status = 'paid'), 0) +
          COALESCE((SELECT SUM(eb.total_cents) FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id IN (${in1}) AND eb.payment_status = 'paid'), 0)
          as totalPaidCents`
      )
      .get(...ids, ...ids, ...ids, ...ids),
  ]);
  const all = [...bookings, ...registrations, ...programEnrollments, ...experienceBookings].sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  // total_cents is INT, but mysql2 still returns a multi-term SUM(...)+SUM(...)
  // expression as a string when decimalNumbers isn't enabled on the pool (see
  // CLAUDE.md's DECIMAL-as-string note) — coerce explicitly rather than assume.
  const totalPaidCents = Number((totalRow as { totalPaidCents: number | string }).totalPaidCents ?? 0);
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
