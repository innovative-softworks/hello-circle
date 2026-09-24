/** Server-side file-signature + pixel-dimension sniffing — never trust a
 * client-declared Content-Type/extension alone (see mediaService.ts's
 * finalizeUpload/uploadEditorial). Deliberately dependency-free (no
 * sharp/imagemagick native binary): this app has no image-processing
 * dependency today, and adding one just to read a header is a bigger
 * footprint than parsing the four container formats we actually accept by
 * hand. Real, bounded support for JPEG/PNG/WebP; GIF/HEIC/HEIF are
 * signature-checked (so a mislabeled non-image can't pass) but their pixel
 * dimensions are intentionally NOT extracted — HEIC's box structure and
 * animated WebP/GIF frame handling would need meaningfully more parsing to
 * get right, and this app has never validated their dimensions, so skipping
 * is a documented no-op, not a regression. */

export type SniffedFormat = "jpeg" | "png" | "webp" | "gif" | "heic" | "heif";

export interface SniffedImage {
  format: SniffedFormat;
  /** Null when the format's dimensions aren't parsed (see module doc). */
  width: number | null;
  height: number | null;
}

function sniffPng(buf: Buffer): SniffedImage | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  // IHDR is always the first chunk, immediately after the 8-byte signature:
  // 4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height.
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sniffJpeg(buf: Buffer): SniffedImage | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return { format: "jpeg", width: null, height: null }; // malformed segment chain — signature still valid
    const marker = buf[offset + 1];
    // SOFn markers (0xC0-0xCF) carry dimensions, except DHT(C4)/JPG(C8)/DAC(CC).
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2; // markers with no payload length
      continue;
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (isSOF && offset + 9 <= buf.length) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { format: "jpeg", width, height };
    }
    offset += 2 + segmentLength;
  }
  return { format: "jpeg", width: null, height: null };
}

function sniffWebp(buf: Buffer): SniffedImage | null {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // Extended format: 24-bit width/height minus one, little-endian, at a fixed offset.
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    return { format: "webp", width, height };
  }
  if (chunk === "VP8 " && buf.length >= 30) {
    // Lossy: 14-bit width/height (top 2 bits are scale flags) at offset 26.
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { format: "webp", width, height };
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    // Lossless: 14-bit width/height packed across 4 bytes starting at offset 21.
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { format: "webp", width, height };
  }
  return { format: "webp", width: null, height: null };
}

function sniffGif(buf: Buffer): SniffedImage | null {
  if (buf.length < 10 || buf.toString("ascii", 0, 3) !== "GIF") return null;
  return { format: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function sniffHeif(buf: Buffer): SniffedImage | null {
  // ISO BMFF: 4-byte box size, then "ftyp", then a 4-byte brand. HEIC/HEIF
  // brands seen from real iPhone camera output: heic, heix, hevc, heim,
  // heis, mif1 (with a heic/heix/mif1 compatible-brands list, unchecked
  // here for simplicity — the major brand alone is enough to reject a
  // non-HEIC file that merely claims the mimetype).
  if (buf.length < 12 || buf.toString("ascii", 4, 8) !== "ftyp") return null;
  const brand = buf.toString("ascii", 8, 12);
  if (!["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return null;
  return { format: brand === "mif1" || brand === "msf1" ? "heif" : "heic", width: null, height: null };
}

/** Returns null if the bytes don't match any signature this app accepts —
 * callers must treat that as "reject the upload", never fall back to
 * trusting the declared Content-Type. */
export function sniffImage(buf: Buffer): SniffedImage | null {
  return sniffPng(buf) ?? sniffJpeg(buf) ?? sniffWebp(buf) ?? sniffGif(buf) ?? sniffHeif(buf);
}

export const MAX_MEGAPIXELS = 25;

export function exceedsMaxMegapixels(width: number | null, height: number | null): boolean {
  if (width == null || height == null) return false; // can't check what we can't parse — see module doc
  return width * height > MAX_MEGAPIXELS * 1_000_000;
}
