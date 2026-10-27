import crypto from "node:crypto";
import { Router } from "express";
import { writeAudit } from "../audit.js";
import { requireResident } from "../residents.js";
import { db } from "../db/index.js";
import { notifyResident } from "../notifications.js";
import { orgActiveSql } from "../orgSql.js";
import { cleanListingRef, resolvePlanListing, type PlanListing, type PlanListingRef } from "../circlePlanListings.js";
import { isMember, isOrganiser } from "./circleHelpers.js";

// Circles 3.1 — listings linked to a Circle (docs/circles-3.1/03-architecture.md).
// A link is not a plan (no one commits to anything) and not a copy: it points
// at the listing, which keeps its owner, price, capacity and booking flow.
// An organiser's link shows straight away; a member's waits for an organiser.
// Removing a link only ends the link. Official Circles named by a partner
// (experiences/programs/clubs.circle_id) are listed alongside, read-only.

export const circleLinksRouter = Router();

type CircleBasics = { id: string; name: string; status: string; join_mode: string };
type LinkRow = {
  id: string;
  circle_id: string;
  listing_type: string;
  listing_id: string;
  relationship: string;
  status: string;
  note: string | null;
  linked_by: string;
  created_at: string;
};

async function loadCircle(idOrSlug: string): Promise<CircleBasics | undefined> {
  return (await db.prepare(`SELECT id, name, status, join_mode FROM circles WHERE slug = ? OR id = ?`).get(idOrSlug, idOrSlug)) as CircleBasics | undefined;
}

async function organiserIds(circleId: string): Promise<string[]> {
  return ((await db.prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ? AND role = 'organiser'`).all(circleId)) as { resident_id: string }[]).map((r) => r.resident_id);
}

export type AddLinkResult =
  | { ok: true; status: "approved" | "pending"; linkId: string; created: boolean }
  | { ok: false; httpStatus: number; error: string; linkId?: string };

/** The one way a listing gets linked to a Circle — used by the Circle page,
 * listing pages and "create an activity for this Circle". Checks membership,
 * that the person can see the listing, that it hasn't finished, and that a
 * private activity only goes to its own Circle. One link per Circle +
 * listing: a live link is returned, a removed or declined one is reopened. */
export async function addListingLink(circleId: string, residentId: string, ref: PlanListingRef, opts: { note?: string; relationship?: "shared" | "created_for" } = {}): Promise<AddLinkResult> {
  const circle = (await db.prepare(`SELECT id, name, status FROM circles WHERE id = ?`).get(circleId)) as { id: string; name: string; status: string } | undefined;
  if (!circle) return { ok: false, httpStatus: 404, error: "Circle not found" };
  if (circle.status === "closed") return { ok: false, httpStatus: 409, error: "This Circle is closed" };
  if (!(await isMember(circle.id, residentId))) return { ok: false, httpStatus: 403, error: "Only members can link things to this Circle" };
  const listing = await resolvePlanListing(ref, residentId);
  if (listing.availability === "unavailable" && !listing.title) return { ok: false, httpStatus: 404, error: "That listing isn't available to link" };
  if (listing.availability === "cancelled" || listing.availability === "past") return { ok: false, httpStatus: 409, error: "That listing has already finished or been cancelled" };
  if (listing.restricted) {
    const game = (await db.prepare(`SELECT circle_id as circleId FROM games WHERE id = ?`).get(listing.id)) as { circleId: string | null } | undefined;
    if (game?.circleId !== circle.id) return { ok: false, httpStatus: 409, error: "A private activity can only be linked to its own Circle" };
  }
  const organiser = await isOrganiser(circle.id, residentId);
  const status: "approved" | "pending" = organiser ? "approved" : "pending";
  const note = (opts.note ?? "").trim().slice(0, 500) || null;
  const relationship = opts.relationship ?? "shared";

  const outcome = await db.transaction(async (tx) => {
    const existing = (await tx
      .prepare(`SELECT id, status FROM circle_listing_links WHERE circle_id = ? AND listing_type = ? AND listing_id = ? FOR UPDATE`)
      .get(circle.id, listing.type, listing.id)) as { id: string; status: string } | undefined;
    if (existing && (existing.status === "approved" || existing.status === "pending")) return { kind: "exists" as const, id: existing.id, status: existing.status };
    if (existing) {
      await tx
        .prepare(
          `UPDATE circle_listing_links SET status = ?, relationship = ?, note = ?, linked_by = ?, decided_by = ?, decided_at = ?, removed_by = NULL, removed_at = NULL WHERE id = ?`
        )
        .run(status, relationship, note, residentId, organiser ? residentId : null, organiser ? new Date() : null, existing.id);
      return { kind: "created" as const, id: existing.id };
    }
    const id = crypto.randomUUID();
    await tx
      .prepare(
        `INSERT INTO circle_listing_links (id, circle_id, listing_type, listing_id, relationship, status, note, linked_by, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, circle.id, listing.type, listing.id, relationship, status, note, residentId, organiser ? residentId : null, organiser ? new Date() : null);
    return { kind: "created" as const, id };
  });
  if (outcome.kind === "exists") return { ok: false, httpStatus: 409, error: outcome.status === "pending" ? "This is already waiting for an organiser" : "This is already linked to the Circle", linkId: outcome.id };

  if (status === "pending") {
    for (const o of await organiserIds(circle.id)) {
      await notifyResident({ residentId: o, kind: "circle", title: `Suggested for ${circle.name}: ${listing.title}`, body: "A member suggested linking this to the Circle. Approve or decline it on the Circle's Activities tab.", listingType: "circle", listingId: circle.id, ref: outcome.id });
    }
  } else {
    await tellMembers(circle, listing, residentId, outcome.id);
  }
  return { ok: true, status, linkId: outcome.id, created: true };
}

