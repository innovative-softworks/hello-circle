import "dotenv/config";
import { initSchema } from "../db/index.js";
import { deleteEditorialImage, deleteObject } from "../media/mediaService.js";
import { findCleanupCandidates, markMediaAssetStatus } from "../media/mediaAssets.js";

// Pending/orphan cleanup for the media_assets ledger (Media Cost Controls
// pass) — bounded, dry-run-by-default, idempotent. Deliberately a plain
// script an operator (or the existing OS cron already used for anything
// else this deployment runs on a schedule) invokes periodically, NOT a new
// queue/worker service — see the media architecture report's §17/§22
// "don't introduce new infrastructure" guidance.
//
// Two things this cleans up:
//   1. `pending` rows older than PENDING_TTL_MS that were never finalized —
//      authorizeUpload records a `pending` row (keyed by the throwaway
//      staging key) at authorize time, before the browser has even started
//      its PUT (see mediaService.ts's authorizeUpload/finalizeUpload); a
//      browser that never completes the PUT, or never calls finalize,
//      leaves this row as the only trace. Deleting the (possibly
//      nonexistent — deleteObject is a no-op-safe idempotent delete)
//      staging object and marking the row `deleted` is always safe: a
//      `pending` row's key is, by construction, never referenced by any
//      entity — finalizeUpload only ever promotes a validated object to an
//      entity-namespaced key, so nothing outside this ledger can be
//      pointing at a staging key.
//   2. `deletion_pending` rows whose provider delete previously failed
//      (see mediaService.ts's deleteEditorialImage) — retried here with
//      the SAME stored provider/key, never a caller-supplied one.
//
// Usage:
//   tsx src/scripts/mediaCleanup.ts               (dry run — default, no writes)
//   tsx src/scripts/mediaCleanup.ts --apply        (actually delete + mark rows)
//   tsx src/scripts/mediaCleanup.ts --apply --limit=50

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 100;
const PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour — matches the presigned upload URL's own 5-minute TTL with generous slack for a slow client

async function cleanupPending() {
  const candidates = await findCleanupCandidates("pending", PENDING_TTL_MS, BATCH_LIMIT);
  console.log(`[pending] ${candidates.length} row(s) older than ${PENDING_TTL_MS / 1000}s and never finalized`);
  for (const c of candidates) {
    console.log(`${APPLY ? "[apply]" : "[dry-run]"} pending -> deleted: ${c.provider} ${c.providerKey}`);
    if (!APPLY) continue;
    if (c.provider === "r2") await deleteObject(c.providerKey);
    // Cloudinary editorial assets never reach 'pending' today (uploadEditorialImage
    // records 'attached' only after a successful upload) — r2-only in practice.
    await markMediaAssetStatus(c.id, "deleted");
  }
}

async function retryPendingDeletions() {
  const candidates = await findCleanupCandidates("deletion_pending", 0, BATCH_LIMIT);
  console.log(`[deletion_pending] ${candidates.length} row(s) awaiting a provider-delete retry`);
  for (const c of candidates) {
    console.log(`${APPLY ? "[apply]" : "[dry-run]"} retrying delete: ${c.provider} ${c.providerKey}`);
    if (!APPLY) continue;
    if (c.provider === "r2") {
      await deleteObject(c.providerKey);
      await markMediaAssetStatus(c.id, "deleted");
    } else {
      // Reuses deleteEditorialImage's own retry-safe logic (re-checks
      // current status, best-effort Cloudinary destroy, marks 'deleted'
      // only after that call is attempted) rather than duplicating it here.
      await deleteEditorialImage(c.id).catch((e) => console.error(`  failed: ${e instanceof Error ? e.message : e}`));
    }
  }
}

await initSchema();
console.log(`Media cleanup — ${APPLY ? "LIVE (writes enabled)" : "DRY RUN (no writes)"}, batch limit ${BATCH_LIMIT}\n`);
await cleanupPending();
await retryPendingDeletions();
console.log(APPLY ? "\nCleanup complete." : "\nDry run complete — re-run with --apply to actually delete.");
process.exit(0);
