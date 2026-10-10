import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { RewardError, adjustPoints, rewardHistory } from "../commerce/rewards.js";
import { writeAudit } from "../audit.js";
import type { CheckoutType } from "../checkoutService.js";
import { balances, groupLines, ledgerIsBalanced } from "../commerce/ledger.js";
import { NeedsReviewError, RefundError, refundInApp } from "../commerce/payments.js";
import { paymentProvider } from "../payments/provider.js";
import { RuleError } from "../commerce/rules.js";
import { partnerBalances, reconcilePaymentFees, resolveDisputeRecovery, runSettlement } from "../commerce/settlement.js";
import { failEvent, finishEvent, reopenForReplay } from "../payments/webhookEvents.js";
import { processThinConnectEvent } from "../payments/connect.js";
import { processStripeEvent } from "./stripeWebhook.js";
import { ConnectError, openPartnerDebt, payoutReadiness, retryDebtRecovery, reverseAllocation, runTransfers, type Party } from "../payments/connect.js";
import { listDebts } from "../commerce/debts.js";
import { CreditError, grantCredit, residentCredits } from "../commerce/credits.js";
import { sweepSubscriptions } from "../commerce/subscriptions.js";

// Revenue & Connect Stage 2c — finance operations: webhook queue + replay,
// payments, refunds (incl. partial), disputes, ledger. Mounted from admin.ts
// behind requireAdminRole("finance"); writes are audited with a reason.
export const adminFinanceRouter = Router();

const REFUNDABLE: CheckoutType[] = ["booking", "registration", "program", "experience", "game"];

function reasonOf(req: Request): string | null {
  const r = (req.body as { reason?: unknown } | undefined)?.reason;
  return typeof r === "string" && r.trim().length >= 5 ? r.trim().slice(0, 2000) : null;
}

adminFinanceRouter.get("/webhooks", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await db
    .prepare(
      `SELECT id, provider, event_id as eventId, event_type as eventType, status, attempts, last_error as lastError, summary, received_at as receivedAt, processed_at as processedAt
       FROM webhook_events ${status ? "WHERE status = ?" : ""} ORDER BY id DESC LIMIT 200`
    )
    .all(...(status ? [status] : [])) as Record<string, unknown>[];
  res.json(rows.map((r) => ({ ...r, summary: JSON.parse(String(r.summary)) })));
});

/** Replays a failed or parked event: re-fetched from the provider, then
 * processed exactly like a live delivery (handlers are idempotent). */
adminFinanceRouter.post("/webhooks/:id/replay", async (req: Request, res: Response) => {
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  const provider = paymentProvider();
  if (!provider) return res.status(503).json({ error: "Payments aren't configured on this server" });
  const target = await reopenForReplay(Number(req.params.id));
  if (!target) return res.status(409).json({ error: "Only a failed or parked event can be replayed" });
  // Stage 5e — v2 (thin) events are re-fetched inside processThinConnectEvent.
  const isThin = target.provider === "stripe_v2";
  const event = isThin ? null : await provider.retrieveEvent(target.eventId);
  if (!isThin && !event) return res.status(404).json({ error: "The provider no longer has this event" });
  const claim = await db.prepare(`UPDATE webhook_events SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'failed'`).run(Number(req.params.id));
  if (claim.changes !== 1) return res.status(409).json({ error: "This event is already being processed" });
  try {
    const outcome = isThin ? await processThinConnectEvent(target.eventId) : await processStripeEvent(event!);
    await finishEvent(Number(req.params.id), outcome);
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "webhook.replayed", objectType: "webhook_event", objectId: target.eventId, newValue: { outcome }, reason });
    res.json({ ok: true, outcome });
  } catch (e) {
    await failEvent(Number(req.params.id), e, { needsReview: true });
    res.status(e instanceof NeedsReviewError ? 409 : 500).json({ error: e instanceof Error ? e.message : "Replay failed" });
  }
});

/** Stage 5e — a booking's frozen allocation snapshot (and its split agreement). */
adminFinanceRouter.get("/allocations/:type/:ref", async (req, res) => {
  const snap = (await db.prepare(`SELECT * FROM allocation_snapshots WHERE source_type = ? AND source_ref = ?`).get(req.params.type, req.params.ref)) as Record<string, unknown> | undefined;
  if (!snap) return res.status(404).json({ error: "No allocation frozen for this booking" });
  const lines = await db.prepare(`SELECT role, party_type as partyType, party_id as partyId, amount_minor as amountMinor FROM allocation_lines WHERE snapshot_id = ? ORDER BY id`).all(snap.id);
  const releases = await db.prepare(`SELECT party_type as partyType, party_id as partyId, released_minor as releasedMinor, released_at as releasedAt FROM order_party_releases WHERE source_type = ? AND source_ref = ?`).all(req.params.type, req.params.ref);
  res.json({ snapshot: snap, lines, releases });
});

