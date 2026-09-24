import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../db/index.js";
import { dataDir } from "../dataDir.js";
import { mediaConfig } from "../media/config.js";
import { r2Client } from "../media/r2Client.js";

// Cloudflare R2 Media System — Changeset 7. One-time migration of every
// still-legacy `/uploads/<file>` reference into R2, matching the same
// object-key convention (`{prefix}/{entityId}/{purpose}/{uuid}.ext`) new
// uploads already use (see media/mediaService.ts). Never touches an
// external URL (placehold.co seed placeholders, Unsplash marketing images,
// or anything else not starting with `/uploads/`) and never deletes a
// local file — verification is a separate, deliberate step the operator
// runs after reviewing this script's report (media plan §42's staged
// migration: dry-run first, then real, never auto-retire the old path).
//
// Usage:
//   tsx src/scripts/migrateLegacyUploads.ts --dry-run   (report only, no writes)
//   tsx src/scripts/migrateLegacyUploads.ts             (real migration)

const DRY_RUN = process.argv.includes("--dry-run");

if (mediaConfig.provider !== "r2" || !mediaConfig.r2 || !r2Client) {
  console.error("MEDIA_PROVIDER must be \"r2\" with a complete R2 config to run this migration.");
  process.exit(1);
}
if (!mediaConfig.r2.publicDomain) {
  console.error("R2_PUBLIC_DOMAIN must be set — migrated rows need a real delivery URL to write back.");
  process.exit(1);
}

const bucket = mediaConfig.r2.bucket;
const publicDomain = mediaConfig.r2.publicDomain;

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

interface Result {
  total: number;
  migrated: number;
  missingSource: number;
  failedUpload: number;
  failedDbUpdate: number;
  externalSkipped: number;
}
const result: Result = { total: 0, migrated: 0, missingSource: 0, failedUpload: 0, failedDbUpdate: 0, externalSkipped: 0 };
const failures: string[] = [];

async function migrateOneFile(localUrl: string, prefix: string, entityId: string, purpose: string): Promise<string | null> {
  const localPath = path.join(dataDir, localUrl);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(localPath);
  } catch {
    result.missingSource++;
    failures.push(`MISSING SOURCE: ${localUrl} (expected at ${localPath})`);
    return null;
  }

  const ext = path.extname(localUrl).toLowerCase() || ".jpg";
  const safeEntityId = String(entityId).replace(/[^a-zA-Z0-9_-]/g, "") || "unknown";
  const key = `${prefix}/${safeEntityId}/${purpose}/${crypto.randomUUID()}${ext}`;

  if (DRY_RUN) {
    console.log(`[dry-run] would migrate ${localUrl} (${bytes.length} bytes) -> ${key}`);
    result.migrated++;
    return null;
  }

  try {
    await r2Client!.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: MIME_BY_EXT[ext] ?? "application/octet-stream" }));
    await r2Client!.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    result.failedUpload++;
    failures.push(`FAILED UPLOAD: ${localUrl}: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  result.migrated++;
  return `https://${publicDomain}/${key}`;
}

const SINGLE_COLUMN_TARGETS = [
  { table: "centres", idColumn: "id", urlColumn: "image_url", prefix: "centres", purpose: "gallery" },
  { table: "clubs", idColumn: "id", urlColumn: "image_url", prefix: "clubs", purpose: "gallery" },
  { table: "experiences", idColumn: "id", urlColumn: "image_url", prefix: "experiences", purpose: "gallery" },
  { table: "programs", idColumn: "id", urlColumn: "image_url", prefix: "programs", purpose: "cover" },
  { table: "games", idColumn: "id", urlColumn: "image_url", prefix: "activities", purpose: "cover" },
  { table: "circles", idColumn: "id", urlColumn: "image_url", prefix: "circles", purpose: "cover" },
  { table: "club_sessions", idColumn: "id", urlColumn: "image_url", prefix: "club-sessions", purpose: "cover" },
  { table: "users", idColumn: "id", urlColumn: "logo", prefix: "providers", purpose: "logo" },
  { table: "residents", idColumn: "id", urlColumn: "avatar_url", prefix: "residents", purpose: "avatar" },
] as const;

