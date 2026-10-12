// Commercial UX R3A — a resident's receipts: the list (every kind of paid
// participation they own) and one receipt's detail.
//
// Rules (plan §5, R3A brief):
// - Ownership is `resident_id = the signed-in resident` on the source row. A
//   ref that exists but belongs to someone else is a 404, never a 403, so the
//   endpoint can't be used to discover other people's refs.
// - The price shown is what was recorded at purchase, never re-priced with
//   today's rules: the commerce order's frozen pricing snapshot first, else the
//   row's own stored columns, else the stored total alone (no breakdown).
// - Refunds come from the `refunds` records (money back to the card) and the
//   `credit_uses` reversals (HelloCircle credit given back); both as recorded.
// - Not a VAT invoice: nothing here is labelled as one (the VAT model is
//   undecided — booking audit P0).

import { db } from "./db/index.js";

export type ReceiptKind = "booking" | "registration" | "game" | "pass" | "program_enrollment" | "experience";
export type ReceiptStatus = "paid" | "free" | "pay_at_venue" | "pending" | "failed" | "refunded" | "part_refunded";

/** Receipt kind → commerce source type (checkoutService `type`). */
const SOURCE_OF: Record<ReceiptKind, string> = {
  booking: "booking",
  registration: "registration",
  game: "game",
  pass: "pass",
  program_enrollment: "program",
  experience: "experience",
};

interface SourceRow {
  ref: string;
  label: string;
  totalCents: number | string | null;
  createdAt: string;
  paymentStatus: string;
  /** Stored columns (bookings, registrations, experiences); null elsewhere. */
  taxableCents?: number | string | null;
  discountCents?: number | string | null;
  vatCents?: number | string | null;
  feeCents?: number | string | null;
  couponCode?: string | null;
  quantity?: number | string | null;
  stripeSessionId?: string | null;
}

/** One query per kind, all scoped to the resident. `ref` narrows to one row. */
function sourceQuery(kind: ReceiptKind, oneRef: boolean): string {
  const refFilter = oneRef ? " AND x.ref = ?" : "";
  switch (kind) {
    case "booking":
      return `SELECT x.ref, CONCAT(c.name, COALESCE(CONCAT(' · ', rm.name), '')) as label, x.total_cents as totalCents, x.created_at as createdAt, x.payment_status as paymentStatus,
                     x.subtotal_cents as taxableCents, x.discount_cents as discountCents, x.vat_cents as vatCents, x.platform_fee_cents as feeCents, x.coupon_code as couponCode,
                     NULL as quantity, x.stripe_session_id as stripeSessionId, x.date as date, x.time as time, x.centre_id as centreId
              FROM bookings x JOIN centres c ON c.id = x.centre_id LEFT JOIN rooms rm ON rm.id = x.room_id
              WHERE x.resident_id = ?${refFilter} ORDER BY x.created_at DESC`;
    case "registration":
      return `SELECT x.ref, c.name as label, x.total_cents as totalCents, x.created_at as createdAt, x.payment_status as paymentStatus,
                     x.subtotal_cents as taxableCents, x.discount_cents as discountCents, x.vat_cents as vatCents, x.platform_fee_cents as feeCents, x.coupon_code as couponCode,
                     NULL as quantity, x.stripe_session_id as stripeSessionId, NULL as date, NULL as time, NULL as centreId
              FROM registrations x JOIN clubs c ON c.id = x.club_id WHERE x.resident_id = ?${refFilter} ORDER BY x.created_at DESC`;
    case "game":
      // R3A (G2) — the amount this participant was charged (stored since the
      // per-join total existed); the list price only for older rows without one.
      return `SELECT x.ref, g.activity_label as label, COALESCE(x.total_cents, g.price_cents, 0) as totalCents, x.joined_at as createdAt, x.payment_status as paymentStatus,
                     NULL as taxableCents, NULL as discountCents, NULL as vatCents, NULL as feeCents, x.coupon_code as couponCode,
                     NULL as quantity, x.stripe_session_id as stripeSessionId, NULL as date, NULL as time, NULL as centreId
              FROM game_participants x JOIN games g ON g.id = x.game_id WHERE x.resident_id = ? AND x.ref IS NOT NULL${refFilter} ORDER BY x.joined_at DESC`;
    case "pass":
      return `SELECT x.ref, c.name as label, x.purchased_cents as totalCents, x.created_at as createdAt, x.payment_status as paymentStatus,
                     NULL as taxableCents, NULL as discountCents, NULL as vatCents, NULL as feeCents, NULL as couponCode,
                     x.credits_total as quantity, x.stripe_session_id as stripeSessionId, NULL as date, NULL as time, NULL as centreId
              FROM passes x LEFT JOIN clubs c ON c.id = x.listing_id WHERE x.resident_id = ?${refFilter} ORDER BY x.created_at DESC`;
    case "program_enrollment":
      return `SELECT x.ref, pr.title as label, x.total_cents as totalCents, x.created_at as createdAt, x.payment_status as paymentStatus,
                     NULL as taxableCents, NULL as discountCents, NULL as vatCents, NULL as feeCents, x.coupon_code as couponCode,
                     NULL as quantity, x.stripe_session_id as stripeSessionId, NULL as date, NULL as time, NULL as centreId
              FROM program_enrollments x JOIN programs pr ON pr.id = x.program_id WHERE x.resident_id = ?${refFilter} ORDER BY x.created_at DESC`;
    case "experience":
      // R3A (G1) — experience bookings were missing from receipts.
      return `SELECT x.ref, e.title as label, x.total_cents as totalCents, x.created_at as createdAt, x.payment_status as paymentStatus,
                     x.subtotal_cents as taxableCents, x.discount_cents as discountCents, x.vat_cents as vatCents, x.platform_fee_cents as feeCents, x.coupon_code as couponCode,
                     x.party_size as quantity, x.stripe_session_id as stripeSessionId, NULL as date, NULL as time, NULL as centreId
              FROM experience_bookings x JOIN experiences e ON e.id = x.experience_id WHERE x.resident_id = ?${refFilter} ORDER BY x.created_at DESC`;
  }
}

