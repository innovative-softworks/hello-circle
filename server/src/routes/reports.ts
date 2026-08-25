import { Router } from "express";
import { db } from "../db/index.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const reportsRouter = Router();

// Moderation reports (Phase D, best-effort) — the only user-generated
// surfaces today are Circles and reviews; this is report creation, review
// happens in routes/platformAdmin.ts.

reportsRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { targetType, targetId, reason } = req.body as { targetType?: string; targetId?: string; reason?: string };
  if (!targetType || !targetId || !reason) return res.status(400).json({ error: "targetType, targetId and reason are required" });
  await db.prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES (?, ?, ?, ?)`).run(targetType, targetId, clientId, reason);
  res.status(201).json({ ok: true });
});

// Safety Centre report history (IA spec §13) — a resident's own past
// reports, keyed the same way creation is (reporter_client_id), not by
// resident id, since reporting itself doesn't require being signed in.
reportsRouter.get("/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = await db
    .prepare(`SELECT id, target_type, target_id, reason, status, created_at FROM reports WHERE reporter_client_id = ? ORDER BY created_at DESC`)
    .all(clientId);
  res.json(
    (rows as any[]).map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    }))
  );
});
