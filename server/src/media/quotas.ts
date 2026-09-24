/** Centralized, configurable gallery/cover quotas — Media Cost Controls
 * pass. Previously these limits existed only as UI copy
 * (VendorImageUpload.tsx's helper text) with no server-side enforcement at
 * all: a vendor could PUT an `images` array of any length and it would be
 * written verbatim (see vendorListings.ts/vendorExperiences.ts). Enforcing
 * here, not in the client, closes that gap — the client-side count is still
 * useful UX but is not the actual control.
 *
 * A quota violation never deletes anything already stored (existing photos
 * beyond a since-lowered limit are preserved, uploads are just blocked
 * until the caller is back under the limit) — see callers in
 * vendorListings.ts/vendorExperiences.ts. */

export type GalleryEntity = "centre" | "club" | "experience";

/** Cover photo is `images[0]` for centres/clubs/experiences (existing
 * convention, see media/mediaService.ts's ENTITY_PURPOSE) — these limits
 * are the TOTAL array length allowed, cover included, matching the
 * product's own "one cover plus N gallery images" framing. */
export const GALLERY_LIMITS: Record<GalleryEntity, number> = {
  centre: 7, // 1 cover + 6 gallery
  club: 7, // 1 cover + 6 gallery
  experience: 9, // 1 cover + 8 gallery
};

export function exceedsGalleryLimit(entity: GalleryEntity, imageCount: number): boolean {
  return imageCount > GALLERY_LIMITS[entity];
}
