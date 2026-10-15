import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { orgSuspended, removedStaff, requireVendorOrAdmin } from "../auth.js";
import { adminCan } from "../adminPermissions.js";
import { dataDir } from "../dataDir.js";
import { verifyStoredImage } from "../localUploads.js";

export const uploadsRouter = Router();

const uploadsDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// The stored filename's extension is derived from this map (keyed by the
// validated mimetype), never from the client-supplied original filename —
// otherwise a request could spoof Content-Type: image/jpeg to pass
// fileFilter while naming the file foo.html, land it on disk as
// <uuid>.html, and have express.static (serving /uploads) hand it back as
// text/html — script execution on this app's own origin.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${MIME_EXT[file.mimetype] ?? ""}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in MIME_EXT)) return cb(new Error("Only JPEG, PNG, WebP or GIF images are allowed"));
    cb(null, true);
  },
});

// D-02 — an admin uploads images only as part of editing listing content or
// the editorial library, so it needs one of those permissions; an admin with
// no role or an unknown role is refused before any file is written.
function adminMayUpload(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (req.user?.role === "admin" && !adminCan(req.user, "listings.edit") && !adminCan(req.user, "media.editorial")) {
    return res.status(403).json({ error: "Not included in your admin role" });
  }
  // D-01 / D-08: no partner uploads while the organisation is suspended or after removal from it.
  if (orgSuspended(req.user) || removedStaff(req.user)) return res.status(403).json({ error: "Not available for your account right now" });
  next();
}

uploadsRouter.post("/", requireVendorOrAdmin, adminMayUpload, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  // HC-QA-062 adjacent — the declared Content-Type alone isn't proof; the
  // file's own bytes must be the image type it claims to be.
  if (!verifyStoredImage(req.file.path, req.file.mimetype)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "That file isn't a supported image (JPEG, PNG, WebP or GIF)" });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

uploadsRouter.use((err: Error, _req: unknown, res: import("express").Response, _next: unknown) => {
  res.status(400).json({ error: err.message });
});
