import { logEvent } from "./analytics.js";
import { db } from "./db/index.js";
import { notifyResident } from "./notifications.js";

// ParticipationIntent matching (participation-intent plan Phase 1) —
// trigger-based, same idiom as searchAlerts.ts: matched at the moment a new
// Game is created, not a periodic scan (this app has no cron/job-queue
// infrastructure anywhere).

/** Resident-backed active intents needed for the same activity+county
 * before "enough people are interested" fires — a hardcoded v1 constant,
 * not admin-configurable. */
const NOTIFY_THRESHOLD = 3;

interface MatchGame {
  id: string;
  activityLabel: string;
  centreId: string | null;
  date: string;
}

/** Called right after a new Game commits (see routes/games.ts's POST /,
 * alongside matchSearchAlertsForGame) — flips any active intent this new
 * game satisfies to 'converted' and lets its resident-backed owner know.
 * Anonymous (client_id-only) intents still convert, they just can't be
 * notified. Never throws — a failed match/notify must not fail game
 * creation, same contract as every other matchX helper in this app. */
export async function matchParticipationIntentsForGame(game: MatchGame) {
  try {
    let county: string | null = null;
    if (game.centreId) {
      const centre = (await db.prepare(`SELECT county FROM centres WHERE id = ?`).get(game.centreId)) as { county: string } | undefined;
      county = centre?.county ?? null;
    }
    // A free-location game has no county to match a county-scoped intent against.
    if (!county) return;

    const label = game.activityLabel.toLowerCase();
    const intents = (await db
      .prepare(
        `SELECT id, resident_id as residentId, activity_label as activityLabel FROM participation_intents
         WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) AND county = ?`
      )
      .all(county)) as { id: string; residentId: string | null; activityLabel: string }[];

    for (const intent of intents) {
      const intentLabel = intent.activityLabel.toLowerCase();
      if (!label.includes(intentLabel) && !intentLabel.includes(label)) continue;

      const info = await db.prepare(`UPDATE participation_intents SET status = 'converted' WHERE id = ? AND status = 'active'`).run(intent.id);
      if (info.changes === 0) continue; // already matched by a concurrent game

      if (intent.residentId) {
        await notifyResident({
          residentId: intent.residentId,
          kind: "intent_match",
          title: "A session matching your interest was just created",
          body: `${game.activityLabel} — ${game.date}`,
          listingType: "game",
          listingId: game.id,
          ref: game.id,
        });
        void logEvent("match_notified", { residentId: intent.residentId, metadata: { intentId: intent.id, gameId: game.id } });
      }
    }
  } catch (e) {
    console.error("[participation-intents] game match failed:", e);
  }
}

/** Called from routes/participationIntents.ts's POST / right after a new
 * intent is upserted — checks whether this activity+county cluster just
 * crossed NOTIFY_THRESHOLD resident-backed active intents, and if so
 * notifies every resident-backed intent in it exactly once. The
 * intent_cluster_notifications row (INSERT ... ON DUPLICATE KEY UPDATE,
 * checked via the standard MySQL affectedRows idiom — 1 on first insert, 0
 * on a no-op duplicate) is what stops a burst of near-simultaneous
 * submissions from double-firing this. Never throws. */
export async function notifyIntentClusterIfThreshold(activityLabel: string, county: string) {
  try {
    const { n } = (await db
      .prepare(
        `SELECT COUNT(*) as n FROM participation_intents
         WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
           AND activity_label = ? AND county = ? AND resident_id IS NOT NULL`
      )
      .get(activityLabel, county)) as { n: number };
    if (n < NOTIFY_THRESHOLD) return;

    // INSERT IGNORE, not ON DUPLICATE KEY UPDATE — verified directly against
    // this app's mysql2 pool that a self-referencing
    // `ON DUPLICATE KEY UPDATE col = col` no-op still reports affectedRows=1
    // here (not the 0 the MySQL docs describe for the plain CLI/text
    // protocol), which silently defeated this guard. INSERT IGNORE has no
    // such ambiguity: 1 only on a genuine first insert, 0 on any duplicate.
    const info = await db.prepare(`INSERT IGNORE INTO intent_cluster_notifications (activity_label, county) VALUES (?, ?)`).run(activityLabel, county);
    if (info.changes !== 1) return; // already notified for this cluster before

    const rows = (await db
      .prepare(
        `SELECT resident_id as residentId FROM participation_intents
         WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
           AND activity_label = ? AND county = ? AND resident_id IS NOT NULL`
      )
      .all(activityLabel, county)) as { residentId: string }[];

    const ref = `${activityLabel}::${county}`;
    for (const row of rows) {
      await notifyResident({
        residentId: row.residentId,
        kind: "intent_match",
        title: `Enough people are interested in ${activityLabel}`,
        body: `${n} people${county ? ` near ${county}` : ""} want to do this — want to start a plan?`,
        listingType: "intent",
        listingId: ref,
        ref,
      });
    }
  } catch (e) {
    console.error("[participation-intents] cluster notify failed:", e);
  }
}
