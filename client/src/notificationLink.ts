import type { ResidentNotification } from "./types";

// Resident Experience Polish — Changeset 2. NotificationInboxPanel
// (Profile.tsx) previously never navigated anywhere on click, for any
// notification kind, ever — not just the new booking/registration/program/
// experience kinds this changeset adds, but the pre-existing waitlist/game/
// circle ones too. Mirrors the server's own notifications.ts's
// pushPathFor()/DETAIL_PATH_BY_LISTING_TYPE exactly, so the in-app link
// matches what the native push notification already opens.
//
// Platform Pre-Launch Polish — Changeset 2: this mirror had fallen out of
// sync with the server's map (which has always had all 8 entries) —
// vendor/host/experience/program notifications silently no-opped on click
// (marked read, navigated nowhere). Kept in sync by listing every entry the
// server's own DETAIL_PATH_BY_LISTING_TYPE has.
const DETAIL_PATH_BY_LISTING_TYPE: Partial<Record<ResidentNotification["listingType"], string>> = {
  centre: "/centres/",
  club: "/clubs/",
  game: "/games/",
  circle: "/circles/",
  vendor: "/provider/",
  host: "/host/",
  experience: "/experiences/",
  program: "/programs/",
};

export function notificationHref(n: Pick<ResidentNotification, "kind" | "listingType" | "listingId" | "ref">): string | null {
  if (n.kind === "booking" || n.kind === "registration" || n.kind === "program" || n.kind === "experience") {
    return `/bookings?ref=${n.ref}`;
  }
  const base = DETAIL_PATH_BY_LISTING_TYPE[n.listingType];
  return base ? `${base}${n.listingId}` : null;
}
