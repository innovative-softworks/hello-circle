import { Router } from "express";
import { logEvent } from "../analytics.js";
import { fromAttendanceStatus } from "../attendanceState.js";
import { db } from "../db/index.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const feedbackRouter = Router();

// Post-activity feedback — "How was it?" (Release 3): an optional private
// star rating, a few optional tags, an optional comment, and the one
// required answer, "Would you do something like this again?" (`response`,
// yes/maybe/no — unchanged from Phase A so every existing reader of it,
// e.g. the would-repeat % on detail pages, keeps working). One response per
// (kind, ref, client). This is private to the host/platform; public
// reviews stay in the separate reviews table.

const RESPONSE_VALUES = ["yes", "maybe", "no"];
export const FEEDBACK_TAGS = ["great_host", "met_new_people", "well_organised", "beginner_friendly", "great_location"] as const;
// Pre-Release-3 optional yes/maybe/no questions — still accepted from an
// older client; a "beginner_friendly" tag also fills the matching column so
// anything reading it keeps getting a signal.
const LEGACY_QUESTION_KEYS = ["beginnerFriendly", "soloFriendly", "descriptionAccurate", "welcoming"] as const;
const MAX_COMMENT = 1000;

// Kinds whose participation is recorded in the shared attendance table.
const ATTENDANCE_KIND: Record<string, string> = { booking: "booking", registration: "registration", experience: "experience" };

feedbackRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const body = req.body as {
    kind?: string;
    ref?: string;
    response?: string;
    rating?: number;
    tags?: unknown;
    comment?: string;
  } & Partial<Record<(typeof LEGACY_QUESTION_KEYS)[number], string>>;
  const { kind, ref, response } = body;
  if (!kind || !ref || !response || !RESPONSE_VALUES.includes(response)) {
    return res.status(400).json({ error: "kind, ref and a response of yes/maybe/no are required" });
  }
  for (const key of LEGACY_QUESTION_KEYS) {
    if (body[key] !== undefined && !RESPONSE_VALUES.includes(body[key]!)) {
      return res.status(400).json({ error: `${key} must be yes/maybe/no if provided` });
    }
  }
  if (body.rating !== undefined && body.rating !== null && !(Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5)) {
    return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
  }
  const tags = Array.isArray(body.tags) ? FEEDBACK_TAGS.filter((t) => (body.tags as unknown[]).includes(t)) : [];
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, MAX_COMMENT) : "";

  // Feedback is for people who actually took part — a host-recorded no-show
  // can't leave it (a missing record is "unknown", which still can).
  const attendanceKind = ATTENDANCE_KIND[kind];
  if (attendanceKind) {
    const a = (await db.prepare(`SELECT status FROM attendance WHERE kind = ? AND ref = ?`).get(attendanceKind, ref)) as { status: string } | undefined;
    if (fromAttendanceStatus(a?.status) === "no_show") return res.status(409).json({ error: "Feedback is only for people who attended" });
  }

  const beginnerFriendly = body.beginnerFriendly ?? (tags.includes("beginner_friendly") ? "yes" : null);
  await db
    .prepare(
      `INSERT INTO activity_feedback (kind, ref, resident_id, client_id, response, beginner_friendly, solo_friendly, description_accurate, welcoming, rating, tags, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), beginner_friendly = COALESCE(VALUES(beginner_friendly), beginner_friendly),
         solo_friendly = COALESCE(VALUES(solo_friendly), solo_friendly), description_accurate = COALESCE(VALUES(description_accurate), description_accurate),
         welcoming = COALESCE(VALUES(welcoming), welcoming), rating = COALESCE(VALUES(rating), rating),
         tags = VALUES(tags), comment = COALESCE(VALUES(comment), comment)`
    )
    .run(
      kind,
      ref,
      req.resident?.id ?? null,
      clientId,
      response,
      beginnerFriendly,
      body.soloFriendly ?? null,
      body.descriptionAccurate ?? null,
      body.welcoming ?? null,
      body.rating ?? null,
      tags.join(","),
      comment || null
    );
  void logEvent("feedback_submitted", { residentId: req.resident?.id ?? null, clientId, metadata: { kind, response, rated: !!body.rating, tags: tags.length } });
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
              description_accurate as descriptionAccurate, welcoming, rating, tags, comment
       FROM activity_feedback WHERE kind = ? AND ref = ? AND client_id = ?`
    )
    .get(kind, ref, clientId)) as
    | { response: string; beginnerFriendly: string | null; soloFriendly: string | null; descriptionAccurate: string | null; welcoming: string | null; rating: number | null; tags: string; comment: string | null }
    | undefined;
  res.json({
    response: row?.response ?? null,
    beginnerFriendly: row?.beginnerFriendly ?? null,
    soloFriendly: row?.soloFriendly ?? null,
    descriptionAccurate: row?.descriptionAccurate ?? null,
    welcoming: row?.welcoming ?? null,
    rating: row?.rating ?? null,
    tags: row?.tags ? row.tags.split(",").filter(Boolean) : [],
    comment: row?.comment ?? null,
  });
});
