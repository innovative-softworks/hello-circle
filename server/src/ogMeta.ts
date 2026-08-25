import { db } from "./db/index.js";

// Shareable link previews (master-prompt punch list #1) — this app has no
// SSR framework, so a full per-route render isn't an option. This is the
// smallest thing that actually works: for the handful of public detail
// routes, look up the listing and inject real <meta property="og:..."> /
// twitter:card tags into the one static built index.html before serving
// it — a pasted link then shows a title/description/image before the SPA
// itself ever loads. Every other route (anything not matching one of these
// 6 patterns) falls through to the plain, unmodified index.html exactly as
// before this existed.

export interface OgMeta {
  title: string;
  description: string;
  image?: string;
  url: string;
}

const ROUTE_PATTERN = /^\/(centres|clubs|circles|experiences|adventures|games)\/([^/]+)\/?$/;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function resolveOgMeta(pathName: string, origin: string): Promise<OgMeta | null> {
  const match = pathName.match(ROUTE_PATTERN);
  if (!match) return null;
  const [, kind, idOrSlug] = match;
  const url = `${origin}${pathName}`;

  if (kind === "centres") {
    const row = (await db.prepare(`SELECT name, blurb, image_url FROM centres WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string }
      | undefined;
    if (!row) return null;
    return { title: `${row.name} — HelloCircle`, description: truncate(row.blurb, 200), image: row.image_url || undefined, url };
  }

  if (kind === "clubs") {
    const row = (await db.prepare(`SELECT name, blurb, image_url FROM clubs WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string }
      | undefined;
    if (!row) return null;
    return { title: `${row.name} — HelloCircle`, description: truncate(row.blurb, 200), image: row.image_url || undefined, url };
  }

  if (kind === "circles") {
    const row = (await db.prepare(`SELECT name, about, activity_label as activityLabel FROM circles WHERE (slug = ? OR id = ?) AND status = 'active'`).get(idOrSlug, idOrSlug)) as
      | { name: string; about: string; activityLabel: string }
      | undefined;
    if (!row) return null;
    return { title: `${row.name} — HelloCircle`, description: truncate(row.about || `A ${row.activityLabel || "local"} Circle on HelloCircle.`, 200), url };
  }

  if (kind === "experiences" || kind === "adventures") {
    const row = (await db.prepare(`SELECT title, blurb, image_url FROM experiences WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { title: string; blurb: string; image_url: string }
      | undefined;
    if (!row) return null;
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
    return { title: `${row.activityLabel} — HelloCircle`, description: truncate(`${row.date} at ${row.time}${where ? ` · ${where}` : ""}`, 200), url };
  }

  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Injects the og/twitter meta tags right after the existing static
 * <title> — never touches or duplicates the <title> tag itself. */
export function injectOgTags(html: string, meta: OgMeta): string {
  const tags = [
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");
  return html.replace("</title>", `</title>\n    ${tags}`);
}
