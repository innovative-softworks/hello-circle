import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";
import { isPlausibleDob } from "../util.js";

export const householdRouter = Router();
householdRouter.use(requireResident);

interface HouseholdMemberInput {
  firstName: string;
  lastName: string;
  dob?: string;
  notes?: string;
  guardianConsentGiven?: boolean;
}

householdRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, first_name as firstName, last_name as lastName, dob, notes, guardian_consent_given as guardianConsentGiven, created_at as createdAt
       FROM household_members WHERE resident_id = ? ORDER BY first_name`
    )
    .all(req.resident!.id);
  res.json((rows as any[]).map((r) => ({ ...r, guardianConsentGiven: !!r.guardianConsentGiven })));
});

householdRouter.post("/", async (req, res) => {
  const b = req.body as HouseholdMemberInput;
  if (!b.firstName || !b.lastName) return res.status(400).json({ error: "First and last name are required" });
  // Onboarding audit §6 — format/plausibility only, same as
  // routes/registrations.ts's own use of this check: dob is optional here
  // (household members can be added with no dob at all), but if one is
  // given it must be a real, non-future date.
  if (b.dob && !isPlausibleDob(b.dob)) return res.status(400).json({ error: "That doesn't look like a valid date of birth" });
  const info = await db
    .prepare(`INSERT INTO household_members (resident_id, first_name, last_name, dob, notes, guardian_consent_given) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.resident!.id, b.firstName, b.lastName, b.dob ?? "", b.notes ?? "", b.guardianConsentGiven ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

async function ownsMember(residentId: string, memberId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT resident_id FROM household_members WHERE id = ?`).get(memberId)) as { resident_id: string } | undefined;
  return !!row && row.resident_id === residentId;
}

householdRouter.put("/:id", async (req, res) => {
  if (!(await ownsMember(req.resident!.id, req.params.id))) return res.status(403).json({ error: "Not your household member" });
  const b = req.body as Partial<HouseholdMemberInput>;
  if (b.dob && !isPlausibleDob(b.dob)) return res.status(400).json({ error: "That doesn't look like a valid date of birth" });
  await db
    .prepare(
      `UPDATE household_members SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
       dob = COALESCE(?, dob), notes = COALESCE(?, notes), guardian_consent_given = COALESCE(?, guardian_consent_given) WHERE id = ?`
    )
    .run(b.firstName, b.lastName, b.dob, b.notes, b.guardianConsentGiven === undefined ? undefined : b.guardianConsentGiven ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

householdRouter.delete("/:id", async (req, res) => {
  if (!(await ownsMember(req.resident!.id, req.params.id))) return res.status(403).json({ error: "Not your household member" });
  await db.prepare(`DELETE FROM household_members WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});