adminFinanceRouter.get("/splits", async (req, res) => {
  const gameId = typeof req.query.gameId === "string" ? req.query.gameId : null;
  res.json(await db.prepare(`SELECT * FROM venue_split_agreements ${gameId ? "WHERE game_id = ?" : ""} ORDER BY id DESC LIMIT 200`).all(...(gameId ? [gameId] : [])));
});

adminFinanceRouter.get("/payments", async (req, res) => {
  const ref = typeof req.query.ref === "string" ? req.query.ref : null;
  const rows = await db
    .prepare(`SELECT * FROM payment_records ${ref ? "WHERE source_ref = ? OR payment_intent_id = ? OR checkout_session_id = ?" : ""} ORDER BY id DESC LIMIT 200`)
    .all(...(ref ? [ref, ref, ref] : []));
  res.json(rows);
});

adminFinanceRouter.get("/refunds", async (_req, res) => {
  res.json(await db.prepare(`SELECT * FROM refunds ORDER BY id DESC LIMIT 200`).all());
});

adminFinanceRouter.post("/refunds", async (req, res) => {
  const b = req.body as { sourceType?: string; ref?: string; amountMinor?: number; responsible?: string };
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  if (!b.sourceType || !REFUNDABLE.includes(b.sourceType as CheckoutType) || !b.ref) return res.status(400).json({ error: "sourceType and ref are required" });
  const responsible = ["customer", "partner", "platform"].includes(String(b.responsible)) ? (b.responsible as "customer" | "partner" | "platform") : "platform";
  try {
    const r = await refundInApp({ type: b.sourceType as CheckoutType, ref: b.ref, amountMinor: b.amountMinor, reason, responsible, actorId: req.user!.id });
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "refund.issued_by_admin", objectType: b.sourceType, objectId: b.ref, newValue: r, reason });
    res.json(r);
  } catch (e) {
    if (e instanceof RefundError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

adminFinanceRouter.get("/disputes", async (_req, res) => {
  res.json(await db.prepare(`SELECT * FROM disputes ORDER BY id DESC LIMIT 200`).all());
});

adminFinanceRouter.get("/ledger/groups", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: string[] = [];
  if (q.sourceType) {
    where.push("source_type = ?");
    params.push(q.sourceType);
  }
  if (q.sourceId) {
    where.push("source_id = ?");
    params.push(q.sourceId);
  }
  const groups = (await db
    .prepare(`SELECT id, idempotency_key as idempotencyKey, source_type as sourceType, source_id as sourceId, description, basis, reverses_group_id as reversesGroupId, currency, created_at as createdAt FROM ledger_entry_groups ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 100`)
    .all(...params)) as { id: string }[];
  res.json(await Promise.all(groups.map(async (g) => ({ ...g, lines: await groupLines(db, g.id) }))));
});

adminFinanceRouter.get("/ledger/balances", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json({ balanced: await ledgerIsBalanced(), accounts: await balances({ partyType: q.partyType, partyId: q.partyId, basis: q.basis === "estimate" ? "estimate" : q.basis === "actual" ? "actual" : undefined }) });
});

// --- Stage 2d: settlement ---------------------------------------------------------

function handleRule(res: Response, e: unknown) {
  if (e instanceof RuleError) return res.status(e.status).json({ error: e.message });
  throw e;
}

/** Runs (or dry-runs) a weekly settlement: releases completed orders, then
 * creates settlements for payees at or above the minimum payout. */
adminFinanceRouter.post("/settlements/run", async (req, res) => {
  const b = req.body as { runKey?: string; dryRun?: boolean };
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  try {
    const result = await runSettlement({ runKey: String(b.runKey ?? ""), dryRun: b.dryRun !== false, actorId: req.user!.id, reason });
    if (!result.dryRun) await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "settlement.run", objectType: "settlement_run", objectId: String(result.runId), newValue: { runKey: b.runKey, settled: result.settled.length, carried: result.carried.length }, reason });
    res.json(result);
  } catch (e) {
    handleRule(res, e);
  }
});

