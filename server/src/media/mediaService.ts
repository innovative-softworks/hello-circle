import crypto from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSetting } from "../db/index.js";
import { cloudinary } from "./cloudinaryClient.js";
import { mediaConfig } from "./config.js";
import { AVATAR_ONLY_VARIANTS, ConcurrencyLimiter, generateVariants, loadForProcessing, STANDARD_VARIANTS, type VariantSpec } from "./imageProcessing.js";
import { exceedsMaxMegapixels, sniffImage, type SniffedFormat } from "./imageSniff.js";
import { getMediaAsset, markMediaAssetStatus, promoteMediaAsset, recordMediaAsset } from "./mediaAssets.js";
import { MediaValidationError, type MediaVariant } from "./mediaTypes.js";
import { r2Client } from "./r2Client.js";

export { MediaValidationError, type MediaVariant };

/** Every real image surface this app has (or is adding) — see the Image/
 * Media System Audit §1/§4. Used only to namespace object keys
 * (`{entityType}/{entityId}/{purpose}/{uuid}.ext`); authorization per type
 * is enforced by routes/media.ts, not here. */
export type MediaEntityType =
  | "resident-avatar"
  | "activity-cover"
  | "circle-cover"
  | "centre-gallery"
  | "club-gallery"
  | "club-session-cover"
  | "experience-gallery"
  | "program-cover"
  | "org-logo"
  // Centre/Club/Experience creation wizards upload photos before the
  // listing itself exists (no real id to check ownership against yet) —
  // scoped by the vendor's own orgId instead of a specific listing, same
  // security model the legacy /api/uploads route already had (role-gated,
  // not entity-gated) for exactly this case. Once the listing is created,
  // its own PUT request attaches these same URLs — no re-upload, no move.
  | "vendor-draft-media"
  // A small, admin-managed, freestanding editorial image collection — NOT
  // a vendor/resident upload surface, and not attached to any existing
  // entity row (no listing/circle/etc. "owns" one), so it has no
  // entityId in the usual sense. Routed to Cloudinary rather than R2 (see
  // mediaAssets.ts's CREATE TABLE comment) specifically because it's the
  // one category the media architecture plan designates for the optional
  // second provider — everything else stays on R2 by default, per policy.
  | "editorial-image";

/** MediaVariant itself now lives in mediaTypes.ts (see this file's import/
 * re-export above) — the four presentation classes are still deliberately
 * bounded (not arbitrary user-controlled dimensions) so processing/
 * transformation cost stays predictable. VARIANT_TRANSFORM below is the
 * legacy R2-dynamic-transform table, still used by the OLD presigned
 * upload path (kept as a rollback option — see isLocalProcessingEnabled())
 * and by anything not yet migrated to a locally-pre-generated variant. */
export const VARIANT_TRANSFORM: Record<MediaVariant, string> = {
  avatar: "width=256,height=256,fit=cover,format=auto",
  thumbnail: "width=360,fit=scale-down,format=auto",
  card: "width=800,fit=scale-down,format=auto",
  hero: "width=1600,fit=scale-down,format=auto",
};

/** Cloudinary equivalents — `c_limit` (never upscales, matches R2's
 * `fit=scale-down`) for everything except `avatar`, which crops to an exact
 * square the same way `fit=cover` does. `f_auto,q_auto` mirrors
 * `format=auto` (serve WebP/AVIF where the browser supports it, otherwise
 * the original format) at Cloudinary's automatic quality setting. */
export const CLOUDINARY_VARIANT_TRANSFORM: Record<MediaVariant, string> = {
  avatar: "w_256,h_256,c_fill,g_auto,f_auto,q_auto",
  thumbnail: "w_360,c_limit,f_auto,q_auto",
  card: "w_800,c_limit,f_auto,q_auto",
  hero: "w_1600,c_limit,f_auto,q_auto",
};

/** Server-side-verified MIME allowlist — never trust the client's declared
 * Content-Type alone for anything downstream of this (see finalizeUpload).
 * HEIC/HEIF accepted as a SOURCE format per the plan's §8 instruction (iPhone
 * default camera format) — whether Cloudflare's Image Resizing actually
 * transforms it correctly is unverified until the R2 custom domain is live
 * and real device samples are tested (flagged explicitly, not assumed). */
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const ENTITY_PREFIX: Record<MediaEntityType, string> = {
  "resident-avatar": "residents",
  "activity-cover": "activities",
  "circle-cover": "circles",
  "centre-gallery": "centres",
  "club-gallery": "clubs",
  "club-session-cover": "club-sessions",
  "experience-gallery": "experiences",
  "program-cover": "programs",
  "org-logo": "providers",
  "vendor-draft-media": "drafts",
  "editorial-image": "editorial",
};

