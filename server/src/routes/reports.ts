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
