// HC-QA-059 / HC-QA-060 — the venue launch gate as ONE explicit switch
// (mirrors server/src/venueLaunch.ts). Community centre / sports club pages
// stay behind the coming-soon gate until VITE_VENUE_PAGES_PUBLIC=true; the
// vendor dashboard uses the same switch so it never calls a venue "live"
// while the public can't open it.
export const VENUE_PAGES_PUBLIC = (import.meta.env.VITE_VENUE_PAGES_PUBLIC as string | undefined) === "true";

// Vendor-facing wording while venue pages are gated (the listing's own
// publication state is unchanged — only how it's described).
export const VENUE_NOT_PUBLIC_LABEL = "Not publicly visible";
export const VENUE_NOT_PUBLIC_HELP = "Venue pages aren't publicly available yet. Your listing is approved and will appear as soon as they launch.";
