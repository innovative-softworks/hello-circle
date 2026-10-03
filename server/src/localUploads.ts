import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./dataDir.js";

// Local-disk image storage (HC-QA-062) — used when cloud media (R2) isn't
// configured. `uploads/` is served publicly by express.static; restricted
// media (non-open Circle covers) goes to `private-uploads/`, which is never
// served statically and is only streamed through the membership-checked
// /api/media/circles/:id/cover endpoint.

export const publicUploadsDir = path.join(dataDir, "uploads");
export const privateUploadsDir = path.join(dataDir, "private-uploads");

const EXT_BY_TYPE: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

/** Detects the real image type from the file's own bytes (never the
 * client-declared Content-Type or filename). */
export function sniffImageType(buf: Buffer): keyof typeof EXT_BY_TYPE | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("ascii"))) return "image/gif";
  return null;
}

export class LocalImageError extends Error {}

/** Validates and stores an image; returns the generated filename. */
export function saveLocalImage(buf: Buffer, declaredType: string, opts: { private?: boolean } = {}): string {
  const actual = sniffImageType(buf);
  if (!actual || (declaredType && declaredType !== actual && !(declaredType === "image/jpg" && actual === "image/jpeg"))) {
    throw new LocalImageError("That file isn't a supported image (JPEG, PNG, WebP or GIF)");
  }
  const dir = opts.private ? privateUploadsDir : publicUploadsDir;
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}${EXT_BY_TYPE[actual]}`;
  fs.writeFileSync(path.join(dir, name), buf, { flag: "wx" });
  return name;
}

/** Same check for a file multer already wrote to disk (legacy route). */
export function verifyStoredImage(filePath: string, declaredType: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    const actual = sniffImageType(head.subarray(0, n));
    return !!actual && (actual === declaredType || (declaredType === "image/jpg" && actual === "image/jpeg"));
  } finally { fs.closeSync(fd); }
}

const PRIVATE_NAME = /^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/;
/** Resolves a stored private filename safely (no traversal). */
export function privateUploadPath(name: string): string | null {
  return PRIVATE_NAME.test(name) ? path.join(privateUploadsDir, name) : null;
}
