// Shared media URL resolver — one place that knows how to turn a stored
// image URL into what should actually be requested for a given display
// context. Mirrors server/src/media/mediaService.ts's deliveryUrl()
// exactly (kept as two copies, not shared code, same as this codebase's
// existing client/server split — see CLAUDE.md on packages/types being
// data-shape-only, not a shared-logic package).
//
// A stored image_url is one of three shapes (Image/Media System Audit
// §15/§20's "backward compatibility" requirement): a legacy local path
// (`/uploads/<uuid>.jpg`), an external URL (seed placeholders on
// placehold.co, marketing imagery on Unsplash), or — once
// VITE_MEDIA_PUBLIC_DOMAIN is set — a Cloudflare R2-backed canonical URL
// (`https://<domain>/<key>`). Only the third form gets rewritten into a
// `/cdn-cgi/image/...` Image Resizing URL; the other two pass through
// completely unchanged, so nothing already stored anywhere ever breaks.

export type MediaVariant = "avatar" | "thumbnail" | "card" | "hero";

const MEDIA_PUBLIC_DOMAIN = (import.meta.env.VITE_MEDIA_PUBLIC_DOMAIN as string | undefined)?.trim() || null;
// Cloudflare Image Resizing (`/cdn-cgi/image/...`) is a separate toggle from
// just binding a custom domain to the R2 bucket — confirmed by a live probe
// during setup: raw object delivery via the custom domain worked
// immediately, but the transform path 404'd until this is enabled in the
// Cloudflare dashboard. Until then, render the raw (un-resized) object URL
// — correct and working, just not yet optimized — rather than a 404.
const IMAGE_RESIZING_ENABLED = import.meta.env.VITE_MEDIA_IMAGE_RESIZING_ENABLED === "true";

// Cloudinary — the small, optional second provider for the admin-curated
// editorial collection only (see server/src/media/mediaService.ts's
// Cloudinary adapter). Every Cloudinary delivery URL Cloudinary itself
// returns already has the form `https://res.cloudinary.com/<cloud>/image/
// upload/<public_id>` — recognized here purely by that fixed domain +
// cloud name, same "match a known prefix, never guess" discipline as the
// R2 branch above. No further env var is needed client-side beyond the
// cloud name itself: Cloudinary URLs need no credentials to construct a
// transform, unlike R2's presigned upload flow.
const CLOUDINARY_CLOUD_NAME = (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined)?.trim() || null;

// Same four bounded presentation classes as the server's
// VARIANT_TRANSFORM — deliberately not arbitrary/caller-controlled
// dimensions, so Cloudflare transformation usage stays predictable.
const VARIANT_TRANSFORM: Record<MediaVariant, string> = {
  avatar: "width=256,height=256,fit=cover,format=auto",
  thumbnail: "width=360,fit=scale-down,format=auto",
  card: "width=800,fit=scale-down,format=auto",
  hero: "width=1600,fit=scale-down,format=auto",
};

// Mirrors server/src/media/mediaService.ts's CLOUDINARY_VARIANT_TRANSFORM
// exactly — same reasoning as the R2 table above (`c_limit` never
// upscales; `avatar` alone crops to an exact square).
const CLOUDINARY_VARIANT_TRANSFORM: Record<MediaVariant, string> = {
  avatar: "w_256,h_256,c_fill,g_auto,f_auto,q_auto",
  thumbnail: "w_360,c_limit,f_auto,q_auto",
  card: "w_800,c_limit,f_auto,q_auto",
  hero: "w_1600,c_limit,f_auto,q_auto",
};

export interface MediaUrlConfig {
  mediaPublicDomain: string | null;
  imageResizingEnabled: boolean;
  cloudinaryCloudName: string | null;
}

/** Pure — takes its config as an argument rather than reading
 * import.meta.env directly, so media.test.ts can exercise every provider
 * branch deterministically instead of fighting Vite's env-inlining (which
 * bakes import.meta.env.* in at transform time, not at module-import
 * time — re-stubbing process.env per test does not reliably re-transform
 * already-loaded modules). getMediaUrl() below is the real entry point
 * every component actually calls, and just forwards the live env values
 * in. */
