// Revenue & Connect Stage 5e — venue/host split (flow C) and the immutable
// allocation snapshot frozen at payment confirmation.
//
// A host runs a paid game at a partner venue. The host proposes how the
// partner share is divided; the venue's organisation accepts (or declines)
// it. The accepted agreement in force when a booking is *paid* is frozen into
// that booking's allocation snapshot — later changes to the agreement or to
// the venue_split rule never touch a paid booking.
//
// Money is integer cents throughout. A percentage split is
//   venue = ⌊pool × bps / 10000⌋, host = ⌊pool × (10000 − bps) / 10000⌋
// and the remainder (0 or 1 cent) goes to the configured rounding owner
// (venue_split.roundingOwner), recorded on the snapshot. The snapshot always
// satisfies
//   gross cash received = HelloCircle retained + venue + host (or the single
//                         partner) + VAT + refundable deposit
// and freezeAllocation refuses to write one that doesn't.

import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import type { LedgerLine } from "./ledger.js";
import { resolveRule, RuleError } from "./rules.js";
import { commerceSwitch } from "./switches.js";

type Tx = Pick<typeof db, "prepare">;

export type SplitMode = "percentage" | "fixed_venue" | "fixed_host";
export type RoundingOwner = "venue" | "host" | "platform";

export interface SplitTerms {
  mode: SplitMode;
  venueBps: number | null;
  venueFixedMinor: number | null;
  hostFixedMinor: number | null;
}

export interface SplitAgreement extends SplitTerms {
  id: number;
  gameId: string;
  version: number;
  venuePartyType: "org" | "vendor";
  venuePartyId: string;
  hostResidentId: string;
  status: "proposed" | "accepted" | "declined" | "withdrawn" | "superseded";
  proposedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

const FIELDS = `id, game_id as gameId, version, venue_party_type as venuePartyType, venue_party_id as venuePartyId, host_resident_id as hostResidentId,
  mode, venue_bps as venueBps, venue_fixed_minor as venueFixedMinor, host_fixed_minor as hostFixedMinor, status, proposed_at as proposedAt,
  decided_at as decidedAt, decision_reason as decisionReason`;

function normalize(a: SplitAgreement): SplitAgreement {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...a, venueBps: n(a.venueBps), venueFixedMinor: n(a.venueFixedMinor), hostFixedMinor: n(a.hostFixedMinor) };
}

/** Pure, integer-only split of the partner pool. */
export function splitWithRounding(poolMinor: number, terms: SplitTerms, roundingOwner: RoundingOwner): { venue: number; host: number; platform: number; remainder: number; error: string | null } {
  if (!Number.isSafeInteger(poolMinor) || poolMinor < 0) return { venue: 0, host: 0, platform: 0, remainder: 0, error: "Partner pool must be a whole, non-negative number of cents" };
  if (terms.mode === "percentage") {
    const bps = Number(terms.venueBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) return { venue: 0, host: 0, platform: 0, remainder: 0, error: "Venue share must be 0–100%" };
    const venue = Math.floor((poolMinor * bps) / 10_000);
    const host = Math.floor((poolMinor * (10_000 - bps)) / 10_000);
    const remainder = poolMinor - venue - host;
    return {
      venue: venue + (roundingOwner === "venue" ? remainder : 0),
      host: host + (roundingOwner === "host" ? remainder : 0),
      platform: roundingOwner === "platform" ? remainder : 0,
      remainder,
      error: null,
    };
  }
  const fixed = Number(terms.mode === "fixed_venue" ? terms.venueFixedMinor : terms.hostFixedMinor);
  if (!Number.isSafeInteger(fixed) || fixed < 0) return { venue: 0, host: 0, platform: 0, remainder: 0, error: "Fixed amount must be a whole, non-negative number of cents" };
  if (fixed > poolMinor) return { venue: 0, host: 0, platform: 0, remainder: 0, error: `The fixed ${terms.mode === "fixed_venue" ? "venue" : "host"} amount (${fixed}) is more than the partner share (${poolMinor})` };
  return terms.mode === "fixed_venue"
    ? { venue: fixed, host: poolMinor - fixed, platform: 0, remainder: 0, error: null }
    : { venue: poolMinor - fixed, host: fixed, platform: 0, remainder: 0, error: null };
}

