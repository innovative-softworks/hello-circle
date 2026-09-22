import { db } from "../db/index.js";

// Shared between circles.ts and games.ts (Phase 2 "Circles V2" needs
// games.ts's POST / to check circle-organiser status when converting a
// plan-idea into a real activity) — split into its own file rather than
// exported from circles.ts directly, since circles.ts also needs to import
// games.ts's createGameRow() for that same conversion, and two route files
// importing runtime values from each other is a circular-import risk this
// tiny, dependency-free helper avoids entirely.

/** Organiser-only actions (invite, close, close a poll, confirm/cancel a
 * plan-idea, convert a plan into an activity) — the circle creator gets
 * role='organiser' at creation; anyone else is 'member'. A circle can have
 * multiple co-organisers (see circles.ts's promote/demote routes). */
export async function isOrganiser(circleId: string, residentId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId)) as
    | { role: string }
    | undefined;
  return row?.role === "organiser";
}

/** Any role (member or organiser) — used to gate plan-idea creation to
 * circle members only, per Phase 2's approved permission model. */
export async function isMember(circleId: string, residentId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId);
  return !!row;
}
