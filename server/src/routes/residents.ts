import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident, updateResident } from "../residents.js";

export const residentsRouter = Router();

residentsRouter.get("/me", async (req, res) => {
  res.json({ resident: req.resident ?? null });
});

residentsRouter.put("/me", requireResident, async (req, res) => {
  const { name, homeCounty } = req.body as { name?: string; homeCounty?: string };
  await updateResident(req.resident!.id, { name, homeCounty });
  res.json({ ok: true });
});

// --- resident-facing notifications (MVP) ------------------------------
// Mirrors the shape of the existing vendor notification routes
// (routes/vendor.ts GET /notifications, POST /notifications/:id/read) —
// same table, just scoped by resident_id instead of recipient_id.

residentsRouter.get("/me/notifications", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, kind, title, body, listing_type as listingType, listing_id as listingId, ref, \`read\`, created_at as createdAt
       FROM notifications WHERE resident_id = ? ORDER BY created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

residentsRouter.post("/me/notifications/:id/read", requireResident, async (req, res) => {
  const info = await db.prepare(`UPDATE notifications SET \`read\` = 1 WHERE id = ? AND resident_id = ?`).run(req.params.id, req.resident!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
