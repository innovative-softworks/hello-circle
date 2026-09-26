// Splits a free-text demand phrase ("badminton sunday morning") into the
// activity itself and when the person wants it, so IntentCaptureForm files
// "Badminton" + "Sunday morning" rather than a one-off "badminton sunday
// morning" cluster that never meets the plain "badminton" one. Deliberately
// just word-stripping — proper category normalisation is Release 6.

const DAY_WORDS: Record<string, string> = {
  monday: "Monday", mondays: "Monday",
  tuesday: "Tuesday", tuesdays: "Tuesday",
  wednesday: "Wednesday", wednesdays: "Wednesday",
  thursday: "Thursday", thursdays: "Thursday",
  friday: "Friday", fridays: "Friday",
  saturday: "Saturday", saturdays: "Saturday",
  sunday: "Sunday", sundays: "Sunday",
  weekend: "Weekend", weekends: "Weekend",
  weekday: "Weekday", weekdays: "Weekday",
};

const TIME_WORDS: Record<string, string> = {
  morning: "morning", mornings: "morning",
  afternoon: "afternoon", afternoons: "afternoon",
  evening: "evening", evenings: "evening",
  tonight: "evening", night: "evening", nights: "evening",
};

// Relative dates mean nothing a week later, when the request is still
// open — dropped rather than kept as timing.
const RELATIVE_DAY_WORDS = new Set(["today", "tomorrow"]);

// Connectors left dangling once the day/time words are gone ("yoga on
// sunday" → "yoga on"). Only trimmed from the ends, never the middle, so
// a real name like "walk in the park" survives.
const CONNECTORS = new Set(["on", "in", "the", "at", "this", "next", "every", "a", "an", "for"]);

export interface DemandQuery {
  /** The activity with day/time words removed, first letter capitalised. "" if nothing is left. */
  activityLabel: string;
  /** e.g. "Sunday morning", "Weekend", "evening" — "" if none was mentioned. */
  timeWindow: string;
  /** Release 6 — the same, structured: day codes ("sun", "weekend") and slot. */
  days: string[];
  time: string;
}

const DAY_CODE: Record<string, string> = { Monday: "mon", Tuesday: "tue", Wednesday: "wed", Thursday: "thu", Friday: "fri", Saturday: "sat", Sunday: "sun", Weekend: "weekend", Weekday: "weekday" };

export function splitDemandQuery(text: string, timeOfDay?: string | null): DemandQuery {
  const days: string[] = [];
  let time = timeOfDay ? TIME_WORDS[timeOfDay.toLowerCase()] ?? "" : "";
  const kept: string[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const key = word.toLowerCase().replace(/[^a-z]/g, "");
    if (RELATIVE_DAY_WORDS.has(key)) {
      continue;
    } else if (DAY_WORDS[key]) {
      if (!days.includes(DAY_WORDS[key])) days.push(DAY_WORDS[key]);
    } else if (TIME_WORDS[key]) {
      time = time || TIME_WORDS[key];
    } else {
      kept.push(word);
    }
  }
  while (kept.length && CONNECTORS.has(kept[0].toLowerCase())) kept.shift();
  while (kept.length && CONNECTORS.has(kept[kept.length - 1].toLowerCase())) kept.pop();

  const label = kept.join(" ");
  const dayPart = days.join(" or ");
  return {
    activityLabel: label ? label[0].toUpperCase() + label.slice(1) : "",
    timeWindow: dayPart && time ? `${dayPart} ${time}` : dayPart || time,
    days: days.map((d) => DAY_CODE[d]).filter(Boolean),
    time,
  };
}