const KINDS: ReceiptKind[] = ["booking", "registration", "game", "pass", "program_enrollment", "experience"];

/** The receipts list (same row shape as before, plus experiences). */
export async function listReceipts(residentId: string) {
  const groups = await Promise.all(
    KINDS.map(async (kind) => {
      const rows = (await db.prepare(sourceQuery(kind, false)).all(residentId)) as (SourceRow & { date: string | null; time: string | null; centreId: string | null })[];
      return rows.map((r) => ({
        ref: r.ref,
        kind,
        label: r.label,
        totalCents: Number(r.totalCents ?? 0),
        createdAt: r.createdAt,
        paymentStatus: r.paymentStatus,
        date: r.date,
        time: r.time,
        centreId: r.centreId,
      }));
    })
  );
  return groups.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export interface ReceiptBreakdown {
  /** Before any discount. */
  subtotalCents: number;
  /** Everything taken off before tax: coupon + HelloCircle credit (the engine's order). */
  discountCents: number;
  couponDiscountCents: number;
  couponCode: string | null;
  creditCents: number;
  vatCents: number;
  vatIncluded: boolean;
  vatLabel: string;
  platformFeeCents: number;
  depositCents: number;
  /** What was charged (card, or due at the venue). */
  totalCents: number;
}

export interface ReceiptRefundLine {
  id: string;
  at: string;
  cardCents: number;
  creditCents: number;
  status: "processing" | "done";
  reason: string | null;
}

export interface ReceiptDetail {
  ref: string;
  kind: ReceiptKind;
  label: string;
  createdAt: string;
  status: ReceiptStatus;
  /** Where the breakdown came from; null breakdown = only the total was recorded. */
  breakdownSource: "snapshot" | "stored" | "total_only";
  breakdown: ReceiptBreakdown | null;
  totalCents: number;
  subtotalLabel: string;
  refunds: ReceiptRefundLine[];
  refundedCardCents: number;
  restoredCreditCents: number;
  /** Paid (card + credit) less everything given back, from the records above. */
  netPaidCents: number | null;
  paidOnline: boolean;
  /** Never an invoice until the VAT model is confirmed. */
  isTaxInvoice: false;
}

const n = (v: unknown) => Number(v ?? 0);

function subtotalLabelOf(kind: ReceiptKind, quantity: number | null): string {
  switch (kind) {
    case "booking":
      return "Venue hire";
    case "registration":
      return "Registration";
    case "game":
      return "Your place";
    case "pass":
      return quantity ? `${quantity}-session pass` : "Session pass";
    case "program_enrollment":
      return "Programme fee";
    case "experience":
      return quantity ? `${quantity} ${quantity === 1 ? "place" : "places"}` : "Experience";
  }
}

export async function receiptDetail(residentId: string, ref: string): Promise<ReceiptDetail | null> {
  let found: { kind: ReceiptKind; row: SourceRow } | null = null;
  for (const kind of KINDS) {
    const row = (await db.prepare(sourceQuery(kind, true)).get(residentId, ref)) as SourceRow | undefined;
    if (row) {
      found = { kind, row };
      break;
    }
  }
  if (!found) return null;
  const { kind, row } = found;
  const source = SOURCE_OF[kind];
  const total = n(row.totalCents);

  const [snapshot, payment, refunds, creditUses] = await Promise.all([
    db
      .prepare(
        `SELECT s.list_minor as list, s.discount_minor as discount, s.coupon_code as coupon, s.goods_gross_minor as goodsGross, s.vat_minor as vat,
                s.customer_fee_minor as fee, s.deposit_minor as deposit, s.customer_paid_minor as paid, s.rule_values as ruleValues
         FROM commerce_orders o JOIN pricing_snapshots s ON s.order_id = o.id WHERE o.source_type = ? AND o.source_ref = ?`
      )
      .get(source, ref) as Promise<Record<string, unknown> | undefined>,
    db.prepare(`SELECT status FROM payment_records WHERE source_type = ? AND source_ref = ?`).get(source, ref) as Promise<{ status: string } | undefined>,
    db
      .prepare(`SELECT id, amount_minor as amount, status, reason, created_at as at FROM refunds WHERE source_type = ? AND source_ref = ? AND status IN ('pending', 'succeeded', 'reconciled') ORDER BY created_at, id`)
      .all(source, ref) as Promise<{ id: number; amount: number | string; status: string; reason: string | null; at: string }[]>,
    db
      .prepare(`SELECT id, amount_minor as amount, status, COALESCE(status_changed_at, created_at) as at FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN ('confirmed', 'reversed') ORDER BY id`)
      .all(source, ref) as Promise<{ id: number; amount: number | string; status: string; at: string }[]>,
  ]);

  // Credit the order used = what's still applied + what was given back.
  const creditUsed = creditUses.reduce((s, u) => s + n(u.amount), 0);
  const restoredCredit = creditUses.filter((u) => u.status === "reversed").reduce((s, u) => s + n(u.amount), 0);

  let breakdown: ReceiptBreakdown | null = null;
  let breakdownSource: ReceiptDetail["breakdownSource"] = "total_only";
  if (snapshot) {
    const list = n(snapshot.list);
    const discount = n(snapshot.discount);
    const vat = n(snapshot.vat);
    let vatBps: number | null = null;
    try {
      const values = JSON.parse(String(snapshot.ruleValues ?? "{}"));
      vatBps = typeof values.vatBps === "number" ? values.vatBps : null;
    } catch {
      vatBps = null;
    }
    breakdown = {
      subtotalCents: list,
      discountCents: discount,
      couponDiscountCents: Math.max(0, discount - creditUsed),
      couponCode: (snapshot.coupon as string | null) ?? row.couponCode ?? null,
      creditCents: creditUsed,
      vatCents: vat,
      // The frozen goods amount either already contains the VAT or has it added.
      vatIncluded: vat > 0 && n(snapshot.goodsGross) === list - discount,
      vatLabel: vatBps !== null ? `VAT (${vatBps / 100}%)` : "VAT",
      platformFeeCents: n(snapshot.fee),
      depositCents: n(snapshot.deposit),
      totalCents: n(snapshot.paid),
    };
    breakdownSource = "snapshot";
  } else if (row.taxableCents !== null && row.taxableCents !== undefined) {
    const taxable = n(row.taxableCents);
    const discount = n(row.discountCents);
    const vat = n(row.vatCents);
    const fee = n(row.feeCents);
    const deposit = total - taxable - vat - fee;
    // Rows older than the breakdown columns default them to 0: with nothing
    // but a total recorded, don't present the whole total as a "deposit".
    const columnsRecorded = taxable + discount + vat + fee > 0 || total === 0;
    if (deposit >= 0 && columnsRecorded) {
      breakdown = {
        subtotalCents: taxable + discount,
        discountCents: discount,
        couponDiscountCents: discount,
        couponCode: row.couponCode ?? null,
        creditCents: 0,
        vatCents: vat,
        vatIncluded: false,
        vatLabel: "VAT",
        platformFeeCents: fee,
        depositCents: deposit,
        totalCents: total,
      };
      breakdownSource = "stored";
    }
  }

  const refundLines: ReceiptRefundLine[] = [
    ...refunds.map((r) => ({ id: `card-${r.id}`, at: r.at, cardCents: n(r.amount), creditCents: 0, status: r.status === "pending" ? ("processing" as const) : ("done" as const), reason: r.reason || null })),
    ...creditUses.filter((u) => u.status === "reversed").map((u) => ({ id: `credit-${u.id}`, at: u.at, cardCents: 0, creditCents: n(u.amount), status: "done" as const, reason: null })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const refundedCard = refunds.reduce((s, r) => s + n(r.amount), 0);

  const paidOnline = !!payment || !!row.stripeSessionId;
  let status: ReceiptStatus;
  if (row.paymentStatus === "refunded") status = "refunded";
  else if (row.paymentStatus === "paid" && (refundedCard > 0 || restoredCredit > 0)) status = "part_refunded";
  else if (row.paymentStatus === "paid") status = total === 0 && creditUsed === 0 ? "free" : paidOnline || creditUsed > 0 ? "paid" : "pay_at_venue";
  else if (row.paymentStatus === "failed") status = "failed";
  else status = "pending";

  const settled = status === "paid" || status === "part_refunded" || status === "refunded";
  return {
    ref: row.ref,
    kind,
    label: row.label,
    createdAt: row.createdAt,
    status,
    breakdownSource,
    breakdown,
    totalCents: total,
    subtotalLabel: subtotalLabelOf(kind, row.quantity === null || row.quantity === undefined ? null : n(row.quantity)),
    refunds: refundLines,
    refundedCardCents: refundedCard,
    restoredCreditCents: restoredCredit,
    netPaidCents: settled ? total + creditUsed - refundedCard - restoredCredit : null,
    paidOnline,
    isTaxInvoice: false,
  };
}
