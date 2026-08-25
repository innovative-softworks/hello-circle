import { Router } from "express";
import { db } from "../db/index.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const feedbackRouter = Router();

// Post-activity feedback (Phase A) — "would you do this again", not a
// 5-star review request every time. One response per (kind, ref, client).

const OPTIONAL_QUESTION_KEYS = ["beginnerFriendly", "soloFriendly", "descriptionAccurate", "welcoming"] as const;
const RESPONSE_VALUES = ["yes", "maybe", "no"];

feedbackRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const body = req.body as { kind?: string; ref?: string; response?: string } & Partial<Record<(typeof OPTIONAL_QUESTION_KEYS)[number], string>>;
  const { kind, ref, response } = body;
  if (!kind || !ref || !response || !RESPONSE_VALUES.includes(response)) {
    return res.status(400).json({ error: "kind, ref and a response of yes/maybe/no are required" });
  }
  // Fuller feedback (IA spec §11) — the other 4 questions are all optional,
  // so a resident can still answer just "would you do this again" exactly
  // as before; anything unset (undefined) leaves that column untouched via
  // the same COALESCE-on-upsert pattern used everywhere else in this app.
  for (const key of OPTIONAL_QUESTION_KEYS) {
    if (body[key] !== undefined && !RESPONSE_VALUES.includes(body[key]!)) {
      return res.status(400).json({ error: `${key} must be yes/maybe/no if provided` });
    }
  }
  await db
    .prepare(
      `INSERT INTO activity_feedback (kind, ref, resident_id, client_id, response, beginner_friendly, solo_friendly, description_accurate, welcoming)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), beginner_friendly = COALESCE(VALUES(beginner_friendly), beginner_friendly),
         solo_friendly = COALESCE(VALUES(solo_friendly), solo_friendly), description_accurate = COALESCE(VALUES(description_accurate), description_accurate),
         welcoming = COALESCE(VALUES(welcoming), welcoming)`
    )
    .run(kind, ref, req.resident?.id ?? null, clientId, response, body.beginnerFriendly ?? null, body.soloFriendly ?? null, body.descriptionAccurate ?? null, body.welcoming ?? null);
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
  const row = (await db
    .prepare(
      `SELECT response, beginner_friendly as beginnerFriendly, solo_friendly as soloFriendly,
              description_accurate as descriptionAccurate, welcoming
       FROM activity_feedback WHERE kind = ? AND ref = ? AND client_id = ?`
    )
    .get(kind, ref, clientId)) as
    | { response: string; beginnerFriendly: string | null; soloFriendly: string | null; descriptionAccurate: string | null; welcoming: string | null }
    | undefined;
  res.json({
    response: row?.response ?? null,
    beginnerFriendly: row?.beginnerFriendly ?? null,
    soloFriendly: row?.soloFriendly ?? null,
    descriptionAccurate: row?.descriptionAccurate ?? null,
    welcoming: row?.welcoming ?? null,
  });
});