/** Members hear once, when a link becomes visible in the Circle. */
async function tellMembers(circle: { id: string; name: string }, listing: PlanListing, exceptId: string, linkId: string) {
  const members = (await db.prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ? AND resident_id != ?`).all(circle.id, exceptId)) as { resident_id: string }[];
  for (const m of members) {
    await notifyResident({ residentId: m.resident_id, kind: "circle", title: `New in ${circle.name}: ${listing.title}`, body: "Linked to the Circle. Have a look, or suggest going together.", listingType: "circle", listingId: circle.id, ref: linkId });
  }
}

// --- read --------------------------------------------------------------------

circleLinksRouter.get("/:id/links", async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const viewerId = req.resident?.id ?? null;
  const member = viewerId ? await isMember(circle.id, viewerId) : false;
  if (circle.join_mode !== "open" && !member) return res.status(403).json({ error: "Only members can see this Circle's linked listings" });
  const organiser = viewerId && member ? await isOrganiser(circle.id, viewerId) : false;

  const rows = (await db
    .prepare(`SELECT * FROM circle_listing_links WHERE circle_id = ? AND status IN ('approved', 'pending') ORDER BY created_at DESC LIMIT 100`)
    .all(circle.id)) as LinkRow[];
  const visible = rows.filter((r) => r.status === "approved" || organiser || r.linked_by === viewerId);
  const names = new Map<string, string>();
  if (member) {
    const ids = [...new Set(visible.map((r) => r.linked_by))];
    if (ids.length) {
      for (const r of (await db.prepare(`SELECT id, name FROM residents WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids)) as { id: string; name: string }[]) names.set(r.id, r.name);
    }
  }
  const out = [];
  for (const r of visible) {
    const listing = await resolvePlanListing({ type: r.listing_type as PlanListingRef["type"], id: r.listing_id }, viewerId);
    // Visitors of an open Circle only see public, still-listed things.
    if (!member && (listing.restricted || listing.availability === "unavailable")) continue;
    out.push({
      id: r.id,
      relationship: r.relationship,
      status: r.status,
      note: r.note,
      listing,
      linkedByName: member ? names.get(r.linked_by) ?? null : null,
      linkedByMe: r.linked_by === viewerId,
      canDecide: organiser && r.status === "pending" && circle.status === "active",
      canRemove: organiser || r.linked_by === viewerId,
      createdAt: r.created_at,
    });
  }

  // Official Circle of partner listings (set by the partner, managed there).
  const official: { type: "experience" | "program" | "club"; id: string }[] = [
    ...((await db.prepare(`SELECT id FROM experiences WHERE circle_id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).all(circle.id)) as { id: string }[]).map((r) => ({ type: "experience" as const, id: r.id })),
    ...((await db.prepare(`SELECT id FROM programs WHERE circle_id = ? AND status = 'published' AND ${orgActiveSql("vendor_id")}`).all(circle.id)) as { id: string }[]).map((r) => ({ type: "program" as const, id: r.id })),
    ...((await db.prepare(`SELECT id FROM clubs WHERE circle_id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).all(circle.id)) as { id: string }[]).map((r) => ({ type: "club" as const, id: r.id })),
  ];
  for (const o of official) {
    if (out.some((x) => x.listing.type === o.type && x.listing.id === o.id)) continue;
    const listing = await resolvePlanListing(o, viewerId);
    if (listing.availability === "unavailable" && !listing.title) continue;
    out.push({ id: `official:${o.type}:${o.id}`, relationship: "official", status: "approved", note: null, listing, linkedByName: null, linkedByMe: false, canDecide: false, canRemove: false, createdAt: "" });
  }
  res.json(out);
});

// --- write -------------------------------------------------------------------

circleLinksRouter.post("/:id/links", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const ref = cleanListingRef((req.body as { listing?: unknown })?.listing);
  if (!ref) return res.status(400).json({ error: "Choose something to link" });
  if ("error" in ref) return res.status(400).json({ error: ref.error });
  // A link is to the listing as a whole; a date belongs to a plan.
  ref.sessionId = null;
  const r = await addListingLink(circle.id, req.resident!.id, ref, { note: (req.body as { note?: string })?.note });
  if (!r.ok) return res.status(r.httpStatus).json({ error: r.error, ...(r.linkId ? { linkId: r.linkId } : {}) });
  res.status(201).json({ id: r.linkId, status: r.status });
});