adminFinanceRouter.get("/settlements", async (_req, res) => {
  res.json(
    await db
      .prepare(`SELECT s.id, r.run_key as runKey, s.party_type as partyType, s.party_id as partyId, s.net_minor as netMinor, s.status, s.transfer_id as transferId, s.created_at as createdAt FROM settlements s JOIN settlement_runs r ON r.id = s.run_id ORDER BY s.id DESC LIMIT 200`)
      .all()
  );
});

adminFinanceRouter.get("/settlements/:id", async (req, res) => {
  const s = await db.prepare(`SELECT * FROM settlements WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: "Settlement not found" });
  const items = await db.prepare(`SELECT ledger_group_id as groupId, description, amount_minor as amountMinor FROM settlement_items WHERE settlement_id = ? ORDER BY id`).all(req.params.id);
  res.json({ settlement: s, items });
});

adminFinanceRouter.post("/disputes/:id/recovery", async (req, res) => {
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  const responsible = (req.body as { responsible?: string }).responsible;
  if (responsible !== "partner" && responsible !== "platform" && responsible !== "venue" && responsible !== "host") return res.status(400).json({ error: "responsible must be partner, venue, host or platform" });
  try {
    const r = await resolveDisputeRecovery({ disputeId: Number(req.params.id), responsible, actorId: req.user!.id, reason });
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "dispute.recovery_decided", objectType: "dispute", objectId: req.params.id, newValue: { responsible, ...r }, reason });
    res.json(r);
  } catch (e) {
    handleRule(res, e);
  }
});

adminFinanceRouter.post("/fees/reconcile", async (_req, res) => {
  try {
    res.json(await reconcilePaymentFees());
  } catch (e) {
    handleRule(res, e);
  }
});

adminFinanceRouter.get("/partners/:kind/:id/balances", async (req, res) => {
  res.json(await partnerBalances({ partyType: req.params.kind, partyId: req.params.id }));
});

// --- Revenue & Connect Stage 5a: Connect accounts, transfers, recovery -------------

function handleConnect(res: Response, e: unknown) {
  if (e instanceof ConnectError) return res.status(e.status).json({ error: e.message });
  throw e;
}

const PARTY_TYPES = ["org", "vendor", "host"];

adminFinanceRouter.get("/connect/accounts", async (_req, res) => {
  const rows = (await db
    .prepare(
      `SELECT party_type as partyType, party_id as partyId, account_id as accountId, country, details_submitted as detailsSubmitted, payouts_enabled as payoutsEnabled,
        transfers_capability as transfersCapability, requirements_due as requirementsDue, disabled_reason as disabledReason, updated_at as updatedAt
       FROM connected_accounts ORDER BY updated_at DESC LIMIT 200`
    )
    .all()) as (Party & Record<string, unknown>)[];
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, readiness: await payoutReadiness(r) }))));
});

adminFinanceRouter.get("/transfers", async (_req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT t.id, t.settlement_id as settlementId, t.attempt, t.party_type as partyType, t.party_id as partyId, t.amount_minor as amountMinor, t.reversed_minor as reversedMinor,
          t.status, t.provider_transfer_id as providerTransferId, t.error, t.created_at as createdAt
         FROM transfers t ORDER BY t.id DESC LIMIT 200`
      )
      .all()
  );
});

adminFinanceRouter.post("/transfers/run", async (req, res) => {
  try {
    const { dryRun, reason, limit } = (req.body ?? {}) as { dryRun?: boolean; reason?: string; limit?: number };
    res.json(await runTransfers({ dryRun: dryRun !== false, actorId: req.user!.id, reason: String(reason ?? ""), limit }));
  } catch (e) {
    handleConnect(res, e);
  }
});

// Stage 5c — partner debts (replace the 5a "recover balance" action).
adminFinanceRouter.get("/debts", async (req, res) => {
  const status = typeof req.query.status === "string" && ["open", "recovered", "offset"].includes(req.query.status) ? req.query.status : undefined;
  res.json(await listDebts(status));
});

adminFinanceRouter.post("/partners/:kind/:id/debts", async (req, res) => {
  if (!PARTY_TYPES.includes(req.params.kind)) return res.status(400).json({ error: "Unknown partner kind" });
  try {
    // Stage 5e — optionally reverse a specific booking's allocation first (e.g. the refunded one).
    const st = typeof req.body?.sourceType === "string" && /^[a-z]{3,20}$/.test(req.body.sourceType) ? req.body.sourceType : null;
    const sr = typeof req.body?.sourceRef === "string" && /^[\w-]{3,191}$/.test(req.body.sourceRef) ? req.body.sourceRef : null;
    res.json(await openPartnerDebt({ partyType: req.params.kind as Party["partyType"], partyId: req.params.id }, { actorId: req.user!.id, reason: String(req.body?.reason ?? ""), prefer: st && sr ? { sourceType: st, sourceRef: sr } : undefined }));
  } catch (e) {
    handleConnect(res, e);
  }
});

