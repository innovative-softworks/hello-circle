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

export type CreditKind = "goodwill" | "promotional" | "refund";
export type FundingOwner = "helloCircle" | "partner";

/**
 * Stage 5f — grants credit to a resident. Idempotent by key (a repeated
 * submission returns the first grant). Currency comes from the availability
 * rule; the largest grant and default expiry from the credits rule.
 */
export async function grantCredit(input: {
  residentId: string;
  amountMinor: number;
  kind: CreditKind;
  reason: string;
  actorId: string;
  fundingOwner?: FundingOwner;
  expiresAt?: string | null;
  idempotencyKey?: string | null;
}) {
  if (!(await creditsEnabled())) throw new CreditError("Customer credits aren't switched on", 409);
  const rule = await resolveRule("credits");
  const cap = Number(rule.values.maxGrantMinor);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > cap) throw new CreditError(`Amount must be between €0.01 and €${(cap / 100).toFixed(2)}`);
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new CreditError("A reason (at least 5 characters) is required");
  if (!["goodwill", "promotional", "refund"].includes(input.kind)) throw new CreditError("Credit type must be goodwill, promotional or refund");
  const funding: FundingOwner = input.fundingOwner === "partner" ? "partner" : "helloCircle";
  const key = input.idempotencyKey ?? null;
  if (key !== null && !/^[\w:-]{8,120}$/.test(key)) throw new CreditError("Invalid request key");
  if (key) {
    const prior = (await db.prepare(`SELECT id, expires_at as e FROM credit_lots WHERE idempotency_key = ?`).get(key)) as { id: number; e: Date | string } | undefined;
    if (prior) return { id: prior.id, expiresAt: new Date(prior.e).toISOString(), duplicate: true };
  }
  const resident = await db.prepare(`SELECT id FROM residents WHERE id = ?`).get(input.residentId);
  if (!resident) throw new CreditError("Resident not found", 404);
  const currency = String((await resolveRule("availability")).values.currency);
  let expires: Date;
  if (input.expiresAt) {
    expires = new Date(input.expiresAt);
    if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now() + 864e5) throw new CreditError("Expiry must be a date at least one day from now");
  } else {
    const months = Number(input.kind === "refund" ? rule.values.refundCreditExpiryMonths : rule.values.defaultExpiryMonths);
    expires = new Date();
    expires.setUTCMonth(expires.getUTCMonth() + months);
  }
  let id: number;
  try {
    const r = await db
      .prepare(`INSERT INTO credit_lots (resident_id, kind, amount_minor, remaining_minor, reason, expires_at, created_by, currency, funding_owner, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.residentId, input.kind, input.amountMinor, input.amountMinor, input.reason.trim().slice(0, 2000), expires, input.actorId, currency, funding, key);
    id = Number(r.lastInsertRowid);
  } catch (e) {
    // A concurrent duplicate submission lost the race on the unique key.
    if ((e as { code?: string }).code === "ER_DUP_ENTRY" && key) {
      const prior = (await db.prepare(`SELECT id, expires_at as e FROM credit_lots WHERE idempotency_key = ?`).get(key)) as { id: number; e: Date | string };
      return { id: prior.id, expiresAt: new Date(prior.e).toISOString(), duplicate: true };
    }
    throw e;
  }
  await writeAudit({ actorUserId: input.actorId, action: "credits.granted", objectType: "resident", objectId: input.residentId, newValue: { amountMinor: input.amountMinor, kind: input.kind, currency, fundingOwner: funding, expires }, reason: input.reason.trim() });
  return { id, expiresAt: expires.toISOString(), duplicate: false };
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
    const moved = await tx.prepare(`UPDATE credit_uses SET status = ?, status_changed_at = NOW() WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`).run(to, u.id, ...from);
    if (moved.changes > 0 && to !== "confirmed") await tx.prepare(`UPDATE credit_lots SET remaining_minor = remaining_minor + ? WHERE id = ?`).run(Number(u.a), u.lot);
  }
}

export async function creditsUsedFor(sourceType: string, ref: string): Promise<number> {
  const row = (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN ('reserved', 'confirmed')`).get(sourceType, ref)) as { s: number | string };
  return Number(row.s);
}

export async function residentCredits(residentId: string) {
  const lots = await db
    .prepare(`SELECT id, kind, amount_minor as amountMinor, remaining_minor as remainingMinor, expires_at as expiresAt, created_at as createdAt, currency FROM credit_lots WHERE resident_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(residentId);
  const next = (await db.prepare(`SELECT MIN(expires_at) as e FROM credit_lots WHERE resident_id = ? AND remaining_minor > 0 AND expires_at > NOW()`).get(residentId)) as { e: string | null };
  const reserved = (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM credit_uses WHERE resident_id = ? AND status = 'reserved'`).get(residentId)) as { s: number | string };
  return { enabled: await creditsEnabled(), balanceMinor: await creditBalance(residentId), reservedMinor: Number(reserved.s), nextExpiry: next.e ? new Date(next.e).toISOString() : null, lots };
}

