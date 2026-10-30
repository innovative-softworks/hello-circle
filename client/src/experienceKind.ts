import type { ExperienceKind } from "./types";

// Participation Phase 1 — one place for the words and paths of the
// experience-family kinds (adventure, experience, volunteer, event), so a
// community event is never labelled or linked as an "experience".

/** The public list path segment for a kind. Volunteering's detail pages live under /experiences. */
export function kindPath(kind: ExperienceKind | string): string {
  return kind === "adventure" ? "adventures" : kind === "event" ? "events" : "experiences";
}

/** The detail page of an experience-family listing. */
export function experienceHref(kind: ExperienceKind | string, slugOrId: string): string {
  return `/${kindPath(kind)}/${slugOrId}`;
}

/** "Adventure", "Event", "Volunteer", "Experience". */
export function experienceKindWord(kind: ExperienceKind | string): string {
  return kind === "adventure" ? "Adventure" : kind === "volunteer" ? "Volunteer" : kind === "event" ? "Event" : "Experience";
}