// Local-processing pass — mirrors server/src/media/mediaService.ts's
// siblingVariantKey() exactly (same two copies, not shared code,
// convention as the rest of this file). Pure string manipulation, safe
// because these are always PUBLIC, unsigned R2 keys — the one
// signed-delivery case (a restricted Circle cover) is handled separately
// below by threading ?variant= through to the server, which does its own
// sibling-key derivation and signs a FRESH url for it; nothing here ever
// touches an already-issued signed url.
function siblingVariantKey(key: string, targetVariant: MediaVariant): string | null {
  const m = key.match(/^(.*-)(avatar|thumbnail|card|hero)(\.avif)$/);
  if (!m) return null;
  const [, prefix, currentVariant, ext] = m;
  if (currentVariant === "avatar") return `${prefix}avatar${ext}`;
  if (targetVariant === "avatar") return `${prefix}thumbnail${ext}`;
  return `${prefix}${targetVariant}${ext}`;
}

const RESTRICTED_CIRCLE_COVER_PATH = /^\/api\/media\/circles\/[^/]+\/cover$/;

export function resolveMediaUrl(source: string | null | undefined, variant: MediaVariant, config: MediaUrlConfig): string {
  if (!source) return "";

  // The one signed-delivery case — thread the wanted size through as a
  // query param so the server picks (and signs) the right real object;
  // see routes/media.ts's /circles/:id/cover.
  if (RESTRICTED_CIRCLE_COVER_PATH.test(source)) return `${source}?variant=${variant}`;

  if (config.cloudinaryCloudName) {
    const cloudinaryPrefix = `https://res.cloudinary.com/${config.cloudinaryCloudName}/image/upload/`;
    if (source.startsWith(cloudinaryPrefix)) {
      const publicId = source.slice(cloudinaryPrefix.length);
      return `${cloudinaryPrefix}${CLOUDINARY_VARIANT_TRANSFORM[variant]}/${publicId}`;
    }
  }

  if (!config.mediaPublicDomain) return source;
  const prefix = `https://${config.mediaPublicDomain}/`;
  if (!source.startsWith(prefix)) return source;
  const key = source.slice(prefix.length);

  // A local-processing asset (`...-hero.avif` etc.) is a real, already-
  // correctly-sized static file — swap to the sibling file for the
  // requested variant instead of asking Cloudflare to transform it
  // (Image Resizing can't take an AVIF source anyway — confirmed via a
  // live 415 on this account). Falls through to the legacy transform-URL
  // behavior for anything that doesn't match this naming convention.
  const sibling = siblingVariantKey(key, variant);
  if (sibling) return `${prefix}${sibling}`;

  if (!config.imageResizingEnabled) return source;
  return `${prefix}cdn-cgi/image/${VARIANT_TRANSFORM[variant]}/${key}`;
}

export function getMediaUrl(source: string | null | undefined, variant: MediaVariant): string {
  return resolveMediaUrl(source, variant, {
    mediaPublicDomain: MEDIA_PUBLIC_DOMAIN,
    imageResizingEnabled: IMAGE_RESIZING_ENABLED,
    cloudinaryCloudName: CLOUDINARY_CLOUD_NAME,
  });
}

export function isCloudMediaConfigured(): boolean {
  return !!MEDIA_PUBLIC_DOMAIN;
}

/** A Circle's cover is the one restricted-media case in this app (Media
 * plan Task 2). Returns a SOURCE — same contract as `imageUrl` itself —
 * for a caller to pass into Photo's `src` prop (or SingleImageUpload's
 * `value`) exactly as it would `circle.imageUrl` directly; the caller
 * still applies its own variant/getMediaUrl() resolution as normal.
 *
 * For an "open" Circle, that's just `circle.imageUrl` unchanged. For any
 * other join mode, the server never puts the raw permanent URL in the
 * response at all (see routes/circles.ts's toCircleJson()/
 * toCircleTeaserJson() — `imageUrl` is always null there regardless of
 * whether a cover exists), so this instead returns the protected endpoint
 * path (`/api/media/circles/:id/cover`, a relative path — getMediaUrl()
 * passes it through unchanged since it never matches the R2 domain
 * prefix, so no double-resolution risk). The browser follows the 302 to a
 * short-lived signed R2 URL and sends the session cookie automatically
 * (same-origin), so no extra client-side auth wiring is needed. That
 * endpoint re-checks membership on every request — an unauthorized viewer
 * gets a 403, which Photo's existing onError handler already turns into
 * the normal placeholder fallback. */
export function getCircleCoverUrl(circle: { id: string; imageUrl: string | null; hasImage?: boolean; joinMode: string }): string | null {
  if (circle.joinMode === "open") return circle.imageUrl;
  if (!circle.hasImage) return null;
  return `/api/media/circles/${circle.id}/cover`;
}
