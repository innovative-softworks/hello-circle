import { Router } from "express";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";

// Revenue & Connect Stage 3 — financial field help (brief §19D). Public read
// (latest version per key); edits go through the admin router (legal or
// super) and add a new version — earlier versions are kept.
export const helpRouter = Router();

const FIELDS = `h.help_key as helpKey, h.version, h.name, h.definition, h.formula, h.example, h.who_pays as whoPays, h.when_charged as whenCharged,
  h.refund_behaviour as refundBehaviour, h.policy_key as policyKey, h.created_at as updatedAt`;

export async function latestHelp(keys?: string[]) {
  const filter = keys?.length ? `AND h.help_key IN (${keys.map(() => "?").join(",")})` : "";
  return db
    .prepare(
      `SELECT ${FIELDS} FROM help_entries h
       JOIN (SELECT help_key, MAX(version) as v FROM help_entries GROUP BY help_key) m ON m.help_key = h.help_key AND m.v = h.version
       WHERE 1 = 1 ${filter} ORDER BY h.help_key`
    )
    .all(...(keys ?? []));
}

helpRouter.get("/fields", async (req, res) => {
  const keys = typeof req.query.keys === "string" ? req.query.keys.split(",").map((k) => k.trim()).filter((k) => /^[a-z0-9_]{1,60}$/.test(k)).slice(0, 50) : undefined;
  res.json(await latestHelp(keys));
});

/** Admin edit (mounted under /api/admin/help behind requireAdminRole("legal")). */
export const adminHelpRouter = Router();

adminHelpRouter.get("/:key/versions", async (req, res) => {
  res.json(await db.prepare(`SELECT ${FIELDS}, h.created_by as createdBy, h.reason FROM help_entries h WHERE h.help_key = ? ORDER BY h.version DESC`).all(req.params.key));
});

adminHelpRouter.put("/:key", async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 5) return res.status(400).json({ error: "A reason (at least 5 characters) is required" });
  const fields = ["name", "definition", "formula", "example", "whoPays", "whenCharged", "refundBehaviour", "policyKey"] as const;
  for (const f of fields) if (typeof b[f] !== "string" || !(b[f] as string).trim()) return res.status(400).json({ error: `${f} is required` });
  if ((b.name as string).length > 120) return res.status(400).json({ error: "Name is too long" });
  try {
    const next = await db.transaction(async (tx) => {
      const cur = (await tx.prepare(`SELECT MAX(version) as v FROM help_entries WHERE help_key = ? FOR UPDATE`).get(req.params.key)) as { v: number | null };
      if (cur.v === null) throw new Error("NOT_FOUND");
      const v = Number(cur.v) + 1;
      await tx
        .prepare(
          `INSERT INTO help_entries (help_key, version, name, definition, formula, example, who_pays, when_charged, refund_behaviour, policy_key, created_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(req.params.key, v, ...fields.map((f) => (b[f] as string).trim().slice(0, 4000)), req.user!.id, reason);
      return v;
    });
    await writeAudit({ actorUserId: req.user!.id, actorKind: "user", action: "help.updated", objectType: "help_entry", objectId: req.params.key, newValue: { version: next }, reason });
    res.json({ helpKey: req.params.key, version: next });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return res.status(404).json({ error: "Unknown help entry" });
    throw e;
  }
});