const ENTITY_PURPOSE: Record<MediaEntityType, string> = {
  "resident-avatar": "avatar",
  "activity-cover": "cover",
  "circle-cover": "cover",
  "centre-gallery": "gallery",
  "club-gallery": "gallery",
  "club-session-cover": "cover",
  "experience-gallery": "gallery",
  "program-cover": "cover",
  "org-logo": "logo",
  "vendor-draft-media": "media",
  "editorial-image": "editorial",
};

// Cost Controls pass — previously one flat 10MB cap for every entity type.
// Differentiated per the media architecture plan's §11 suggested defaults:
// small profile-ish images stay tight, cover/gallery photos get more room.
// Still a hard server-side cap either way — finalizeUpload deletes and
// rejects anything over this regardless of what the client claimed
// up front.
const AVATAR_OR_LOGO_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const EDITORIAL_MAX_BYTES = 8 * 1024 * 1024;

function maxBytesFor(entityType: MediaEntityType): number {
  return entityType === "resident-avatar" || entityType === "org-logo" ? AVATAR_OR_LOGO_MAX_BYTES : DEFAULT_MAX_BYTES;
}

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const RESTRICTED_GET_URL_TTL_SECONDS = 5 * 60;

// Runtime pause switches (app_settings, same "no redeploy needed" pattern
// as the pre-existing `maps_enabled` key — see db/index.ts's getSetting).
// Both must independently be true for a given upload to proceed: this env
// flag decides whether Cloudinary is configured for use AT ALL at
// deploy-time (mediaConfig.cloudinaryUploadsEnabledByEnv), the app_settings
// key decides whether it's currently PAUSED without a redeploy. Neither
// flag ever affects delivery of an already-uploaded asset — only new
// uploads.
export async function isMediaUploadsEnabled(): Promise<boolean> {
  return (await getSetting("media_uploads_enabled", "true")) !== "false";
}

export async function isCloudinaryUploadsRuntimeEnabled(): Promise<boolean> {
  return (await getSetting("cloudinary_uploads_enabled", "false")) === "true";
}

/** True only when Cloudinary credentials exist, the SDK client initialized,
 * the env-level switch is on, AND the runtime app_settings switch is on —
 * every one of these is a deliberate, independent gate (see their own
 * comments), so a missing/rotated credential and an admin's temporary
 * pause both fail this the same way: new Cloudinary uploads are refused,
 * existing Cloudinary assets keep rendering (delivery never checks this). */
export async function isCloudinaryUploadAllowed(): Promise<boolean> {
  if (!cloudinary || !mediaConfig.cloudinary || !mediaConfig.cloudinaryUploadsEnabledByEnv) return false;
  return isCloudinaryUploadsRuntimeEnabled();
}

export function isR2Enabled(): boolean {
  return mediaConfig.provider === "r2" && !!r2Client && !!mediaConfig.r2;
}

function requireR2(): { bucket: string; publicDomain: string | null } {
  if (!isR2Enabled() || !mediaConfig.r2) throw new MediaValidationError("Media storage is not configured (MEDIA_PROVIDER != r2)");
  return { bucket: mediaConfig.r2.bucket, publicDomain: mediaConfig.r2.publicDomain };
}

function objectKeyFor(entityType: MediaEntityType, entityId: string, ext: string): string {
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeEntityId) throw new MediaValidationError("Invalid entity id");
  return `${ENTITY_PREFIX[entityType]}/${safeEntityId}/${ENTITY_PURPOSE[entityType]}/${crypto.randomUUID()}${ext}`;
}

// Every R2 upload lands at a throwaway, NOT-entity-namespaced staging key
// first — the presigned PUT the browser gets only ever targets this key.
// finalizeUpload validates the actual bytes here, then server-side-copies
// them to the real, entity-namespaced key (objectKeyFor) and deletes the
// staging object. This closes two related gaps a plain "presign once,
// trust it forever" flow has: (1) the object the entity ends up pointing
// at is always something the server itself validated by reading it, not
// just HEAD's byte count; (2) once promoted, the original presigned URL
// is inert (the staging object it targeted is gone) — replaying it within
// its remaining TTL can, at worst, recreate an orphaned, never-referenced
// staging object, never overwrite the live, already-validated asset.
const STAGING_PREFIX = "_staging/";

