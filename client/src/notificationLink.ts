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
  // Phase 12 — a withdrawn invitation is informational only: no link.
  if (n.kind === "invite_withdrawn") return null;
  // Trust & Retention — opens the booking page, which shows the live attendance/review state.
  if (n.kind === "review_invite") return `/bookings/${n.ref}`;
  if (n.kind === "booking" || n.kind === "registration" || n.kind === "program" || n.kind === "experience") {
    return `/bookings?ref=${n.ref}`;
  }
  // D-03 — mirrors the server: a decision on your own host application or
  // place suggestion opens where the explanation is shown.
  if (n.kind === "moderation") return n.listingType === "place_suggestion" ? "/suggest-place" : "/profile?tab=hosting";
  const base = DETAIL_PATH_BY_LISTING_TYPE[n.listingType];
  return base ? `${base}${n.listingId}` : null;
}
