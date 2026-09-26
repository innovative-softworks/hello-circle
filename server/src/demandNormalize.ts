// Mirrors db/queries.ts's MARKET_CATEGORIES (kept local on purpose:
// db/index.ts's schema backfill imports this file, and importing
// db/queries.ts from here would make that a circular import).
const MARKET_CATEGORIES = ["Badminton", "Football", "Swimming", "Fitness", "Yoga", "Walking", "Kids activities", "Arts", "Learning", "Community events", "Outdoor", "Wellbeing"];

// Community-request clustering (community participation upgrade, Release 6)
// — turns free text into a stable cluster key so "badminton", "Badminton
// Sunday", "Sunday badminton" and "social badminton sunday morning" all
// count toward the same demand, with the day/time pulled out into their
// own fields instead of splitting the cluster. Deterministic word rules
// and a small synonym table — no NLP, nothing that could invent demand.

const DAY_WORDS: Record<string, string> = {
  monday: "mon", mondays: "mon", tuesday: "tue", tuesdays: "tue", wednesday: "wed", wednesdays: "wed",
  thursday: "thu", thursdays: "thu", friday: "fri", fridays: "fri", saturday: "sat", saturdays: "sat",
  sunday: "sun", sundays: "sun", weekend: "weekend", weekends: "weekend", weekday: "weekday", weekdays: "weekday",
};
const TIME_WORDS: Record<string, string> = {
  morning: "morning", mornings: "morning", afternoon: "afternoon", afternoons: "afternoon",
  evening: "evening", evenings: "evening", tonight: "evening", night: "evening", nights: "evening",
};
// Words that describe *how* or *when*, not *what* — dropped so they don't
// split a cluster.
const FILLER = new Set([
  "a", "an", "the", "on", "in", "at", "for", "this", "next", "every", "some", "any", "near", "me", "local", "around", "today", "tomorrow",
  "game", "games", "session", "sessions", "group", "groups", "club", "clubs", "class", "classes", "meetup", "meet", "up",
  "casual", "social", "friendly", "beginner", "beginners", "adult", "adults", "weekly", "regular", "free", "cheap", "people",
]);
// Canonical activity for common variants.
const SYNONYMS: Record<string, string> = {
  soccer: "football", "5-a-side": "football", "five-a-side": "football", "5 a side": "football",
  swim: "swimming", swims: "swimming", "sea swim": "swimming", "sea swimming": "swimming",
  hike: "hiking", hikes: "hiking", hillwalking: "hiking", "hill walking": "hiking", "hill walk": "hiking",
  walk: "walking", walks: "walking",
  run: "running", runs: "running", jog: "running", jogging: "running", parkrun: "running",
  cycle: "cycling", cycles: "cycling", bike: "cycling", "bike ride": "cycling", biking: "cycling",
  "table tennis": "table tennis", "ping pong": "table tennis",
  gym: "fitness", workout: "fitness", bootcamp: "fitness", hiit: "fitness",
};
// Canonical activity → the admin/market category it rolls up into.
const CATEGORY_OF: Record<string, string> = {
  hiking: "Outdoor", cycling: "Outdoor", kayaking: "Outdoor", climbing: "Outdoor",
  running: "Fitness", pilates: "Fitness", fitness: "Fitness",
  pottery: "Arts", painting: "Arts", drawing: "Arts", photography: "Arts",
};

export interface NormalizedDemand {
  /** Stable grouping key, e.g. "badminton". "" when nothing but timing was given. */
  clusterKey: string;
  /** Display label, e.g. "Badminton". */
  label: string;
  /** A MARKET_CATEGORIES value when one fits, else "". */
  category: string;
  /** e.g. ["sun"] or ["weekend"] — pulled out of the text. */
  days: string[];
  /** "morning" | "afternoon" | "evening" | "" — pulled out of the text. */
  time: string;
}

export function normalizeDemand(text: string): NormalizedDemand {
  const days: string[] = [];
  let time = "";
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    if (DAY_WORDS[w]) {
      if (!days.includes(DAY_WORDS[w])) days.push(DAY_WORDS[w]);
    } else if (TIME_WORDS[w]) {
      time = time || TIME_WORDS[w];
    } else if (!FILLER.has(w)) {
      kept.push(w);
    }
  }
  let phrase = kept.join(" ");
  // Multi-word synonyms first ("hill walking"), then single words.
  if (SYNONYMS[phrase]) phrase = SYNONYMS[phrase];
  else phrase = kept.map((w) => SYNONYMS[w] ?? w).filter((w, i, a) => a.indexOf(w) === i).join(" ");

  const market = MARKET_CATEGORIES.find((c) => c.toLowerCase() === phrase);
  const category = market ?? CATEGORY_OF[phrase] ?? "";
  return { clusterKey: phrase, label: phrase ? phrase[0].toUpperCase() + phrase.slice(1) : "", category, days, time };
}

/** Friendly range for anything shown to hosts — never an exact count of
 * people, so small clusters can't be reasoned about individually. */
export function interestRange(n: number): string {
  if (n >= 50) return "50+";
  if (n >= 30) return "30+";
  if (n >= 20) return "20+";
  if (n >= 10) return "10+";
  if (n >= 5) return "5+";
  return "3+";
}