/** The venue's payee for a game: the organisation that owns the centre. */
export async function venuePartyForGame(gameId: string, tx: Tx = db): Promise<{ partyType: "org" | "vendor"; partyId: string } | null> {
  const r = (await tx
    .prepare(`SELECT c.vendor_id as v, u.org_id as orgId FROM games g JOIN centres c ON c.id = g.centre_id JOIN users u ON u.id = c.vendor_id WHERE g.id = ?`)
    .get(gameId)) as { v: string; orgId: string | null } | undefined;
  if (!r) return null;
  return r.orgId ? { partyType: "org", partyId: r.orgId } : { partyType: "vendor", partyId: r.v };
}

export async function getAgreement(id: number, tx: Tx = db): Promise<SplitAgreement | null> {
  const a = (await tx.prepare(`SELECT ${FIELDS} FROM venue_split_agreements WHERE id = ?`).get(id)) as SplitAgreement | undefined;
  return a ? normalize(a) : null;
}

/** The accepted agreement in force for a game (latest accepted version). */
export async function activeAgreement(gameId: string, tx: Tx = db): Promise<SplitAgreement | null> {
  const a = (await tx.prepare(`SELECT ${FIELDS} FROM venue_split_agreements WHERE game_id = ? AND status = 'accepted' ORDER BY version DESC LIMIT 1`).get(gameId)) as SplitAgreement | undefined;
  return a ? normalize(a) : null;
}

export async function agreementsForGame(gameId: string): Promise<SplitAgreement[]> {
  return ((await db.prepare(`SELECT ${FIELDS} FROM venue_split_agreements WHERE game_id = ? ORDER BY version DESC`).all(gameId)) as SplitAgreement[]).map(normalize);
}

export async function agreementsForVenue(party: { partyType: string; partyId: string }): Promise<(SplitAgreement & { gameTitle: string | null })[]> {
  return ((await db
    .prepare(
      `SELECT x.*, g.activity_label as gameTitle FROM (SELECT ${FIELDS} FROM venue_split_agreements WHERE venue_party_type = ? AND venue_party_id = ? ORDER BY id DESC LIMIT 100) x
       LEFT JOIN games g ON g.id = x.gameId ORDER BY x.id DESC`
    )
    .all(party.partyType, party.partyId)) as (SplitAgreement & { gameTitle: string | null })[]).map((a) => ({ ...normalize(a), gameTitle: a.gameTitle }));
}

/** The host proposes (or re-proposes) a split for their own game at a venue. */
export async function splitEnabled(): Promise<boolean> {
  return commerceSwitch("commerce.venue_host_split_payout");
}

