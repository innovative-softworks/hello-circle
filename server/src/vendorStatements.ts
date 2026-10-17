import { db } from "./db/index.js";
import { irelandWallTimeToUtc } from "./irelandTime.js";
import { inClause } from "./routes/vendorHelpers.js";

// OG-25 — a monthly statement for a partner organisation: the orders taken
// and the refunds made in one Ireland calendar month, at the amounts recorded
// on each order, the fees and partner share recorded on each payment (where a
// pricing snapshot exists — older orders have none, shown blank, never
// estimated), and the bank payouts Stripe reported to the organisation that
// month. Read-only and deliberately not a VAT invoice (D-04 is open). It only
// adds up plain sums; it never nets one figure against another.

export interface StatementLine {
  type: "booking" | "registration" | "program" | "experience";
  ref: string;
  listingName: string;
  customerName: string;
  createdAt: string;
  totalCents: number;
  paymentStatus: string;
  status: string;
  /** Recorded on the payment's pricing snapshot; null when none was recorded. */
  customerFeeCents: number | null;
  platformFeeCents: number | null;
  partnerShareCents: number | null;
}
export interface StatementPayout {
  id: string;
  amountCents: number;
  status: string;
  arrivalDate: string | null;
  createdAt: string;
}
export interface StatementRefund {
  type: string;
  ref: string;
  amountCents: number;
  createdAt: string;
}

export function monthBounds(month: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: irelandWallTimeToUtc(`${month}-01`, 0, 0), to: irelandWallTimeToUtc(`${next}-01`, 0, 0) };
}

