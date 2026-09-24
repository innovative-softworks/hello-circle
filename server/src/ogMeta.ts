import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";
import { getShareData } from "./routes/sharing.js";
import { CLIENT_URL } from "./stripe.js";

// Shareable link previews (master-prompt punch list #1) — this app has no
// SSR framework, so a full per-route render isn't an option. This is the
// smallest thing that actually works: for the handful of public detail
// routes, look up the listing and inject real <meta property="og:..."> /
// twitter:card tags into the one static built index.html before serving
// it — a pasted link then shows a title/description/image before the SPA
// itself ever loads. Every other route (anything not matching one of these
// 6 patterns) falls through to the plain, unmodified index.html exactly as
// before this existed.
//
// Every URL built in this file (canonical/og:url/sitemap entries) uses the
// fixed CLIENT_URL constant, not the requesting host — this used to be
// built per-request from `${req.protocol}://${req.get("host")}`, which
// meant hellocircle.ie and www.hellocircle.ie (both resolve, nginx has no
// redirect between them) each produced their own "canonical" URL for the
// same page, defeating canonicalization entirely and creating duplicate
// content in Google's eyes. CLIENT_URL is the same env var the Stripe
// checkout redirect already treats as the one true public origin.

export interface OgMeta {
  title: string;
  description: string;
  image?: string;
  url: string;
  /** schema.org JSON-LD, built from the same row this OgMeta was already
   * resolved from (no extra queries) — omitted for kinds where the fields
   * we already fetch don't map cleanly onto a real schema.org type (see
   * resolveOgMeta's per-kind branches). */
  jsonLd?: Record<string, unknown>;
  /** Defaults to `noindex, nofollow` in injectOgTags when omitted — same
   * "fail closed" posture as client/src/App.tsx's LAUNCH_GATE_ENABLED, so a
   * route nobody explicitly marked indexable stays out of search results by
   * default instead of silently becoming crawlable. Every genuinely public
   * resolveOgMeta branch (approved Centre/Club/Experience/Program, published
   * Program, public Activity, open Circle, verified Host, approved Provider,
   * local SEO landing pages) and resolveMarketingOgMeta set this explicitly
   * to "index, follow"; private/restricted/stub branches (invite-only
   * Circle, non-public Activity) and defaultOgMeta deliberately omit it so
   * they fall through to the noindex default. */
  robots?: "index, follow" | "noindex, nofollow";
}

const ROUTE_PATTERN = /^\/(centres|clubs|circles|experiences|adventures|games|programs|host|provider)\/([^/]+)\/?$/;

// Local SEO landing pages (participation-intent plan Phase 3) — the county
// segment is checked against a real county with actual approved listings
// (not just a static 32-county allowlist) so a stray 2-segment URL that
// happens to look like /somecounty/something never gets a fabricated
// "0 results" meta description for a place with no real inventory.
const LOCAL_ROUTE_PATTERN = /^\/([^/]+)\/([^/]+)\/?$/;
const RESERVED_FIRST_SEGMENTS = new Set([
  "centres", "clubs", "circles", "experiences", "adventures", "games", "browse", "book", "register",
  "programs", "provider", "host", "vendor", "admin", "payment",
]);

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** SEO Phase 8 — Event JSON-LD's endDate, computed only when a real
 * duration is set (most games have no duration_minutes at all). Mirrors
 * startDate's own naive `${date}T${time}` format (no timezone offset) rather
 * than reaching for irelandTime.ts's DST-aware conversion — that would make
 * endDate more "correct" than startDate immediately above it in the same
 * object, which is a worse inconsistency than the pre-existing format. */
