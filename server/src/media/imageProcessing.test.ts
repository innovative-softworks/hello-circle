import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AVATAR_ONLY_VARIANTS,
  ConcurrencyLimiter,
  generateVariants,
  loadForProcessing,
  MAX_SOURCE_MEGAPIXELS,
  STANDARD_VARIANTS,
} from "./imageProcessing.js";
import { MediaValidationError } from "./mediaTypes.js";

// Real sharp round trips throughout — building a real JPEG/PNG with sharp
// itself and feeding it back through loadForProcessing/generateVariants is
// the strongest validation this app does anywhere (actual decodability,
// not signature sniffing). HEIC specifically is NOT covered here: there is
// no HEIC ENCODER available in this environment (heic-convert only
// decodes; a real HEVC-encoded fixture would need one) — the dispatch to
// heic-convert for a sniffed heic/heif format is code-reviewable but not
// exercised end-to-end by this suite. Documented, not silently skipped.

async function buildRealJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } } }).jpeg({ quality: 85 }).toBuffer();
}

describe("loadForProcessing", () => {
  it("decodes a real JPEG and reports its real dimensions", async () => {
    const jpeg = await buildRealJpeg(400, 300);
    const pipeline = await loadForProcessing(jpeg, "jpeg");
    const meta = await pipeline.metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it("decodes a real PNG", async () => {
    const png = await sharp({ create: { width: 50, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const pipeline = await loadForProcessing(png, "png");
    const meta = await pipeline.metadata();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(60);
  });

  it("rejects a file whose signature is fine but whose body is corrupt/truncated", async () => {
    const jpeg = await buildRealJpeg(200, 200);
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 3)); // valid SOI, garbage/incomplete the rest
    await expect(loadForProcessing(truncated, "jpeg")).rejects.toThrow(MediaValidationError);
  });

  it("rejects an image that exceeds the megapixel cap", async () => {
    // A real (if huge) image, not a header lie — proves the cap is
    // enforced against sharp's own decoded metadata.
    const side = Math.ceil(Math.sqrt(MAX_SOURCE_MEGAPIXELS * 1_000_000)) + 200;
    const huge = await sharp({ create: { width: side, height: side, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png({ compressionLevel: 0 }).toBuffer();
    await expect(loadForProcessing(huge, "png")).rejects.toThrow(/dimensions are too large/);
  }, 20000);

  it("auto-orients (strips EXIF orientation rather than leaving a sideways image)", async () => {
    // sharp's own .rotate() with no args reads EXIF orientation and bakes
    // it into pixel data, then the output carries none — verified here by
    // confirming the decoded pipeline has no orientation tag left to apply.
    const jpeg = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 10, g: 10, b: 10 } } })
      .withExif({ IFD0: { Orientation: "6" } })
      .jpeg()
      .toBuffer();
    const pipeline = await loadForProcessing(jpeg, "jpeg");
    const out = await pipeline.clone().toBuffer({ resolveWithObject: true });
    expect(out.info.orientation).toBeUndefined();
  });
});

describe("generateVariants", () => {
  it("produces the avatar-only set as an exact square crop, never upscaling", async () => {
    const jpeg = await buildRealJpeg(3000, 2000);
    const pipeline = await loadForProcessing(jpeg, "jpeg");
    const variants = await generateVariants(pipeline, AVATAR_ONLY_VARIANTS);
    expect(variants).toHaveLength(1);
    expect(variants[0].variant).toBe("avatar");
    expect(variants[0].width).toBe(256);
    expect(variants[0].height).toBe(256);
    // Real AVIF bytes, not a stub — decodable by sharp itself.
    const decoded = await sharp(variants[0].buffer).metadata();
    expect(decoded.format).toBe("heif"); // sharp reports AVIF (an HEIF-family container) as "heif"
  });

  it("produces the standard set (thumbnail/card/hero), each within its cap and never upscaled", async () => {
    const jpeg = await buildRealJpeg(3000, 2000);
    const pipeline = await loadForProcessing(jpeg, "jpeg");
    const variants = await generateVariants(pipeline, STANDARD_VARIANTS);
    expect(variants.map((v) => v.variant)).toEqual(["thumbnail", "card", "hero"]);
    for (const v of variants) {
      const spec = STANDARD_VARIANTS.find((s) => s.name === v.variant)!;
      expect(v.width).toBeLessThanOrEqual(spec.width);
    }
    // Real, monotonically increasing sizes.
    expect(variants[0].width).toBeLessThan(variants[1].width);
    expect(variants[1].width).toBeLessThan(variants[2].width);
  });

  it("never upscales a source smaller than a variant's target width", async () => {
    const jpeg = await buildRealJpeg(100, 60); // smaller than even "thumbnail" (360w)
    const pipeline = await loadForProcessing(jpeg, "jpeg");
    const variants = await generateVariants(pipeline, STANDARD_VARIANTS);
    for (const v of variants) expect(v.width).toBeLessThanOrEqual(100);
  });
});

describe("ConcurrencyLimiter", () => {
  it("never runs more than `max` jobs concurrently", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let concurrent = 0;
    let maxObserved = 0;
    const job = () =>
      limiter.run(async () => {
        concurrent++;
        maxObserved = Math.max(maxObserved, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
      });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it("still runs every job to completion, just queued", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => limiter.run(async () => { order.push(n); })));
    expect(order.sort()).toEqual([1, 2, 3]);
  });
});
