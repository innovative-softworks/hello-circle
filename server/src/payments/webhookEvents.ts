// Revenue & Connect Stage 2c — webhook event store (brief §11).
//
// Every verified event is stored once (unique provider + event id) with a
// minimal, non-sensitive summary — never the full payload, never card or
// personal data. Processing is claimed atomically (received/failed →
// processing), so two deliveries of the same event can't both run it. A
// failure is retried by the provider; after MAX_ATTEMPTS the event parks in
// "manual_review" for a finance admin, who can replay it (the replay
// re-fetches the event from the provider rather than trusting a stored copy).

import crypto from "node:crypto";
import { db } from "../db/index.js";

export const MAX_ATTEMPTS = 5;

export type WebhookStatus = "received" | "processing" | "processed" | "ignored" | "failed" | "manual_review";

/** A provider-agnostic view of an incoming event. */
export interface IncomingEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string | null;
  data: { object: Record<string, any> };
}

/** The only fields kept: identifiers, amounts, statuses and our own metadata. */
export function summarize(event: IncomingEvent): Record<string, unknown> {
  const o = event.data?.object ?? {};
  const pick = (k: string) => (o[k] === undefined || o[k] === null ? undefined : o[k]);
  return {
    object: pick("object"),
    id: pick("id"),
    amount: pick("amount") ?? pick("amount_total"),
    amount_refunded: pick("amount_refunded"),
    currency: pick("currency"),
    status: pick("status"),
    payment_status: pick("payment_status"),
    payment_intent: typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id,
    charge: typeof o.charge === "string" ? o.charge : o.charge?.id,
    reason: pick("reason"),
    metadata: o.metadata ? { type: o.metadata.type, ref: o.metadata.ref } : undefined,
  };
}

export type BeginResult = { action: "process"; rowId: number } | { action: "duplicate"; status: WebhookStatus } | { action: "busy" };

/** Stores the event (first delivery) and tries to claim it for processing. */
export async function beginEvent(provider: string, event: IncomingEvent, rawBody: Buffer | string): Promise<BeginResult> {
  const summary = summarize(event);
  const sha = crypto.createHash("sha256").update(rawBody).digest("hex");
  await db
    .prepare(
      `INSERT IGNORE INTO webhook_events (provider, event_id, event_type, connected_account, livemode, object_id, summary, payload_sha256, status, provider_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`
    )
    .run(provider, event.id, event.type, event.account ?? null, event.livemode ? 1 : 0, (summary.id as string | undefined) ?? null, JSON.stringify(summary), sha, event.created ? new Date(event.created * 1000).toISOString().slice(0, 19).replace("T", " ") : null);
  const claimed = await db
    .prepare(`UPDATE webhook_events SET status = 'processing', attempts = attempts + 1 WHERE provider = ? AND event_id = ? AND status IN ('received', 'failed')`)
    .run(provider, event.id);
  const row = (await db.prepare(`SELECT id, status FROM webhook_events WHERE provider = ? AND event_id = ?`).get(provider, event.id)) as { id: number; status: WebhookStatus };
  if (claimed.changes === 1) return { action: "process", rowId: row.id };
  if (row.status === "processing") return { action: "busy" };
  return { action: "duplicate", status: row.status };
}

export async function finishEvent(rowId: number, status: "processed" | "ignored") {
  await db.prepare(`UPDATE webhook_events SET status = ?, processed_at = NOW(), last_error = NULL WHERE id = ?`).run(status, rowId);
}

/** Records a failure. Returns true when the provider should retry. */
export async function failEvent(rowId: number, error: unknown, opts: { needsReview?: boolean } = {}): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const row = (await db.prepare(`SELECT attempts FROM webhook_events WHERE id = ?`).get(rowId)) as { attempts: number };
  const review = opts.needsReview || Number(row.attempts) >= MAX_ATTEMPTS;
  await db.prepare(`UPDATE webhook_events SET status = ?, last_error = ? WHERE id = ?`).run(review ? "manual_review" : "failed", message, rowId);
  return !review;
}

/** Lets an admin replay an event that failed or is parked for review. */
export async function reopenForReplay(rowId: number): Promise<{ provider: string; eventId: string } | null> {
  const row = (await db.prepare(`SELECT provider, event_id as eventId, status FROM webhook_events WHERE id = ?`).get(rowId)) as { provider: string; eventId: string; status: WebhookStatus } | undefined;
  if (!row || !["failed", "manual_review"].includes(row.status)) return null;
  await db.prepare(`UPDATE webhook_events SET status = 'failed' WHERE id = ?`).run(rowId);
  return { provider: row.provider, eventId: row.eventId };
}