function eventEndDate(date: string | null | undefined, time: string | null | undefined, durationMinutes: number | null | undefined): string | null {
  if (!durationMinutes || !date || !time) return null;
  const start = new Date(`${date}T${time}`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

// Same copy as client/index.html's static <title>/description — kept in
// sync by hand since there's no shared config between the two. Used for
// every route that isn't one of the 6 detail-page kinds or a real local
// landing page, so a shared link/crawl of e.g. the homepage or /browse
// still gets a real description and canonical/OG/Twitter tags instead of
// the previous plain fallback (title only, no description, no canonical).
const DEFAULT_TITLE = "Hello Circle — community centres & sports clubs in Ireland";
const DEFAULT_DESCRIPTION =
  "Browse and book community centres, sports clubs, and local activities across Ireland — halls, classes, kids' clubs, pickup sessions, and more, all in one place.";

export function defaultOgMeta(pathName: string): OgMeta {
  return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url: `${CLIENT_URL}${pathName}`, robots: "noindex, nofollow" };
}

// The pre-launch marketing/recruitment pages (see client/src/App.tsx's
// isExemptFromLaunchGate — same set of routes, same rationale: these are
// meant to recruit vendors/hosts via search and shared links *now*, unlike
// every other route which has no real data yet and stays noindexed). Kept
// here as hand-copied strings (same "no shared config between client and
// server" tradeoff DEFAULT_TITLE/DESCRIPTION above already accepts) rather
// than importing from a client file the server can't reach.
const MARKETING_PAGES: Record<string, { title: string; description: string; image?: string; jsonLd?: Record<string, unknown> }> = {
  "/": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    // Site-identity markup, not a listing — the only JSON-LD type here that
    // isn't per-row data from resolveOgMeta's kind branches above.
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "HelloCircle",
      url: "https://www.hellocircle.ie",
      logo: "https://www.hellocircle.ie/illustrations/Logo.svg",
      description: DEFAULT_DESCRIPTION,
    },
  },
  "/for-venues": {
    title: "List your venue or become a Host — HelloCircle",
    description: "Get discovered, get booked, and grow your community. List a community centre or sports club, or become a Host and run a Session or Circle with no venue needed.",
  },
  "/become-a-host": {
    title: "Become a Host, free — no venue needed — HelloCircle",
    description: "Host a one-off Session or start a standing Circle in minutes. No venue, no business, no approval to start — completely free.",
    image: "https://images.unsplash.com/photo-1633894812833-3961145496a3?w=1200&h=630&q=75&auto=format&fit=crop",
  },
  "/coming-soon": {
    title: "HelloCircle — launching soon in Ireland, and everywhere",
    description: "One place to book a hall, join a club, catch a pickup session, or start a recurring Circle across Ireland. Join the waitlist to be the first to know.",
  },
  "/privacy": { title: "Privacy Policy — HelloCircle", description: "How HelloCircle collects, uses, and protects your personal data." },
  "/cookies": { title: "Cookie Policy — HelloCircle", description: "How HelloCircle uses cookies and similar technologies." },
};

export function resolveMarketingOgMeta(pathName: string): OgMeta | null {
  const page = MARKETING_PAGES[pathName];
  if (!page) return null;
  return { title: page.title, description: page.description, image: page.image, jsonLd: page.jsonLd, url: `${CLIENT_URL}${pathName}`, robots: "index, follow" };
}

// SEO Phase 7/10 — every one of these is a STATIC_SITEMAP_PATHS entry (see
// generateSitemapUrls below), i.e. already submitted to Google as a "static
// high-value route" once the site launches. None of them matches
// ROUTE_PATTERN (they're list/browse pages, not entity detail pages) or
// MARKETING_PAGES above, so — before this — every one of them fell straight
// through resolveOgMeta and resolveMarketingOgMeta to defaultOgMeta's
// noindex fallback. That meant the app's actual core discovery surfaces
// (Explore, Browse, Games, Circles, Adventures, Experiences, and the
// consumer Home page at /home) would have stayed permanently out of the
// index even after a real launch — the exact "Do not accidentally noindex"
// failure Phase 10 calls out, just for list pages instead of detail pages.
const STATIC_DISCOVERY_PAGES: Record<string, { title: string; description: string }> = {
  "/home": {
    title: "HelloCircle — book a hall, join a club, or start a Circle",
    description: "Browse community centres, sports clubs, pickup sessions, and recurring Circles across Ireland, all in one place.",
  },
  "/explore": {
    title: "Explore what's on near you — HelloCircle",
    description: "Discover community centres, sports clubs, sessions, and Circles happening across Ireland right now.",
  },
  "/browse/centres": {
    title: "Community centres in Ireland — HelloCircle",
    description: "Browse and book halls, rooms, and community centres across Ireland.",
  },
  "/browse/clubs": {
    title: "Sports clubs in Ireland — HelloCircle",
    description: "Browse and register with sports clubs for kids and adults across Ireland.",
  },
  "/games": {
    title: "Join a pickup session — HelloCircle",
    description: "Find and join casual pickup sessions and one-off activities happening near you in Ireland.",
  },
  "/circles": {
    title: "Circles — recurring groups near you — HelloCircle",
    description: "Join or start a recurring Circle around a shared activity, from running clubs to book groups, across Ireland.",
  },
  "/adventures": {
    title: "Adventures across Ireland — HelloCircle",
    description: "Book guided adventures and outdoor experiences across Ireland.",
  },
  "/experiences": {
    title: "Experiences across Ireland — HelloCircle",
    description: "Book classes, workshops, and one-off experiences across Ireland.",
  },
};

