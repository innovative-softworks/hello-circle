import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { requireVendorOrAdmin } from "../auth.js";
import { dataDir } from "../dataDir.js";

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

uploadsRouter.post("/", requireVendorOrAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

uploadsRouter.use((err: Error, _req: unknown, res: import("express").Response, _next: unknown) => {
  res.status(400).json({ error: err.message });
});