const GALLERY_TARGETS = [
  { table: "centre_images", parentColumn: "centre_id", urlColumn: "url", prefix: "centres", purpose: "gallery" },
  { table: "club_images", parentColumn: "club_id", urlColumn: "url", prefix: "clubs", purpose: "gallery" },
  { table: "experience_images", parentColumn: "experience_id", urlColumn: "url", prefix: "experiences", purpose: "gallery" },
] as const;

async function migrateSingleColumnTable(t: (typeof SINGLE_COLUMN_TARGETS)[number]) {
  const rows = (await db
    .prepare(`SELECT ${t.idColumn} as id, ${t.urlColumn} as url FROM ${t.table} WHERE ${t.urlColumn} LIKE '/uploads/%'`)
    .all()) as { id: string; url: string }[];
  const { n: externalCount } = (await db
    .prepare(`SELECT COUNT(*) as n FROM ${t.table} WHERE ${t.urlColumn} IS NOT NULL AND ${t.urlColumn} != '' AND ${t.urlColumn} NOT LIKE '/uploads/%'`)
    .get()) as { n: number };
  result.externalSkipped += externalCount;

  for (const row of rows) {
    result.total++;
    const newUrl = await migrateOneFile(row.url, t.prefix, row.id, t.purpose);
    if (newUrl && !DRY_RUN) {
      try {
        await db.prepare(`UPDATE ${t.table} SET ${t.urlColumn} = ? WHERE ${t.idColumn} = ?`).run(newUrl, row.id);
      } catch (e) {
        result.failedDbUpdate++;
        failures.push(`FAILED DB UPDATE: ${t.table}.${t.idColumn}=${row.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

async function migrateGalleryTable(t: (typeof GALLERY_TARGETS)[number]) {
  const rows = (await db
    .prepare(`SELECT ${t.parentColumn} as parentId, ${t.urlColumn} as url FROM ${t.table} WHERE ${t.urlColumn} LIKE '/uploads/%'`)
    .all()) as { parentId: string; url: string }[];
  const { n: externalCount } = (await db
    .prepare(`SELECT COUNT(*) as n FROM ${t.table} WHERE ${t.urlColumn} NOT LIKE '/uploads/%'`)
    .get()) as { n: number };
  result.externalSkipped += externalCount;

  for (const row of rows) {
    result.total++;
    const newUrl = await migrateOneFile(row.url, t.prefix, row.parentId, t.purpose);
    if (newUrl && !DRY_RUN) {
      try {
        // Gallery tables have no per-row primary key (see media audit §17)
        // — matched by (parent, original url) instead, unique enough since
        // each row is a distinct uploaded file.
        await db.prepare(`UPDATE ${t.table} SET ${t.urlColumn} = ? WHERE ${t.parentColumn} = ? AND ${t.urlColumn} = ?`).run(newUrl, row.parentId, row.url);
      } catch (e) {
        result.failedDbUpdate++;
        failures.push(`FAILED DB UPDATE: ${t.table} parent=${row.parentId} url=${row.url}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

console.log(`Legacy /uploads migration — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
console.log(`Target: R2 bucket "${bucket}", delivery domain "${publicDomain}"\n`);

for (const t of SINGLE_COLUMN_TARGETS) await migrateSingleColumnTable(t);
for (const t of GALLERY_TARGETS) await migrateGalleryTable(t);

console.log("\n--- Migration report ---");
console.log(`Total /uploads references found: ${result.total}`);
console.log(`${DRY_RUN ? "Would migrate" : "Migrated"}: ${result.migrated}`);
console.log(`Missing source file: ${result.missingSource}`);
console.log(`Failed upload: ${result.failedUpload}`);
console.log(`Failed DB update: ${result.failedDbUpdate}`);
console.log(`External URLs skipped (untouched, as intended): ${result.externalSkipped}`);
if (failures.length > 0) {
  console.log("\n--- Failures ---");
  failures.forEach((f) => console.log(f));
}
console.log(
  DRY_RUN
    ? "\nDry run complete — no files were uploaded, no database rows were changed."
    : "\nMigration complete — local files under /uploads were NOT deleted; verify the report above before considering any cleanup."
);
process.exit(result.failedUpload > 0 || result.failedDbUpdate > 0 ? 1 : 0);
