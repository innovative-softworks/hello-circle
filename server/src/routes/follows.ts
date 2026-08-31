import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";
import { getProviderUpcoming } from "../db/queries.js";
import { notifyResident } from "../notifications.js";

export const followsRouter = Router();
followsRouter.use(requireResident);

// Follow — "keep me in the loop" on a vendor Provider, a specific centre
// (venue), or a resident Host (see db/index.ts's `follows` table comment
// for why this is a separate table from favourites, not an extension of
// it). Deliberately no activity-type/interest or place/area type yet — no
// concrete entity id for either in this app's data model today, so isn't
// offered here rather than inventing a fake one.

const FOLLOWED_TYPES = ["vendor", "host", "centre"] as const;
type FollowedType = (typeof FOLLOWED_TYPES)[number];
const LEVELS = ["highlights", "everything"] as const;
type NotificationLevel = (typeof LEVELS)[number];

async function isFollowable(type: FollowedType, id: string): Promise<boolean> {
  if (type === "vendor") {
    const row = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'vendor' AND status = 'approved'`).get(id);
    return !!row;
  }
  if (type === "centre") {
    const row = await db.prepare(`SELECT id FROM centres WHERE id = ? AND status = 'approved'`).get(id);
    return !!row;
  }
  const row = await db.prepare(`SELECT id FROM residents WHERE id = ? AND host_status = 'verified'`).get(id);
  return !!row;
}

interface FollowRow {
  followedType: FollowedType;
  followedId: string;
  notificationLevel: NotificationLevel;
}

/** Every standing follow this resident holds, enriched with a display
 * name/image the same way favourites.ts's attachListingDetails does for
 * favourites — batched by type (one query per type present) rather than
 * per row. Backs the My Life "Following" panel; there was previously no
 * way for a resident to see their own follow list in one place. */
followsRouter.get("/", async (req, res) => {
  const rows = (await db
    .prepare(`SELECT followed_type as followedType, followed_id as followedId, notification_level as notificationLevel FROM follows WHERE resident_id = ? ORDER BY created_at DESC`)
    .all(req.resident!.id)) as FollowRow[];
  if (rows.length === 0) return res.json([]);

  const vendorIds = rows.filter((r) => r.followedType === "vendor").map((r) => r.followedId);
  const hostIds = rows.filter((r) => r.followedType === "host").map((r) => r.followedId);
  const centreIds = rows.filter((r) => r.followedType === "centre").map((r) => r.followedId);
  const names = new Map<string, { name: string; imageUrl: string | null }>();

  await Promise.all([
    vendorIds.length
      ? (db
          .prepare(`SELECT id, business_name as businessName, name, logo FROM users WHERE id IN (${vendorIds.map(() => "?").join(",")})`)
          .all(...vendorIds) as Promise<{ id: string; businessName: string; name: string; logo: string | null }[]>
        ).then((r) => r.forEach((v) => names.set(`vendor:${v.id}`, { name: v.businessName || v.name, imageUrl: v.logo || null })))
      : Promise.resolve(),
    hostIds.length
      ? (db.prepare(`SELECT id, name FROM residents WHERE id IN (${hostIds.map(() => "?").join(",")})`).all(...hostIds) as Promise<{ id: string; name: string }[]>).then((r) =>
          r.forEach((h) => names.set(`host:${h.id}`, { name: h.name, imageUrl: null }))
        )
      : Promise.resolve(),
    centreIds.length
      ? (db.prepare(`SELECT id, name, image_url as imageUrl FROM centres WHERE id IN (${centreIds.map(() => "?").join(",")})`).all(...centreIds) as Promise<
          { id: string; name: string; imageUrl: string | null }[]
        >).then((r) => r.forEach((c) => names.set(`centre:${c.id}`, { name: c.name, imageUrl: c.imageUrl })))
      : Promise.resolve(),
  ]);

  const hrefFor = (r: FollowRow) => (r.followedType === "vendor" ? `/provider/${r.followedId}` : r.followedType === "centre" ? `/centres/${r.followedId}` : `/host/${r.followedId}`);

  res.json(
    rows.map((r) => ({
      followedType: r.followedType,
      followedId: r.followedId,
      notificationLevel: r.notificationLevel,
      name: names.get(`${r.followedType}:${r.followedId}`)?.name ?? null,
      imageUrl: names.get(`${r.followedType}:${r.followedId}`)?.imageUrl ?? null,
      href: hrefFor(r),
    }))
  );
});

followsRouter.post("/", async (req, res) => {
  const { followedType, followedId } = req.body as { followedType?: FollowedType; followedId?: string };
  if (!followedType || !followedId || !FOLLOWED_TYPES.includes(followedType)) {
    return res.status(400).json({ error: "followedType and followedId are required" });
  }
  if (!(await isFollowable(followedType, followedId))) return res.status(404).json({ error: "Nothing to follow here" });

  await db
    .prepare(`INSERT INTO follows (resident_id, followed_type, followed_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE resident_id = resident_id`)
    .run(req.resident!.id, followedType, followedId);
  res.status(201).json({ ok: true });
});

followsRouter.delete("/", async (req, res) => {
  const { followedType, followedId } = req.body as { followedType?: string; followedId?: string };
  if (!followedType || !followedId) return res.status(400).json({ error: "followedType and followedId are required" });
  await db.prepare(`DELETE FROM follows WHERE resident_id = ? AND followed_type = ? AND followed_id = ?`).run(req.resident!.id, followedType, followedId);
  res.json({ ok: true });
});

followsRouter.put("/notification-level", async (req, res) => {
  const { followedType, followedId, level } = req.body as { followedType?: string; followedId?: string; level?: NotificationLevel };
  if (!followedType || !followedId || !level || !LEVELS.includes(level)) {
    return res.status(400).json({ error: "followedType, followedId and a valid level are required" });
  }
  await db
    .prepare(`UPDATE follows SET notification_level = ? WHERE resident_id = ? AND followed_type = ? AND followed_id = ?`)
    .run(level, req.resident!.id, followedType, followedId);
  res.json({ ok: true });
});

// "From people you follow" — Explore's basic personalization row. Reuses
// getProviderUpcoming() (already built for Provider Profile) per followed
// vendor rather than a new giant join; host activity is just their
// upcoming open games, capped the same way.
followsRouter.get("/feed", async (req, res) => {
  const follows = (await db.prepare(`SELECT followed_type as followedType, followed_id as followedId FROM follows WHERE resident_id = ?`).all(req.resident!.id)) as {
    followedType: FollowedType;
    followedId: string;
  }[];
  if (follows.length === 0) return res.json([]);

  const vendorIds = follows.filter((f) => f.followedType === "vendor").map((f) => f.followedId);
  const hostIds = follows.filter((f) => f.followedType === "host").map((f) => f.followedId);

  const [vendorItems, hostItems] = await Promise.all([
    Promise.all(vendorIds.map((id) => getProviderUpcoming(id, 3))).then((lists) => lists.flat()),
    hostIds.length
      ? (db
          .prepare(
            `SELECT g.id, g.activity_label as title, g.date, g.time, g.image_url as imageUrl, c.name as centreName
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.host_resident_id IN (${hostIds.map(() => "?").join(",")}) AND g.status = 'open' AND g.date >= CURDATE()
             ORDER BY g.date, g.time LIMIT 6`
          )
          .all(...hostIds) as Promise<{ id: string; title: string; date: string; time: string; imageUrl: string | null; centreName: string | null }[]>)
      : Promise.resolve([]),
  ]);

  const items = [
    ...vendorItems.map((v) => ({ kind: v.kind as string, id: v.id, title: v.title, date: v.date, time: v.time, href: v.href, imageUrl: v.imageUrl })),
    ...hostItems.map((g) => ({ kind: "game", id: g.id, title: g.title, date: g.date, time: g.time, href: `/games/${g.id}`, imageUrl: g.imageUrl })),
  ];
  items.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  res.json(items.slice(0, 6));
});

/** Notifies a vendor's followers of something new. `minLevel: "everything"`
 * restricts to followers who opted into every update (e.g. a new session on
 * an existing listing); omitted/"highlights" notifies everyone following,
 * since a listing going live is exactly the kind of update Highlights
 * exists for. Never throws — same contract as notifyResident itself. */
export async function notifyVendorFollowers(vendorId: string, params: { title: string; body: string; ref: string }, minLevel: "highlights" | "everything" = "highlights") {
  try {
    const followers = (await db
      .prepare(`SELECT resident_id as residentId FROM follows WHERE followed_type = 'vendor' AND followed_id = ? ${minLevel === "everything" ? "AND notification_level = 'everything'" : ""}`)
      .all(vendorId)) as { residentId: string }[];
    await Promise.all(
      followers.map((f) =>
        notifyResident({ residentId: f.residentId, kind: "provider_update", title: params.title, body: params.body, listingType: "vendor", listingId: vendorId, ref: params.ref })
      )
    );
  } catch (e) {
    console.error("[follows] notifyVendorFollowers failed:", e);
  }
}

/** Notifies a verified host's followers of a new Game — both notification
 * levels, since a single host's activity volume is low enough that
 * Highlights/Everything don't need to diverge the way they do for a vendor
 * with many listings. */
export async function notifyHostFollowers(hostResidentId: string, params: { title: string; body: string; ref: string }) {
  try {
    const followers = (await db.prepare(`SELECT resident_id as residentId FROM follows WHERE followed_type = 'host' AND followed_id = ?`).all(hostResidentId)) as { residentId: string }[];
    await Promise.all(
      followers.map((f) =>
        notifyResident({ residentId: f.residentId, kind: "host_update", title: params.title, body: params.body, listingType: "host", listingId: hostResidentId, ref: params.ref })
      )
    );
  } catch (e) {
    console.error("[follows] notifyHostFollowers failed:", e);
  }
}

/** Notifies a specific centre's own followers — narrower than
 * notifyVendorFollowers, which reaches everyone following the vendor
 * account behind possibly several venues. A vendor with multiple centres
 * following the same "everything" convention as notifyVendorFollowers
 * would double-notify a resident who follows both the vendor and one of
 * their centres; that's an accepted, rare overlap rather than something
 * this v1 dedupes against. */
export async function notifyCentreFollowers(centreId: string, params: { title: string; body: string; ref: string }) {
  try {
    const followers = (await db.prepare(`SELECT resident_id as residentId FROM follows WHERE followed_type = 'centre' AND followed_id = ?`).all(centreId)) as { residentId: string }[];
    await Promise.all(
      followers.map((f) =>
        notifyResident({ residentId: f.residentId, kind: "centre_update", title: params.title, body: params.body, listingType: "centre", listingId: centreId, ref: params.ref })
      )
    );
  } catch (e) {
    console.error("[follows] notifyCentreFollowers failed:", e);
  }
}
