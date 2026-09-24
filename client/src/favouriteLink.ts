import type { Favourite } from "./types";

// Resident Experience Polish — Changeset 4. Shared by MyLifeSaved.tsx and
// Profile.tsx's fuller Saved panel, which previously each hand-rolled their
// own (identical, and identically incomplete) version of this — neither
// had a case for circle/program_session/club_session, so a saved item of
// those types always rendered non-clickable even when it was still
// perfectly valid. program_session/club_session route to their parent
// program/club (neither has its own detail page); both return null only
// when the parent itself was also removed (parentId absent from the
// server), matching every other type's "deleted listing" fallback.
export function favouriteDetailHref(f: Favourite): string | null {
  if (f.listingType === "centre") return `/centres/${f.listingId}`;
  if (f.listingType === "club") return `/clubs/${f.listingId}`;
  if (f.listingType === "game") return `/games/${f.listingId}`;
  if (f.listingType === "experience") return `/experiences/${f.listingId}`;
  if (f.listingType === "circle") return `/circles/${f.slug ?? f.listingId}`;
  if (f.listingType === "program_session") return f.parentId ? `/programs/${f.parentId}` : null;
  if (f.listingType === "club_session") return f.parentId ? `/clubs/${f.parentId}` : null;
  return null;
}