function stagingKeyFor(ext: string): string {
  return `${STAGING_PREFIX}${crypto.randomUUID()}${ext}`;
}

const SNIFFED_FORMAT_EXT: Record<SniffedFormat, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  gif: ".gif",
  heic: ".heic",
  heif: ".heif",
};

const SNIFFED_FORMAT_MIME: Record<SniffedFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

// R2 uploads never accept GIF (MIME_EXT never listed it) — kept out of
// this set deliberately, so a file that sniffs as a valid GIF signature
// still gets rejected here, same as before this change.
const R2_ALLOWED_SNIFFED_FORMATS: SniffedFormat[] = ["jpeg", "png", "webp", "heic", "heif"];

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Shared by finalizeUpload and routes/media.ts's /release handler — an
 * entity-ownership check alone (checkUploadPermission) only proves the
 * caller owns the entityId in the request body; it says nothing about
 * whether the objectKey/url they also passed actually belongs to that
 * entity. Without this, an authorized owner of entity A could pass entity
 * B's object key/URL and finalize/delete B's file. Object keys are
 * namespaced by entity type+id specifically so this can be checked
 * cheaply, with no extra DB lookup. */
function assertOwnedKey(entityType: MediaEntityType, entityId: string, objectKey: string): void {
  const expectedPrefix = `${ENTITY_PREFIX[entityType]}/${entityId.replace(/[^a-zA-Z0-9_-]/g, "")}/${ENTITY_PURPOSE[entityType]}/`;
  if (!objectKey.startsWith(expectedPrefix)) throw new MediaValidationError("Object key does not belong to this entity");
}

export interface AuthorizeUploadResult {
  objectKey: string;
  uploadUrl: string;
  method: "PUT";
  expiresAt: string;
  maxBytes: number;
}

/** Stage A of the two-step upload lifecycle (plan §6) — issues a short-lived
 * presigned PUT scoped to one specific object key the caller cannot choose.
 * The presigned URL alone does not attach anything to any entity; nothing
 * in the product reads this object until finalizeUpload + the caller's own
 * entity-update request (e.g. PUT /vendor/centres/:id) both succeed. */
export async function authorizeUpload(entityType: MediaEntityType, entityId: string, contentType: string): Promise<AuthorizeUploadResult> {
  if (entityType === "editorial-image") {
    throw new MediaValidationError("Editorial images are uploaded via POST /api/admin/media/editorial, not this route");
  }
  if (!(await isMediaUploadsEnabled())) throw new MediaValidationError("New uploads are temporarily paused — try again shortly");
  const { bucket } = requireR2();
  const ext = MIME_EXT[contentType];
  if (!ext) throw new MediaValidationError("Only JPEG, PNG, WebP, HEIC or HEIF images are allowed");

  const stagingKey = stagingKeyFor(ext);
  const uploadUrl = await getSignedUrl(r2Client!, new PutObjectCommand({ Bucket: bucket, Key: stagingKey, ContentType: contentType }), {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  });

  // Ledger row created HERE, at authorize time, not at finalize — a
  // browser that never completes its PUT (or never calls finalize)
  // otherwise leaves nothing anywhere for scripts/mediaCleanup.ts to find
  // and sweep. The row's own id IS the staging key (an opaque, already-
  // unique string) rather than a fresh uuid, specifically so finalizeUpload
  // can look this exact row back up by the same key the client hands back,
  // and so a repeated finalize call for the same upload is a real,
  // detectable replay rather than "no record found".
  try {
    await recordMediaAsset({
      id: stagingKey,
      provider: "r2",
      providerKey: stagingKey,
      url: "",
      entityType,
      entityId,
      purpose: ENTITY_PURPOSE[entityType],
      mimeType: contentType,
      width: null,
      height: null,
      bytes: null,
      status: "pending",
    });
  } catch {
    // best-effort, same as finalizeUpload's ledger write — a DB hiccup
    // here degrades cleanup visibility for this one upload, it must never
    // block the upload itself.
  }

  return {
    objectKey: stagingKey,
    uploadUrl,
    method: "PUT",
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    maxBytes: maxBytesFor(entityType),
  };
}

