import { Router } from "express";
import crypto from "node:crypto";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { notifyIntentClusterIfThreshold } from "../participationIntents.js";
import { lookupLimiter } from "../rateLimit.js";
import { clientIdFrom } from "../util.js";

export const participationIntentsRouter = Router();

// Explicit unmet-demand capture (participation-intent plan Phase 1) —
// deliberately separate from search_misses (see db/index.ts's schema
// comment): this is an opt-in "count me in" action a person takes from a
// dead-end search/browse/home result, not passive query-text logging.
// Works for guests (client_id) and residents alike, mirroring
// waitlist_entries' anonymous-capable shape.

const INTENT_TTL_DAYS = 14;

interface CreateIntentBody {
  activityLabel?: string;
  county?: string;
  preferredDate?: string;
  preferredTimeWindow?: string;
  notes?: string;
  name?: string;
  email?: string;
}

participationIntentsRouter.post("/", lookupLimiter, async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const b = req.body as CreateIntentBody;
  const activityLabel = (b.activityLabel ?? "").trim();
  const county = (b.county ?? "").trim();
  if (!activityLabel) return res.status(400).json({ error: "activityLabel is required" });

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INTENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db
    .prepare(
      `INSERT INTO participation_intents
         (id, resident_id, client_id, name, email, activity_label, county, preferred_date, preferred_time_window, notes, status, expires_at)
       VALUES (@id, @residentId, @clientId, @name, @email, @activityLabel, @county, @preferredDate, @preferredTimeWindow, @notes, 'active', @expiresAt)
       ON DUPLICATE KEY UPDATE
         resident_id = COALESCE(VALUES(resident_id), resident_id),
         name = VALUES(name), email = VALUES(email),
         preferred_date = VALUES(preferred_date), preferred_time_window = VALUES(preferred_time_window), notes = VALUES(notes),
         status = 'active', expires_at = VALUES(expires_at)`
    )
    .run({
      id,
      residentId: req.resident?.id ?? null,
      clientId,
      name: b.name ?? "",
      email: b.email ?? "",
      activityLabel,
      county,
      preferredDate: b.preferredDate ?? "",
      preferredTimeWindow: b.preferredTimeWindow ?? "",
      notes: b.notes ?? null,
      expiresAt,
    });

  // The upsert can hit the duplicate-key path and discard the UUID just
  // generated above, so re-read the real row id rather than assuming `id`.
  const row = (await db
    .prepare(`SELECT id FROM participation_intents WHERE client_id = ? AND activity_label = ? AND county = ?`)
    .get(clientId, activityLabel, county)) as { id: string };

  await notifyIntentClusterIfThreshold(activityLabel, county);
  void logEvent("intent_created", { residentId: req.resident?.id ?? null, clientId, metadata: { activityLabel, county } });

  res.status(201).json({ id: row.id });
});

participationIntentsRouter.get("/count", async (req, res) => {
  const activityLabel = String(req.query.activityLabel ?? "").trim();
  const county = String(req.query.county ?? "").trim();
  if (!activityLabel) return res.status(400).json({ error: "activityLabel is required" });

  const row = (await db
    .prepare(
      `SELECT COUNT(*) as count,
              CAST(COALESCE(SUM(CASE WHEN resident_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS UNSIGNED) as residentCount
       FROM participation_intents
       WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
         AND activity_label = ? AND county = ?`
    )
    .get(activityLabel, county)) as { count: number; residentCount: number };
  res.json(row);
});

participationIntentsRouter.get("/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const rows = await db
    .prepare(
      `SELECT id, activity_label as activityLabel, county, preferred_date as preferredDate, preferred_time_window as preferredTimeWindow,
              notes, status, created_at as createdAt
       FROM participation_intents
       WHERE (client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?)) AND status != 'cancelled'
       ORDER BY created_at DESC`
    )
    .all(clientId, req.resident?.id ?? "");
  res.json(rows);
});

participationIntentsRouter.delete("/:id", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const info = await db
    .prepare(`UPDATE participation_intents SET status = 'cancelled' WHERE id = ? AND (client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?))`)
    .run(req.params.id, clientId, req.resident?.id ?? "");
  if (info.changes === 0) return res.status(404).json({ error: "Intent not found" });
  res.json({ ok: true });
});
