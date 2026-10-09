import { db } from "./db/index.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "./irelandTime.js";
import { ConflictError } from "./util.js";
import { commerceSwitch } from "./commerce/switches.js";
import { allocate } from "./commerce/money.js";

// Phase 8 booking-integrity remediation (HC-QA-034..046) — the shared rules
// every booking model applies. See QA_BOOKING_MODEL.md "Authoritative booking
// invariants". Kept deliberately small: the five participation tables stay
// separate (CLAUDE.md); only the predicates/validators are shared.

/** A pending paid checkout holds capacity for this long. Matches the Stripe
 * Checkout session lifetime set in checkoutService.ts (Stripe's minimum), so
 * a hold never outlives the payment page that could still complete it.
 * Expiry is read-time: no job is needed for capacity to come back. */
export const PENDING_HOLD_MINUTES = 30;

/** SQL predicate: this row currently consumes capacity (paid, or a live
 * pending hold), for tables with payment_status + created_at + status. */
export function occupiesCapacitySql(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}status != 'cancelled' AND (${a}payment_status = 'paid' OR (${a}payment_status = 'pending' AND ${a}created_at > NOW() - INTERVAL ${PENDING_HOLD_MINUTES} MINUTE)))`;
}

/** Activities: joined, or a live pending_payment hold (joined_at is the hold start). */
export function gameSeatSql(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}status = 'joined' OR (${a}status = 'pending_payment' AND ${a}joined_at > NOW() - INTERVAL ${PENDING_HOLD_MINUTES} MINUTE))`;
}

/** True while a row created at `createdAt` is still a live hold. */
export function holdIsLive(createdAt: string | Date): boolean {
  return Date.now() - new Date(createdAt).getTime() < PENDING_HOLD_MINUTES * 60 * 1000;
}

type Tx = Pick<typeof db, "prepare">;

/** HC-QA-037 — consume one use of a coupon inside the caller's transaction,
 * exactly once, regardless of payment path. Throws ConflictError when the
 * coupon is exhausted (a concurrent order took the last use). */
