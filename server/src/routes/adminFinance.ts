import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { writeAudit } from "../audit.js";
import type { CheckoutType } from "../checkoutService.js";
import { balances, groupLines, ledgerIsBalanced } from "../commerce/ledger.js";
import { NeedsReviewError, RefundError, refundInApp } from "../commerce/payments.js";
import { paymentProvider } from "../payments/provider.js";
import { failEvent, finishEvent, reopenForReplay } from "../payments/webhookEvents.js";
import { processStripeEvent } from "./stripeWebhook.js";

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
  const event = await provider.retrieveEvent(target.eventId);
  if (!event) return res.status(404).json({ error: "The provider no longer has this event" });
  const claim = await db.prepare(`UPDATE webhook_events SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'failed'`).run(Number(req.params.id));
  if (claim.changes !== 1) return res.status(409).json({ error: "This event is already being processed" });
  try {
    const outcome = await processStripeEvent(event);
    await finishEvent(Number(req.params.id), outcome);
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "webhook.replayed", objectType: "webhook_event", objectId: target.eventId, newValue: { outcome }, reason });
    res.json({ ok: true, outcome });
  } catch (e) {
    await failEvent(Number(req.params.id), e, { needsReview: true });
    res.status(e instanceof NeedsReviewError ? 409 : 500).json({ error: e instanceof Error ? e.message : "Replay failed" });
  }
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
