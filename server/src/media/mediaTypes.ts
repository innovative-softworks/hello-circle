/** Shared by mediaService.ts and imageProcessing.ts — split out purely to
 * avoid a circular import between them (mediaService calls into
 * imageProcessing's encode pipeline; imageProcessing throws
 * MediaValidationError). mediaService.ts re-exports both, so every
 * existing `import { MediaValidationError } from "./mediaService.js"`
 * call site elsewhere in the app is unaffected. */

export class MediaValidationError extends Error {}

/** The four presentation classes — deliberately bounded (not arbitrary
 * user-controlled dimensions) so processing/transformation cost stays
 * predictable. */
export type MediaVariant = "avatar" | "thumbnail" | "card" | "hero";
