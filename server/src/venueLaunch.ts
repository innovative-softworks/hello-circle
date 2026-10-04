// HC-QA-060 / HC-QA-059 — the venue launch gate as ONE explicit switch.
// Community centre / sports club pages (/centres, /clubs, /browse/centres,
// /browse/clubs, /book, /register) are still behind the client's coming-soon
// gate (client/src/venueLaunch.ts). The server's SEO layer must agree, so it
// never advertises (sitemap) or marks indexable a page users can't open.
// Default: gated. Set VENUE_PAGES_PUBLIC=true (and the client's
// VITE_VENUE_PAGES_PUBLIC=true) together when venue pages launch.
// Read per call (not frozen at import) so both modes are testable in-process.
export function venuePagesPublic(): boolean {
  return process.env.VENUE_PAGES_PUBLIC === "true";
}

const VENUE_STATIC_PATHS = new Set(["/browse/centres", "/browse/clubs"]);

export function isVenuePath(pathName: string): boolean {
  return VENUE_STATIC_PATHS.has(pathName) || /^\/(centres|clubs|book|register)\//.test(pathName);
}