adminFinanceRouter.post("/debts/:id/retry", async (req, res) => {
  try {
    res.json(await retryDebtRecovery(Number(req.params.id), { actorId: req.user!.id, reason: String(req.body?.reason ?? "") }));
  } catch (e) {
    handleConnect(res, e);
  }
});

adminFinanceRouter.get("/transfers/:id/allocations", async (req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT a.id, a.kind, a.source_type as sourceType, a.source_ref as sourceRef, a.amount_minor as amountMinor,
           (SELECT COALESCE(SUM(ar.amount_minor), 0) FROM transfer_allocation_reversals ar JOIN transfer_reversals r ON r.id = ar.reversal_id WHERE ar.allocation_id = a.id AND r.status = 'created') as reversedMinor
         FROM transfer_allocations a WHERE a.transfer_id = ? ORDER BY a.id`
      )
      .all(Number(req.params.id))
  );
});

adminFinanceRouter.post("/allocations/:id/reverse", async (req, res) => {
  try {
    res.json(await reverseAllocation(Number(req.params.id), { actorId: req.user!.id, reason: String(req.body?.reason ?? ""), amountMinor: Number(req.body?.amountMinor) }));
  } catch (e) {
    handleConnect(res, e);
  }
});

// --- Revenue & Connect Stage 5b: customer credits, Pro subscriptions ------------------

async function residentIdFrom(body: { residentId?: string; email?: string }): Promise<string | null> {
  if (body.residentId) return body.residentId;
  if (!body.email) return null;
  const r = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).get(String(body.email).trim().toLowerCase())) as { id: string } | undefined;
  return r?.id ?? null;
}

adminFinanceRouter.get("/credits", async (req, res) => {
  const id = await residentIdFrom({ residentId: typeof req.query.residentId === "string" ? req.query.residentId : undefined, email: typeof req.query.email === "string" ? req.query.email : undefined });
  if (!id) return res.status(404).json({ error: "No resident with that email" });
  res.json({ residentId: id, ...(await residentCredits(id)) });
});

adminFinanceRouter.post("/credits", async (req, res) => {
  const b = (req.body ?? {}) as { residentId?: string; email?: string; amountMinor?: number; kind?: string; reason?: string; fundingOwner?: string; expiresAt?: string | null; idempotencyKey?: string };
  const id = await residentIdFrom(b);
  if (!id) return res.status(404).json({ error: "No resident with that email" });
  const kind = b.kind === "promotional" || b.kind === "refund" ? b.kind : "goodwill";
  try {
    res.json(
      await grantCredit({
        residentId: id,
        amountMinor: Number(b.amountMinor),
        kind,
        reason: String(b.reason ?? ""),
        actorId: req.user!.id,
        fundingOwner: b.fundingOwner === "partner" ? "partner" : "helloCircle",
        expiresAt: typeof b.expiresAt === "string" && b.expiresAt ? b.expiresAt : null,
        idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey : null,
      })
    );
  } catch (e) {
    if (e instanceof CreditError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Stage 5f — partner reward points: balances and debts per partner. */
adminFinanceRouter.get("/rewards", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.party_type as partyType, p.party_id as partyId,
         (SELECT COALESCE(SUM(points_remaining), 0) FROM reward_lots l WHERE l.party_type = p.party_type AND l.party_id = p.party_id AND l.expires_at > NOW()) as available,
         (SELECT COALESCE(points_owed, 0) FROM reward_debts d WHERE d.party_type = p.party_type AND d.party_id = p.party_id) as debt,
         (SELECT COALESCE(SUM(points_earned), 0) FROM reward_lots l WHERE l.party_type = p.party_type AND l.party_id = p.party_id) as earned,
         (SELECT COALESCE(SUM(points), 0) FROM reward_redemptions r WHERE r.party_type = p.party_type AND r.party_id = p.party_id) as redeemed
       FROM (SELECT party_type, party_id FROM reward_lots UNION SELECT party_type, party_id FROM reward_debts) p
       ORDER BY available DESC LIMIT 500`
    )
    .all();
  res.json((rows as Record<string, unknown>[]).map((r) => ({ ...r, available: Number(r.available), debt: Number(r.debt ?? 0), earned: Number(r.earned), redeemed: Number(r.redeemed) })));
});

