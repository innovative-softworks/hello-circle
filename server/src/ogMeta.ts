import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";
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
   * default instead of silently becoming crawlable. Only resolveMarketingOgMeta
   * currently sets this to "index, follow". */
  robots?: "index, follow" | "noindex, nofollow";
}

const ROUTE_PATTERN = /^\/(centres|clubs|circles|experiences|adventures|games)\/([^/]+)\/?$/;

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

// Same copy as client/index.html's static <title>/description — kept in
// sync by hand since there's no shared config between the two. Used for
// every route that isn't one of the 6 detail-page kinds or a real local
// landing page, so a shared link/crawl of e.g. the homepage or /browse
// still gets a real description and canonical/OG/Twitter tags instead of
// the previous plain fallback (title only, no description, no canonical).
const DEFAULT_TITLE = "Hello Circle — community centres & sports clubs in Ireland";
const DEFAULT_DESCRIPTION =
  "Browse and book community centres, sports clubs, and local activities across Ireland — halls, classes, kids' clubs, pickup games, and more, all in one place.";

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
    description: "Get discovered, get booked, and grow your community. List a community centre or sports club, or become a Host and run a Game or Circle with no venue needed.",
  },
  "/become-a-host": {
    title: "Become a Host, free — no venue needed — HelloCircle",
    description: "Host a one-off Game or start a standing Circle in minutes. No venue, no business, no approval to start — completely free.",
    image: "https://images.unsplash.com/photo-1633894812833-3961145496a3?w=1200&h=630&q=75&auto=format&fit=crop",
  },
  "/coming-soon": {
    title: "HelloCircle — launching soon in Ireland, and everywhere",
    description: "One place to book a hall, join a club, catch a pickup game, or start a recurring Circle across Ireland. Join the waitlist to be the first to know.",
  },
  "/privacy": { title: "Privacy Policy — HelloCircle", description: "How HelloCircle collects, uses, and protects your personal data." },
  "/cookies": { title: "Cookie Policy — HelloCircle", description: "How HelloCircle uses cookies and similar technologies." },
};

export function resolveMarketingOgMeta(pathName: string): OgMeta | null {
  const page = MARKETING_PAGES[pathName];
  if (!page) return null;
  return { title: page.title, description: page.description, image: page.image, jsonLd: page.jsonLd, url: `${CLIENT_URL}${pathName}`, robots: "index, follow" };
}

export async function resolveOgMeta(pathName: string): Promise<OgMeta | null> {
  const match = pathName.match(ROUTE_PATTERN);
  if (!match) return resolveLocalLandingOgMeta(pathName);
  const [, kind, idOrSlug] = match;
  const url = `${CLIENT_URL}${pathName}`;

  if (kind === "centres") {
    const row = (await db.prepare(`SELECT name, blurb, image_url, area, county FROM centres WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string; area: string; county: string }
      | undefined;
    if (!row) return null;
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(row.blurb, 200),
      image: row.image_url || undefined,
      url,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: row.name,
        description: truncate(row.blurb, 300),
        image: row.image_url || undefined,
        url,
        address: { "@type": "PostalAddress", addressLocality: row.area, addressRegion: row.county, addressCountry: "IE" },
      },
    };
  }

  if (kind === "clubs") {
    const row = (await db.prepare(`SELECT name, blurb, image_url, area, county FROM clubs WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string; area: string; county: string }
      | undefined;
    if (!row) return null;
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(row.blurb, 200),
      image: row.image_url || undefined,
      url,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: row.name,
        description: truncate(row.blurb, 300),
        image: row.image_url || undefined,
        url,
        address: { "@type": "PostalAddress", addressLocality: row.area, addressRegion: row.county, addressCountry: "IE" },
      },
    };
  }

  if (kind === "circles") {
    const row = (await db.prepare(`SELECT name, about, activity_label as activityLabel FROM circles WHERE (slug = ? OR id = ?) AND status = 'active'`).get(idOrSlug, idOrSlug)) as
      | { name: string; about: string; activityLabel: string }
      | undefined;
    if (!row) return null;
    const description = row.about || `A ${row.activityLabel || "local"} Circle on HelloCircle.`;
    return {
      title: `${row.name} — HelloCircle`,
      description: truncate(description, 200),
      url,
      // Organization, not Event — a Circle is a persistent group, not a
      // single dated occurrence (its next session is a Game, which gets its
      // own Event markup on its own detail page).
      jsonLd: { "@context": "https://schema.org", "@type": "Organization", name: row.name, description: truncate(description, 300), url },
    };
  }

  if (kind === "experiences" || kind === "adventures") {
    const row = (await db.prepare(`SELECT title, blurb, image_url FROM experiences WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { title: string; blurb: string; image_url: string }
      | undefined;
    if (!row) return null;
    // No JSON-LD here — the fields resolveOgMeta already fetches for
    // experiences/adventures (title/blurb/image only) don't include a date,
    // and Event/Product markup without one would be worse than none.
    return { title: `${row.title} — HelloCircle`, description: truncate(row.blurb, 200), image: row.image_url || undefined, url };
  }

  if (kind === "games") {
    const row = (await db
      .prepare(
        `SELECT g.activity_label as activityLabel, g.date, g.time, g.location_text as locationText, c.name as centreName
         FROM games g LEFT JOIN centres c ON c.id = g.centre_id
         WHERE g.id = ? AND g.status != 'cancelled'`
      )
      .get(idOrSlug)) as { activityLabel: string; date: string; time: string; locationText: string; centreName: string | null } | undefined;
    if (!row) return null;
    const where = row.centreName ?? row.locationText;
    return {
      title: `${row.activityLabel} — HelloCircle`,
      description: truncate(`${row.date} at ${row.time}${where ? ` · ${where}` : ""}`, 200),
      url,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Event",
        name: row.activityLabel,
        startDate: `${row.date}T${row.time}`,
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        location: { "@type": "Place", name: where || "Location to be confirmed" },
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
  return { title, description: truncate(description, 200), url: `${CLIENT_URL}${pathName}` };
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
  const [centres, clubs, circles, experiences, games, localPages] = await Promise.all([
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM centres WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM clubs WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM circles WHERE status = 'active'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT COALESCE(slug, id) as slug FROM experiences WHERE status = 'approved'`).all() as Promise<{ slug: string }[]>,
    db.prepare(`SELECT id FROM games WHERE status IN ('open', 'pending_participants') AND date >= ?`).all(todayIso) as Promise<{ id: string }[]>,
    db
      .prepare(
        `SELECT DISTINCT c.county as county, g.activity_label as activityLabel
         FROM games g JOIN centres c ON c.id = g.centre_id
         WHERE g.status = 'open' AND g.date >= ? AND c.status = 'approved'`
      )
      .all(todayIso) as Promise<{ county: string; activityLabel: string }[]>,
  ]);

  for (const c of centres) urls.push(`${CLIENT_URL}/centres/${c.slug}`);
  for (const c of clubs) urls.push(`${CLIENT_URL}/clubs/${c.slug}`);
  for (const c of circles) urls.push(`${CLIENT_URL}/circles/${c.slug}`);
  for (const e of experiences) urls.push(`${CLIENT_URL}/experiences/${e.slug}`);
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
