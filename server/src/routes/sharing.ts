import { Router } from "express";
import { logEvent } from "../analytics.js";
import { dataDir } from "../dataDir.js";
import { db } from "../db/index.js";
import { isMember } from "./circleHelpers.js";
import { renderShareCardPng } from "../shareCard.js";
import { CLIENT_URL } from "../stripe.js";

export const sharingRouter = Router();

// Universal Sharing & Invitation system, Phase 1 — the single
// getShareData(entityType, entityId) resolver every sharing surface (the
// client's <ShareSheet/>, this same route's own consumers, and eventually
// ogMeta.ts) is meant to consume, per the spec's §33 "don't duplicate
// sharing logic per page" rule. Deliberately reuses the exact same
// approved/active-only gating ogMeta.ts's resolveOgMeta already established
// per entity kind — a page that isn't publicly visible isn't shareable
// either.

export type ShareEntityType = "centre" | "club" | "circle" | "experience" | "adventure" | "game" | "program" | "host" | "provider";

export interface ShareData {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  description: string;
  image?: string | null;
  url: string;
  host?: { name: string; verified: boolean } | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  interestedCount?: number | null;
  priceCents?: number | null;
  circleName?: string | null;
  privacy: "public" | "circle_only" | "private";
  // SEO Phase 8 — Event JSON-LD completion. Only real, already-collected
  // data (games.duration_minutes/capacity, the joined centre's lat/lng) —
  // never fabricated. Each is independently optional: a free-text-location
  // game has no lat/lng, a game with no duration set has no computable
  // endDate, so ogMeta.ts's Event branch below only emits the JSON-LD
  // property when the underlying value is actually present.
  durationMinutes?: number | null;
  capacity?: number | null;
  lat?: number | null;
  lng?: number | null;
  /** §59 — set only on the cancelled-Activity branch below, so a consumer
   * (ogMeta.ts) can render an honest `EventCancelled` status instead of
   * detecting cancellation by parsing the title string. */
  cancelled?: boolean;
}

function pathFor(entityType: ShareEntityType, entityIdOrSlug: string): string {
  const seg: Record<ShareEntityType, string> = {
    centre: "centres",
    club: "clubs",
    circle: "circles",
    experience: "experiences",
    adventure: "adventures",
    game: "games",
    program: "programs",
    host: "host",
    provider: "provider",
  };
  return `/${seg[entityType]}/${entityIdOrSlug}`;
}

/** Games are the one entity in this schema with a real, enforced-nowhere-
 * else privacy tier (visibility: public|circle|invite — see games.ts;
 * `GET /games/:id`/`GET /games` don't currently gate on it at all, a
 * pre-existing gap this file doesn't attempt to fix more broadly). This
 * sharing surface is a new, more prominent way to pass a game's URL around
 * (§21/§22's explicit "never leak private content because a link was
 * copied"), so it's the one place that must actually honour the column:
 * a 'circle' game only shares full detail to the host, a member of its
 * linked circle, or an already-joined participant; an 'invite' game only
 * to the host, a joined participant, or someone with a real invitations
 * row for it. Everyone else gets the private stub shape. */