export function resolveStaticDiscoveryOgMeta(pathName: string): OgMeta | null {
  const page = STATIC_DISCOVERY_PAGES[pathName];
  if (!page) return null;
  return { title: page.title, description: page.description, url: `${CLIENT_URL}${pathName}`, robots: "index, follow" };
}

// Plural ogMeta route kind -> singular getShareData/ShareEntityType kind —
// both name the same 9 entities, just spelled differently (this file's
// ROUTE_PATTERN segments read as URL path plurals; sharing.ts's
// ShareEntityType reads as a type discriminant). Every og:image below routes
// through the branded card endpoint (§14) rather than the raw listing
// photo directly — see shareCard.ts for why, and card.png's own route
// comment in routes/sharing.ts for why this is safe for a privacy-gated
// game (getShareData already returns the generic private stub, never the
// real photo, before the card is ever rendered from it).
const SHARE_KIND: Record<string, string> = {
  centres: "centre",
  clubs: "club",
  circles: "circle",
  experiences: "experience",
  adventures: "adventure",
  games: "game",
  programs: "program",
  host: "host",
  provider: "provider",
};

function cardImageUrl(kind: string, idOrSlug: string): string {
  return `${CLIENT_URL}/api/share/${SHARE_KIND[kind] ?? kind}/${encodeURIComponent(idOrSlug)}/card.png`;
}

/** SEO audit Phase 2 — lets the catch-all handler in index.ts tell "this
 * path looks like an entity-detail URL (/centres/:id etc), but
 * resolveOgMeta() came back null because that specific id/slug genuinely
 * doesn't exist" (a real 404) apart from "this path was never an entity
 * route in the first place" (e.g. /manage, /profile — always 200, the SPA
 * decides what to render). Deliberately does NOT cover the local landing
 * pages (/:county/:activity) — those have their own established, honest
 * "zero real inventory for this county" page state (Phase 11 says
 * preserve it untouched), not a 404 case. */
export function isEntityDetailRoute(pathName: string): boolean {
  return ROUTE_PATTERN.test(pathName);
}

