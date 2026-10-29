import { Router } from "express";
import { REPORT_TARGET_TYPES, isReportTargetType, resolveReportTarget } from "../reportModeration.js";
import { db } from "../db/index.js";
import { simpleRateLimit } from "../rateLimit.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const reportsRouter = Router();

// Moderation reports — creation is public (keyed by the anonymous client id,
// plus the resident id when signed in); review happens in the admin Reviews &
// reports queue (routes/admin.ts). A report is private: nothing here or in any
// owner-facing route reveals who reported, and the reported person is never
// shown the report itself.
//
// Trust & Retention batch 1: a report is either about content ("content") or a
// safety concern ("safety" — someone may be at risk; prioritised in the admin
// queue). The reporter gets a case reference and can ask for a decided report
// to be reconsidered through the complaints process (kind "appeal").

export const REPORT_CATEGORIES = ["content", "safety"] as const;
export const caseRef = (id: number) => `R-${String(id).padStart(6, "0")}`;

const reportLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

reportsRouter.post("/", reportLimiter, async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { targetType, targetId, reason, category } = req.body as { targetType?: string; targetId?: string; reason?: string; category?: string };
  if (!targetType || !targetId || !reason) return res.status(400).json({ error: "targetType, targetId and reason are required" });
  // OG-32 — only content HelloCircle can actually act on can be reported.
  if (!isReportTargetType(targetType)) return res.status(400).json({ error: `targetType must be one of ${REPORT_TARGET_TYPES.join(", ")}` });
  if (typeof targetId !== "string" || targetId.length > 191) return res.status(400).json({ error: "targetId is invalid" });
  if (typeof reason !== "string" || reason.trim().length > 2000) return res.status(400).json({ error: "Keep the reason under 2000 characters" });
  const cat = category === "safety" ? "safety" : "content";
  if (!(await resolveReportTarget(targetType, targetId))) return res.status(404).json({ error: "That content no longer exists" });
  const r = await db
    .prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reporter_resident_id, reason, category) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(targetType, targetId, clientId, req.resident?.id ?? null, reason, cat);
  const id = Number(r.lastInsertRowid);
  res.status(201).json({ ok: true, id, caseRef: caseRef(id), category: cat });
});

// Safety Centre report history — a reporter's own reports: those made from
// this device, plus (when signed in) those made while signed in elsewhere.
reportsRouter.get("/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const residentId = req.resident?.id ?? null;
  const rows = await db
    .prepare(
      `SELECT id, target_type, target_id, reason, status, category, created_at, decided_at FROM reports
       WHERE reporter_client_id = ? ${residentId ? "OR reporter_resident_id = ?" : ""} ORDER BY created_at DESC LIMIT 200`
    )
    .all(...(residentId ? [clientId, residentId] : [clientId]));
  res.json(
    (rows as any[]).map((r) => ({
      id: r.id,
      caseRef: caseRef(r.id),
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      category: r.category ?? "content",
      createdAt: r.created_at,
      decidedAt: r.decided_at ?? null,
      canAppeal: r.status !== "pending",
    }))
  );
});
