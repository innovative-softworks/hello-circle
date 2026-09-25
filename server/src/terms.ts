// Identifier recorded next to terms_accepted_at on every signup/acceptance
// path (onboarding audit E2), so "what did this person agree to, and when"
// is answerable later. It is metadata, not policy: bump it (or set
// TERMS_VERSION in the environment) whenever the Terms/Privacy Policy text
// materially changes. Rows accepted before this existed keep a NULL version
// — their acceptance is real but its version is unknown, and it is never
// backfilled or guessed. Nothing compares versions yet: a bump does not by
// itself re-prompt anyone (that is a separate product decision).
export const TERMS_VERSION = process.env.TERMS_VERSION || "2026-09-25";