/**
 * Stage 5f — decision D1: a partial refund restores credit in proportion to
 * the refunded share of the card payment (credit used × refunded ÷ card
 * paid, rounded down), the card share going back to the card. Incremental
 * and idempotent: only the difference from what's already restored moves.
 * A full refund restores everything (also done by the order lifecycle).
 */
export async function restoreCreditForRefund(tx: Tx, sourceType: string, ref: string, refundedSoFarMinor: number, cardPaidMinor: number): Promise<number> {
  const uses = (await tx
    .prepare(`SELECT id, lot_id as lot, resident_id as rid, amount_minor as a, status FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN ('confirmed', 'reversed') ORDER BY id DESC FOR UPDATE`)
    .all(sourceType, ref)) as { id: number; lot: number; rid: string; a: number | string; status: string }[];
  if (!uses.length) return 0;
  const total = uses.reduce((x, u) => x + Number(u.a), 0);
  const restored = uses.filter((u) => u.status === "reversed").reduce((x, u) => x + Number(u.a), 0);
  const full = cardPaidMinor <= 0 || refundedSoFarMinor >= cardPaidMinor;
  const target = full ? total : Math.floor((total * Math.max(0, refundedSoFarMinor)) / cardPaidMinor);
  let need = target - restored;
  let moved = 0;
  for (const u of uses) {
    if (need <= 0) break;
    if (u.status !== "confirmed") continue;
    const part = Math.min(Number(u.a), need);
    if (part === Number(u.a)) {
      await tx.prepare(`UPDATE credit_uses SET status = 'reversed', status_changed_at = NOW() WHERE id = ?`).run(u.id);
    } else {
      await tx.prepare(`UPDATE credit_uses SET amount_minor = amount_minor - ? WHERE id = ?`).run(part, u.id);
      await tx
        .prepare(`INSERT INTO credit_uses (lot_id, resident_id, source_type, source_ref, amount_minor, status, status_changed_at) VALUES (?, ?, ?, ?, ?, 'reversed', NOW())`)
        .run(u.lot, u.rid, sourceType, ref, part);
    }
    await tx.prepare(`UPDATE credit_lots SET remaining_minor = remaining_minor + ? WHERE id = ?`).run(part, u.lot);
    need -= part;
    moved += part;
  }
  return moved;
}

export type CreditHistoryKind = "granted" | "used" | "reserved" | "restored" | "released" | "expired";
export interface CreditHistoryEntry {
  kind: CreditHistoryKind;
  amountMinor: number;
  at: string;
  creditType: CreditKind | null;
  sourceType: string | null;
  sourceRef: string | null;
  expiresAt: string | null;
}

/** Stage 5f — the resident's credit history, newest first (their own only). */
export async function residentCreditHistory(residentId: string): Promise<CreditHistoryEntry[]> {
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  const out: CreditHistoryEntry[] = [];
  const lots = (await db
    .prepare(`SELECT id, kind, amount_minor as a, remaining_minor as r, expires_at as e, created_at as c FROM credit_lots WHERE resident_id = ? ORDER BY id DESC LIMIT 200`)
    .all(residentId)) as { id: number; kind: CreditKind; a: number | string; r: number | string; e: string; c: string }[];
  for (const l of lots) {
    out.push({ kind: "granted", amountMinor: Number(l.a), at: iso(l.c)!, creditType: l.kind, sourceType: null, sourceRef: null, expiresAt: iso(l.e) });
    if (new Date(l.e).getTime() <= Date.now() && Number(l.r) > 0) out.push({ kind: "expired", amountMinor: -Number(l.r), at: iso(l.e)!, creditType: l.kind, sourceType: null, sourceRef: null, expiresAt: iso(l.e) });
  }
  const uses = (await db
    .prepare(`SELECT source_type as t, source_ref as ref, status, amount_minor as a, created_at as c, status_changed_at as sc FROM credit_uses WHERE resident_id = ? ORDER BY id DESC LIMIT 400`)
    .all(residentId)) as { t: string; ref: string; status: string; a: number | string; c: string; sc: string | null }[];
  for (const u of uses) {
    const a = Number(u.a);
    out.push({ kind: u.status === "reserved" ? "reserved" : "used", amountMinor: -a, at: iso(u.c)!, creditType: null, sourceType: u.t, sourceRef: u.ref, expiresAt: null });
    if (u.status === "reversed") out.push({ kind: "restored", amountMinor: a, at: iso(u.sc ?? u.c)!, creditType: null, sourceType: u.t, sourceRef: u.ref, expiresAt: null });
    if (u.status === "released") out.push({ kind: "released", amountMinor: a, at: iso(u.sc ?? u.c)!, creditType: null, sourceType: u.t, sourceRef: u.ref, expiresAt: null });
  }
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}