export async function consumeCoupon(tx: Tx, code: string | null | undefined, redemption?: RedemptionContext) {
  if (!code) return;
  const normalized = code.trim().toUpperCase();
  const info = await tx
    .prepare(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND active = 1 AND archived_at IS NULL AND (max_uses IS NULL OR used_count < max_uses)`)
    .run(normalized);
  if (info.changes !== 1) throw new ConflictError("That code has been fully redeemed");
  if (redemption && (await commerceSwitch("commerce.coupons_v2"))) await recordRedemption(tx, normalized, redemption);
}

/** Commerce Engine Phase 3 — who/what a coupon use belongs to. Funding and
 * limits are read from the coupon row itself (already locked by the
 * used_count UPDATE above), never trusted from the caller. */
export interface RedemptionContext {
  sourceType: string;
  ref: string;
  /** "r:<residentId>" when signed in, else "c:<clientId>". */
  customerKey: string;
  discountMinor: number;
  /** true when the order is already paid/free/cash (no pending hold). */
  confirmed: boolean;
}

export function customerKeyOf(residentId: string | null | undefined, clientId: string | null | undefined): string {
  return residentId ? `r:${residentId}` : `c:${clientId ?? "unknown"}`;
}

async function recordRedemption(tx: Tx, code: string, r: RedemptionContext) {
  const coupon = (await tx
    .prepare(`SELECT id, funding, platform_share_bps as share, per_customer_limit as perCustomer, created_by_vendor_id as v, created_by_resident_id as h FROM coupons WHERE code = ?`)
    .get(code)) as { id: number; funding: string; share: number; perCustomer: number | null; v: string | null; h: string | null };
  if (coupon.perCustomer !== null && coupon.perCustomer !== undefined) {
    // Serialised by the coupon row lock taken by the used_count UPDATE.
    const { n } = (await tx
      .prepare(`SELECT COUNT(*) as n FROM coupon_redemptions WHERE coupon_id = ? AND customer_key = ? AND status IN ('reserved', 'confirmed')`)
      .get(coupon.id, r.customerKey)) as { n: number };
    if (Number(n) >= coupon.perCustomer) throw new ConflictError(coupon.perCustomer === 1 ? "You've already used this code" : `This code can be used ${coupon.perCustomer} times per customer`);
  }
  const partnerOwned = !!(coupon.v || coupon.h);
  const shareBps = partnerOwned || coupon.funding === "partner" ? 0 : coupon.funding === "platform" ? 10_000 : Math.max(0, Math.min(10_000, Number(coupon.share)));
  const discount = Math.max(0, Math.round(r.discountMinor));
  const platformFunded = shareBps === 0 || discount === 0 ? 0 : allocate(discount, [shareBps, 10_000 - shareBps])[0];
  await tx
    .prepare(
      `INSERT INTO coupon_redemptions (coupon_id, code, source_type, source_ref, customer_key, discount_minor, platform_funded_minor, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(coupon.id, code, r.sourceType, r.ref, r.customerKey, discount, platformFunded, r.confirmed ? "confirmed" : "reserved");
}

const REDEMPTION_SOURCE: Record<string, string> = {
  bookings: "booking",
  registrations: "registration",
  program_enrollments: "program",
  experience_bookings: "experience",
  game_participants: "game",
};

/** Marks a still-reserved redemption released (its pending hold ended). */
export async function releaseRedemption(tx: Tx, table: string, ref: string) {
  const sourceType = REDEMPTION_SOURCE[table];
  if (!sourceType) return;
  await tx.prepare(`UPDATE coupon_redemptions SET status = 'released' WHERE source_type = ? AND source_ref = ? AND status = 'reserved'`).run(sourceType, ref);
}

/** HC-QA-050 — hand back one reserved coupon use (never below zero). */
export async function releaseCoupon(tx: Tx, code: string | null | undefined) {
  if (!code) return;
  await tx.prepare(`UPDATE coupons SET used_count = used_count - 1 WHERE code = ? AND used_count > 0`).run(code.trim().toUpperCase());
}

type PendingTable = "bookings" | "registrations" | "program_enrollments" | "experience_bookings" | "game_participants";

/** HC-QA-050 — end a still-pending paid hold exactly once and release its
 * reserved coupon use with it. `delete` removes the row (provider session
 * never created, or the model's existing failure convention); otherwise the
 * row is kept as payment_status='failed'. A row that is no longer pending
 * (confirmed, already failed, replayed event) is left untouched. */
export async function endPendingHold(table: PendingTable, ref: string, mode: "delete" | "fail"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = (await tx.prepare(`SELECT coupon_code, payment_status FROM ${table} WHERE ref = ? FOR UPDATE`).get(ref)) as { coupon_code: string | null; payment_status: string } | undefined;
    if (!row || row.payment_status !== "pending") return false;
    const info = mode === "delete"
      ? await tx.prepare(`DELETE FROM ${table} WHERE ref = ? AND payment_status = 'pending'`).run(ref)
      : await tx.prepare(`UPDATE ${table} SET payment_status = 'failed' WHERE ref = ? AND payment_status = 'pending'`).run(ref);
    if (info.changes !== 1) return false;
    await releaseCoupon(tx, row.coupon_code);
    await releaseRedemption(tx, table, ref);
    return true;
  });
}

/** A positive whole number (rejects strings, fractions, NaN, ≤ 0). */
export function isPositiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** A real calendar date (YYYY-MM-DD) that is today or later in Ireland. */
export function validateFutureDate(date: unknown): string | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "That doesn't look like a valid date";
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return "That doesn't look like a valid date";
  if (date < irelandTodayIso()) return "That date has already passed";
  return null;
}

/** The Ireland wall-clock start (date + HH:MM) has not passed yet. */
export function startIsInFuture(date: string, time: string): boolean {
  const [h, m] = time.split(":").map(Number);
  const start = irelandWallTimeToUtc(date, h, m || 0);
  return !Number.isNaN(start.getTime()) && start.getTime() > Date.now();
}

/** Commerce audit R14 — suspending a vendor only changes users.status; their
 * approved listings stay visible. Every paid/free checkout refuses to take a
 * new order for a listing whose owning vendor is suspended. */
export async function vendorSuspended(vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId) return false;
  const row = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(vendorId)) as { status: string } | undefined;
  return row?.status === "suspended";
}

export const VENDOR_SUSPENDED_ERROR = "This listing isn't taking bookings right now";
