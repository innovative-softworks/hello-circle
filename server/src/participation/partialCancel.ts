import { db } from "../db/index.js";
import { RefundError, refundInApp } from "../commerce/payments.js";
import { syncOrderFromSource } from "../commerce/engine.js";
import { writeAudit } from "../audit.js";

// Participation Phase 1 — removing people from a booking bought with options
// ("partial cancellation"). Behind participation.partial_cancel, which is
// LOCKED off (circleFeatures.ts): this proves the money mechanics (release
// gate G4) without letting anyone use it until the owner approves.
//
// Guarantees (tested in partialCancel.test.ts):
// - One removal, one refund: the client sends the line's refunded quantity it
//   saw (`expectedRefunded`); the line is re-read under the order's row lock,
//   so a repeat or concurrent request finds it changed and gets 409. The
//   provider refund carries a key derived from (ref, line, new refunded qty),
//   and refunds.idempotency_key is UNIQUE, so even a replay can't pay twice.
// - All or nothing: the seat removal and the refund row are written in the
//   same transaction as the provider call; a provider failure rolls the seat
//   removal back (the person stays booked, nothing is refunded).
// - Never more than was paid: the share is computed from the frozen line
//   snapshot and capped at what is still refundable.
// - The whole booking can't be emptied this way — that's a normal cancel.

type Tx = Pick<typeof db, "prepare">;

export class PartialCancelError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface LineRow {
  line_no: number;
  line_kind: string;
  unit_minor: number;
  quantity_purchased: number;
  quantity: number;
  heads: number;
  heads_per_unit_snapshot: number;
  price_basis_snapshot: string;
  refunded_quantity: number;
  refunded_minor: number;
  label_snapshot: string;
}

export interface RemoveInput {
  ref: string;
  lineNo: number;
  quantity: number;
  /** The line's refunded quantity the caller last saw (optimistic version). */
  expectedRefunded: number;
  actor: { kind: "resident" | "client" | "user"; id: string };
}

export interface RemoveResult {
  ref: string;
  lineNo: number;
  removedQuantity: number;
  removedHeads: number;
  refundedMinor: number;
  refundId: number | null;
}

/** The paid share of `quantity` units of one line: proportional to the frozen
 * goods amounts, rounded down, never more than is still refundable. */
export function lineShareMinor(paidMinor: number, refundableMinor: number, unitMinor: number, quantity: number, goodsTotalMinor: number): number {
  if (goodsTotalMinor <= 0 || paidMinor <= 0) return 0;
  const share = Math.floor((paidMinor * unitMinor * quantity) / goodsTotalMinor);
  return Math.max(0, Math.min(share, refundableMinor));
}

/** Validates and applies the removal under the caller's row lock; returns
 * the refund amount owed. Shared by the paid and the free/no-charge paths. */
async function applyRemoval(tx: Tx, input: RemoveInput, paidMinor: number, remainingMinor: number): Promise<{ amount: number; heads: number }> {
  const booking = (await tx.prepare(`SELECT party_size, status, pricing_mode FROM experience_bookings WHERE ref = ?`).get(input.ref)) as
    | { party_size: number; status: string; pricing_mode: string }
    | undefined;
  if (!booking) throw new PartialCancelError("Booking not found", 404);
  if (booking.status === "cancelled") throw new PartialCancelError("This booking is already cancelled", 409);
  if (booking.pricing_mode !== "lines") throw new PartialCancelError("Only a booking with registration options can have people removed", 409);
  const lines = (await tx.prepare(`SELECT * FROM order_lines WHERE source_type = 'experience' AND source_ref = ? ORDER BY line_no FOR UPDATE`).all(input.ref)) as LineRow[];
  const line = lines.find((l) => Number(l.line_no) === input.lineNo);
  if (!line) throw new PartialCancelError("That part of the booking wasn't found", 404);
  if (Number(line.refunded_quantity) !== input.expectedRefunded) throw new PartialCancelError("This booking changed since you opened it — reload to see the latest", 409);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > Number(line.quantity)) throw new PartialCancelError(`You can remove between 1 and ${line.quantity} from ${line.label_snapshot}`, 400);
  const heads = line.line_kind === "addon" ? 0 : input.quantity * Number(line.heads_per_unit_snapshot);
  const partyAfter = Number(booking.party_size) - heads;
  if (partyAfter < 1) throw new PartialCancelError("That would remove everyone — cancel the whole booking instead", 409);
  // A per-person add-on can't be left on more people than remain.
  for (const l of lines) {
    if (l.line_kind === "addon" && l.price_basis_snapshot === "per_person" && Number(l.quantity) - (Number(l.line_no) === input.lineNo ? input.quantity : 0) > partyAfter) {
      throw new PartialCancelError(`Remove some of ${l.label_snapshot} first — it's one per person`, 409);
    }
  }
  const goodsTotal = lines.reduce((s, l) => s + Number(l.unit_minor) * Number(l.quantity_purchased), 0);
  const amount = lineShareMinor(paidMinor, remainingMinor, Number(line.unit_minor), input.quantity, goodsTotal);
  await tx
    .prepare(
      `UPDATE order_lines SET quantity = quantity - ?, heads = heads - ?, refunded_quantity = refunded_quantity + ?, refunded_minor = refunded_minor + ?
       WHERE source_type = 'experience' AND source_ref = ? AND line_no = ? AND refunded_quantity = ?`
    )
    .run(input.quantity, heads, input.quantity, amount, input.ref, input.lineNo, input.expectedRefunded);
  if (heads > 0) {
    await tx.prepare(`UPDATE experience_bookings SET party_size = party_size - ? WHERE ref = ?`).run(heads, input.ref);
    // Phase 2 — recorded attendees on that line follow the head count (last first).
    await tx
      .prepare(`UPDATE booking_attendees SET status = 'removed' WHERE source_type = 'experience' AND source_ref = ? AND line_no = ? AND status = 'active' ORDER BY attendee_no DESC LIMIT ${Math.floor(heads)}`)
      .run(input.ref, input.lineNo);
  }
  return { amount, heads };
}