export async function proposeSplit(input: { gameId: string; hostResidentId: string; terms: SplitTerms }): Promise<SplitAgreement> {
  if (!(await splitEnabled())) throw new RuleError("Venue/host split payouts aren't switched on yet", 409);
  const game = (await db.prepare(`SELECT host_resident_id as host, centre_id as centre, price_cents as price FROM games WHERE id = ?`).get(input.gameId)) as
    | { host: string; centre: string | null; price: number | null }
    | undefined;
  if (!game || game.host !== input.hostResidentId) throw new RuleError("Game not found", 404);
  if (!game.centre) throw new RuleError("A split needs the game to be at a HelloCircle venue", 409);
  const venue = await venuePartyForGame(input.gameId);
  if (!venue) throw new RuleError("This venue can't receive payouts through HelloCircle", 409);
  const rule = await resolveRule("venue_split");
  const t = input.terms;
  if (!["percentage", "fixed_venue", "fixed_host"].includes(t.mode)) throw new RuleError("Split mode must be percentage, fixed_venue or fixed_host");
  if (t.mode === "percentage") {
    if (!Number.isInteger(t.venueBps) || t.venueBps! < 1 || t.venueBps! > Number(rule.values.maxVenueBps)) throw new RuleError(`Venue share must be between 0.01% and ${Number(rule.values.maxVenueBps) / 100}%`);
  } else {
    const fixed = t.mode === "fixed_venue" ? t.venueFixedMinor : t.hostFixedMinor;
    if (!Number.isSafeInteger(fixed) || fixed! < 0) throw new RuleError("Fixed amount must be a whole number of cents");
    if (game.price !== null && fixed! > Number(game.price)) throw new RuleError("Fixed amount can't be more than the game's price");
  }
  return db.transaction(async (tx) => {
    await tx.prepare(`SELECT id FROM games WHERE id = ? FOR UPDATE`).get(input.gameId);
    await tx.prepare(`UPDATE venue_split_agreements SET status = 'withdrawn', decided_at = NOW(), decision_reason = 'Replaced by a newer proposal' WHERE game_id = ? AND status = 'proposed'`).run(input.gameId);
    const { v } = (await tx.prepare(`SELECT COALESCE(MAX(version), 0) as v FROM venue_split_agreements WHERE game_id = ?`).get(input.gameId)) as { v: number };
    const info = await tx
      .prepare(
        `INSERT INTO venue_split_agreements (game_id, version, venue_party_type, venue_party_id, host_resident_id, mode, venue_bps, venue_fixed_minor, host_fixed_minor, status, proposed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`
      )
      .run(input.gameId, Number(v) + 1, venue.partyType, venue.partyId, input.hostResidentId, t.mode, t.mode === "percentage" ? t.venueBps : null, t.mode === "fixed_venue" ? t.venueFixedMinor : null, t.mode === "fixed_host" ? t.hostFixedMinor : null, input.hostResidentId);
    const id = Number(info.lastInsertRowid);
    await writeAudit({ actorUserId: input.hostResidentId, actorKind: "resident", action: "venue_split.proposed", objectType: "venue_split_agreement", objectId: String(id), newValue: { gameId: input.gameId, ...t } });
    return (await getAgreement(id, tx))!;
  });
}

/** The venue accepts or declines. Accepting supersedes the previously accepted version (future payments only). */
export async function decideSplit(input: { agreementId: number; venue: { partyType: string; partyId: string }; accept: boolean; actorId: string; reason?: string }): Promise<SplitAgreement> {
  if (!(await splitEnabled())) throw new RuleError("Venue/host split payouts aren't switched on yet", 409);
  const reason = (input.reason ?? "").trim();
  if (!input.accept && reason.length < 5) throw new RuleError("A reason (at least 5 characters) is required to decline");
  return db.transaction(async (tx) => {
    const a = (await tx.prepare(`SELECT ${FIELDS} FROM venue_split_agreements WHERE id = ? FOR UPDATE`).get(input.agreementId)) as SplitAgreement | undefined;
    if (!a || a.venuePartyType !== input.venue.partyType || a.venuePartyId !== input.venue.partyId) throw new RuleError("Agreement not found", 404);
    if (a.status !== "proposed") throw new RuleError("Only a proposed split can be accepted or declined", 409);
    if (input.accept) await tx.prepare(`UPDATE venue_split_agreements SET status = 'superseded' WHERE game_id = ? AND status = 'accepted'`).run(a.gameId);
    await tx
      .prepare(`UPDATE venue_split_agreements SET status = ?, decided_by = ?, decided_at = NOW(), decision_reason = ? WHERE id = ?`)
      .run(input.accept ? "accepted" : "declined", input.actorId, reason || null, input.agreementId);
    await writeAudit({ actorUserId: input.actorId, action: input.accept ? "venue_split.accepted" : "venue_split.declined", objectType: "venue_split_agreement", objectId: String(input.agreementId), newValue: { gameId: a.gameId }, reason: reason || undefined });
    return (await getAgreement(input.agreementId, tx))!;
  });
}

// --- allocation snapshot ----------------------------------------------------------

