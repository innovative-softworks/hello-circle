import { Router } from "express";
import multer from "multer";
import { orgVendorIds } from "../auth.js";
import { db } from "../db/index.js";
import { findMediaAssetByProviderKey, findMediaAssetsByGroup, markDeletedByProviderKey } from "../media/mediaAssets.js";
import { isMember, isOrganiser } from "./circleHelpers.js";
import {
  authorizeUpload,
  deleteObject,
  finalizeUpload,
  getRestrictedDeliveryUrl,
  isLocalProcessingEnabled,
  isR2Enabled,
  MediaValidationError,
  objectKeyFromUrl,
  objectKeyFromUrlForEntity,
  siblingVariantKey,
  uploadWithLocalProcessing,
  type MediaEntityType,
  type MediaVariant,
} from "../media/mediaService.js";

export const mediaRouter = Router();

// Two-step upload lifecycle (media plan §6): authorize -> browser uploads
// directly to R2 -> finalize. Neither step writes to any product table —
// the caller's own existing entity-update request (e.g. PUT
// /vendor/centres/:id with the finalized URL in its images array) still
// owns that write, same as it already does for the legacy /api/uploads
// flow. This keeps every existing gallery-management endpoint's own
// validation/side-effects (recomputeCentreRollup, audit logs, etc.)
// completely unchanged.

async function ownsCentreOrClub(vendorIds: string[], table: "centres" | "clubs", id: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM ${table} WHERE id = ?`).get(id)) as { vendor_id: string } | undefined;
  return !!row && vendorIds.includes(row.vendor_id);
}

async function ownsClubSession(vendorIds: string[], sessionId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT cl.vendor_id FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id WHERE cs.id = ?`).get(sessionId)) as
    | { vendor_id: string }
    | undefined;
  return !!row && vendorIds.includes(row.vendor_id);
}

async function ownsExperience(vendorIds: string[], id: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM experiences WHERE id = ?`).get(id)) as { vendor_id: string } | undefined;
  return !!row && vendorIds.includes(row.vendor_id);
}

async function ownsProgram(vendorIds: string[], id: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM programs WHERE id = ?`).get(id)) as { vendor_id: string } | undefined;
  return !!row && vendorIds.includes(row.vendor_id);
}