async function linkFor(circleId: string, linkId: string): Promise<LinkRow | undefined> {
  return (await db.prepare(`SELECT * FROM circle_listing_links WHERE id = ? AND circle_id = ?`).get(linkId, circleId)) as LinkRow | undefined;
}

circleLinksRouter.post("/:id/links/:linkId/:decision(approve|decline)", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!(await isOrganiser(circle.id, req.resident!.id))) return res.status(403).json({ error: "Only organisers can approve or decline" });
  if (circle.status === "closed") return res.status(409).json({ error: "This Circle is closed" });
  const link = await linkFor(circle.id, req.params.linkId);
  if (!link) return res.status(404).json({ error: "Link not found" });
  const approve = req.params.decision === "approve";
  const r = await db
    .prepare(`UPDATE circle_listing_links SET status = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'`)
    .run(approve ? "approved" : "declined", req.resident!.id, link.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This has already been decided" });
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: approve ? "circle.link_approved" : "circle.link_declined", objectType: "circle", objectId: circle.id, newValue: { linkId: link.id, listingType: link.listing_type, listingId: link.listing_id } });
  const listing = await resolvePlanListing({ type: link.listing_type as PlanListingRef["type"], id: link.listing_id }, null);
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? String((req.body as { reason: string }).reason).trim().slice(0, 300) : "";
  if (link.linked_by !== req.resident!.id) {
    await notifyResident({
      residentId: link.linked_by,
      kind: "circle",
      title: approve ? `Added to ${circle.name}: ${listing.title || "your suggestion"}` : `Not added to ${circle.name}`,
      body: approve ? "An organiser approved your suggestion." : reason || "An organiser decided not to add it this time.",
      listingType: "circle",
      listingId: circle.id,
      ref: link.id,
    });
  }
  if (approve) await tellMembers(circle, listing, link.linked_by, link.id);
  res.json({ ok: true, status: approve ? "approved" : "declined" });
});

circleLinksRouter.delete("/:id/links/:linkId", requireResident, async (req, res) => {
  const circle = await loadCircle(req.params.id);
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const link = await linkFor(circle.id, req.params.linkId);
  if (!link || (link.status !== "approved" && link.status !== "pending")) return res.status(404).json({ error: "Link not found" });
  const organiser = await isOrganiser(circle.id, req.resident!.id);
  if (!organiser && link.linked_by !== req.resident!.id) return res.status(403).json({ error: "Only an organiser or the person who linked it can remove it" });
  // Ends the link only — the listing, its bookings and other Circles' links are untouched.
  const r = await db
    .prepare(`UPDATE circle_listing_links SET status = 'removed', removed_by = ?, removed_at = NOW() WHERE id = ? AND status IN ('approved', 'pending')`)
    .run(req.resident!.id, link.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This has already been removed" });
  await writeAudit({ actorUserId: req.resident!.id, actorKind: "resident", action: "circle.link_removed", objectType: "circle", objectId: circle.id, newValue: { linkId: link.id, listingType: link.listing_type, listingId: link.listing_id } });
  res.json({ ok: true });
});

/** Admin (adminOperations.ts): a Circle's links for review, any status. */
export async function circleLinksForAdmin(circleId: string) {
  const rows = (await db
    .prepare(
      `SELECT l.id, l.listing_type as listingType, l.listing_id as listingId, l.status, l.relationship, l.created_at as createdAt, r.name as linkedByName
       FROM circle_listing_links l LEFT JOIN residents r ON r.id = l.linked_by WHERE l.circle_id = ? ORDER BY l.created_at DESC LIMIT 200`
    )
    .all(circleId)) as { id: string; listingType: string; listingId: string; status: string; relationship: string; createdAt: string; linkedByName: string | null }[];
  return Promise.all(rows.map(async (r) => ({ ...r, title: (await resolvePlanListing({ type: r.listingType as PlanListingRef["type"], id: r.listingId }, null)).title || "(no longer listed)" })));
}

/** Admin: take a link down, with a reason the organisers see. */
export async function adminRemoveLink(circleId: string, linkId: string, adminUserId: string, reason: string): Promise<"ok" | "missing"> {
  const r = await db
    .prepare(`UPDATE circle_listing_links SET status = 'removed', removed_by = ?, removed_at = NOW() WHERE id = ? AND circle_id = ? AND status IN ('approved', 'pending')`)
    .run(adminUserId, linkId, circleId);
  if (r.changes !== 1) return "missing";
  await writeAudit({ actorUserId: adminUserId, action: "circle.link_removed_by_helloCircle", objectType: "circle", objectId: circleId, newValue: { linkId }, reason });
  for (const o of await organiserIds(circleId)) {
    await notifyResident({ residentId: o, kind: "circle", title: "A linked listing was removed", body: `HelloCircle removed a listing from your Circle: ${reason}`, listingType: "circle", listingId: circleId, ref: linkId });
  }
  return "ok";
}