adminFinanceRouter.get("/rewards/:kind/:id/history", async (req, res) => {
  if (!["org", "host", "vendor"].includes(req.params.kind)) return res.status(400).json({ error: "Unknown partner kind" });
  res.json(await rewardHistory({ kind: req.params.kind as "org" | "host" | "vendor", id: req.params.id }, { limit: 200 }));
});

/** Stage 5f — manual points adjustment (reason, idempotency key, audit). */
adminFinanceRouter.post("/rewards/:kind/:id/adjust", async (req, res) => {
  if (!["org", "host"].includes(req.params.kind)) return res.status(400).json({ error: "Points apply to organisations and hosts" });
  const b = (req.body ?? {}) as { points?: number; reason?: string; idempotencyKey?: string };
  try {
    res.json(await adjustPoints({ partner: { kind: req.params.kind as "org" | "host", id: req.params.id }, points: Number(b.points), reason: String(b.reason ?? ""), idempotencyKey: String(b.idempotencyKey ?? ""), actorId: req.user!.id }));
  } catch (e) {
    if (e instanceof RewardError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Stage 5f — coupon usage (redemption ledger). */
adminFinanceRouter.get("/coupons/usage", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT code, COUNT(*) as uses, SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed, SUM(CASE WHEN status IN ('released','reversed') THEN 1 ELSE 0 END) as returned,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN discount_minor ELSE 0 END), 0) as discountMinor,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN platform_funded_minor ELSE 0 END), 0) as platformFundedMinor, MAX(created_at) as lastUsedAt
       FROM coupon_redemptions GROUP BY code ORDER BY lastUsedAt DESC LIMIT 200`
    )
    .all();
  res.json((rows as Record<string, unknown>[]).map((r) => ({ ...r, uses: Number(r.uses), confirmed: Number(r.confirmed), returned: Number(r.returned), discountMinor: Number(r.discountMinor), platformFundedMinor: Number(r.platformFundedMinor) })));
});

/** Stage 5f — customer credit outstanding (liability) and recent grants. */
adminFinanceRouter.get("/credits/summary", async (_req, res) => {
  const total = (await db.prepare(`SELECT COALESCE(SUM(remaining_minor), 0) as s, COUNT(DISTINCT resident_id) as n FROM credit_lots WHERE expires_at > NOW() AND remaining_minor > 0`).get()) as { s: number | string; n: number | string };
  const grants = await db
    .prepare(
      `SELECT l.id, r.email, l.kind, l.amount_minor as amountMinor, l.remaining_minor as remainingMinor, l.currency, l.funding_owner as fundingOwner, l.expires_at as expiresAt, l.created_at as createdAt, l.created_by as createdBy
       FROM credit_lots l LEFT JOIN residents r ON r.id = l.resident_id ORDER BY l.id DESC LIMIT 100`
    )
    .all();
  res.json({ outstandingMinor: Number(total.s), residents: Number(total.n), grants });
});

/** Stage 5f — bank payouts (Stripe → partner's bank), mirrored from payout.* events. */
adminFinanceRouter.get("/payouts", async (_req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT p.provider_payout_id as id, p.account_id as accountId, a.party_type as partyType, a.party_id as partyId, p.amount_minor as amountMinor, p.currency, p.status,
           p.arrival_date as arrivalDate, p.failure_code as failureCode, p.created_at as createdAt
         FROM connected_payouts p LEFT JOIN connected_accounts a ON a.account_id = p.account_id ORDER BY p.created_at DESC LIMIT 200`
      )
      .all()
  );
});

adminFinanceRouter.get("/subscriptions", async (_req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT id, party_type as partyType, party_id as partyId, provider_subscription_id as subscriptionId, status, gross_minor as grossMinor, current_period_end as currentPeriodEnd,
          cancel_at_period_end as cancelAtPeriodEnd, grace_until as graceUntil, created_at as createdAt
         FROM partner_subscriptions WHERE status <> 'abandoned' ORDER BY id DESC LIMIT 200`
      )
      .all()
  );
});

adminFinanceRouter.post("/subscriptions/sweep", async (req, res) => {
  const r = await sweepSubscriptions();
  await writeAudit({ actorUserId: req.user!.id, action: "subscriptions.swept", objectType: "subscriptions", objectId: new Date().toISOString(), newValue: r });
  res.json(r);
});
