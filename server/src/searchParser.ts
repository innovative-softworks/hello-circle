// Same 32-county list client/src/irishCounties.ts's coordinate map covers,
// kept as plain names here since search only needs to match text, not
// distance — duplicated by hand across client/server (no shared package),
// same convention CLAUDE.md documents for types.ts.
const IRISH_COUNTIES = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal", "Down", "Dublin",
  "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford",
  "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

export interface ParsedQuery {
  raw: string;
  county: string | null;
  free: boolean;
  keywords: string[];
  maxPriceEuro: number | null;
  timeOfDay: "morning" | "afternoon" | "evening" | null;
}

const TIME_WORDS: Record<string, ParsedQuery["timeOfDay"]> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  tonight: "evening",
};

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "near",
  "me",
  "my",
  "in",
  "at",
  "on",
  "with",
  "and",
  "or",
  "this",
  "that",
  "some",
  "something",
  "activities",
  "activity",
  "find",
  "show",
  "i",
  "want",
  "to",
  "do",
]);

/** Rule-based free-text query parser (FUTURE, best-effort — "AI search"
 * without an LLM API key/wiring). Extracts a handful of structured signals
 * from a plain-English query so routes/search.ts can turn e.g. "free
 * badminton in dublin this evening" into real filters — genuinely useful at
 * this traffic volume without needing external NLP. Anything it can't
 * confidently extract is just left in `keywords` for a plain LIKE match. */
export function parseSearchQuery(raw: string): ParsedQuery {
  const text = raw.toLowerCase().trim();
  const words = text.split(/\s+/).filter(Boolean);

  let county: string | null = null;
  for (const c of IRISH_COUNTIES) {
    if (text.includes(c.toLowerCase())) {
      county = c;
      break;
    }
  }

  const free = /\bfree\b/.test(text);

  let timeOfDay: ParsedQuery["timeOfDay"] = null;
  for (const [word, value] of Object.entries(TIME_WORDS)) {
    if (text.includes(word)) {
      timeOfDay = value;
      break;
    }
  }

  const priceMatch = text.match(/under\s+€?(\d+)/) ?? text.match(/€(\d+)\s+or less/);
  const maxPriceEuro = priceMatch ? parseInt(priceMatch[1], 10) : null;

  const countyWords = county ? county.toLowerCase().split(/\s+/) : [];
  const keywords = words.filter(
    (w) => !STOPWORDS.has(w) && !countyWords.includes(w) && !Object.keys(TIME_WORDS).includes(w) && w !== "free" && !/^\d+$/.test(w)
  );

  return { raw, county, free, keywords, maxPriceEuro, timeOfDay };
}
