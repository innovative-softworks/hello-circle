import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { notifyResident, residentAllows } from "./notifications.js";
import { CLIENT_URL } from "./stripe.js";

const OFFER_WINDOW_HOURS = 48;

interface WaitlistRow {
  id: number;
  resident_id: string | null;
  name: string;
  email: string;
}

/** Promotes the earliest still-waiting entry to a time-limited 'offered'
 * state and lets them know — called whenever a paid slot frees up (a club
 * registration cancellation, a game participant leaving). Deliberately
 * doesn't auto-confirm a booking on their behalf: they still have to come
 * back and register/join within the window, same as anyone else, just with
 * a held spot. Never throws — a failed promotion shouldn't fail the
 * cancellation/leave that triggered it. */
export async function promoteNextWaitlistEntry(listingType: "club" | "game", listingId: string, listingName: string) {
  try {
    const next = (await db
      .prepare(
        `SELECT id, resident_id, name, email FROM waitlist_entries
         WHERE listing_type = ? AND listing_id = ? AND status = 'waiting' ORDER BY id LIMIT 1`
      )
      .get(listingType, listingId)) as WaitlistRow | undefined;
    if (!next) return;

    await db
      .prepare(`UPDATE waitlist_entries SET status = 'offered', offer_expires_at = DATE_ADD(NOW(), INTERVAL ${OFFER_WINDOW_HOURS} HOUR) WHERE id = ?`)
      .run(next.id);

    if (next.resident_id) {
      await notifyResident({
        residentId: next.resident_id,
        kind: "waitlist",
        title: `A spot opened up: ${listingName}`,
        body: `You have ${OFFER_WINDOW_HOURS}h to claim it before it's offered to the next person on the list.`,
        listingType,
        listingId,
        ref: String(next.id),
      });
    }
    // A pure guest (no resident_id) has no other way to hear about this, so
    // always email them. A signed-in resident's own waitlistOffers
    // preference gates the email the same way it gates the in-app copy
    // above — respecting an explicit opt-out even for a time-sensitive
    // notice, since the pref exists specifically for this category.
    if (next.email && (!next.resident_id || (await residentAllows(next.resident_id, "waitlistOffers")))) {
      await sendMail({
        to: next.email,
        subject: `A spot opened up — ${listingName}`,
        text: `Hi${next.name ? ` ${next.name}` : ""},\n\nA spot just opened up for ${listingName}. You have ${OFFER_WINDOW_HOURS} hours to claim it before it's offered to the next person on the waitlist.\n\n${CLIENT_URL}\n\nThanks for using Hello Circle.`,
      });
    }
  } catch (e) {
    console.error("[waitlist] promotion failed:", e);
  }
}

interface ExpiredOfferRow {
  id: number;
  listing_type: "club" | "game";
  listing_id: string;
}

/** Sweeps every 'offered' entry whose 48h window has passed: marks it
 * 'expired' and promotes the next waiting entry in its place, so an
 * unclaimed offer doesn't just sit there forever blocking the list. No
 * cron infrastructure exists in this app (see rateLimit.ts's identical
 * single-instance/in-memory rationale) — a periodic in-process sweep is
 * the simplest thing that works at current scale; see index.ts for the
 * interval that calls this. */
export async function sweepExpiredWaitlistOffers() {
  try {
    const expired = (await db
      .prepare(`SELECT id, listing_type, listing_id FROM waitlist_entries WHERE status = 'offered' AND offer_expires_at < NOW()`)
      .all()) as ExpiredOfferRow[];
    for (const row of expired) {
      await db.prepare(`UPDATE waitlist_entries SET status = 'expired' WHERE id = ?`).run(row.id);
      const listingName =
        row.listing_type === "club"
          ? ((await db.prepare(`SELECT name FROM clubs WHERE id = ?`).get(row.listing_id)) as { name: string } | undefined)?.name
          : ((await db.prepare(`SELECT activity_label as name FROM games WHERE id = ?`).get(row.listing_id)) as { name: string } | undefined)?.name;
      if (listingName) await promoteNextWaitlistEntry(row.listing_type, row.listing_id, listingName);
    }
    if (expired.length > 0) console.log(`[waitlist] swept ${expired.length} expired offer(s)`);
  } catch (e) {
    console.error("[waitlist] sweep failed:", e);
  }
}
