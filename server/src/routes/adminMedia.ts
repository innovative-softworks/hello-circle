import { Router } from "express";
import multer from "multer";
import { requireAdmin } from "../auth.js";
import { writeAudit } from "../audit.js";
import { getSetting, setSetting } from "../db/index.js";
import { mediaConfig } from "../media/config.js";
import {
  deleteEditorialImage,
  isCloudinaryUploadAllowed,
  isCloudinaryUploadsRuntimeEnabled,
  isMediaUploadsEnabled,
  MediaValidationError,
  uploadEditorialImage,
} from "../media/mediaService.js";
import { findCleanupCandidates, listEditorialAssets, mediaLedgerStartedAt, mediaUsageByProviderAndStatus } from "../media/mediaAssets.js";
import { GALLERY_LIMITS } from "../media/quotas.js";

// Usage visibility + editorial-collection management + pause toggles
// (Media Cost Controls / Cloudinary pilot pass) — see media_assets' own
// CREATE TABLE comment (db/index.ts) for what this table does and doesn't
// track. Everything here is admin-only (requireAdmin, same as the rest of
// routes/admin.ts) — vendors/residents have no visibility into
// provider-level usage.

export const adminMediaRouter = Router();
adminMediaRouter.use(requireAdmin);

const editorialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
}).single("file");

// --- usage visibility ---------------------------------------------------
// Deliberately distinguishes application-counted rows/bytes (real, but not
// the provider's own invoice) from provider-reported usage (not called
// here — no live Cloudflare/Cloudinary billing API integration; see the
// media architecture report). Never reports a number as 0 when it's
// actually "unavailable" — provider-reported fields are always `null` with
// an explicit `available: false` today.
adminMediaRouter.get("/usage", async (_req, res) => {
  const rows = await mediaUsageByProviderAndStatus();
  const uploadsEnabled = await isMediaUploadsEnabled();
  const cloudinaryRuntimeEnabled = await isCloudinaryUploadsRuntimeEnabled();
  const cloudinaryAllowed = await isCloudinaryUploadAllowed();
  const trackedSince = await mediaLedgerStartedAt();

  const pendingR2 = await findCleanupCandidates("pending", 0, 1); // existence probe only, not exhaustive
  const pendingCloudinaryDeletions = await findCleanupCandidates("deletion_pending", 0, 1);

  res.json({
    application: {
      byProviderAndStatus: rows,
      trackedSince,
      note: trackedSince
        ? `Tracked uploads since ${trackedSince}; anything uploaded before that (this app's entire pre-existing photo library) is excluded from these counts. Recorded bytes are an application estimate from this ledger, not total bucket/account storage and not billed usage.`
        : "No uploads recorded in this ledger yet. This app's existing photo library (uploaded before this ledger existed) is not represented here at all — this is not a count of zero images.",
    },
    providerReported: {
      r2: { available: false, note: "Cloudflare R2/account usage requires manual dashboard verification — not queried live." },
      cloudinary: { available: false, note: "Cloudinary account usage requires manual dashboard verification — not queried live." },
    },
    hasPendingR2Cleanup: pendingR2.length > 0,
    hasPendingDeletionRetries: pendingCloudinaryDeletions.length > 0,
    config: {
      uploadsEnabled,
      cloudinaryConfigured: !!mediaConfig.cloudinary,
      cloudinaryEnabledByEnv: mediaConfig.cloudinaryUploadsEnabledByEnv,
      cloudinaryRuntimeEnabled,
      cloudinaryUploadAllowed: cloudinaryAllowed,
      galleryLimits: GALLERY_LIMITS,
    },
  });
});

// --- editorial collection (Cloudinary) ----------------------------------

adminMediaRouter.get("/editorial", async (_req, res) => {
  res.json({ images: await listEditorialAssets() });
});

adminMediaRouter.post("/editorial", editorialUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const caption = typeof req.body?.caption === "string" ? req.body.caption.slice(0, 255) : null;
  try {
    const result = await uploadEditorialImage(req.file.buffer, req.file.mimetype, caption, req.user!.id);
    await writeAudit({ actorUserId: req.user!.id, action: "media.editorial_uploaded", objectType: "media_asset", objectId: result.id, newValue: { caption } });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

adminMediaRouter.delete("/editorial/:id", async (req, res) => {
  try {
    await deleteEditorialImage(req.params.id);
    await writeAudit({ actorUserId: req.user!.id, action: "media.editorial_deleted", objectType: "media_asset", objectId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof MediaValidationError) return res.status(404).json({ error: e.message });
    throw e;
  }
});

// --- pause toggles --------------------------------------------------------
// Same runtime-kill-switch shape as admin.ts's pre-existing maps-enabled
// toggle (app_settings, GET/PUT split, audited). A pause only blocks NEW
// uploads — it never touches delivery of anything already stored (Photo/
// PhotoGallery keep rendering existing R2/Cloudinary URLs unchanged either
// way).

adminMediaRouter.get("/config/uploads-enabled", async (_req, res) => {
  res.json({ enabled: (await getSetting("media_uploads_enabled", "true")) !== "false" });
});

adminMediaRouter.put("/config/uploads-enabled", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  const before = (await getSetting("media_uploads_enabled", "true")) !== "false";
  await setSetting("media_uploads_enabled", enabled ? "true" : "false");
  await writeAudit({
    actorUserId: req.user!.id,
    action: "config.media_uploads_enabled_changed",
    objectType: "app_settings",
    objectId: "media_uploads_enabled",
    previousValue: { enabled: before },
    newValue: { enabled },
  });
  res.json({ enabled });
});

adminMediaRouter.get("/config/cloudinary-enabled", async (_req, res) => {
  res.json({
    enabled: await isCloudinaryUploadsRuntimeEnabled(),
    configuredByEnv: mediaConfig.cloudinaryUploadsEnabledByEnv,
    credentialsPresent: !!mediaConfig.cloudinary,
  });
});

adminMediaRouter.put("/config/cloudinary-enabled", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  if (enabled && !mediaConfig.cloudinaryUploadsEnabledByEnv) {
    return res.status(409).json({ error: "CLOUDINARY_UPLOADS_ENABLED is not set to true in this deployment's environment — this runtime switch can only turn Cloudinary OFF until that's changed" });
  }
  const before = await isCloudinaryUploadsRuntimeEnabled();
  await setSetting("cloudinary_uploads_enabled", enabled ? "true" : "false");
  await writeAudit({
    actorUserId: req.user!.id,
    action: "config.cloudinary_uploads_enabled_changed",
    objectType: "app_settings",
    objectId: "cloudinary_uploads_enabled",
    previousValue: { enabled: before },
    newValue: { enabled },
  });
  res.json({ enabled });
});

adminMediaRouter.use((err: Error, _req: unknown, res: import("express").Response, _next: unknown) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message });
});