export interface FinalizeUploadResult {
  objectKey: string;
  url: string;
  contentType: string;
  contentLength: number;
}

const SNIFF_RANGE_BYTES = 65536; // comfortably covers PNG IHDR / JPEG SOF / WebP header / HEIC ftyp box, all near byte 0

/** Stage B — validates the object that actually landed at the staging key
 * (real signature + pixel dimensions read from the first 64KB, not just
 * HEAD's byte count), then server-side-copies it to the real,
 * entity-namespaced key and deletes the staging object. Idempotent: a
 * repeated call with the same (already-consumed) objectKey finds the
 * ledger row already `attached` and returns its recorded result again,
 * without re-validating or re-copying anything. */
export async function finalizeUpload(entityType: MediaEntityType, entityId: string, objectKey: string): Promise<FinalizeUploadResult> {
  if (entityType === "editorial-image") {
    throw new MediaValidationError("Editorial images are uploaded via POST /api/admin/media/editorial, not this route");
  }
  const { bucket, publicDomain } = requireR2();

  // Ownership is proven by DB record, not by string-matching the key
  // against the entity's own namespace (the staging key never has that
  // namespace prefix at all) — only a row this exact authorizeUpload call
  // created, for this exact entity, can be finalized. This is strictly
  // stronger than the old prefix check: forging a plausible-looking
  // staging key with no matching row goes nowhere.
  const row = await getMediaAsset(objectKey);
  if (!row || row.provider !== "r2" || row.entityType !== entityType || row.entityId !== entityId) {
    throw new MediaValidationError("Upload session not found — it may have expired or already been used. Please try uploading again.");
  }

  if (row.status === "attached") {
    // Idempotent replay (plan §15) — the DB is the single source of truth
    // for what actually got promoted; never re-touch R2 for this call.
    return { objectKey: row.providerKey, url: row.url, contentType: row.mimeType ?? "application/octet-stream", contentLength: row.bytes ?? 0 };
  }
  if (row.status !== "pending") {
    throw new MediaValidationError("This upload is no longer valid — please try uploading again.");
  }

  const maxBytes = maxBytesFor(entityType);

  const fail = async (message: string): Promise<never> => {
    await deleteObject(objectKey);
    await markMediaAssetStatus(row.id, "failed");
    throw new MediaValidationError(message);
  };

  let head;
  try {
    head = await r2Client!.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  } catch {
    await markMediaAssetStatus(row.id, "failed");
    throw new MediaValidationError("Uploaded file not found — the upload may have failed or expired");
  }

  const contentLength = head.ContentLength ?? 0;
  if (contentLength === 0) return fail("Uploaded file is empty");
  if (contentLength > maxBytes) return fail(`Uploaded file exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`);

  // Bounded read (never the whole file) of the ACTUAL bytes, so
  // finalization can't be tricked by a mismatched/spoofed declared
  // Content-Type the way a HEAD-only check could be — the presigned PUT's
  // ContentType is a client-supplied hint, never trusted downstream of
  // this point.
  let sniffed;
  try {
    const rangeGet = await r2Client!.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${SNIFF_RANGE_BYTES - 1}` }));
    const partial = await streamToBuffer(rangeGet.Body);
    sniffed = sniffImage(partial);
  } catch {
    return fail("Could not read the uploaded file to verify it");
  }
  if (!sniffed || !R2_ALLOWED_SNIFFED_FORMATS.includes(sniffed.format)) {
    return fail("The uploaded file's content doesn't match a supported image format (JPEG, PNG, WebP, HEIC or HEIF)");
  }
  if (exceedsMaxMegapixels(sniffed.width, sniffed.height)) {
    return fail("Image dimensions are too large");
  }

  // The final key's extension/content-type come from the SNIFFED format,
  // not the client's originally declared Content-Type — a mislabeled file
  // (real PNG bytes sent as "image/jpeg") gets named/served correctly
  // rather than perpetuating the lie.
  const realContentType = SNIFFED_FORMAT_MIME[sniffed.format];
  const finalKey = objectKeyFor(entityType, entityId, SNIFFED_FORMAT_EXT[sniffed.format]);

  try {
    await r2Client!.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: finalKey,
        CopySource: `${bucket}/${objectKey}`,
        MetadataDirective: "REPLACE",
        ContentType: realContentType,
      })
    );
  } catch {
    return fail("Could not finalize the uploaded file — please try again");
  }

  await deleteObject(objectKey); // staging object — best-effort, mirrors deleteObject's own idempotent-delete convention

  const url = publicDomain ? `https://${publicDomain}/${finalKey}` : finalKey;

  try {
    await promoteMediaAsset(row.id, { providerKey: finalKey, url, mimeType: realContentType, width: sniffed.width, height: sniffed.height, bytes: contentLength });
  } catch {
    // Best-effort, same as elsewhere in this file — the real asset is
    // already safely promoted in R2 at this point; a ledger write failure
    // here only degrades usage-visibility/cleanup for this one asset, and
    // is not surfaced to the caller as an upload failure.
  }

  return { objectKey: finalKey, url, contentType: realContentType, contentLength };
}

// --- Local-processing upload path (Cost Controls, Changeset 2) ---------
//
// Added after live-testing showed Cloudflare Image Resizing 415s on an
// AVIF source object on this account/zone (it can OUTPUT avif from a jpg/
// png source, but can't take an avif file as input for a transform — see
// imageProcessing.ts's own doc comment). So instead of storing one
// original and resizing dynamically at delivery time, this decodes the
// upload, generates every REQUIRED size locally, encodes each to AVIF,
// and uploads the finished, already-correctly-sized files directly —
// eliminating Image Resizing/Cloudinary transformation billing for
// anything uploaded through this path, at the cost of real local CPU/
// memory per upload (bounded — see processingLimiter below) and one
// stored object per variant instead of one original.
//
// This is intentionally a SEPARATE function from authorizeUpload/
// finalizeUpload, not a replacement — gated by isLocalProcessingEnabled()
// (MEDIA_LOCAL_PROCESSING_ENABLED, off by default) specifically so the
// existing presigned two-step flow remains a real, working rollback path
// if this needs to be turned back off.

export function isLocalProcessingEnabled(): boolean {
  return mediaConfig.localProcessingEnabledByEnv;
}

/** Entity types whose ONLY real rendering context is a small, fixed-size
 * UI element (see Avatar in ui.tsx) — generating thumbnail/card/hero for
 * something never shown at those sizes wastes storage/CPU. Every other
 * type gets the standard three (org-logo included — its own render call
 * sites only ever request "card" today, but the extra two variants cost
 * little and keep this a two-bucket, not three-bucket, rule). */
function variantSpecsFor(entityType: MediaEntityType): VariantSpec[] {
  return entityType === "resident-avatar" ? AVATAR_ONLY_VARIANTS : STANDARD_VARIANTS;
}

/** The size this app treats as "the" canonical URL for an entity's own
 * single-URL column (centres.image_url, etc.) — the largest variant for
 * the standard set (hero), the only one for the avatar-only set. Sibling
 * variant URLs are derived from this one by suffix (see client/src/
 * media.ts's resolveMediaUrl and this file's siblingVariantKey below). */
function canonicalVariantName(entityType: MediaEntityType): MediaVariant {
  return entityType === "resident-avatar" ? "avatar" : "hero";
}

/** Given ANY one variant's object key from a local-processing upload
 * (`{prefix}/{entityId}/{purpose}/{uuid}-{variant}.avif`), returns the
 * sibling key for a different variant of the SAME upload — pure string
 * manipulation, safe because these are always PUBLIC, unsigned object
 * keys. Never used for a restricted/signed asset (see routes/media.ts's
 * /circles/:id/cover, which re-derives the sibling key the same way but
 * signs a FRESH url for it server-side, rather than rewriting an
 * already-issued signed url). Returns null if `key` doesn't match the
 * local-processing naming convention at all (a legacy pre-this-pass
 * asset), so callers can fall back to their own old behavior. */
export function siblingVariantKey(key: string, targetVariant: MediaVariant): string | null {
  const m = key.match(/^(.*-)(avatar|thumbnail|card|hero)(\.avif)$/);
  if (!m) return null;
  const [, prefix, currentVariant, ext] = m;
  // An avatar-only group has no thumbnail/card/hero siblings at all —
  // request any of those and you get the one file that actually exists,
  // never a 404 for a size that was never generated.
  if (currentVariant === "avatar") return `${prefix}avatar${ext}`;
  if (targetVariant === "avatar") return `${prefix}thumbnail${ext}`; // closest available size, not a nonexistent file
  return `${prefix}${targetVariant}${ext}`;
}

export interface UploadWithLocalProcessingResult {
  url: string;
  contentType: string;
  contentLength: number;
}

const processingLimiter = new ConcurrencyLimiter(3);

/** The whole point of this path: browser -> server (multipart, not
 * presigned) -> validate real bytes -> decode -> generate every required
 * variant -> AVIF-encode each -> upload all of them -> record one ledger
 * row per variant, all sharing one group_id. All-or-nothing: if any
 * variant upload fails, every variant already uploaded for this group is
 * deleted and the whole call throws — never leaves a caller pointing at a
 * partially-generated set. */
export async function uploadWithLocalProcessing(entityType: MediaEntityType, entityId: string, buffer: Buffer, declaredContentType: string): Promise<UploadWithLocalProcessingResult> {
  if (entityType === "editorial-image") {
    throw new MediaValidationError("Editorial images are uploaded via POST /api/admin/media/editorial, not this route");
  }
  if (!(await isMediaUploadsEnabled())) throw new MediaValidationError("New uploads are temporarily paused — try again shortly");
  const { bucket, publicDomain } = requireR2();

  const maxBytes = maxBytesFor(entityType);
  if (buffer.length === 0) throw new MediaValidationError("Uploaded file is empty");
  if (buffer.length > maxBytes) throw new MediaValidationError(`Uploaded file exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`);

  const sniffed = sniffImage(buffer);
  if (!sniffed || !R2_ALLOWED_SNIFFED_FORMATS.includes(sniffed.format)) {
    throw new MediaValidationError("Only JPEG, PNG, WebP, HEIC or HEIF images are allowed");
  }

  const pipeline = await loadForProcessing(buffer, sniffed.format);
  const specs = variantSpecsFor(entityType);
  const processed = await processingLimiter.run(() => generateVariants(pipeline, specs));

  const groupId = crypto.randomUUID();
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeEntityId) throw new MediaValidationError("Invalid entity id");
  const uploaded: { variant: MediaVariant; key: string; url: string; width: number; height: number; bytes: number }[] = [];

  try {
    for (const p of processed) {
      // All variants from one upload share `groupId` in the key itself —
      // that's what lets siblingVariantKey() derive one variant's key
      // from another purely by string manipulation, with no DB lookup.
      const key = `${ENTITY_PREFIX[entityType]}/${safeEntityId}/${ENTITY_PURPOSE[entityType]}/${groupId}-${p.variant}.avif`;
      await r2Client!.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: p.buffer, ContentType: "image/avif" }));
      uploaded.push({ variant: p.variant, key, url: publicDomain ? `https://${publicDomain}/${key}` : key, width: p.width, height: p.height, bytes: p.buffer.length });
    }
  } catch (e) {
    // Atomic: roll back every variant this group already uploaded rather
    // than leave a caller able to reference an incomplete set.
    await Promise.all(uploaded.map((u) => deleteObject(u.key)));
    throw new MediaValidationError(`Upload failed while generating image sizes: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  try {
    for (const u of uploaded) {
      await recordMediaAsset({
        provider: "r2",
        providerKey: u.key,
        url: u.url,
        entityType,
        entityId,
        purpose: ENTITY_PURPOSE[entityType],
        mimeType: "image/avif",
        width: u.width,
        height: u.height,
        bytes: u.bytes,
        status: "attached",
        groupId,
        variant: u.variant,
      });
    }
  } catch {
    // Best-effort, same convention as elsewhere in this file — the real
    // objects are already safely uploaded; a ledger write failure here
    // only degrades usage-visibility/cleanup, not the upload itself.
  }

  const canonical = uploaded.find((u) => u.variant === canonicalVariantName(entityType))!;
  return { url: canonical.url, contentType: "image/avif", contentLength: canonical.bytes };
}

/** Idempotent by design (plan §24/§45) — deleting an already-gone key is a
 * no-op, never an error, since replace/delete flows call this as
 * best-effort cleanup after their own DB write already succeeded. */
export async function deleteObject(objectKey: string): Promise<void> {
  if (!isR2Enabled()) return;
  const { bucket } = requireR2();
  try {
    await r2Client!.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  } catch {
    // best-effort — matches this codebase's existing fs.unlink(..., () => {}) convention
  }
}

/** Extracts the R2 object key back out of a stored canonical delivery URL
 * (`https://{publicDomain}/{key}`) — used for restricted-media signed GET
 * and for cleanup-on-delete, since the DB only ever stores the plain URL,
 * never the key separately (see media plan §16 — avoid a schema change). */
export function objectKeyFromUrl(url: string): string | null {
  const { publicDomain } = mediaConfig.r2 ?? { publicDomain: null };
  if (!publicDomain) return null;
  const prefix = `https://${publicDomain}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

/** Resolves a stored URL to its object key AND verifies that key belongs to
 * the given entity — same ownership-of-key check finalizeUpload does,
 * reused by routes/media.ts's /release handler so a caller who owns entity
 * A cannot delete entity B's object just by passing B's URL in the request
 * body (checkUploadPermission alone only verifies A). Returns null (safe
 * no-op) for a URL that doesn't parse as one of our own R2 keys at all,
 * same as objectKeyFromUrl. */
export function objectKeyFromUrlForEntity(entityType: MediaEntityType, entityId: string, url: string): string | null {
  const objectKey = objectKeyFromUrl(url);
  if (!objectKey) return null;
  assertOwnedKey(entityType, entityId, objectKey);
  return objectKey;
}

/** For restricted media (e.g. an invite-only Circle's cover) — bypasses the
 * public Cloudflare-fronted custom domain entirely and returns a short-lived
 * signed GET straight against the R2 S3-compatible endpoint. This is
 * intentionally NOT run through Image Resizing (that only happens at
 * Cloudflare's edge in front of the public domain) — restricted delivery is
 * therefore unoptimized (full original size), a known, accepted trade-off
 * until a proper authenticated edge path exists. Never persisted — plan
 * §20 explicitly requires generating these on demand. */
export async function getRestrictedDeliveryUrl(objectKey: string): Promise<string> {
  const { bucket } = requireR2();
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  return getSignedUrl(r2Client!, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: RESTRICTED_GET_URL_TTL_SECONDS });
}

function cloudinaryDeliveryPrefix(): string | null {
  return mediaConfig.cloudinary ? `https://res.cloudinary.com/${mediaConfig.cloudinary.cloudName}/image/upload/` : null;
}

export function deliveryUrl(objectKeyOrUrl: string, variant: MediaVariant): string {
  const cloudinaryPrefix = cloudinaryDeliveryPrefix();
  if (cloudinaryPrefix && objectKeyOrUrl.startsWith(cloudinaryPrefix)) {
    const publicId = objectKeyOrUrl.slice(cloudinaryPrefix.length);
    return `${cloudinaryPrefix}${CLOUDINARY_VARIANT_TRANSFORM[variant]}/${publicId}`;
  }

  const { publicDomain, imageResizingEnabled } = mediaConfig.r2 ?? { publicDomain: null, imageResizingEnabled: false };
  if (!publicDomain) return objectKeyOrUrl;
  const prefix = `https://${publicDomain}/`;
  const key = objectKeyOrUrl.startsWith(prefix) ? objectKeyOrUrl.slice(prefix.length) : objectKeyOrUrl;
  if (!imageResizingEnabled) return `${prefix}${key}`;
  return `${prefix}cdn-cgi/image/${VARIANT_TRANSFORM[variant]}/${key}`;
}

// --- Cloudinary editorial adapter ---------------------------------------
//
// Deliberately NOT a presigned-browser-direct-upload flow like R2's. R2
// needs that shape because ordinary uploads happen at real user volume
// across many entity types; the editorial collection is small, admin-only,
// and infrequent, so a plain authenticated server-side upload (admin's
// browser -> our server -> Cloudinary, via routes/adminMedia.ts's multer
// memory-storage endpoint) is simpler and just as safe, with no unsigned
// upload preset or client-supplied public_id to worry about (§14's
// concerns for Cloudinary specifically). This asymmetry is intentional, not
// an inconsistency to "fix" later.

export interface UploadEditorialResult {
  id: string;
  url: string;
}

/** Validates the actual bytes (signature + megapixels), uploads to
 * Cloudinary under the configured folder with a server-generated public_id
 * (never client-supplied — §14's "don't trust a client public ID as proof
 * of ownership"), and records the result in media_assets. Throws
 * MediaValidationError for any rejection; callers must not attach anything
 * on a thrown error.
 *
 * Only jpeg/png/webp are accepted here — deliberately narrower than the R2
 * allowlist. GIF and HEIC/HEIF are excluded specifically because this
 * app's dimension/megapixel check can't read their dimensions (see
 * imageSniff.ts's module doc), and the editorial collection is a small,
 * curated set where that trade-off isn't worth relaxing for.
 *
 * EXIF/GPS metadata: Cloudinary's documented default behavior is to strip
 * ALL metadata from an image once ANY transformation is applied to it, and
 * it does not offer an API to edit/strip metadata on the stored original
 * itself. Every render path in this app goes through resolveMediaUrl(),
 * which always applies one of the four variant transforms — so every
 * DELIVERED editorial image already has its metadata stripped by
 * Cloudinary, by default, with no extra parameter needed here. The
 * untransformed original (the bare secure_url Cloudinary returns) can
 * still carry the uploader's original EXIF/GPS until a transform is
 * requested of it — this app never links to that bare URL anywhere, but
 * it does exist and isn't something an upload-time parameter can close. */
export async function uploadEditorialImage(buffer: Buffer, declaredContentType: string, caption: string | null, actorUserId: string): Promise<UploadEditorialResult> {
  if (!(await isMediaUploadsEnabled())) throw new MediaValidationError("New uploads are temporarily paused — try again shortly");
  if (!(await isCloudinaryUploadAllowed())) throw new MediaValidationError("Cloudinary uploads are not enabled");

  const sniffed = sniffImage(buffer);
  if (!sniffed || !["jpeg", "png", "webp"].includes(sniffed.format)) {
    throw new MediaValidationError("Only JPEG, PNG or WebP images are allowed for editorial uploads");
  }
  if (buffer.length === 0) throw new MediaValidationError("Uploaded file is empty");
  if (buffer.length > EDITORIAL_MAX_BYTES) {
    throw new MediaValidationError(`Uploaded file exceeds the ${Math.round(EDITORIAL_MAX_BYTES / 1024 / 1024)}MB limit`);
  }
  if (exceedsMaxMegapixels(sniffed.width, sniffed.height)) {
    throw new MediaValidationError("Image dimensions are too large");
  }

  const publicId = `${mediaConfig.cloudinary!.folder}/${crypto.randomUUID()}`;
  const dataUri = `data:${declaredContentType};base64,${buffer.toString("base64")}`;

  let uploadResult: { public_id: string; secure_url: string; bytes: number };
  try {
    uploadResult = await cloudinary!.uploader.upload(dataUri, {
      public_id: publicId, // folder is already embedded here, not passed separately, so Cloudinary doesn't double-prefix it
      overwrite: false,
      resource_type: "image",
    });
  } catch (e) {
    throw new MediaValidationError(`Cloudinary upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  const id = await recordMediaAsset({
    provider: "cloudinary",
    providerKey: uploadResult.public_id,
    url: uploadResult.secure_url,
    entityType: "editorial-image",
    entityId: null,
    purpose: "editorial",
    mimeType: declaredContentType,
    width: sniffed.width,
    height: sniffed.height,
    bytes: uploadResult.bytes ?? buffer.length,
    status: "attached",
    caption,
    createdByUserId: actorUserId,
  });

  return { id, url: uploadResult.secure_url };
}

/** Deletes an editorial asset from Cloudinary and marks the ledger row.
 * Uses the STORED provider/key, never a caller-supplied URL or public_id
 * (§16's "don't expose a delete endpoint accepting arbitrary remote
 * identifiers") — routes/adminMedia.ts only ever passes the media_assets
 * row id. */
export async function deleteEditorialImage(assetId: string): Promise<void> {
  const asset = await getMediaAsset(assetId);
  if (!asset || asset.entityType !== "editorial-image") throw new MediaValidationError("Editorial image not found");
  if (asset.status === "deleted") return;

  if (cloudinary) {
    try {
      await cloudinary.uploader.destroy(asset.providerKey, { resource_type: "image" });
    } catch {
      // best-effort — same convention as R2's deleteObject; a cleanup
      // script retry (scripts/mediaCleanup.ts) picks up anything left in
      // 'deletion_pending'.
    }
  }
  await markMediaAssetStatus(assetId, "deleted");
}
