import type { FormTypeKey } from "../categoryPolicy.js";

// Phase H (docs/participation-expansion/19) — the listing types that use the
// one registration-form engine (questions.ts / forms.ts). Same tables for all;
// each type differs only in where its version counter lives, which answer
// source its orders write, and which platform fields its own fixed form
// already asks (so a question can't duplicate them).
//
//   experience — experiences, events, volunteering, adventures (Phase 2/G)
//   club       — club registrations (one registrant: a child or an adult)
//   program    — programme enrolments (one participant)
//   centre     — hall / room bookings (once per booking; no people list)
//
//   game       — a resident-hosted activity (Phase N): only the fixed host
//                question library (participation/gameQuestions.ts), never the
//                partner builder — the vendor form routes don't accept it.

export const FORM_LISTING_TYPES = ["experience", "club", "program", "centre", "game"] as const;
export type FormListingType = (typeof FORM_LISTING_TYPES)[number];
export const isFormListingType = (v: unknown): v is FormListingType => typeof v === "string" && (FORM_LISTING_TYPES as readonly string[]).includes(v);

/** Where the listing row (and its questions_version counter) lives. */
export const FORM_TABLE: Record<FormListingType, string> = { experience: "experiences", club: "clubs", program: "programs", centre: "centres", game: "games" };

/** The answers' source_type: the same key the order's acknowledgements and lines use. */
export type AnswerSource = "experience" | "registration" | "program" | "booking" | "game";
export const ANSWER_SOURCE: Record<FormListingType, AnswerSource> = { experience: "experience", club: "registration", program: "program", centre: "booking", game: "game" };

/** A hall booking has no list of people, so every question is asked once per booking. */
export const PERSON_QUESTIONS: Record<FormListingType, boolean> = { experience: true, club: true, program: true, centre: false, game: true };

/** The template a listing starts from when its category suggests none. */
export const DEFAULT_FORM_TYPE: Record<Exclude<FormListingType, "experience" | "game">, FormTypeKey> = { club: "club_registration", program: "programme_enrolment", centre: "venue_booking" };

/** Ready-made fields the listing's own fixed form already collects. */
export const FIXED_LIBRARY_FIELDS: Record<FormListingType, string[]> = {
  experience: [],
  club: ["emergency_contact", "date_of_birth"],
  program: ["date_of_birth"],
  centre: [],
  game: [],
};

/** Own-question wording that would repeat the listing's fixed form. */
const FIXED_WORDING: Record<FormListingType, RegExp | null> = {
  experience: null,
  club: /^\s*(the\s+)?(child'?s?\s+)?(date\s+of\s+birth|dob|birthday|age\s+group|team|address|home\s+address|emergency\s+contact(\s+(name|phone|number))?|relationship(\s+to\s+(the\s+)?child)?)\s*\??\s*$/i,
  program: /^\s*(participant'?s?\s+)?(date\s+of\s+birth|dob|birthday)\s*\??\s*$/i,
  game: null,
  centre: /^\s*(type\s+of\s+event|event\s+type|number\s+of\s+guests|how\s+many\s+guests|guests|date|time|start\s+time|duration|how\s+long|notes|any\s+notes|room)\s*\??\s*$/i,
};

const FORM_NAMES: Record<FormListingType, string> = { experience: "booking form", club: "club registration form", program: "enrolment form", centre: "hall booking form", game: "activity form" };

/** Why a question can't be on this listing's form, or null. */
export function fixedFieldClash(listingType: FormListingType, q: { fieldKey: string | null; label: string; scope: string }): string | null {
  if (q.fieldKey && FIXED_LIBRARY_FIELDS[listingType].includes(q.fieldKey)) return `the ${FORM_NAMES[listingType]} already asks for this`;
  if (!q.fieldKey && FIXED_WORDING[listingType]?.test(q.label)) return `the ${FORM_NAMES[listingType]} already asks for this ("${q.label.trim()}") — it doesn't need a question`;
  if (q.scope === "attendee" && !PERSON_QUESTIONS[listingType]) return `a ${FORM_NAMES[listingType]} asks once per booking — choose "Once per booking"`;
  return null;
}
