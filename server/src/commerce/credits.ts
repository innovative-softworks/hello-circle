import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { resolveRule } from "./rules.js";
import { commerceSwitch } from "./switches.js";

// Revenue & Connect Stage 5b — customer credits. HelloCircle-funded,
// no cash value (brief: credits.cashOut = not_supported), granted by finance
// and spent at checkout on engine-priced bookings, where they act as a
// HelloCircle-funded discount (the partner's payout is unchanged; the ledger
// books it to coupon_expense through the order snapshot). Uses follow the
// coupon redemption lifecycle: reserved at checkout → confirmed when paid →
// released (credit restored) if the checkout fails, or reversed (credit
// restored) if the booking is refunded.

type Tx = Pick<typeof db, "prepare">;

export class CreditError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export const creditsEnabled = () => commerceSwitch("commerce.customer_credits");

export async function creditBalance(residentId: string, at: Date = new Date(), tx: Tx = db): Promise<number> {
  const row = (await tx.prepare(`SELECT COALESCE(SUM(remaining_minor), 0) as s FROM credit_lots WHERE resident_id = ? AND expires_at > ?`).get(residentId, at)) as { s: number | string };
  return Number(row.s);
}

export async function grantCredit(input: { residentId: string; amountMinor: number; kind: "goodwill" | "promotional" | "refund"; reason: string; actorId: string }) {
  if (!(await creditsEnabled())) throw new CreditError("Customer credits aren't switched on", 409);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 50_000) throw new CreditError("Amount must be between €0.01 and €500");
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new CreditError("A reason (at least 5 characters) is required");
  const resident = await db.prepare(`SELECT id FROM residents WHERE id = ?`).get(input.residentId);
  if (!resident) throw new CreditError("Resident not found", 404);
  const rule = await resolveRule("credits");
  const months = Number(input.kind === "refund" ? rule.values.refundCreditExpiryMonths : rule.values.defaultExpiryMonths);
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + months);
  const r = await db
    .prepare(`INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.residentId, input.kind, input.amountMinor, input.amountMinor, input.reason.trim().slice(0, 2000), expires, input.actorId);
  await writeAudit({ actorUserId: input.actorId, action: "credits.granted", objectType: "resident", objectId: input.residentId, newValue: { amountMinor: input.amountMinor, kind: input.kind, expires }, reason: input.reason.trim() });
  return { id: Number(r.lastInsertRowid), expiresAt: expires.toISOString() };
}

/** How much credit this checkout may use (0 when off or not signed in). */
export async function creditForCheckout(residentId: string | null | undefined, wanted: boolean, maxMinor: number): Promise<number> {
  if (!wanted || !residentId || maxMinor <= 0 || !(await creditsEnabled())) return 0;
  return Math.min(await creditBalance(residentId), maxMinor);
}

/** Reserves `amountMinor` of the resident's credit for an order (oldest-expiring first). */
export async function reserveCredit(tx: Tx, input: { residentId: string; sourceType: string; ref: string; amountMinor: number; confirmed: boolean }) {
  if (input.amountMinor <= 0) return;
  const lots = (await tx
    .prepare(`SELECT id, remaining_minor as r FROM credit_lots WHERE resident_id = ? AND expires_at > ? AND remaining_minor > 0 ORDER BY expires_at, id FOR UPDATE`)
    .all(input.residentId, new Date())) as { id: number; r: number | string }[];
  let need = input.amountMinor;
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(Number(l.r), need);
    await tx.prepare(`UPDATE credit_lots SET remaining_minor = remaining_minor - ? WHERE id = ?`).run(take, l.id);
    await tx
      .prepare(`INSERT INTO credit_uses (lot_id, resident_id, source_type, source_ref, amount_minor, status) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(l.id, input.residentId, input.sourceType, input.ref, take, input.confirmed ? "confirmed" : "reserved");
    need -= take;
  }
  if (need > 0) throw new CreditError("Your credit balance changed — please review the price and try again", 409);
}

/** Moves an order's credit uses forward; released/reversed uses give the credit back. Replays are no-ops. */
export async function syncCreditUses(tx: Tx, sourceType: string, ref: string, to: "confirmed" | "released" | "reversed", from: string[]) {
  const uses = (await tx
    .prepare(`SELECT id, lot_id as lot, amount_minor as a FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN (${from.map(() => "?").join(", ")}) FOR UPDATE`)
    .all(sourceType, ref, ...from)) as { id: number; lot: number; a: number | string }[];
  for (const u of uses) {
    const moved = await tx.prepare(`UPDATE credit_uses SET status = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`).run(to, u.id, ...from);
    if (moved.changes > 0 && to !== "confirmed") await tx.prepare(`UPDATE credit_lots SET remaining_minor = remaining_minor + ? WHERE id = ?`).run(Number(u.a), u.lot);
  }
}

export async function creditsUsedFor(sourceType: string, ref: string): Promise<number> {
  const row = (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN ('reserved', 'confirmed')`).get(sourceType, ref)) as { s: number | string };
  return Number(row.s);
}

export async function residentCredits(residentId: string) {
  const lots = await db
    .prepare(`SELECT id, kind, amount_minor as amountMinor, remaining_minor as remainingMinor, expires_at as expiresAt, created_at as createdAt FROM credit_lots WHERE resident_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(residentId);
  return { enabled: await creditsEnabled(), balanceMinor: await creditBalance(residentId), lots };
}