async function isActivityHost(residentId: string, gameId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT host_resident_id FROM games WHERE id = ?`).get(gameId)) as { host_resident_id: string } | undefined;
  return !!row && row.host_resident_id === residentId;
}

/** The /release contract has always assumed the caller's own entity-update
 * request already committed the DB change removing this url BEFORE
 * calling release (see this file's top-of-file comment) — that's a
 * client-side ordering assumption, never server-enforced. This re-checks
 * the entity's LIVE reference(s) immediately before deleting, so a
 * caller (buggy client, or a stale/duplicate request) can't delete an
 * object that's still the entity's actual current cover/gallery image.
 * Deliberately conservative: any error resolving this returns `true`
 * (treat as "still referenced", i.e. refuse to delete) rather than `false`. */
async function isUrlStillReferenced(entityType: MediaEntityType, entityId: string, url: string): Promise<boolean> {
  switch (entityType) {
    case "resident-avatar": {
      const row = (await db.prepare(`SELECT avatar_url FROM residents WHERE id = ?`).get(entityId)) as { avatar_url: string | null } | undefined;
      return row?.avatar_url === url;
    }
    case "activity-cover": {
      const row = (await db.prepare(`SELECT image_url FROM games WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      return row?.image_url === url;
    }
    case "circle-cover": {
      const row = (await db.prepare(`SELECT image_url FROM circles WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      return row?.image_url === url;
    }
    case "centre-gallery": {
      const centre = (await db.prepare(`SELECT image_url FROM centres WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      if (centre?.image_url === url) return true;
      const gallery = (await db.prepare(`SELECT 1 FROM centre_images WHERE centre_id = ? AND url = ? LIMIT 1`).get(entityId, url)) as unknown;
      return !!gallery;
    }
    case "club-gallery": {
      const club = (await db.prepare(`SELECT image_url FROM clubs WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      if (club?.image_url === url) return true;
      const gallery = (await db.prepare(`SELECT 1 FROM club_images WHERE club_id = ? AND url = ? LIMIT 1`).get(entityId, url)) as unknown;
      return !!gallery;
    }
    case "club-session-cover": {
      const row = (await db.prepare(`SELECT image_url FROM club_sessions WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      return row?.image_url === url;
    }
    case "experience-gallery": {
      const experience = (await db.prepare(`SELECT image_url FROM experiences WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      if (experience?.image_url === url) return true;
      const gallery = (await db.prepare(`SELECT 1 FROM experience_images WHERE experience_id = ? AND url = ? LIMIT 1`).get(entityId, url)) as unknown;
      return !!gallery;
    }
    case "program-cover": {
      const row = (await db.prepare(`SELECT image_url FROM programs WHERE id = ?`).get(entityId)) as { image_url: string } | undefined;
      return row?.image_url === url;
    }
    case "org-logo": {
      const row = (await db.prepare(`SELECT logo FROM users WHERE org_id = ? OR id = ? LIMIT 1`).get(entityId, entityId)) as { logo: string | null } | undefined;
      return row?.logo === url;
    }
    case "vendor-draft-media":
      // Draft-wizard photos are never persisted to any entity row before
      // the listing exists — nothing to check a reference against.
      return false;
    default:
      return true; // unknown type — conservative refusal, not a silent allow
  }
}

/** This router is mounted at the top level (not under vendorRouter), so
 * req.vendorIds — normally attached by vendor.ts's own attachVendorIds
 * middleware — is never populated here. Compute it inline instead of
 * relying on that middleware; orgVendorIds() is the same function it
 * calls under the hood, so behavior (org-wide ownership, not just the
 * requesting user's own rows) is identical. */
async function requireApprovedVendor(req: import("express").Request): Promise<{ status: number; error: string } | string[]> {
  if (!req.user) return { status: 401, error: "Vendor login required" };
  if (req.user.role !== "vendor" || req.user.status !== "approved") return { status: 403, error: "Vendor account required" };
  return orgVendorIds(req.user);
}

/** Every authorization check lives here, one per MediaEntityType — reuses
 * this app's existing ownership model exactly (org-scoped vendorIds for
 * listings, circle organiser role, game host id, resident's own id) rather
 * than inventing a second one, per the media plan's §7 instruction not to
 * build parallel authorization. */
async function checkUploadPermission(
  req: import("express").Request,
  entityType: MediaEntityType,
  entityId: string
): Promise<{ status: number; error: string } | null> {
  switch (entityType) {
    case "resident-avatar":
      if (!req.resident) return { status: 401, error: "Sign in required" };
      if (req.resident.id !== entityId) return { status: 403, error: "You can only manage your own avatar" };
      return null;
    case "activity-cover":
      if (!req.resident) return { status: 401, error: "Sign in required" };
      if (!(await isActivityHost(req.resident.id, entityId))) return { status: 403, error: "Only the host can manage this activity's cover" };
      return null;
    case "circle-cover":
      if (!req.resident) return { status: 401, error: "Sign in required" };
      if (!(await isOrganiser(entityId, req.resident.id))) return { status: 403, error: "Only the organiser can manage this Circle's cover" };
      return null;
    case "centre-gallery": {
      const vendorIds = await requireApprovedVendor(req);
      if (!Array.isArray(vendorIds)) return vendorIds;
      if (!(await ownsCentreOrClub(vendorIds, "centres", entityId))) return { status: 403, error: "Not your listing" };
      return null;
    }
    case "club-gallery": {
      const vendorIds = await requireApprovedVendor(req);
      if (!Array.isArray(vendorIds)) return vendorIds;
      if (!(await ownsCentreOrClub(vendorIds, "clubs", entityId))) return { status: 403, error: "Not your listing" };
      return null;
    }
    case "club-session-cover": {
      const vendorIds = await requireApprovedVendor(req);
      if (!Array.isArray(vendorIds)) return vendorIds;
      if (!(await ownsClubSession(vendorIds, entityId))) return { status: 403, error: "Not your session" };
      return null;
    }
    case "experience-gallery": {
      const vendorIds = await requireApprovedVendor(req);
      if (!Array.isArray(vendorIds)) return vendorIds;
      if (!(await ownsExperience(vendorIds, entityId))) return { status: 403, error: "Not your listing" };
      return null;
    }
    case "program-cover": {
      const vendorIds = await requireApprovedVendor(req);
      if (!Array.isArray(vendorIds)) return vendorIds;
      if (!(await ownsProgram(vendorIds, entityId))) return { status: 403, error: "Not your listing" };
      return null;
    }
    case "org-logo":
      if (!req.user) return { status: 401, error: "Vendor login required" };
      if (req.user.invitedStaff) return { status: 403, error: "Only the organisation owner can edit this" };
      if (req.user.orgId !== entityId) return { status: 403, error: "Not your organisation" };
      return null;
    case "vendor-draft-media": {
      // No listing exists yet (creation-wizard photos) — any approved
      // member of the org named by entityId may upload here, same
      // role-only gate the legacy /api/uploads route always had. entityId
      // is the vendor's own orgId (or user id, if orgId is somehow null),
      // never a listing id.
      if (!req.user) return { status: 401, error: "Vendor login required" };
      if (req.user.role !== "vendor" || req.user.status !== "approved") return { status: 403, error: "Vendor account required" };
      const scope = req.user.orgId ?? req.user.id;
      if (scope !== entityId) return { status: 403, error: "Not your organisation" };
      return null;
    }
    default:
      return { status: 400, error: "Unknown entity type" };
  }
}

const ENTITY_TYPES = new Set<MediaEntityType>([
  "resident-avatar",
  "activity-cover",
  "circle-cover",
  "centre-gallery",
  "club-gallery",
  "club-session-cover",
  "experience-gallery",
  "program-cover",
  "org-logo",
  "vendor-draft-media",
]);

// Runs attachUser/attachResident (already global, see index.ts) but not a
// single blanket role gate — permission is entity-type-specific, checked
// per request above, since one router here legitimately serves residents,
// hosts, circle organisers and vendors alike.

mediaRouter.post("/authorize", async (req, res) => {
  const { entityType, entityId, contentType } = req.body as { entityType?: string; entityId?: string; contentType?: string };
  if (!entityType || !entityId || !contentType || !ENTITY_TYPES.has(entityType as MediaEntityType)) {
    return res.status(400).json({ error: "entityType, entityId and contentType are required" });
  }

  // Authorization is checked before revealing anything about R2's
  // configuration state — an unauthorized caller shouldn't be able to
  // distinguish "not your listing" from "media storage isn't set up" by
  // probing entity ids.
  const denied = await checkUploadPermission(req, entityType as MediaEntityType, entityId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (!isR2Enabled()) return res.status(503).json({ error: "Cloud media storage is not configured", provider: "local" });

  try {
    const result = await authorizeUpload(entityType as MediaEntityType, entityId, contentType);
    res.json({ provider: "r2", ...result });
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

mediaRouter.post("/finalize", async (req, res) => {
  const { entityType, entityId, objectKey } = req.body as { entityType?: string; entityId?: string; objectKey?: string };
  if (!entityType || !entityId || !objectKey || !ENTITY_TYPES.has(entityType as MediaEntityType)) {
    return res.status(400).json({ error: "entityType, entityId and objectKey are required" });
  }

  const denied = await checkUploadPermission(req, entityType as MediaEntityType, entityId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (!isR2Enabled()) return res.status(503).json({ error: "Cloud media storage is not configured", provider: "local" });

  try {
    const result = await finalizeUpload(entityType as MediaEntityType, entityId, objectKey);
    res.json(result);
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Best-effort delete of an R2 object a caller no longer references (e.g.
// replacing a gallery image) — the caller's own entity-update request has
// already committed the DB change before calling this, matching plan §24
// ("only remove the old asset after the replacement has been committed").
mediaRouter.post("/release", async (req, res) => {
  const { entityType, entityId, url } = req.body as { entityType?: string; entityId?: string; url?: string };
  if (!entityType || !entityId || !url || !ENTITY_TYPES.has(entityType as MediaEntityType)) {
    return res.status(400).json({ error: "entityType, entityId and url are required" });
  }
  const denied = await checkUploadPermission(req, entityType as MediaEntityType, entityId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (!isR2Enabled()) return res.json({ ok: true });

  // Re-check the entity's LIVE reference immediately before deleting — the
  // caller's own entity-update request is *supposed* to have already
  // removed this url, but that's a client-side ordering assumption, not
  // something this endpoint can trust on its own (see isUrlStillReferenced's
  // own doc comment).
  if (await isUrlStillReferenced(entityType as MediaEntityType, entityId, url)) {
    return res.status(409).json({ error: "That image is still this item's current photo — update it first, then release the old one" });
  }

  let objectKey: string | null;
  try {
    // Owning entityId alone (checked above) doesn't prove this specific url
    // belongs to it — without this, an owner of entity A could delete
    // entity B's object by passing B's url here.
    objectKey = objectKeyFromUrlForEntity(entityType as MediaEntityType, entityId, url);
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(403).json({ error: "That image does not belong to this entity" });
    throw e;
  }
  if (objectKey) {
    // A local-processing upload produces several REAL objects (thumbnail/
    // card/hero, or just avatar) sharing one ledger group_id — deleting
    // only the canonical (hero) key would silently orphan the rest in R2
    // forever. The ledger's group_id is the source of truth for "every
    // object this canonical URL actually implies"; a legacy/single-file
    // asset (no matching row, or a row with no group_id) just deletes the
    // one key, exactly as before.
    const row = await findMediaAssetByProviderKey("r2", objectKey);
    if (row?.groupId) {
      const siblings = await findMediaAssetsByGroup(row.groupId);
      for (const sibling of siblings) {
        await deleteObject(sibling.providerKey);
        await markDeletedByProviderKey("r2", sibling.providerKey).catch(() => {});
      }
    } else {
      await deleteObject(objectKey);
      await markDeletedByProviderKey("r2", objectKey).catch(() => {});
    }
  }
  res.json({ ok: true });
});

const localProcessingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single("file");

// Local-processing upload (Cost Controls, Changeset 2) — a single
// multipart POST, not the presigned two-step flow above. Gated by
// MEDIA_LOCAL_PROCESSING_ENABLED (off by default); a 503 here is the
// signal client/src/api/media.ts's uploadMedia() uses to fall back to the
// presigned flow automatically, same "try the newer path, fall back on
// 503" idiom already used for the R2-vs-local-disk fallback.
mediaRouter.post("/upload", localProcessingUpload, async (req, res) => {
  const { entityType, entityId } = req.body as { entityType?: string; entityId?: string };
  if (!entityType || !entityId || !ENTITY_TYPES.has(entityType as MediaEntityType)) {
    return res.status(400).json({ error: "entityType and entityId are required" });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const denied = await checkUploadPermission(req, entityType as MediaEntityType, entityId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (!isR2Enabled()) return res.status(503).json({ error: "Cloud media storage is not configured", provider: "local" });
  if (!isLocalProcessingEnabled()) return res.status(503).json({ error: "Local media processing is not configured" });

  try {
    const result = await uploadWithLocalProcessing(entityType as MediaEntityType, entityId, req.file.buffer, req.file.mimetype);
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Restricted delivery — the one privacy-sensitive case the Image/Media
// audit flagged concretely (§18/§19): an invite-only/approval Circle's
// cover must not be permanently fetchable at a flat public URL just
// because its underlying file lives in the same bucket as everything
// else's public media. This issues a short-lived signed GET straight
// against R2 (bypassing the public custom domain + Image Resizing
// entirely) only after re-running the same canViewCircleFull check the
// Circle's own JSON routes already enforce. Never persisted (§20).
mediaRouter.get("/circles/:id/cover", async (req, res) => {
  const circle = (await db.prepare(`SELECT image_url, join_mode FROM circles WHERE id = ?`).get(req.params.id)) as
    | { image_url: string | null; join_mode: string }
    | undefined;
  if (!circle || !circle.image_url) return res.status(404).json({ error: "No cover image" });

  const viewerId = req.resident?.id ?? null;
  const canView = circle.join_mode === "open" ? true : !!viewerId && (await isMember(req.params.id, viewerId));
  if (!canView) return res.status(403).json({ error: "You don't have access to this Circle" });

  if (!isR2Enabled()) return res.status(503).json({ error: "Cloud media storage is not configured" });

  let objectKey = objectKeyFromUrl(circle.image_url);
  if (!objectKey) return res.status(404).json({ error: "No cover image" });

  // A local-processing cover has several real, differently-sized objects
  // sharing the canonical key's naming convention — the caller picks
  // which one via ?variant=, and the sibling key is derived and a FRESH
  // signed url generated for it HERE, server-side. This never rewrites an
  // already-issued signed url client-side (that's a `secure media` red
  // line — a filename change invalidates a signature anyway, so the
  // client couldn't do this even if it tried); it just picks which real
  // object to sign before signing it. A legacy/single-file cover (no
  // matching suffix) ignores ?variant= entirely and signs the one file
  // that exists, same as before this pass.
  const VALID_VARIANTS: MediaVariant[] = ["avatar", "thumbnail", "card", "hero"];
  const requestedVariant = req.query.variant;
  if (typeof requestedVariant === "string" && (VALID_VARIANTS as string[]).includes(requestedVariant)) {
    const siblingKey = siblingVariantKey(objectKey, requestedVariant as MediaVariant);
    if (siblingKey) objectKey = siblingKey;
  }

  const signedUrl = await getRestrictedDeliveryUrl(objectKey);
  res.redirect(302, signedUrl);
});

mediaRouter.use((err: Error, _req: unknown, res: import("express").Response, _next: unknown) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message });
});
