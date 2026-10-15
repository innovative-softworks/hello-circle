import { db } from "../db/index.js";
import { NeedsReviewError } from "../commerce/payments.js";

// Webhook reconciliation (UI completion 2026-10-14). When a Checkout session
// is created, the server records what it asked the provider to charge for
// which order (`checkout_agreements`). A signed "paid" event is only
// confirmed when it matches that agreement: same order, same session, the
// agreed amount and currency. A mismatch never marks anything paid — the
// event is parked for finance review (Finance → Payment events), exactly like
// other events that can't be applied automatically.
//
// The agreement is the amount sent to the provider at session creation — it
// already reflects coupons, deposits and credits — so the comparison doesn't
// re-derive prices and can't disagree with a legitimate discount.

const SOURCE_TABLES: Record<string, { table: string }> = {
  booking: { table: "bookings" },
  registration: { table: "registrations" },
  game: { table: "game_participants" },
  program: { table: "program_enrollments" },
  pass: { table: "passes" },
  experience: { table: "experience_bookings" },
};

export async function recordCheckoutAgreement(input: { sessionId: string; type: string; ref: string; amountMinor: number; currency: string }) {
  await db
    .prepare(`INSERT IGNORE INTO checkout_agreements (session_id, source_type, source_ref, amount_minor, currency) VALUES (?, ?, ?, ?, ?)`)
    .run(input.sessionId, input.type, input.ref, input.amountMinor, input.currency.toUpperCase());
}

export interface PaidSession {
  id?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

/** `kind` (D-10): "association" — the session can't be tied to this order
 * (case 2, never holds or refunds); "amount" / "currency" — a verified,
 * correctly associated payment that differs from what was agreed (case 1). */
export type AgreementCheck =
  | { ok: true; basis: "agreement" | "legacy"; agreed: { amountMinor: number; currency: string } | null }
  | { ok: false; reason: string; kind: "association" | "amount" | "currency"; agreed: { amountMinor: number; currency: string } | null };

/** Pure-ish check, exported for tests. */
export async function checkCheckoutAgreement(session: PaidSession): Promise<AgreementCheck> {
  const type = session.metadata?.type ?? "";
  const ref = session.metadata?.ref ?? "";
  if (!(type in SOURCE_TABLES) || !ref) return { ok: false, reason: `unknown order ${type}:${ref}`, kind: "association", agreed: null };
  if (!session.id) return { ok: false, reason: "event has no session id", kind: "association", agreed: null };
  const agreement = (await db
    .prepare(`SELECT source_type AS type, source_ref AS ref, amount_minor AS amount, currency FROM checkout_agreements WHERE session_id = ?`)
    .get(session.id)) as { type: string; ref: string; amount: number | string; currency: string } | undefined;
  if (!agreement) {
    // Sessions created before agreements were recorded: fall back to the
    // session id stored on the order row (set when the session was created).
    const row = (await db.prepare(`SELECT stripe_session_id AS sid FROM ${SOURCE_TABLES[type].table} WHERE ref = ?`).get(ref)) as { sid: string | null } | undefined;
    if (row?.sid && row.sid !== session.id) return { ok: false, reason: `session ${session.id} isn't the checkout session recorded for ${type} ${ref}`, kind: "association", agreed: null };
    // A legacy session with no stored session id either can't be tied to the order.
    if (!row?.sid) return { ok: false, reason: `no checkout agreement or stored session for ${type} ${ref}`, kind: "association", agreed: null };
    return { ok: true, basis: "legacy", agreed: null };
  }
  if (agreement.type !== type || agreement.ref !== ref) return { ok: false, reason: `session ${session.id} was created for ${agreement.type} ${agreement.ref}, not ${type} ${ref}`, kind: "association", agreed: null };
  const agreed = { amountMinor: Number(agreement.amount), currency: agreement.currency };
  const currency = String(session.currency ?? "").toUpperCase();
  if (currency !== agreement.currency) return { ok: false, reason: `currency ${currency || "missing"} ≠ agreed ${agreement.currency}`, kind: "currency", agreed };
  if (typeof session.amount_total !== "number" || session.amount_total !== Number(agreement.amount)) {
    return { ok: false, reason: `amount ${session.amount_total ?? "missing"} ≠ agreed ${Number(agreement.amount)} (${agreement.currency})`, kind: "amount", agreed };
  }
  return { ok: true, basis: "agreement", agreed };
}

/** Throws NeedsReviewError (event parked, nothing confirmed) on a mismatch. */
export async function verifyCheckoutAgreement(session: PaidSession): Promise<void> {
  const result = await checkCheckoutAgreement(session);
  if (!result.ok) throw new NeedsReviewError(`Checkout reconciliation failed — not marked paid: ${result.reason}`);
}

/** True while a paid Checkout event for this order is parked for finance
 * review (e.g. it didn't match its checkout agreement). Lets the customer's
 * confirmation page say "your payment needs a check" instead of an open-ended
 * "still confirming". Read-only; it never changes the order. */
export async function paymentUnderReview(type: string, ref: string): Promise<boolean> {
  // D-10: an open payment review for this order (any reason except an
  // unverified association) also means "needs a check".
  if (await db.prepare(`SELECT id FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND status = 'open' AND reason != 'association_unverified' LIMIT 1`).get(type, ref)) return true;
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM checkout_agreements ca
       JOIN webhook_events we ON we.object_id = ca.session_id
       WHERE ca.source_type = ? AND ca.source_ref = ? AND we.status = 'manual_review' AND we.event_type LIKE 'checkout.session.%'
       LIMIT 1`
    )
    .get(type, ref);
  return !!row;
}