export async function canViewPrivateGame(gameId: string, circleId: string | null, viewerResidentId: string | null, hostResidentId: string): Promise<boolean> {
  if (!viewerResidentId) return false;
  if (viewerResidentId === hostResidentId) return true;
  const joined = await db.prepare(`SELECT 1 FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(gameId, viewerResidentId);
  if (joined) return true;
  if (circleId) {
    const member = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, viewerResidentId);
    if (member) return true;
  }
  const invited = await db.prepare(`SELECT 1 FROM invitations WHERE entity_type = 'game' AND entity_id = ? AND invitee_resident_id = ?`).get(gameId, viewerResidentId);
  return !!invited;
}

export async function getShareData(entityType: ShareEntityType, idOrSlug: string, viewerResidentId: string | null): Promise<ShareData | null> {
  const url = `${CLIENT_URL}${pathFor(entityType, idOrSlug)}`;

  if (entityType === "centre" || entityType === "club") {
    const table = entityType === "centre" ? "centres" : "clubs";
    const row = (await db.prepare(`SELECT name, blurb, image_url, area, county FROM ${table} WHERE (slug = ? OR id = ?) AND status = 'approved'`).get(idOrSlug, idOrSlug)) as
      | { name: string; blurb: string; image_url: string; area: string; county: string }
      | undefined;
    if (!row) return null;
    return { entityType, entityId: idOrSlug, title: row.name, description: row.blurb, image: row.image_url || null, url, location: [row.area, row.county].filter(Boolean).join(", "), privacy: "public" };
  }

  if (entityType === "circle") {
    const row = (await db
      .prepare(`SELECT id, name, about, activity_label as activityLabel, image_url as imageUrl, created_by_resident_id as createdBy, join_mode as joinMode FROM circles WHERE (slug = ? OR id = ?) AND status = 'active'`)
      .get(idOrSlug, idOrSlug)) as
      | { id: string; name: string; about: string; activityLabel: string; imageUrl: string; createdBy: string; joinMode: "open" | "approval" | "invite" }
      | undefined;
    if (!row) return null;

    // Media plan Task 2 closed this leak in circles.ts's own toCircleJson()/
    // toCircleTeaserJson() — but this file runs an entirely separate raw
    // query (getShareData is also what ogMeta.ts's og:image/sitemap and the
    // unauthenticated GET /:entityType/:entityId route both consume), which
    // never checked join_mode at all until now. Same public/private mapping
    // convention the game branch above already established: an 'open'
    // Circle shares in full; anything else falls back to a generic stub
    // (no title/about/image/host/member count) unless the viewer can
    // actually see the Circle — never leak the real name/photo into an
    // og:image or a share-card PNG that could be cached/indexed
    // independently of the page it's on.
    const privacy = row.joinMode === "open" ? "public" : "circle_only";
    if (privacy !== "public" && !(viewerResidentId && (await isMember(row.id, viewerResidentId)))) {
      return { entityType, entityId: row.id, title: "Private Circle", description: "This Circle is only visible to its members.", url, privacy };
    }

    const { n: members } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?`).get(row.id)) as { n: number };
    const creator = (await db.prepare(`SELECT name, host_status as hostStatus FROM residents WHERE id = ?`).get(row.createdBy)) as { name: string; hostStatus: string } | undefined;
    return {
      entityType,
      entityId: row.id,
      title: row.name,
      description: row.about || `A ${row.activityLabel || "local"} Circle on HelloCircle.`,
      image: row.imageUrl || null,
      url,
      host: creator ? { name: creator.name, verified: creator.hostStatus === "verified" } : null,
      interestedCount: members,
      privacy,
    };
  }

  if (entityType === "experience" || entityType === "adventure") {
    const row = (await db
      .prepare(`SELECT title, blurb, image_url, area, county, price_cents as priceCents FROM experiences WHERE (slug = ? OR id = ?) AND status = 'approved'`)
      .get(idOrSlug, idOrSlug)) as { title: string; blurb: string; image_url: string; area: string; county: string; priceCents: number | null } | undefined;
    if (!row) return null;
    return {
      entityType,
      entityId: idOrSlug,
      title: row.title,
      description: row.blurb,
      image: row.image_url || null,
      url,
      location: [row.area, row.county].filter(Boolean).join(", "),
      priceCents: row.priceCents,
      privacy: "public",
    };
  }

  if (entityType === "program") {
    const row = (await db.prepare(`SELECT id, title, description, image_url, price_cents as priceCents, listing_type as listingType, listing_id as listingId FROM programs WHERE id = ? AND status = 'published'`).get(idOrSlug)) as
      | { id: string; title: string; description: string; image_url: string; priceCents: number; listingType: string; listingId: string }
      | undefined;
    if (!row) return null;
    const listing = (await db.prepare(`SELECT name FROM ${row.listingType === "centre" ? "centres" : "clubs"} WHERE id = ?`).get(row.listingId)) as { name: string } | undefined;
    return {
      entityType,
      entityId: row.id,
      title: row.title,
      description: row.description || `A program at ${listing?.name ?? "HelloCircle"}.`,
      image: row.image_url || null,
      url,
      priceCents: row.priceCents,
      privacy: "public",
    };
  }

  if (entityType === "game") {
    const row = (await db
      .prepare(
        `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.location_text as locationText, g.price_cents as priceCents,
                g.visibility, g.circle_id as circleId, g.host_resident_id as hostResidentId, g.image_url as imageUrl,
                g.duration_minutes as durationMinutes, g.capacity as capacity, g.status as status, g.lifecycle as lifecycle,
                c.name as centreName, c.area as area, c.county as county, c.lat as lat, c.lng as lng
         FROM games g LEFT JOIN centres c ON c.id = g.centre_id
         WHERE g.id = ?`
      )
      .get(idOrSlug)) as
      | {
          id: string;
          activityLabel: string;
          date: string;
          time: string;
          locationText: string;
          priceCents: number | null;
          visibility: string;
          circleId: string | null;
          hostResidentId: string;
          imageUrl: string;
          durationMinutes: number | null;
          capacity: number;
          status: string;
          lifecycle: string;
          centreName: string | null;
          area: string | null;
          county: string | null;
          lat: number | null;
          lng: number | null;
        }
      | undefined;
    if (!row) return null;
    // §6/§54 — a Draft is never shareable/indexable/sitemap-eligible at
    // all, same as a genuinely nonexistent game (404-equivalent). This is
    // the lifecycle half of the gate; the visibility check right below is
    // the separate, pre-existing privacy half.
    if (row.lifecycle === "draft") return null;

    const privacy = row.visibility === "invite" ? "private" : row.visibility === "circle" ? "circle_only" : "public";
    if (privacy !== "public" && !(await canViewPrivateGame(row.id, row.circleId, viewerResidentId, row.hostResidentId))) {
      return {
        entityType,
        entityId: row.id,
        title: privacy === "private" ? "Invite-only activity" : "Circle-only activity",
        description: "This activity is only visible to people who've been invited.",
        url,
        privacy,
      };
    }

    // §59 — a cancelled Activity keeps a real, informative page (never
    // auto-404'd just because it's cancelled) rather than the generic
    // "invite-only" stub above or the full live-listing shape below —
    // someone who booked or was shared this link should still be able to
    // see what it was and that it was cancelled, without the page
    // implying it's still bookable.
    if (row.status === "cancelled") {
      const where = row.centreName ?? row.locationText;
      return {
        entityType,
        entityId: row.id,
        title: `${row.activityLabel} (Cancelled)`,
        description: `This activity — originally ${row.date} at ${row.time}${where ? ` · ${where}` : ""} — was cancelled.`,
        image: row.imageUrl || null,
        url,
        date: row.date,
        time: row.time,
        location: where ?? null,
        privacy: "public",
        cancelled: true,
      };
    }

    const { n: joined } = (await db.prepare(`SELECT COUNT(*) as n FROM game_participants WHERE game_id = ? AND status = 'joined'`).get(row.id)) as { n: number };
    const host = (await db.prepare(`SELECT name, host_status as hostStatus FROM residents WHERE id = ?`).get(row.hostResidentId)) as { name: string; hostStatus: string } | undefined;
    const circle = row.circleId ? ((await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(row.circleId)) as { name: string } | undefined) : undefined;
    const where = row.centreName ?? row.locationText;
    return {
      entityType,
      entityId: row.id,
      title: row.activityLabel,
      description: `${row.date} at ${row.time}${where ? ` · ${where}` : ""}`,
      image: row.imageUrl || null,
      url,
      host: host ? { name: host.name, verified: host.hostStatus === "verified" } : null,
      location: where ?? null,
      date: row.date,
      time: row.time,
      interestedCount: joined,
      priceCents: row.priceCents,
      circleName: circle?.name ?? null,
      privacy,
      durationMinutes: row.durationMinutes,
      capacity: row.capacity,
      lat: row.lat !== null ? Number(row.lat) : null,
      lng: row.lng !== null ? Number(row.lng) : null,
    };
  }

  if (entityType === "host") {
    const row = (await db.prepare(`SELECT id, name, host_bio as bio, host_status as hostStatus FROM residents WHERE id = ?`).get(idOrSlug)) as
      | { id: string; name: string; bio: string | null; hostStatus: string }
      | undefined;
    if (!row || row.hostStatus !== "verified") return null;
    return { entityType, entityId: row.id, title: `${row.name} on HelloCircle`, description: row.bio || `See what ${row.name} is hosting on HelloCircle.`, url, host: { name: row.name, verified: true }, privacy: "public" };
  }

  if (entityType === "provider") {
    const row = (await db.prepare(`SELECT id, name, business_name as businessName, description, logo FROM users WHERE id = ? AND role = 'vendor' AND status = 'approved'`).get(idOrSlug)) as
      | { id: string; name: string; businessName: string; description: string; logo: string | null }
      | undefined;
    if (!row) return null;
    return { entityType, entityId: row.id, title: row.businessName || row.name, description: row.description || `See what's on with ${row.businessName || row.name} on HelloCircle.`, image: row.logo || null, url, privacy: "public" };
  }

  return null;
}