export async function resolveOgMeta(pathName: string, viewerResidentId: string | null = null): Promise<OgMeta | null> {
  const match = pathName.match(ROUTE_PATTERN);
  if (!match) return resolveLocalLandingOgMeta(pathName);
  const [, kind, idOrSlug] = match;
  const url = `${CLIENT_URL}${pathName}`;
  const cardImage = cardImageUrl(kind, idOrSlug);

  // SEO Phase 7 — canonical cleanup. Every slug-bearing kind's own query
  // matches `slug = ? OR id = ?`, so /centres/{real-slug} and
  // /centres/{raw-uuid} both resolve to the identical page — without this,
  // `url` above (built from the raw request path) would put a *different*
  // <link rel="canonical">/og:url/JSON-LD url on each of those two URLs,
  // which is close to the textbook definition of duplicate content in
  // Google's eyes. `canonicalPath(row.slug)` always prefers the real slug
  // when the row has one, regardless of which variant was actually
  // requested, so both URLs converge on one canonical target.
  const canonicalPath = (slug: string | null | undefined) => `${CLIENT_URL}/${kind}/${slug || idOrSlug}`;

  if (kind === "centres") {
    const row = (await db.prepare(`SELECT name, blurb, image_url, area, county, slug FROM centres WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string; area: string; county: string; slug: string | null }
      | undefined;
    if (!row) return null;
    const canonicalUrl = canonicalPath(row.slug);
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(row.blurb, 200),
      image: cardImage,
      url: canonicalUrl,
      robots: "index, follow",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: row.name,
        description: truncate(row.blurb, 300),
        image: row.image_url || undefined,
        url: canonicalUrl,
        address: { "@type": "PostalAddress", addressLocality: row.area, addressRegion: row.county, addressCountry: "IE" },
      },
    };
  }

  if (kind === "clubs") {
    const row = (await db.prepare(`SELECT name, blurb, image_url, area, county, slug FROM clubs WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string; area: string; county: string; slug: string | null }
      | undefined;
    if (!row) return null;
    const canonicalUrl = canonicalPath(row.slug);
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(row.blurb, 200),
      image: cardImage,
      url: canonicalUrl,
      robots: "index, follow",
      jsonLd: {
        "@context": "https://schema.org",
        // SEO Phase 8 — audited against generic LocalBusiness. A sports
        // club is a real, more specific schema.org LocalBusiness subtype
        // (SportsActivityLocation, "a sports location, such as a playing
        // field") — more accurate than the generic type, and Google's rich
        // results treat a more specific applicable subtype as strictly
        // better, never worse, than the generic ancestor. Centre keeps
        // plain LocalBusiness above: "a community centre with rentable
        // rooms" has no closer-fitting subtype in schema.org's vocabulary.
        "@type": "SportsActivityLocation",
        name: row.name,
        description: truncate(row.blurb, 300),
        image: row.image_url || undefined,
        url: canonicalUrl,
        address: { "@type": "PostalAddress", addressLocality: row.area, addressRegion: row.county, addressCountry: "IE" },
      },
    };
  }

  if (kind === "circles") {
    const row = (await db
      .prepare(`SELECT name, about, activity_label as activityLabel, join_mode as joinMode, slug FROM circles WHERE (slug = ? OR id = ?) AND status = 'active'`)
      .get(idOrSlug, idOrSlug)) as { name: string; about: string; activityLabel: string; joinMode: "open" | "approval" | "invite"; slug: string | null } | undefined;
    if (!row) return null;

    // Media plan Task 2 closed this leak in the JSON API responses and in
    // getShareData()/the share-card image above — this raw `<head>` HTML
    // (sent to every requester, crawlers included, with no session/viewer
    // concept at all) had the identical gap independently: the real
    // name/about was always in the page source regardless of join_mode.
    // No viewer check possible/meaningful here (unauthenticated HTML), so
    // a non-open Circle always gets the generic stub, unconditionally.
    if (row.joinMode !== "open") {
      return {
        title: "Private Circle — HelloCircle",
        description: "This Circle is only visible to its members.",
        url,
      };
    }

    const canonicalUrl = canonicalPath(row.slug);
    const description = row.about || `A ${row.activityLabel || "local"} Circle on HelloCircle.`;
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(description, 200),
      image: cardImage,
      url: canonicalUrl,
      robots: "index, follow",
      // Organization, not Event — a Circle is a persistent group, not a
      // single dated occurrence (its next session is a Game, which gets its
      // own Event markup on its own detail page).
      jsonLd: { "@context": "https://schema.org", "@type": "Organization", name: row.name, description: truncate(description, 300), url: canonicalUrl },
    };
  }

  if (kind === "experiences" || kind === "adventures") {
    const row = (await db.prepare(`SELECT title, blurb, image_url, slug FROM experiences WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { title: string; blurb: string; image_url: string; slug: string | null }
      | undefined;
    if (!row) return null;
    // No JSON-LD here — the fields resolveOgMeta already fetches for
    // experiences/adventures (title/blurb/image only) don't include a date,
    // and Event/Product markup without one would be worse than none.
    return { title: `${row.title} — HelloCircle`, description: truncate(row.blurb, 200), image: cardImage, url: canonicalPath(row.slug), robots: "index, follow" };
  }

  if (kind === "programs") {
    const row = (await db.prepare(`SELECT title, description, image_url FROM programs WHERE id = ? AND status = 'published'`).get(idOrSlug)) as
      | { title: string; description: string; image_url: string }
      | undefined;
    if (!row) return null;
    return { title: `${row.title} — HelloCircle`, description: truncate(row.description, 200), image: cardImage, url, robots: "index, follow" };
  }

  if (kind === "host") {
    const row = (await db.prepare(`SELECT name, host_bio as bio FROM residents WHERE id = ? AND host_status = 'verified'`).get(idOrSlug)) as { name: string; bio: string | null } | undefined;
    if (!row) return null;
    return {
      title: `${row.name} on HelloCircle`,
      description: truncate(row.bio || `See what ${row.name} is hosting on HelloCircle.`, 200),
      image: cardImage,
      url,
      robots: "index, follow",
      jsonLd: { "@context": "https://schema.org", "@type": "Person", name: row.name, description: truncate(row.bio || "", 300), url },
    };
  }

  if (kind === "provider") {
    const row = (await db.prepare(`SELECT name, business_name as businessName, description, logo FROM users WHERE id = ? AND role = 'vendor' AND status = 'approved'`).get(idOrSlug)) as
      | { name: string; businessName: string; description: string; logo: string | null }
      | undefined;
    if (!row) return null;
    const displayName = row.businessName || row.name;
    return {
      title: `${displayName} — HelloCircle`,
      description: truncate(row.description || `See what's on with ${displayName} on HelloCircle.`, 200),
      image: cardImage,
      url,
      robots: "index, follow",
    };
  }

  if (kind === "games") {
    // Delegates to getShareData rather than its own query (this branch used
    // to run one) specifically so a circle-only/invite-only game's real
    // date/time/location never lands in the page's own <title>/meta
    // description/JSON-LD either — card.png was already privacy-safe (it
    // always called getShareData), but this branch previously wasn't,
    // which would have undermined it: the generic stub image next to a
    // fully-detailed page title/description defeats the point.
    const data = await getShareData("game", idOrSlug, viewerResidentId);
    if (!data) return null;
    if (data.privacy !== "public") {
      return { title: `${data.title} — HelloCircle`, description: data.description, image: cardImage, url };
    }
    // Lifecycle §59 — a cancelled Activity gets its own real, indexable
    // page (sharing.ts's getShareData no longer 404s it) with an honest
    // `EventCancelled` status, never the generic "book now" shape below —
    // no `offers` block at all (there's nothing to book), matching §59's
    // "do not fabricate" instruction rather than emitting a Cancelled event
    // that still advertises a price/availability.
    if (data.cancelled) {
      return {
        title: `${data.title} — HelloCircle`,
        description: truncate(data.description, 200),
        image: cardImage,
        url,
        robots: "index, follow",
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Event",
          name: data.title,
          startDate: data.date && data.time ? `${data.date}T${data.time}` : undefined,
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          eventStatus: "https://schema.org/EventCancelled",
          location: { "@type": "Place", name: data.location || "Location to be confirmed" },
          url,
        },
      };
    }
    // SEO Phase 8 — Event JSON-LD completion, real data only. endDate is
    // computed only when duration_minutes is actually set on the game (most
    // aren't — no fabricated duration); offers/geo are similarly omitted
    // outright rather than filled with a placeholder when the underlying
    // value is missing (no centre, no lat/lng). Real regardless of
    // lifecycle — a Coming Soon activity's date/time/location are already
    // collected at creation, so §55's "do not add fake Event structured
    // data" doesn't apply here the way it does for e.g. Experiences (which
    // never collect a date at all until booked).
    const startDate = `${data.date}T${data.time}`;
    const endDate = eventEndDate(data.date, data.time, data.durationMinutes);
    const spotsLeft = typeof data.capacity === "number" ? Math.max(0, data.capacity - (data.interestedCount ?? 0)) : null;
    return {
      title: `${data.title} — HelloCircle`,
      description: truncate(data.description, 200),
      image: cardImage,
      url,
      robots: "index, follow",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Event",
        name: data.title,
        startDate,
        ...(endDate ? { endDate } : {}),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        location: {
          "@type": "Place",
          name: data.location || "Location to be confirmed",
          ...(data.lat != null && data.lng != null ? { geo: { "@type": "GeoCoordinates", latitude: data.lat, longitude: data.lng } } : {}),
        },
        organizer: data.host ? { "@type": "Person", name: data.host.name } : undefined,
        offers: {
          "@type": "Offer",
          price: ((data.priceCents ?? 0) / 100).toFixed(2),
          priceCurrency: "EUR",
          availability: spotsLeft === null || spotsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
          url,
        },
        url,
      },
    };
  }

  return null;
}

