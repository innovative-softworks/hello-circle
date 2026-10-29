import { endOfIrelandDay, irelandWallTimeToUtc } from "./irelandTime.js";

// Trust & Retention — "Your next plan" rules (docs/trust-retention/06-*).
// Pure, so ordering, phases and day boundaries are tested without a database.
//
// Times: an occurrence's `date` + `time` are Ireland wall-clock (the app's
// convention); they become a UTC instant via irelandWallTimeToUtc, DST-aware.
// End = start + duration when the duration is known; otherwise the end of
// that Ireland day (we never claim an activity is over earlier than we know).

export type PlanStatus =
  | "confirmed" // a paid/free place that's yours
  | "rsvp" // a free Circle meetup you said you're going to (no booking)
  | "pending_payment" // checkout started, place held, not paid yet
  | "pending_approval" // asked to join, waiting for the host
  | "waitlist" // on the waitlist — not a place
  | "interest" // said you're interested in a Circle plan — not a place
  | "cancelled";

export type PlanPhase = "before" | "today" | "after";

/** Statuses that are a commitment of the person's time (can be "your next plan"). */
export const COMMITMENT: readonly PlanStatus[] = ["confirmed", "rsvp", "pending_payment", "pending_approval"];

export const STATUS_LABEL: Record<PlanStatus, string> = {
  confirmed: "Booked",
  rsvp: "Going · Circle meetup",
  pending_payment: "Payment not finished",
  pending_approval: "Waiting for the host to accept",
  waitlist: "On the waitlist — not a place yet",
  interest: "Interested — not a booking",
  cancelled: "Cancelled",
};

export interface PlanTiming {
  start: Date;
  end: Date;
  durationKnown: boolean;
}

export function planTiming(date: string, time: string | null | undefined, durationMinutes: number | null | undefined): PlanTiming {
  const [h, m] = (time || "00:00").split(":").map((n) => Number(n) || 0);
  const start = irelandWallTimeToUtc(date.slice(0, 10), h, m);
  const known = !!durationMinutes && durationMinutes > 0;
  const end = known ? new Date(start.getTime() + durationMinutes! * 60000) : endOfIrelandDay(date.slice(0, 10));
  return { start, end, durationKnown: known };
}

/** Ireland calendar date of an instant. */
export function irelandDateOf(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function planPhase(date: string, timing: PlanTiming, now: Date): PlanPhase {
  if (now.getTime() >= timing.end.getTime()) return "after";
  return irelandDateOf(now) >= date.slice(0, 10) ? "today" : "before";
}

export interface PlanLike {
  status: PlanStatus;
  date: string;
  timing: PlanTiming;
}

/**
 * Splits plans into: the next commitment (nearest not-yet-ended commitment),
 * the other upcoming items (commitments, waitlists and interests — each with
 * its own label, never shown as a place), and recent finished commitments
 * (ended within `recentDays`, newest first) so a visit doesn't vanish before
 * its attendance and review state can be seen. Cancelled plans whose date
 * hasn't passed stay visible in `upcoming` with their real status.
 */
export function arrangePlans<T extends PlanLike>(plans: T[], now: Date, recentDays = 14): { next: T | null; upcoming: T[]; recent: T[] } {
  const byStart = (a: T, b: T) => a.timing.start.getTime() - b.timing.start.getTime();
  const live = plans.filter((p) => p.timing.end.getTime() > now.getTime()).sort(byStart);
  const next = live.find((p) => COMMITMENT.includes(p.status)) ?? null;
  const upcoming = live.filter((p) => p !== next);
  const cutoff = now.getTime() - recentDays * 86400000;
  const recent = plans
    .filter((p) => (p.status === "confirmed" || p.status === "rsvp") && p.timing.end.getTime() <= now.getTime() && p.timing.end.getTime() >= cutoff)
    .sort((a, b) => b.timing.start.getTime() - a.timing.start.getTime());
  return { next, upcoming, recent };
}
