import { db } from "./db/index.js";
import { notifyResident } from "./notifications.js";
import { resolvePlanListing, type PlanListingType } from "./circlePlanListings.js";
import { irelandTodayIso } from "./irelandTime.js";

// Circles 3.0 — when a provider cancels or removes a listing that open
// Circle plans point at, the members who said "I'm in" and the Circle's
// organisers are told, once per plan (plan row `listing_notice_at`, set
// conditionally). The plan itself stays as it is — its card already reads
// the listing live as cancelled — and nothing is booked or refunded here:
// people with real bookings hear about those from the booking's own flow.

/** With `sessionId`: only plans for that departure/session (a plan for the
 * listing as a whole still has other dates). Without: every open plan. */
export async function noticeListingCancelled(type: PlanListingType, listingId: string, opts: { sessionId?: string | null; title: string; what?: string }): Promise<number> {
  const plans = (await db
    .prepare(
      `SELECT p.id, p.circle_id as circleId, c.name as circleName FROM circle_plans p JOIN circles c ON c.id = p.circle_id
       WHERE p.listing_type = ? AND p.listing_id = ? AND p.status IN ('idea', 'confirmed') AND p.listing_notice_at IS NULL
         ${opts.sessionId ? "AND p.listing_session_id = ?" : ""}`
    )
    .all(...(opts.sessionId ? [type, listingId, opts.sessionId] : [type, listingId]))) as { id: string; circleId: string; circleName: string }[];
  let sent = 0;
  for (const plan of plans) {
    const claimed = await db.prepare(`UPDATE circle_plans SET listing_notice_at = NOW() WHERE id = ? AND listing_notice_at IS NULL`).run(plan.id);
    if (claimed.changes !== 1) continue;
    const people = (await db
      .prepare(
        `SELECT resident_id as id FROM circle_plan_interest WHERE plan_id = ?
         UNION SELECT resident_id as id FROM circle_members WHERE role = 'organiser' AND circle_id IN (?, COALESCE((SELECT partner_circle_id FROM circle_plans WHERE id = ?), ''))`
      )
      .all(plan.id, plan.circleId, plan.id)) as { id: string }[];
    for (const p of people) {
      await notifyResident({
        residentId: p.id,
        kind: "circle",
        title: `${opts.title} was cancelled`,
        body: `${plan.circleName}: the provider cancelled ${opts.what ?? "it"}, so this plan can't go ahead as suggested. Nothing was booked through the plan.`,
        listingType: "circle",
        listingId: plan.circleId,
        ref: plan.id,
      });
      sent += 1;
    }
  }
  return sent;
}

/** "YYYY-MM-DD" plus `days`, as plain calendar maths. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Circles 3.0 — the day before a dated plan, everyone who said "I'm in"
 * gets one reminder (plan row `reminder_sent_at`, claimed conditionally, so
 * a restart or a second server can't send it twice). For a plan about a
 * listing it says plainly whether *you* are booked; a cancelled or gone
 * listing gets no reminder (its cancellation notice already went out).
 * Respects each resident's notification settings via notifyResident. */
export async function sweepCirclePlanReminders(today = irelandTodayIso()): Promise<number> {
  const tomorrow = addDaysIso(today, 1);
  const plans = (await db
    .prepare(
      `SELECT p.id, p.circle_id as circleId, p.title, p.proposed_time as time, p.listing_type as listingType, p.listing_id as listingId, p.listing_session_id as sessionId, c.name as circleName
       FROM circle_plans p JOIN circles c ON c.id = p.circle_id AND c.status = 'active'
       WHERE p.proposed_date = ? AND p.status IN ('idea', 'confirmed') AND p.reminder_sent_at IS NULL`
    )
    .all(tomorrow)) as { id: string; circleId: string; title: string; time: string; listingType: string | null; listingId: string | null; sessionId: string | null; circleName: string }[];
  let sent = 0;
  for (const plan of plans) {
    const claimed = await db.prepare(`UPDATE circle_plans SET reminder_sent_at = NOW() WHERE id = ? AND reminder_sent_at IS NULL`).run(plan.id);
    if (claimed.changes !== 1) continue;
    const ref = plan.listingType && plan.listingId ? { type: plan.listingType as PlanListingType, id: plan.listingId, sessionId: plan.sessionId } : null;
    if (ref) {
      const listing = await resolvePlanListing(ref, null);
      if (listing.availability === "cancelled" || listing.availability === "unavailable" || listing.availability === "past") continue;
    }
    const people = (await db
      .prepare(
        `SELECT DISTINCT i.resident_id as id FROM circle_plan_interest i
         JOIN circle_plans p ON p.id = i.plan_id
         JOIN circle_members m ON m.resident_id = i.resident_id AND (m.circle_id = p.circle_id OR m.circle_id = p.partner_circle_id)
         WHERE i.plan_id = ?`
      )
      .all(plan.id)) as { id: string }[];
    for (const p of people) {
      let body: string;
      if (ref) {
        const mine = await resolvePlanListing(ref, p.id);
        body = mine.myState === "booked" ? `With ${plan.circleName}. You're booked — see you there.` : `With ${plan.circleName}. You said you're in, but it isn't booked yet. Book on its page if you're going.`;
      } else {
        body = `With ${plan.circleName}. It's still a plan, so check the Circle for the latest.`;
      }
      await notifyResident({
        residentId: p.id,
        kind: "circle",
        title: `Tomorrow${plan.time ? ` at ${plan.time}` : ""}: ${plan.title}`,
        body,
        listingType: "circle",
        listingId: plan.circleId,
        ref: plan.id,
      });
      sent += 1;
    }
  }
  return sent;
}
