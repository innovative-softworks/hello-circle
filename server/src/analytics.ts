import { db } from "./db/index.js";

// Minimal first-party funnel logging (post-audit hardening pass) — see
// analytics_events' own schema comment in db/index.ts for why this exists
// and why it doesn't contradict the app's "no analytics, no tracking"
// consumer-facing privacy commitment (no third-party tracker, no new
// per-viewer identity beyond resident/client id, aggregate reads only via
// the admin funnel rollup in routes/admin.ts).

export type AnalyticsEventType =
  | "search_performed"
  | "intent_created"
  | "match_notified"
  | "match_viewed"
  | "game_joined"
  | "circle_joined"
  | "circle_join_requested"
  | "attended"
  | "repeat_joined"
  // Universal Sharing & Invitation system — client-only events (no natural
  // server mutation to hang them off) come through POST /api/share/event's
  // small allowlist (see routes/sharing.ts); the rest are logged directly
  // at the point they actually happen (invite created/responded-to in
  // routes/invitations.ts, a shared link's landing in referrals.ts's
  // existing /land, which already covers shared_link_opened's job).
  | "share_opened"
  | "share_channel_selected"
  | "share_completed"
  | "share_link_copied"
  | "share_to_circle"
  | "invite_created"
  | "invite_opened"
  | "invite_accepted"
  | "invite_maybe"
  | "invite_declined";

const insertEvent = db.prepare(
  `INSERT INTO analytics_events (event_type, resident_id, client_id, metadata) VALUES (@eventType, @residentId, @clientId, @metadata)`
);

/** Fire-and-forget, never throws — mirrors notifications.ts's wrapper style
 * so a logging failure can never break the caller's own request/transaction. */
export async function logEvent(
  eventType: AnalyticsEventType,
  opts: { residentId?: string | null; clientId?: string | null; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    await insertEvent.run({
      eventType,
      residentId: opts.residentId ?? null,
      clientId: opts.clientId ?? null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    });
  } catch (err) {
    console.error("[analytics] logEvent failed:", eventType, err);
  }
}
