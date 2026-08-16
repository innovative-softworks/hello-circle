import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { notifyResident } from "./notifications.js";
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
    if (next.email) {
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
