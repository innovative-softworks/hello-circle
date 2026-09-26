import { Router } from "express";
import crypto from "node:crypto";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { normalizeDemand } from "../demandNormalize.js";
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
  /** Release 6 — optional request details. */
  preferredDays?: string[];
  budgetMinEuro?: number;
  budgetMaxEuro?: number;
  radiusKm?: number;
  sourceQuery?: string;
}

const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "weekend", "weekday"];
const euroToCents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000 ? Math.round(v * 100) : null);

// POST / — "Request it" / "I'm interested too". One person counts once per
// cluster: if this device (or signed-in resident) already has an intent in
// the same cluster+county, that row is updated rather than a second one
// added, even when the wording differs ("badminton" then "Sunday badminton").
participationIntentsRouter.post("/", lookupLimiter, async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const b = req.body as CreateIntentBody;
  const activityLabel = (b.activityLabel ?? "").trim().slice(0, 255);
  const county = (b.county ?? "").trim();
  if (!activityLabel) return res.status(400).json({ error: "activityLabel is required" });
  const norm = normalizeDemand(activityLabel);
  if (!norm.clusterKey) return res.status(400).json({ error: "Tell us which activity you're looking for" });

  const days = [...new Set([...(Array.isArray(b.preferredDays) ? b.preferredDays : []), ...norm.days].filter((d) => DAY_CODES.includes(d)))];
  const budgetMin = euroToCents(b.budgetMinEuro);
  const budgetMax = euroToCents(b.budgetMaxEuro);
  const radiusKm = typeof b.radiusKm === "number" && b.radiusKm > 0 && b.radiusKm <= 200 ? Math.round(b.radiusKm) : null;
  const timeWindow = (b.preferredTimeWindow ?? "").slice(0, 50) || norm.time;
  const residentId = req.resident?.id ?? null;
  const expiresAt = new Date(Date.now() + INTENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  // "I'm interested too" vs a brand-new request — counted before the write,
  // excluding this person.
  const { others } = (await db
    .prepare(
      `SELECT COUNT(DISTINCT client_id) as others FROM participation_intents
       WHERE cluster_key = ? AND county = ? AND client_id != ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())`
    )
    .get(norm.clusterKey, county, clientId)) as { others: number };

  const existing = (await db
    .prepare(
      `SELECT id FROM participation_intents
       WHERE cluster_key = ? AND county = ? AND (client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?))
       ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`
    )
    .get(norm.clusterKey, county, clientId, residentId ?? "")) as { id: string } | undefined;

  const fields = {
    residentId,
    clientId,
    name: b.name ?? "",
    email: b.email ?? "",
    activityLabel,
    county,
    preferredDate: b.preferredDate ?? "",
    preferredTimeWindow: timeWindow,
    notes: b.notes ?? null,
    expiresAt,
    clusterKey: norm.clusterKey,
    category: norm.category,
    preferredDays: days.join(","),
    budgetMin,
    budgetMax,
    radiusKm,
    sourceQuery: (b.sourceQuery ?? "").slice(0, 500),
  };

  let id: string;
  if (existing) {
    id = existing.id;
    await db
      .prepare(
        `UPDATE participation_intents SET resident_id = COALESCE(@residentId, resident_id), status = 'active', expires_at = @expiresAt,
           preferred_time_window = CASE WHEN @preferredTimeWindow = '' THEN preferred_time_window ELSE @preferredTimeWindow END,
           preferred_days = CASE WHEN @preferredDays = '' THEN preferred_days ELSE @preferredDays END,
           budget_min_cents = COALESCE(@budgetMin, budget_min_cents), budget_max_cents = COALESCE(@budgetMax, budget_max_cents),
           radius_km = COALESCE(@radiusKm, radius_km), notes = COALESCE(@notes, notes)
         WHERE id = @id`
      )
      .run({ ...fields, id });
  } else {
    id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO participation_intents
           (id, resident_id, client_id, name, email, activity_label, county, preferred_date, preferred_time_window, notes, status, expires_at,
            cluster_key, category, preferred_days, budget_min_cents, budget_max_cents, radius_km, source_query)
         VALUES (@id, @residentId, @clientId, @name, @email, @activityLabel, @county, @preferredDate, @preferredTimeWindow, @notes, 'active', @expiresAt,
            @clusterKey, @category, @preferredDays, @budgetMin, @budgetMax, @radiusKm, @sourceQuery)
         ON DUPLICATE KEY UPDATE
           resident_id = COALESCE(VALUES(resident_id), resident_id), status = 'active', expires_at = VALUES(expires_at),
           cluster_key = VALUES(cluster_key), category = VALUES(category), preferred_days = VALUES(preferred_days),
           preferred_time_window = VALUES(preferred_time_window), notes = VALUES(notes)`
      )
      .run({ ...fields, id });
    // The unique (client_id, activity_label, county) key can route this to
    // an older cancelled row — re-read the real id.
    const row = (await db
      .prepare(`SELECT id FROM participation_intents WHERE client_id = ? AND activity_label = ? AND county = ?`)
      .get(clientId, activityLabel, county)) as { id: string } | undefined;
    id = row?.id ?? id;
  }

  await notifyIntentClusterIfThreshold(norm.clusterKey, county, norm.label);
  void logEvent(Number(others) > 0 ? "request_interest_added" : "intent_created", {
    residentId,
    clientId,
    metadata: { activityLabel, clusterKey: norm.clusterKey, county, othersInterested: Number(others) },
  });

  res.status(201).json({ id, clusterKey: norm.clusterKey, label: norm.label });
});

// GET /count — how many people want something similar (the cluster, not the
// exact wording), plus the caller's own intent in it if any.
participationIntentsRouter.get("/count", async (req, res) => {
  const activityLabel = String(req.query.activityLabel ?? "").trim();
  const county = String(req.query.county ?? "").trim();
  if (!activityLabel) return res.status(400).json({ error: "activityLabel is required" });
  const norm = normalizeDemand(activityLabel);
  if (!norm.clusterKey) return res.json({ count: 0, residentCount: 0, myIntentId: null, clusterKey: "", label: "" });

  const row = (await db
    .prepare(
      `SELECT COUNT(DISTINCT client_id) as count, COUNT(DISTINCT resident_id) as residentCount
       FROM participation_intents
       WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) AND cluster_key = ? AND county = ?`
    )
    .get(norm.clusterKey, county)) as { count: number; residentCount: number };
  // No X-Client-Id (e.g. a share-card fetch) just means no "mine".
  const clientId = req.header("X-Client-Id") ?? "";
  const mine = clientId || req.resident
    ? ((await db
        .prepare(
          `SELECT id FROM participation_intents
           WHERE cluster_key = ? AND county = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
             AND (client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?))
           LIMIT 1`
        )
        .get(norm.clusterKey, county, clientId, req.resident?.id ?? "")) as { id: string } | undefined)
    : undefined;
  res.json({ count: Number(row.count), residentCount: Number(row.residentCount), myIntentId: mine?.id ?? null, clusterKey: norm.clusterKey, label: norm.label });
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