/**
 * Removes `quantity` units of one line from a booking, refunding that share
 * for a card-paid order. Callers must check ownership, the switch and the
 * cancellation cut-off first.
 */
export async function removeFromBooking(input: RemoveInput): Promise<RemoveResult> {
  const row = (await db.prepare(`SELECT payment_status AS ps, stripe_session_id AS sid, total_cents AS total FROM experience_bookings WHERE ref = ?`).get(input.ref)) as
    | { ps: string; sid: string | null; total: number }
    | undefined;
  if (!row) throw new PartialCancelError("Booking not found", 404);
  if (row.ps !== "paid") throw new PartialCancelError("Only a confirmed booking can be changed", 409);
  let result: RemoveResult;
  if (row.sid && Number(row.total) > 0) {
    // Card-paid: removal + refund in one locked transaction (refundInApp).
    let applied: { amount: number; heads: number } | null = null;
    const newRefunded = input.expectedRefunded + input.quantity;
    try {
      const r = await refundInApp({
        type: "experience",
        ref: input.ref,
        reason: "Person removed from the booking",
        responsible: "customer",
        actorId: input.actor.id,
        idempotencyKey: `hc-line-${input.ref}-${input.lineNo}-${newRefunded}`,
        prepare: async (tx, ctx) => {
          applied = await applyRemoval(tx, input, ctx.paidMinor, ctx.remainingMinor);
          if (applied.amount < 1) throw new PartialCancelError("There's nothing to refund for that part of the booking", 409);
          return applied.amount;
        },
      });
      const a = applied as { amount: number; heads: number } | null;
      result = { ref: input.ref, lineNo: input.lineNo, removedQuantity: input.quantity, removedHeads: a?.heads ?? 0, refundedMinor: r.amountMinor, refundId: r.refundId };
    } catch (e) {
      if (e instanceof RefundError) throw new PartialCancelError(e.message, e.status);
      throw e;
    }
  } else {
    // Free or paid at the venue: nothing moves through HelloCircle.
    const applied = await db.transaction(async (tx) => {
      await tx.prepare(`SELECT ref FROM experience_bookings WHERE ref = ? FOR UPDATE`).get(input.ref);
      return applyRemoval(tx, input, 0, 0);
    });
    result = { ref: input.ref, lineNo: input.lineNo, removedQuantity: input.quantity, removedHeads: applied.heads, refundedMinor: 0, refundId: null };
  }
  await syncOrderFromSource("experience", input.ref);
  await writeAudit({
    actorUserId: input.actor.kind === "user" ? input.actor.id : null,
    actorKind: input.actor.kind === "user" ? "user" : "resident",
    action: "experience_booking.partial_cancel",
    objectType: "experience_booking",
    objectId: input.ref,
    newValue: { lineNo: input.lineNo, removedQuantity: result.removedQuantity, removedHeads: result.removedHeads, refundedMinor: result.refundedMinor, refundId: result.refundId },
  });
  return result;
}
