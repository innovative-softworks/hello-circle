import { db } from "./db/index.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "./irelandTime.js";
import { ConflictError } from "./util.js";

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
export async function consumeCoupon(tx: Tx, code: string | null | undefined) {
  if (!code) return;
  const info = await tx
    .prepare(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses)`)
    .run(code.trim().toUpperCase());
  if (info.changes !== 1) throw new ConflictError("That code has been fully redeemed");
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