export async function vendorStatement(vendorIds: string[], month: string, orgId: string | null = null) {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error("bad month");
  if (!vendorIds.length) return { month, lines: [] as StatementLine[], refunds: [] as StatementRefund[], payouts: [] as StatementPayout[], totals: { orders: 0, orderTotalCents: 0, refunds: 0, refundedCents: 0, recordedFeeCents: 0, recordedPartnerShareCents: 0, payouts: 0, paidOutCents: 0 } };
  const ids = inClause(vendorIds);
  const range = [bounds.from, bounds.to];
  const lines = (await db
    .prepare(
      `SELECT * FROM (
         SELECT 'booking' as type, b.ref, c.name as listingName, b.name as customerName, b.created_at as createdAt, b.total_cents as totalCents, b.payment_status as paymentStatus, b.status
         FROM bookings b JOIN centres c ON c.id = b.centre_id
         WHERE c.vendor_id IN (${ids}) AND b.payment_status IN ('paid', 'refunded') AND b.created_at >= ? AND b.created_at < ?
         UNION ALL
         SELECT 'registration', r.ref, cl.name, CONCAT(r.child_first, ' ', r.child_last), r.created_at, r.total_cents, r.payment_status, r.status
         FROM registrations r JOIN clubs cl ON cl.id = r.club_id
         WHERE cl.vendor_id IN (${ids}) AND r.payment_status IN ('paid', 'refunded') AND r.created_at >= ? AND r.created_at < ?
         UNION ALL
         SELECT 'program', pe.ref, p.title, pe.participant_name, pe.created_at, pe.total_cents, pe.payment_status, pe.status
         FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id
         WHERE p.vendor_id IN (${ids}) AND pe.payment_status IN ('paid', 'refunded') AND pe.created_at >= ? AND pe.created_at < ?
         UNION ALL
         SELECT 'experience', eb.ref, e.title, eb.participant_name, eb.created_at, eb.total_cents, eb.payment_status, eb.status
         FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id
         WHERE e.vendor_id IN (${ids}) AND eb.payment_status IN ('paid', 'refunded') AND eb.created_at >= ? AND eb.created_at < ?
       ) o ORDER BY createdAt, ref`
    )
    .all(...vendorIds, ...range, ...vendorIds, ...range, ...vendorIds, ...range, ...vendorIds, ...range)) as (Omit<StatementLine, "totalCents"> & { totalCents: number | string | null })[];
  const refunds = (await db
    .prepare(
      `SELECT rf.source_type as type, rf.source_ref as ref, rf.amount_minor as amountCents, rf.created_at as createdAt FROM refunds rf
       WHERE rf.status IN ('succeeded', 'reconciled') AND rf.created_at >= ? AND rf.created_at < ? AND (
         (rf.source_type = 'booking' AND rf.source_ref IN (SELECT b.ref FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${ids}))) OR
         (rf.source_type = 'registration' AND rf.source_ref IN (SELECT r.ref FROM registrations r JOIN clubs cl ON cl.id = r.club_id WHERE cl.vendor_id IN (${ids}))) OR
         (rf.source_type = 'program' AND rf.source_ref IN (SELECT pe.ref FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${ids}))) OR
         (rf.source_type = 'experience' AND rf.source_ref IN (SELECT eb.ref FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id IN (${ids})))
       ) ORDER BY rf.created_at`
    )
    .all(...range, ...vendorIds, ...vendorIds, ...vendorIds, ...vendorIds)) as (Omit<StatementRefund, "amountCents"> & { amountCents: number | string })[];
  // Fees and partner share exactly as recorded on each order's pricing snapshot.
  const fees = lines.length
    ? ((await db
        .prepare(
          `SELECT o.source_type as type, o.source_ref as ref, ps.customer_fee_minor as customerFee, ps.success_fee_minor as successFee, ps.partner_payout_minor as partnerShare
           FROM commerce_orders o JOIN pricing_snapshots ps ON ps.order_id = o.id
           WHERE (o.source_type, o.source_ref) IN (${lines.map(() => "(?, ?)").join(", ")})`
        )
        .all(...lines.flatMap((l) => [l.type, l.ref]))) as { type: string; ref: string; customerFee: number | string; successFee: number | string; partnerShare: number | string }[])
    : [];
  const feeOf = (type: string, ref: string) => fees.find((f) => f.type === type && f.ref === ref);
  const outLines: StatementLine[] = lines.map((l) => {
    const f = feeOf(l.type, l.ref);
    return {
      ...l,
      totalCents: Number(l.totalCents ?? 0),
      customerFeeCents: f ? Number(f.customerFee) : null,
      platformFeeCents: f ? Number(f.successFee) : null,
      partnerShareCents: f ? Number(f.partnerShare) : null,
    };
  });
  const outRefunds: StatementRefund[] = refunds.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
  // Bank payouts Stripe reported for this organisation's connected account(s), created this month.
  const payouts = (await db
    .prepare(
      `SELECT p.provider_payout_id as id, p.amount_minor as amountCents, p.status, p.arrival_date as arrivalDate, p.created_at as createdAt
       FROM connected_payouts p JOIN connected_accounts a ON a.account_id = p.account_id
       WHERE p.created_at >= ? AND p.created_at < ? AND ((a.party_type = 'org' AND a.party_id = ?) OR (a.party_type = 'vendor' AND a.party_id IN (${ids})))
       ORDER BY p.created_at`
    )
    .all(...range, orgId ?? "", ...vendorIds)) as (Omit<StatementPayout, "amountCents"> & { amountCents: number | string })[];
  const outPayouts: StatementPayout[] = payouts.map((p) => ({ ...p, amountCents: Number(p.amountCents) }));
  const paid = outPayouts.filter((p) => p.status === "paid");
  return {
    month,
    lines: outLines,
    refunds: outRefunds,
    payouts: outPayouts,
    totals: {
      orders: outLines.length,
      orderTotalCents: outLines.reduce((s, l) => s + l.totalCents, 0),
      refunds: outRefunds.length,
      refundedCents: outRefunds.reduce((s, r) => s + r.amountCents, 0),
      recordedFeeCents: outLines.reduce((s, l) => s + (l.customerFeeCents ?? 0) + (l.platformFeeCents ?? 0), 0),
      recordedPartnerShareCents: outLines.reduce((s, l) => s + (l.partnerShareCents ?? 0), 0),
      payouts: paid.length,
      paidOutCents: paid.reduce((s, p) => s + p.amountCents, 0),
    },
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Quote everything; neutralise spreadsheet formulas in free text.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const euros = (cents: number) => (cents / 100).toFixed(2);
const opt = (cents: number | null) => (cents === null ? "" : euros(cents));

export function statementCsv(s: Awaited<ReturnType<typeof vendorStatement>>, organisation: string): string {
  const rows: unknown[][] = [
    [`Statement of recorded orders — ${organisation} — ${s.month}`],
    ["Not a VAT invoice. Amounts are as recorded; fees and partner share appear only where they were recorded on the payment (blank = not recorded)."],
    [],
    ["Orders taken this month"],
    ["Date (UTC)", "Type", "Reference", "Listing", "Customer", "Payment", "Status", "Order total (EUR)", "Customer fee recorded (EUR)", "Platform fee recorded (EUR)", "Partner share recorded (EUR)"],
    ...s.lines.map((l) => [l.createdAt, l.type, l.ref, l.listingName, l.customerName, l.paymentStatus, l.status, euros(l.totalCents), opt(l.customerFeeCents), opt(l.platformFeeCents), opt(l.partnerShareCents)]),
    ["", "", "", "", "", "", "Total", euros(s.totals.orderTotalCents), "", "", euros(s.totals.recordedPartnerShareCents)],
    [],
    ["Refunds made this month"],
    ["Date (UTC)", "Type", "Reference", "", "", "", "", "Refunded (EUR)"],
    ...s.refunds.map((r) => [r.createdAt, r.type, r.ref, "", "", "", "", euros(r.amountCents)]),
    ["", "", "", "", "", "", "Total", euros(s.totals.refundedCents)],
    [],
    ["Bank payouts this month (as reported by Stripe)"],
    ["Date (UTC)", "Payout reference", "Status", "Arrival date", "", "", "", "Amount (EUR)"],
    ...s.payouts.map((p) => [p.createdAt, p.id, p.status, p.arrivalDate, "", "", "", euros(p.amountCents)]),
    ["", "", "", "", "", "", "Paid out", euros(s.totals.paidOutCents)],
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
