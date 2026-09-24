import sharp from "sharp";
import { MediaValidationError, type MediaVariant } from "./mediaTypes.js";

/** Local (server-side) image decode + resize + AVIF encode — the actual
 * processing HelloCircle's "reduce cost" pass moved to, after live-testing
 * showed Cloudflare Image Resizing 415s on an AVIF source object on this
 * account/zone (can output AVIF, can't take it as input for a transform).
 * Benchmarked on this deployment before choosing AVIF over WebP: a
 * realistic photo-profile source encoded ~1.7x slower to AVIF than WebP
 * but came out 2-3x smaller at equivalent visual quality settings — see
 * the format decision note in mediaService.ts. Quality/format are one
 * constant each, not scattered, so revisiting that trade-off later is a
 * one-line change, not a rewrite.
 *
 * sharp gives REAL decodability validation for free — unlike the
 * signature-only sniffing in imageSniff.ts (still used as a fast
 * reject-obvious-garbage first pass), a file sharp can't decode throws
 * here, which is the strongest validation this app does anywhere. */

export const AVIF_QUALITY = 60;
const AVIF_EFFORT = 4; // sharp's default balance of speed vs. compression — not re-tuned without a reason to

export const MAX_SOURCE_MEGAPIXELS = 40; // generous headroom over a real 12MP phone photo, well under sharp's own pixel-count guard

/** Purpose-specific variant sets (Cost Controls / local-processing pass) —
 * generating all four sizes for something that's only ever rendered small
 * (a resident avatar) wastes storage/CPU for no one. Every OTHER entity
 * type gets the standard three (org-logo included — verified its own
 * render call sites only ever request "card", but thumbnail/hero cost
 * little extra and keep this one bucket simple rather than a third
 * special case). */
export type VariantSpec = { name: MediaVariant; width: number; height?: number; fit: "cover" | "inside" };

export const AVATAR_ONLY_VARIANTS: VariantSpec[] = [{ name: "avatar", width: 256, height: 256, fit: "cover" }];

export const STANDARD_VARIANTS: VariantSpec[] = [
  { name: "thumbnail", width: 360, fit: "inside" },
  { name: "card", width: 800, fit: "inside" },
  { name: "hero", width: 1600, fit: "inside" },
];

export interface ProcessedVariant {
  variant: MediaVariant;
  buffer: Buffer;
  width: number;
  height: number;
}

/** HEIC/HEIF specifically: sharp's prebuilt binary cannot decode it at all
 * (patent licensing on the encoder side means the prebuilt libvips omits
 * libheif/libde265/x265 entirely — confirmed against sharp's own install
 * docs, not assumed). heic-convert wraps libheif compiled to WebAssembly
 * instead, sidestepping the native-build/licensing problem, and hands back
 * a real JPEG buffer that sharp can then process normally. */
async function toDecodableBuffer(buffer: Buffer, sniffedFormat: string): Promise<Buffer> {
  if (sniffedFormat !== "heic" && sniffedFormat !== "heif") return buffer;
  const heicConvert = (await import("heic-convert")).default;
  const jpegArrayBuffer = await heicConvert({ buffer, format: "JPEG", quality: 0.92 });
  return Buffer.from(jpegArrayBuffer);
}

/** Decodes, auto-orients (reads EXIF orientation then discards it — sharp
 * does not carry EXIF/GPS through to the output unless .withMetadata() is
 * called, which this never does, so metadata stripping is the default,
 * not an extra step), and validates real pixel dimensions. Throws
 * MediaValidationError for anything sharp can't actually decode, or
 * whose real (not just claimed) pixel count is absurd. */
export async function loadForProcessing(buffer: Buffer, sniffedFormat: string): Promise<sharp.Sharp> {
  const decodable = await toDecodableBuffer(buffer, sniffedFormat);
  const pipeline = sharp(decodable, { failOn: "error" }).rotate();
  let metadata;
  try {
    metadata = await pipeline.metadata();
  } catch {
    throw new MediaValidationError("Could not decode this file as an image — it may be corrupt or an unsupported variant of its format");
  }
  const { width, height } = metadata;
  if (!width || !height) throw new MediaValidationError("Could not read this image's dimensions");
  if (width * height > MAX_SOURCE_MEGAPIXELS * 1_000_000) {
    throw new MediaValidationError(`Image dimensions are too large (${width}x${height})`);
  }
  return pipeline;
}

/** Runs the decoded pipeline through every variant in `specs`, encoding
 * each to AVIF. Callers are responsible for bounding concurrency across
 * uploads (see mediaService.ts's processingLimiter) — this function itself
 * just does the CPU-bound work for one upload's variant set. */
export async function generateVariants(pipeline: sharp.Sharp, specs: VariantSpec[]): Promise<ProcessedVariant[]> {
  const results: ProcessedVariant[] = [];
  for (const spec of specs) {
    const resized =
      spec.fit === "cover"
        ? pipeline.clone().resize({ width: spec.width, height: spec.height, fit: "cover", position: "attention" })
        : pipeline.clone().resize({ width: spec.width, withoutEnlargement: true, fit: "inside" });
    const { data, info } = await resized.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer({ resolveWithObject: true });
    results.push({ variant: spec.name, buffer: data, width: info.width, height: info.height });
  }
  return results;
}

/** A small in-process concurrency gate — bounded processing, per the
 * media plan's §11 requirement, without adding a queue/worker service.
 * AVIF encoding is CPU-bound; letting unlimited concurrent uploads each
 * spawn libvips work would let a burst of uploads starve the event loop
 * and every other request this same Node process is serving. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
