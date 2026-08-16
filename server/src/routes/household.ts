import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";

export const householdRouter = Router();
householdRouter.use(requireResident);

interface HouseholdMemberInput {
  firstName: string;
  lastName: string;
  dob?: string;
  notes?: string;
}

householdRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, first_name as firstName, last_name as lastName, dob, notes, created_at as createdAt
       FROM household_members WHERE resident_id = ? ORDER BY first_name`
    )
    .all(req.resident!.id);
  res.json(rows);
});

householdRouter.post("/", async (req, res) => {
  const b = req.body as HouseholdMemberInput;
  if (!b.firstName || !b.lastName) return res.status(400).json({ error: "First and last name are required" });
  const info = await db
    .prepare(`INSERT INTO household_members (resident_id, first_name, last_name, dob, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(req.resident!.id, b.firstName, b.lastName, b.dob ?? "", b.notes ?? "");
  res.status(201).json({ id: info.lastInsertRowid });
});

async function ownsMember(residentId: string, memberId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT resident_id FROM household_members WHERE id = ?`).get(memberId)) as { resident_id: string } | undefined;
  return !!row && row.resident_id === residentId;
}

householdRouter.put("/:id", async (req, res) => {
  if (!(await ownsMember(req.resident!.id, req.params.id))) return res.status(403).json({ error: "Not your household member" });
  const b = req.body as Partial<HouseholdMemberInput>;
  await db
    .prepare(
      `UPDATE household_members SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
       dob = COALESCE(?, dob), notes = COALESCE(?, notes) WHERE id = ?`
    )
    .run(b.firstName, b.lastName, b.dob, b.notes, req.params.id);
  res.json({ ok: true });
});

householdRouter.delete("/:id", async (req, res) => {
  if (!(await ownsMember(req.resident!.id, req.params.id))) return res.status(403).json({ error: "Not your household member" });
  await db.prepare(`DELETE FROM household_members WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});
