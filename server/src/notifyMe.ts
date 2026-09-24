import crypto from "node:crypto";
import { db } from "./db/index.js";
import { notifyResident } from "./notifications.js";

// Universal Publishing, Lifecycle & Availability System, Phase L — "Notify
// me" for a Coming Soon entity. Per the brief's own §37 instruction to
// audit existing follow/save/alert infrastructure before adding a table:
// `follows` (server/src/routes/follows.ts) is account-level (vendor/host/
// centre), not per-listing; `favourites` has no notification semantics at
// all; `waitlist_entries` is transaction-scoped (has offer_expires_at, is
// really "you're in line for a spot," not "tell me when this opens"). None
// of the three fit "notify me when this specific Coming Soon listing
// opens," so this is a real, minimal, new table — polymorphic
// (entity_type/entity_id) so Programs/Experiences/Centres/Clubs/Circles can
// reuse it unchanged in later phases, same pattern as `favourites`/
// `waitlist_entries` already use for the same reason.

export type NotifyMeEntityType = "game" | "program" | "experience" | "centre" | "club" | "circle";

/** Idempotent subscribe — INSERT IGNORE + a `.changes` check, the exact
 * idiom `participationIntents.ts` already established (and documented,
 * after a real bug: `ON DUPLICATE KEY UPDATE col = col` reports
 * `changes = 1` even on a no-op update, silently defeating a naive
 * duplicate-notification guard — INSERT IGNORE has no such trap). Returns
 * whether this call actually created a new subscription (false = the
 * resident was already subscribed — the UI should treat that as success,
 * not an error, per §82's "duplicate subscribe" test case). */
export async function subscribeNotifyMe(residentId: string, entityType: NotifyMeEntityType, entityId: string): Promise<boolean> {
  const info = await db
    .prepare(`INSERT IGNORE INTO notify_me_subscriptions (id, resident_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
    .run(crypto.randomUUID(), residentId, entityType, entityId);
  return info.changes === 1;
}

export async function unsubscribeNotifyMe(residentId: string, entityType: NotifyMeEntityType, entityId: string): Promise<void> {
  await db.prepare(`DELETE FROM notify_me_subscriptions WHERE resident_id = ? AND entity_type = ? AND entity_id = ?`).run(residentId, entityType, entityId);
}

export async function isSubscribedToNotifyMe(residentId: string, entityType: NotifyMeEntityType, entityId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM notify_me_subscriptions WHERE resident_id = ? AND entity_type = ? AND entity_id = ?`).get(residentId, entityType, entityId);
  return !!row;
}

/** §39-40 — fires once per subscriber per genuine "Coming Soon → Open"
 * transition. Only ever targets rows where `notified_at IS NULL`, and marks
 * them notified in the same call, so a later Open → Paused → Open cycle
 * never re-sends the original "bookings are open" message to the same
 * subscription row (exactly the brief's own explicit non-duplication
 * requirement) — a resident who wants to be told about the *next* opening
 * too would need a fresh subscribe, which this module already supports
 * (subscribeNotifyMe on an already-notified row's id is impossible today
 * since there's no unsubscribe-then-resubscribe UI yet in this phase; the
 * data model supports it whenever that's built). Never throws — a
 * notification failure must not fail the lifecycle transition that
 * triggered it. */
export async function notifyGameNotifyMeSubscribers(gameId: string): Promise<void> {
  try {
    const rows = (await db
      .prepare(`SELECT resident_id as residentId FROM notify_me_subscriptions WHERE entity_type = 'game' AND entity_id = ? AND notified_at IS NULL`)
      .all(gameId)) as { residentId: string }[];
    if (rows.length === 0) return;
    const game = (await db.prepare(`SELECT activity_label as activityLabel, date, time FROM games WHERE id = ?`).get(gameId)) as
      | { activityLabel: string; date: string; time: string }
      | undefined;
    if (!game) return;
    for (const r of rows) {
      await notifyResident({
        residentId: r.residentId,
        kind: "game",
        title: "Bookings are now open",
        body: `${game.activityLabel} is ready to book — ${game.date} at ${game.time}.`,
        listingType: "game",
        listingId: gameId,
        ref: gameId,
      });
    }
    await db.prepare(`UPDATE notify_me_subscriptions SET notified_at = NOW() WHERE entity_type = 'game' AND entity_id = ? AND notified_at IS NULL`).run(gameId);
  } catch (e) {
    console.error("[notifyMe] notifyGameNotifyMeSubscribers failed:", e);
  }
}
