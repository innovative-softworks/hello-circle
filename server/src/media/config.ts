/** Media storage configuration — Cloudflare R2 (S3-compatible) in production,
 * local disk (the pre-existing `/uploads` pipeline in routes/uploads.ts and
 * routes/residents.ts) as a safe dev fallback. See the Image/Media System
 * Audit's §21/§41: production must never silently fall back to ephemeral
 * local storage, so a misconfigured MEDIA_PROVIDER=r2 in production throws
 * at startup rather than degrading quietly; the same misconfiguration in
 * dev just warns and falls back, so a fresh clone still runs without any
 * Cloudflare account. */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  /** Custom domain bound to the R2 bucket (e.g. media.hellocircle.ie).
   * Null until that domain's DNS/SSL status is active — uploads still work
   * without it (they land in R2 either way), but delivery URLs fall back
   * to the raw object key (unusable as a URL) until it's set. */
  publicDomain: string | null;
  /** Whether Cloudflare's Image Resizing (`/cdn-cgi/image/...`) is actually
   * enabled on the zone `publicDomain` sits on — this is a separate,
   * sometimes-paid toggle from just binding a custom domain to the bucket,
   * confirmed by a real live probe during setup: raw object delivery via
   * the custom domain worked immediately, but `/cdn-cgi/image/...` 404'd
   * until this is turned on in the Cloudflare dashboard. When false,
   * delivery URLs are the raw (un-resized, un-format-converted) object URL
   * — correct and working, just not yet optimized. */
  imageResizingEnabled: boolean;
}

export type MediaProvider = "r2" | "local";

/** Cloudinary is NOT an alternative to R2 for ordinary user uploads — it's a
 * small, optional second provider for a curated editorial image collection
 * only (see media plan Cloudinary Changeset). Unlike R2, an incomplete or
 * missing Cloudinary config never throws, in dev OR production: Cloudinary
 * is opt-in and off by default (`CLOUDINARY_UPLOADS_ENABLED` defaults
 * false), so "not configured" is the expected steady state for most
 * deployments, not a misconfiguration. */
export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Folder prefix every editorial upload is scoped under — never
   * caller-controlled, so a signed request can't be used to write outside
   * the editorial namespace. */
  folder: string;
}

export interface MediaConfig {
  provider: MediaProvider;
  r2: R2Config | null;
  cloudinary: CloudinaryConfig | null;
  /** Master switch for Cloudinary uploads specifically — independent of
   * whether credentials are present, so an operator can pause new
   * Cloudinary uploads (cost control) without unsetting credentials and
   * breaking delivery of already-uploaded Cloudinary assets. Defaults to
   * `false`: Cloudinary starts disabled for new uploads until explicitly
   * turned on, per the media plan's "Cloudinary disabled by default"
   * requirement. This is the build-time/env half of the pause; app_settings
   * key `cloudinary_uploads_enabled` (see mediaService.ts) is the runtime
   * half an admin can flip without a redeploy — both must be true for a new
   * Cloudinary upload to be allowed. */
  cloudinaryUploadsEnabledByEnv: boolean;
  /** Local-processing pass (Cost Controls, Changeset 2) — gates the NEW
   * upload path (browser -> server -> decode/resize/AVIF-encode locally ->
   * upload the generated variants to R2) vs. the OLD presigned direct-to-
   * bucket flow (still fully intact, still the fallback/rollback path —
   * see mediaService.ts's isLocalProcessingEnabled()). Defaults false:
   * this is a deliberate opt-in, not a silent behavior change, same
   * "off until explicitly enabled" posture as Cloudinary. */
  localProcessingEnabledByEnv: boolean;
}

function readCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  const folder = (process.env.CLOUDINARY_FOLDER ?? "hellocircle/editorial").trim() || "hellocircle/editorial";
  return { cloudName, apiKey, apiSecret, folder };
}

function readMediaConfig(): MediaConfig {
  const cloudinary = readCloudinaryConfig();
  const cloudinaryUploadsEnabledByEnv = process.env.CLOUDINARY_UPLOADS_ENABLED === "true";
  const localProcessingEnabledByEnv = process.env.MEDIA_LOCAL_PROCESSING_ENABLED === "true";

  const requested = (process.env.MEDIA_PROVIDER ?? "local").trim().toLowerCase();
  if (requested !== "r2") return { provider: "local", r2: null, cloudinary, cloudinaryUploadsEnabledByEnv, localProcessingEnabledByEnv };

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const publicDomain = process.env.R2_PUBLIC_DOMAIN?.trim() || null;
  const imageResizingEnabled = process.env.R2_IMAGE_RESIZING_ENABLED === "true";

  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !bucket && "R2_BUCKET",
    !endpoint && "R2_ENDPOINT",
  ].filter((v): v is string => !!v);

  if (missing.length > 0) {
    const message = `MEDIA_PROVIDER=r2 but missing required env var(s): ${missing.join(", ")}`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(`[media] ${message} — refusing to start with an incomplete production media config.`);
    }
    console.warn(`[media] ${message} — falling back to local disk uploads for this run.`);
    return { provider: "local", r2: null, cloudinary, cloudinaryUploadsEnabledByEnv, localProcessingEnabledByEnv };
  }

  if (!publicDomain) {
    console.warn(
      "[media] R2_PUBLIC_DOMAIN is not set — uploads will still be stored in R2, but delivery URLs will point at the object key directly with no CDN transform until this is set."
    );
  }

  return {
    provider: "r2",
    r2: { accountId: accountId!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucket: bucket!, endpoint: endpoint!, publicDomain, imageResizingEnabled },
    cloudinary,
    cloudinaryUploadsEnabledByEnv,
    localProcessingEnabledByEnv,
  };
}

export const mediaConfig: MediaConfig = readMediaConfig();