export interface AllocationPlan {
  /** Partner lines that replace the single partner line in the payment posting. */
  partnerLines: LedgerLine[];
  /** Cents the platform keeps because the rounding owner is "platform". */
  platformRoundingMinor: number;
  remainder: number;
  roundingOwner: RoundingOwner;
  agreement: SplitAgreement | null;
  splitRuleHash: string | null;
}

/** For a paid game with an accepted split: the venue and host lines that share
 * `poolMinor`. Null when the order isn't a split (single partner as before). */
export async function planSplit(tx: Tx, type: string, ref: string, poolMinor: number, at: Date): Promise<AllocationPlan | null> {
  if (type !== "game") return null;
  // Switch off → single partner (the host), even if an agreement was accepted.
  if (!(await splitEnabled())) return null;
  const g = (await tx.prepare(`SELECT p.game_id as gameId, g.host_resident_id as host FROM game_participants p JOIN games g ON g.id = p.game_id WHERE p.ref = ?`).get(ref)) as
    | { gameId: string; host: string }
    | undefined;
  if (!g) return null;
  const agreement = await activeAgreement(g.gameId, tx);
  if (!agreement) return null;
  const rule = await resolveRule("venue_split", {}, at, { tx });
  const owner = String(rule.values.roundingOwner) as RoundingOwner;
  const s = splitWithRounding(poolMinor, agreement, owner);
  if (s.error) {
    const { NeedsReviewError } = await import("./payments.js");
    throw new NeedsReviewError(`Split agreement #${agreement.id} can't be applied to ${type} ${ref}: ${s.error}`);
  }
  return {
    partnerLines: [
      { account: "partner_payable", amountMinor: -s.venue, partyType: agreement.venuePartyType, partyId: agreement.venuePartyId, memo: `venue share (split #${agreement.id} v${agreement.version})` },
      { account: "host_payable", amountMinor: -s.host, partyType: "host", partyId: g.host, memo: `host share (split #${agreement.id} v${agreement.version})` },
    ],
    platformRoundingMinor: s.platform,
    remainder: s.remainder,
    roundingOwner: owner,
    agreement,
    splitRuleHash: rule.hash,
  };
}

/**
 * Freezes the booking's allocation, derived from the exact payment posting
 * (so the two can never disagree). Immutable: written once per order (a
 * re-delivery is a no-op). Refuses to write an allocation that doesn't add up.
 */
