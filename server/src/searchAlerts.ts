import { db } from "./db/index.js";
import { notifyResident } from "./notifications.js";
import { MOOD_KEYWORDS } from "./routes/discover.js";

// Saved-search alerts (master-prompt punch list #5) — trigger-based
// matching at the moment a new Game is created (see games.ts's POST /),
// not a periodic scan (see search_alerts's schema comment in db/index.ts
// for why: this app has no cron/job-queue infrastructure anywhere).

interface AlertMatchGame {
  id: string;
  activityLabel: string;
  hostResidentId: string;
  centreId: string | null;
  date: string;
  time: string;
}

/** Notifies every resident whose active saved search matches this new game.
 * Never throws — a failed match/notify must not fail game creation, same
 * contract as every other notifyX helper in this app. */
export async function matchSearchAlertsForGame(game: AlertMatchGame) {
  try {
    const alerts = (await db
      .prepare(`SELECT id, resident_id as residentId, county, keywords, mood FROM search_alerts WHERE active = 1 AND resident_id != ?`)
      .all(game.hostResidentId)) as { id: string; residentId: string; county: string; keywords: string | null; mood: string | null }[];
    if (alerts.length === 0) return;

    let gameCounty: string | null = null;
    if (game.centreId) {
      const centre = (await db.prepare(`SELECT county FROM centres WHERE id = ?`).get(game.centreId)) as { county: string } | undefined;
      gameCounty = centre?.county ?? null;
    }

    const label = game.activityLabel.toLowerCase();
    for (const alert of alerts) {
      if (alert.county && alert.county !== gameCounty) continue;
      if (alert.keywords) {
        const kws = alert.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (kws.length && !kws.some((k) => label.includes(k))) continue;
      }
      if (alert.mood) {
        const kws = MOOD_KEYWORDS[alert.mood] ?? [];
        if (!kws.some((k) => label.includes(k))) continue;
      }
      await notifyResident({
        residentId: alert.residentId,
        kind: "game",
        title: "New game matching your saved search",
        body: `${game.activityLabel} — ${game.date} at ${game.time}`,
        listingType: "game",
        listingId: game.id,
        ref: game.id,
      });
    }
  } catch (e) {
    console.error("[search-alerts] match failed:", e);
  }
}
