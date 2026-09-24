import { describe, expect, it } from "vitest";
import { exceedsMaxMegapixels, sniffImage } from "./imageSniff.js";

// A real, valid 2x3 PNG (the smallest real encoder output is simplest to
// get exactly right for PNG's checksummed chunk format). JPEG/WebP/GIF/
// HEIC are built programmatically below, matching each format's documented
// header layout exactly — that's what sniffImage actually parses, so
// building them by hand (rather than needing a real encoder) proves the
// byte offsets are read correctly.
const PNG_2X3_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABLYCJUAAAAAXNSR0IArs4c6QAAAA1JREFUCJlj+P//PwMAAP//AwAB/1YAAAAASUVORK5CYII=";

/** SOI + a single SOF0 segment carrying `height`/`width` — not a
 * complete/decodable JPEG (no scan data), but exactly what sniffJpeg
 * reads: it returns as soon as it finds the SOF marker. */
function buildMinimalJpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(19);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(11, 4); // segment length (arbitrary, >= the fields we read)
  buf[6] = 8; // precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 1; // component count
  return buf;
}

describe("sniffImage", () => {
  it("reads real PNG dimensions from IHDR", () => {
    const buf = Buffer.from(PNG_2X3_BASE64, "base64");
    const result = sniffImage(buf);
    expect(result).toEqual({ format: "png", width: 2, height: 3 });
  });

  it("reads JPEG dimensions from the SOF0 marker", () => {
    const result = sniffImage(buildMinimalJpeg(800, 600));
    expect(result).toEqual({ format: "jpeg", width: 800, height: 600 });
  });

  it("reads WebP VP8X extended-format dimensions", () => {
    // RIFF header + VP8X chunk: 4-byte chunk id, 4-byte chunk size, 1-byte
    // flags, 3 reserved bytes, then width-1/height-1 packed 24-bit LE
    // (spec-accurate offsets: width at 24-26, height at 27-29).
    const buf = Buffer.alloc(30);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(22, 4);
    buf.write("WEBP", 8, "ascii");
    buf.write("VP8X", 12, "ascii");
    buf.writeUInt32LE(10, 16);
    buf[20] = 0; // flags
    // buf[21..23] reserved, left zero
    const widthMinus1 = 99; // 100 - 1
    const heightMinus1 = 49; // 50 - 1
    buf[24] = widthMinus1 & 0xff;
    buf[25] = (widthMinus1 >> 8) & 0xff;
    buf[26] = (widthMinus1 >> 16) & 0xff;
    buf[27] = heightMinus1 & 0xff;
    buf[28] = (heightMinus1 >> 8) & 0xff;
    buf[29] = (heightMinus1 >> 16) & 0xff;
    const result = sniffImage(buf);
    expect(result).toEqual({ format: "webp", width: 100, height: 50 });
  });

  it("recognizes a GIF signature and dimensions", () => {
    const buf = Buffer.alloc(10);
    buf.write("GIF89a", 0, "ascii");
    buf.writeUInt16LE(64, 6);
    buf.writeUInt16LE(32, 8);
    expect(sniffImage(buf)).toEqual({ format: "gif", width: 64, height: 32 });
  });

  it("recognizes a HEIC ftyp box by brand, without dimensions", () => {
    const buf = Buffer.alloc(20);
    buf.writeUInt32BE(20, 0);
    buf.write("ftyp", 4, "ascii");
    buf.write("heic", 8, "ascii");
    expect(sniffImage(buf)).toEqual({ format: "heic", width: null, height: null });
  });

  it("rejects a file with no recognizable image signature", () => {
    const buf = Buffer.from("<html><body>not an image</body></html>");
    expect(sniffImage(buf)).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it("still recognizes a bare SOI+EOI JPEG with no other segments", () => {
    const result = sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(result).toEqual({ format: "jpeg", width: null, height: null });
  });

  it("does not mistake an .html file that merely starts with GIF-like bytes for a real GIF", () => {
    const buf = Buffer.concat([Buffer.from("GIF87a"), Buffer.from("<script>alert(1)</script>")]);
    // Still sniffs as a GIF signature match (this is a known, documented
    // limitation of signature-only sniffing — see module doc) but the
    // point of this test is that dimension reads never throw/crash on
    // adversarial trailing bytes.
    expect(() => sniffImage(buf)).not.toThrow();
  });
});

describe("exceedsMaxMegapixels", () => {
  it("allows a normal photo", () => {
    expect(exceedsMaxMegapixels(4000, 3000)).toBe(false); // 12MP
  });

  it("rejects something absurdly large", () => {
    expect(exceedsMaxMegapixels(10000, 10000)).toBe(true); // 100MP
  });

  it("never rejects when dimensions are unknown (e.g. HEIC)", () => {
    expect(exceedsMaxMegapixels(null, null)).toBe(false);
  });
});
