import crypto from "node:crypto";
import { db } from "../db/index.js";

/** Bookkeeping for the `media_assets` ledger — see its CREATE TABLE comment
 * in db/index.ts for why this table exists alongside (not instead of) the
 * per-entity url columns every route already writes. Nothing in this file
 * is on the read path any existing page depends on; it only backs usage
 * visibility (routes/adminMedia.ts) and cleanup (scripts/mediaCleanup.ts). */

export type MediaAssetProvider = "r2" | "cloudinary";
export type MediaAssetStatus = "pending" | "attached" | "deletion_pending" | "deleted" | "failed";

export interface MediaAssetInput {
  /** Defaults to a fresh uuid. authorizeUpload passes the staging key
   * itself here, so finalizeUpload can look this exact row back up by the
   * same key the client hands back — see mediaService.ts. */
  id?: string;
  provider: MediaAssetProvider;
  providerKey: string;
  url: string;
  entityType: string;
  entityId: string | null;
  purpose: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  status?: MediaAssetStatus;
  caption?: string | null;
  createdByUserId?: string | null;
  createdByResidentId?: string | null;
  /** Ties every variant generated from ONE upload event together (local-
   * processing pass) — same value across all rows from that upload,
   * unset for anything single-file (Cloudinary editorial, or a row from
   * before this pass). */
  groupId?: string | null;
  variant?: string | null;
}

export async function recordMediaAsset(input: MediaAssetInput): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO media_assets
        (id, provider, provider_key, url, entity_type, entity_id, purpose, mime_type, width, height, bytes, status, caption, created_by_user_id, created_by_resident_id, group_id, variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.provider,
      input.providerKey,
      input.url,
      input.entityType,
      input.entityId,
      input.purpose,
      input.mimeType,
      input.width,
      input.height,
      input.bytes,
      input.status ?? "attached",
      input.caption ?? null,
      input.createdByUserId ?? null,
      input.createdByResidentId ?? null,
      input.groupId ?? null,
      input.variant ?? null
    );
  return id;
}

/** Every row belonging to one upload's variant group — used to clean up
 * an already-uploaded variant if a LATER variant in the same group fails
 * (atomic all-or-nothing attach, see mediaService.ts's local-processing
 * upload path), and by the release/replace flow to find every object a
 * stored canonical URL actually implies. */
export async function findMediaAssetsByGroup(groupId: string): Promise<MediaAssetRow[]> {
  return (await db.prepare(`SELECT ${ROW_SELECT} FROM media_assets WHERE group_id = ?`).all(groupId)) as MediaAssetRow[];
}

export async function markMediaAssetStatus(id: string, status: MediaAssetStatus): Promise<void> {
  await db.prepare(`UPDATE media_assets SET status = ? WHERE id = ?`).run(status, id);
}

export async function softDeleteMediaAsset(id: string): Promise<void> {
  await db.prepare(`UPDATE media_assets SET status = 'deletion_pending', deleted_at = NOW() WHERE id = ?`).run(id);
}

/** Looked up by (provider, provider_key) rather than id — the only handle
 * finalizeUpload/the release flow have at the point they need this is the
 * key itself (a staging key at authorize time, the final key at
 * release time), never the ledger row's own id. */
export interface MediaAssetRow {
  id: string;
  provider: MediaAssetProvider;
  providerKey: string;
  url: string;
  entityType: string;
  entityId: string | null;
  status: MediaAssetStatus;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  groupId: string | null;
  variant: string | null;
}

const ROW_SELECT = `id, provider, provider_key as providerKey, url, entity_type as entityType, entity_id as entityId, status, mime_type as mimeType, width, height, bytes, group_id as groupId, variant`;

export async function findMediaAssetByProviderKey(provider: MediaAssetProvider, providerKey: string): Promise<MediaAssetRow | undefined> {
  return (await db.prepare(`SELECT ${ROW_SELECT} FROM media_assets WHERE provider = ? AND provider_key = ?`).get(provider, providerKey)) as MediaAssetRow | undefined;
}