export async function freezeAllocation(
  tx: Tx,
  input: { type: string; ref: string; currency: string; lines: LedgerLine[]; customerFeeMinor: number; successFeeMinor: number; estProcessingFeeMinor: number; pricingRuleHash: string | null; plan: AllocationPlan | null }
): Promise<void> {
  if (await tx.prepare(`SELECT id FROM allocation_snapshots WHERE source_type = ? AND source_ref = ?`).get(input.type, input.ref)) return;
  const sum = (account: string) => input.lines.filter((l) => l.account === account).reduce((a, l) => a + l.amountMinor, 0);
  const gross = sum("stripe_clearing");
  const vat = -sum("underlying_tax_payable");
  const deposit = -sum("refund_liability");
  const funded = sum("coupon_expense");
  const partnerLines = input.lines.filter((l) => (l.account === "partner_payable" || l.account === "host_payable") && l.partyId);
  const partners = partnerLines.map((l) => ({ role: l.account === "host_payable" ? "host" : input.plan ? "venue" : "vendor", partyType: l.partyType!, partyId: l.partyId!, amount: -l.amountMinor }));
  const retained = -sum("platform_fee_revenue") - sum("accrued_payment_costs") - funded;
  const partnerTotal = partners.reduce((a, p) => a + p.amount, 0);
  if (gross !== retained + partnerTotal + vat + deposit) {
    const { NeedsReviewError } = await import("./payments.js");
    throw new NeedsReviewError(`Allocation for ${input.type} ${input.ref} doesn't reconcile: ${gross} ≠ ${retained} + ${partnerTotal} + ${vat} + ${deposit}`);
  }
  const coupon = (await tx.prepare(`SELECT discount_minor as d, platform_funded_minor as f FROM coupon_redemptions WHERE source_type = ? AND source_ref = ? AND status IN ('reserved','confirmed')`).get(input.type, input.ref)) as
    | { d: number | string; f: number | string }
    | undefined;
  const discount = Number(coupon?.d ?? 0);
  const platformFunded = Number(coupon?.f ?? 0);
  const funder = discount === 0 ? "none" : platformFunded === discount ? "helloCircle" : platformFunded === 0 ? "partner" : "shared";
  const credits = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM credit_uses WHERE source_type = ? AND source_ref = ? AND status IN ('reserved','confirmed','used')`).get(input.type, input.ref)) as { s: number | string };
  const info = await tx
    .prepare(
      `INSERT INTO allocation_snapshots (source_type, source_ref, currency, gross_minor, vat_minor, credits_used_minor, discount_minor, discount_funder, platform_funded_discount_minor,
         customer_fee_minor, success_fee_minor, est_processing_fee_minor, deposit_minor, platform_retained_minor, partner_pool_minor, rounding_adjustment_minor, rounding_owner,
         pricing_rule_hash, split_rule_hash, split_agreement_id, split_agreement_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.type, input.ref, input.currency.toUpperCase(), gross, vat, Number(credits.s), discount, funder, platformFunded,
      input.customerFeeMinor, input.successFeeMinor, input.estProcessingFeeMinor, deposit, retained, partnerTotal + (input.plan?.platformRoundingMinor ?? 0),
      input.plan?.remainder ?? 0, input.plan?.roundingOwner ?? "none", input.pricingRuleHash, input.plan?.splitRuleHash ?? null, input.plan?.agreement?.id ?? null, input.plan?.agreement?.version ?? null
    );
  const id = Number(info.lastInsertRowid);
  // Who owns the VAT liability (record only; provisional pending Irish tax review).
  const vatRule = await resolveRule("vat_treatment", {}, new Date(), { tx });
  await tx
    .prepare(`UPDATE allocation_snapshots SET vat_liability_owner = ?, vat_treatment_status = ?, vat_rule_hash = ? WHERE id = ?`)
    .run(String(vatRule.values.liabilityOwner), String(vatRule.values.status), vatRule.hash, id);
  const rows: { role: string; partyType: string | null; partyId: string | null; amount: number }[] = [
    { role: "platform", partyType: null, partyId: null, amount: retained },
    ...partners,
    { role: "tax", partyType: null, partyId: null, amount: vat },
    { role: "deposit", partyType: null, partyId: null, amount: deposit },
  ];
  for (const r of rows) {
    await tx.prepare(`INSERT INTO allocation_lines (snapshot_id, role, party_type, party_id, amount_minor) VALUES (?, ?, ?, ?, ?)`).run(id, r.role, r.partyType, r.partyId, r.amount);
  }
}

/** The partner payees of an order from its frozen allocation (empty = not frozen). */
export async function allocationPartners(tx: Tx, type: string, ref: string): Promise<{ role: string; partyType: string; partyId: string; amountMinor: number }[]> {
  return ((await tx
    .prepare(
      `SELECT l.role, l.party_type as partyType, l.party_id as partyId, l.amount_minor as amountMinor FROM allocation_lines l JOIN allocation_snapshots s ON s.id = l.snapshot_id
       WHERE s.source_type = ? AND s.source_ref = ? AND l.role IN ('venue','host','vendor') ORDER BY FIELD(l.role, 'venue', 'vendor', 'host')`
    )
    .all(type, ref)) as { role: string; partyType: string; partyId: string; amountMinor: number | string }[]).map((r) => ({ ...r, amountMinor: Number(r.amountMinor) }));
}

export async function isSplitOrder(tx: Tx, type: string, ref: string): Promise<boolean> {
  return (await allocationPartners(tx, type, ref)).filter((p) => p.role === "venue" || p.role === "host").length > 1;
}
