import { getSetting } from "../db/index.js";

// Participation Phase 1 — community events (experiences.kind = 'event') stay
// out of every public discovery read (lists, search, map, ranking, sitemap,
// provider profile) until participation.events is on. A direct link to an
// approved event still opens it, so shared links never break. Read straight
// from app_settings (same row circleFeatures.ts writes) to keep this
// importable from db/queries.ts without a cycle.

export async function eventsVisible(): Promise<boolean> {
  return (await getSetting("participation.events", "false")) === "true";
}

/** "" while events are visible, else ` AND <alias>.kind != 'event'`. */
export async function hiddenEventsSql(alias = ""): Promise<string> {
  return (await eventsVisible()) ? "" : ` AND ${alias ? `${alias}.` : ""}kind != 'event'`;
}

/** The public path of an experience-family listing. */
export function experienceHref(kind: string, slugOrId: string): string {
  const base = kind === "adventure" ? "adventures" : kind === "event" ? "events" : "experiences";
  return `/${base}/${slugOrId}`;
}