sharingRouter.get("/:entityType/:entityId", async (req, res) => {
  const entityType = req.params.entityType as ShareEntityType;
  const data = await getShareData(entityType, req.params.entityId, req.resident?.id ?? null);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

// Dynamic branded share-card image (§14) — this is what ogMeta.ts's
// `og:image`/Twitter card actually points to for every kind now (see that
// file's own resolveOgMeta), so a link pasted into WhatsApp/iMessage/Slack
// shows the on-brand card, not a bare listing photo. Also offered directly
// in <ShareSheet/> as a "Download image" action for manual reposting
// (Instagram has no web share-target API, same limitation the spec itself
// calls out). Never gated on privacy beyond what getShareData already
// enforces — a private-stub ShareData renders its own generic "invite-only
// activity" card rather than leaking the real title/photo into an image
// URL that could be cached/indexed independently of the page it's on.
sharingRouter.get("/:entityType/:entityId/card.png", async (req, res) => {
  const entityType = req.params.entityType as ShareEntityType;
  const data = await getShareData(entityType, req.params.entityId, req.resident?.id ?? null);
  if (!data) return res.status(404).json({ error: "Not found" });
  try {
    const png = await renderShareCardPng(data, dataDir);
    // Short, public cache — cheap enough to regenerate on demand, but a
    // crawler (Facebook/WhatsApp/Slack all cache og:image aggressively on
    // their own side regardless) or a repeat viewer within the window
    // shouldn't force a fresh render every time.
    res.set("Cache-Control", "public, max-age=600");
    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (e) {
    console.error("[sharing] card render failed:", e);
    res.status(500).json({ error: "Couldn't generate the share card image" });
  }
});

// Client-only lifecycle events with no natural server mutation to hang them
// off (opening the sheet, picking a channel, copying the link) — a small
// allowlist, not an arbitrary event sink; everything else (invite created/
// accepted/declined, a shared link landing) is logged directly at the point
// it actually happens (routes/invitations.ts, routes/referrals.ts).
const CLIENT_EVENT_ALLOWLIST = new Set(["share_opened", "share_channel_selected", "share_completed", "share_link_copied", "share_to_circle"] as const);

sharingRouter.post("/event", async (req, res) => {
  const { event, entityType, entityId, channel } = req.body as { event?: string; entityType?: string; entityId?: string; channel?: string };
  if (!event || !CLIENT_EVENT_ALLOWLIST.has(event as never)) return res.status(400).json({ error: "Unknown event" });
  void logEvent(event as "share_opened", { residentId: req.resident?.id ?? null, metadata: { entityType, entityId, channel } });
  res.status(201).json({ ok: true });
});
