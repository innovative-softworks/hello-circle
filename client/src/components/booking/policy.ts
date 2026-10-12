// Booking kit — cancellation wording from server-provided facts (the
// booking quote's cancelDeadline, a My Life row's cancelDeadline/canCancel).
// Never computes a deadline itself: the server owns the rule (selfCancel.ts).

const DUBLIN = "Europe/Dublin";

/** "Thu 22 Oct, 17:00" — the instant shown in Irish time, whatever the
 * device's own timezone. */
export function formatIrishDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: DUBLIN,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

export interface PolicyCopy {
  headline: string;
  detail: string | null;
}

export function cancellationCopy(input: { cancelDeadline?: string | null; depositCents?: number; now?: number; contact?: "venue" | "host" | "organiser" | "club" }): PolicyCopy {
  const contact = input.contact ?? "venue";
  const deposit = input.depositCents && input.depositCents > 0 ? `Your €${(input.depositCents / 100).toFixed(0)} deposit is returned by the ${contact} after the event.` : null;
  if (!input.cancelDeadline) {
    return { headline: "Cancel any time from My Life", detail: deposit };
  }
  const now = input.now ?? Date.now();
  if (new Date(input.cancelDeadline).getTime() <= now) {
    return { headline: "Online cancellation has closed", detail: [`Contact the ${contact} to change this booking.`, deposit].filter(Boolean).join(" ") };
  }
  return {
    headline: `Free cancellation until ${formatIrishDateTime(input.cancelDeadline)}`,
    detail: [`After that, contact the ${contact}.`, deposit].filter(Boolean).join(" "),
  };
}