async function resolveLocalLandingOgMeta(pathName: string): Promise<OgMeta | null> {
  const match = pathName.match(LOCAL_ROUTE_PATTERN);
  if (!match) return null;
  const [, countySeg, activitySeg] = match;
  if (RESERVED_FIRST_SEGMENTS.has(countySeg)) return null;

  // Case-insensitive county match against real listing counties, not a
  // static 32-county allowlist — a county with zero approved listings never
  // gets a fabricated landing page.
  const centre = (await db.prepare(`SELECT county FROM centres WHERE LOWER(county) = LOWER(?) AND status = 'approved' LIMIT 1`).get(countySeg)) as { county: string } | undefined;
  if (!centre) return null;

  const activityQuery = activitySeg.replace(/-/g, " ").trim();
  if (!activityQuery) return null;

  // Same "upcoming only" filter as discover.ts's GET /local/:county/:activity
  // (the actual data the landing page renders) — without this, the meta
  // description could cite a count that includes already-past games and
  // disagree with what a visitor actually sees on the page.
  // CURDATE() is the DB server's own UTC date (the pool is configured
  // timezone: "Z") — wrong for the ~1hr window after Irish midnight during
  // BST, same bug irelandTodayIso() exists to fix; bind it explicitly
  // instead of trusting the DB's own clock for this calendar-date compare.
  const { n: count } = (await db
    .prepare(`SELECT COUNT(*) as n FROM games g LEFT JOIN centres c ON c.id = g.centre_id WHERE g.status = 'open' AND g.date >= ? AND c.county = ? AND LOWER(g.activity_label) LIKE LOWER(?)`)
    .get(irelandTodayIso(), centre.county, `%${activityQuery}%`)) as { n: number };

  const title = `${activityQuery} in ${centre.county} — HelloCircle`;
  const description =
    count > 0
      ? `${count} ${activityQuery} ${count === 1 ? "activity" : "activities"} in ${centre.county} — join one or start your own on HelloCircle.`
      : `Nothing scheduled for ${activityQuery} in ${centre.county} yet — be the first to start one on HelloCircle.`;
  return { title, description: truncate(description, 200), url: `${CLIENT_URL}${pathName}`, robots: "index, follow" };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replaces the static <title> content and the static <meta robots> tag,
 * and injects the og/twitter meta tags, a canonical link, and (when
 * available) a JSON-LD block right after the title. Title/robots used to be
 * left untouched (every route showed the same generic homepage title and
 * the same hardcoded `noindex, nofollow`) — real per-route titles are core
 * to on-page SEO, and a route can now legitimately want `index, follow`
 * (see resolveMarketingOgMeta), so both need to vary per request instead of
 * only the OG/Twitter copy. */
export function injectOgTags(html: string, meta: OgMeta): string {
  const tags = [
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    // SEO Phase 14 — Twitter's crawler falls back to og:image when this is
    // absent, but that's undocumented-enough behavior to not rely on;
    // emitting it explicitly costs nothing since meta.image is already
    // resolved for the og:image tag two lines above.
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />` : "",
    // JSON.stringify does not escape "<" — a vendor blurb or a resident-set
    // Game activity_label containing "</script><script>..." would otherwise
    // close this tag early and execute as real markup for anyone hitting the
    // page on a fresh (non-client-routed) load. Escaping "<" as a unicode
    // escape is valid inside a JSON string and inert as HTML.
    meta.jsonLd ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  return html
    .replace(/<title>.*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="${meta.robots ?? "noindex, nofollow"}" />`)
    .replace("</title>", `</title>\n    ${tags}`);
}

// --- Sitemap (post-audit hardening pass) ----------------------------------
// Same "only real, non-thin content" discipline as resolveLocalLandingOgMeta
// above — no fabricated pages for empty markets/categories. Static
// high-value routes plus every approved/active listing plus only the real
// (county, activity) combinations that currently have a genuine upcoming
// open game, not every syntactically-valid local-landing URL (which would
// be unbounded, since the activity segment accepts free text).

const STATIC_SITEMAP_PATHS = ["/", "/explore", "/browse/centres", "/browse/clubs", "/circles", "/games", "/adventures", "/experiences"];

function slugifyActivity(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function generateSitemapUrls(): Promise<string[]> {
  const urls = STATIC_SITEMAP_PATHS.map((p) => `${CLIENT_URL}${p}`);

  const todayIso = irelandTodayIso();
  const [centres, clubs, circles, experiences, programs, hosts, providers, games, localPages] = await Promise.all([
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM centres WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM clubs WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    // 'open'-only — same reasoning as the games query below: an approval/
    // invite Circle must never end up in a crawlable public sitemap (Media
    // plan Task 2 closed this same leak in the Circle JSON responses
    // themselves; this query had the identical gap independently).
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM circles WHERE status = 'active' AND join_mode = 'open'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM experiences WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT id FROM programs WHERE status = 'published'`).all() as Promise<{ id: string }[]>,
    db.prepare(`SELECT id FROM residents WHERE host_status = 'verified'`).all() as Promise<{ id: string }[]>,
    db.prepare(`SELECT id FROM users WHERE role = 'vendor' AND status = 'approved'`).all() as Promise<{ id: string }[]>,
    // 'public'-only — a circle-only/invite-only game must never end up in a
    // crawlable public sitemap (Universal Sharing system §21/§22: privacy
    // can't leak just because a link exists somewhere). `lifecycle != 'draft'`
    // closes the same class of gap for the newer Publishing/Lifecycle system
    // — `status` and `lifecycle` are independent columns, so a draft game
    // could otherwise still have `status = 'open'` and leak into the sitemap.
    db.prepare(`SELECT id FROM games WHERE status IN ('open', 'pending_participants') AND lifecycle != 'draft' AND date >= ? AND visibility = 'public'`).all(todayIso) as Promise<{ id: string }[]>,
    db
      .prepare(
        `SELECT DISTINCT c.county as county, g.activity_label as activityLabel
         FROM games g JOIN centres c ON c.id = g.centre_id
         WHERE g.status = 'open' AND g.date >= ? AND c.status = 'approved' AND g.visibility = 'public'`
      )
      .all(todayIso) as Promise<{ county: string; activityLabel: string }[]>,
  ]);

  for (const c of centres) urls.push(`${CLIENT_URL}/centres/${c.slug}`);
  for (const c of clubs) urls.push(`${CLIENT_URL}/clubs/${c.slug}`);
  for (const c of circles) urls.push(`${CLIENT_URL}/circles/${c.slug}`);
  for (const e of experiences) urls.push(`${CLIENT_URL}/experiences/${e.slug}`);
  for (const p of programs) urls.push(`${CLIENT_URL}/programs/${p.id}`);
  for (const h of hosts) urls.push(`${CLIENT_URL}/host/${h.id}`);
  for (const p of providers) urls.push(`${CLIENT_URL}/provider/${p.id}`);
  for (const g of games) urls.push(`${CLIENT_URL}/games/${g.id}`);
  for (const p of localPages) {
    const activitySlug = slugifyActivity(p.activityLabel);
    if (activitySlug) urls.push(`${CLIENT_URL}/${encodeURIComponent(p.county)}/${activitySlug}`);
  }

  return urls;
}

export function buildSitemapXml(urls: string[]): string {
  const entries = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
