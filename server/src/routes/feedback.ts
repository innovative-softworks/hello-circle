import { Router } from "express";
import { db } from "../db/index.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const feedbackRouter = Router();

// Post-activity feedback (Phase A) — "would you do this again", not a
// 5-star review request every time. One response per (kind, ref, client).

feedbackRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { kind, ref, response } = req.body as { kind?: string; ref?: string; response?: string };
  if (!kind || !ref || !response || !["yes", "maybe", "no"].includes(response)) {
    return res.status(400).json({ error: "kind, ref and a response of yes/maybe/no are required" });
  }
  await db
    .prepare(`INSERT INTO activity_feedback (kind, ref, resident_id, client_id, response) VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE response = VALUES(response)`)
    .run(kind, ref, req.resident?.id ?? null, clientId, response);
  res.status(201).json({ ok: true });
});

feedbackRouter.get("/status", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { kind, ref } = req.query as { kind?: string; ref?: string };
  if (!kind || !ref) return res.status(400).json({ error: "kind and ref are required" });
  const row = await db.prepare(`SELECT response FROM activity_feedback WHERE kind = ? AND ref = ? AND client_id = ?`).get(kind, ref, clientId);
  res.json({ response: (row as { response: string } | undefined)?.response ?? null });
});