/** Promotes a `pending` staging-key row to `attached` at its real,
 * entity-namespaced final key — the second half of finalizeUpload's
 * validate-then-promote flow (see mediaService.ts). Only ever transitions
 * a row this file itself created as `pending`; there is no path that
 * creates an `attached` row directly for R2 uploads anymore. */
export async function promoteMediaAsset(
  id: string,
  update: { providerKey: string; url: string; mimeType: string; width: number | null; height: number | null; bytes: number }
): Promise<void> {
  await db
    .prepare(`UPDATE media_assets SET provider_key = ?, url = ?, mime_type = ?, width = ?, height = ?, bytes = ?, status = 'attached' WHERE id = ?`)
    .run(update.providerKey, update.url, update.mimeType, update.width, update.height, update.bytes, id);
}

/** Best-effort ledger sync for the /media/release flow — release deletes
 * the provider object directly (see routes/media.ts), and this just marks
 * whatever ledger row happens to reference that exact key as `deleted` so
 * usage visibility/cleanup stay accurate. A miss (no matching row — e.g. an
 * asset uploaded before this ledger existed) is a normal, silent no-op. */
export async function markDeletedByProviderKey(provider: MediaAssetProvider, providerKey: string): Promise<void> {
  await db.prepare(`UPDATE media_assets SET status = 'deleted', deleted_at = NOW() WHERE provider = ? AND provider_key = ? AND status != 'deleted'`).run(provider, providerKey);
}

export interface MediaUsageRow {
  provider: MediaAssetProvider;
  status: MediaAssetStatus;
  count: number;
  bytes: number;
}

/** Application-measured counts/bytes only — never presented as the
 * provider's own billing figures (routes/adminMedia.ts is explicit about
 * that distinction in its response shape). */
export async function mediaUsageByProviderAndStatus(): Promise<MediaUsageRow[]> {
  const rows = (await db
    .prepare(`SELECT provider, status, COUNT(*) as count, COALESCE(SUM(bytes), 0) as bytes FROM media_assets GROUP BY provider, status`)
    .all()) as { provider: MediaAssetProvider; status: MediaAssetStatus; count: number; bytes: string | number }[];
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

/** The ledger's own earliest row — used to render an honest "tracked
 * uploads since [date]; anything uploaded before that is excluded" label
 * (routes/adminMedia.ts), rather than letting a count/byte total imply
 * total historical/bucket usage. */
export async function mediaLedgerStartedAt(): Promise<string | null> {
  const row = (await db.prepare(`SELECT MIN(created_at) as since FROM media_assets`).get()) as { since: string | null } | undefined;
  return row?.since ?? null;
}

export interface EditorialAssetRow {
  id: string;
  url: string;
  caption: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export async function listEditorialAssets(): Promise<EditorialAssetRow[]> {
  return (await db
    .prepare(
      `SELECT id, url, caption, bytes, width, height, created_at as createdAt FROM media_assets
       WHERE entity_type = 'editorial-image' AND status = 'attached' ORDER BY created_at DESC`
    )
    .all()) as EditorialAssetRow[];
}

export async function getMediaAsset(id: string): Promise<MediaAssetRow | undefined> {
  return (await db.prepare(`SELECT ${ROW_SELECT} FROM media_assets WHERE id = ?`).get(id)) as MediaAssetRow | undefined;
}

/** Cleanup candidates for scripts/mediaCleanup.ts — bounded by `limit` so a
 * single run never scans/deletes an unbounded batch. `status` selects which
 * lifecycle stage to look for (never-finalized `pending` rows past their
 * upload TTL, or `deletion_pending` rows whose provider delete may have
 * failed/not-yet-run). */
export async function findCleanupCandidates(status: MediaAssetStatus, olderThanMs: number, limit: number): Promise<
  { id: string; provider: MediaAssetProvider; providerKey: string }[]
> {
  return (await db
    .prepare(
      `SELECT id, provider, provider_key as providerKey FROM media_assets
       WHERE status = ? AND created_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
       ORDER BY created_at ASC LIMIT ?`
    )
    .all(status, Math.floor(olderThanMs / 1000), limit)) as { id: string; provider: MediaAssetProvider; providerKey: string }[];
}
