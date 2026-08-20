import { db } from "./db/index.js";
import { countFamiliarCoParticipants } from "./db/queries.js";
import type { ScheduledActivity } from "./db/queries.js";

// Personalization (implementation plan Phase 12) — wires a signed-in
// resident's own signals into activity ranking, replacing the zero-
// personalization state confirmed by every prior audit in this plan
// (neither discover.ts nor search.ts ever referenced req.resident before
// this). Deliberately rule-based, not ML-ranked — three real, already-
// collected signals (onboarding interests, home county, Phase 8
// familiarity), each contributing an explainable "why this fits" reason.
// Scoped to scheduled activities (games/program sessions/club sessions)
// only, not centre/club listings — those are the "next best participation"
// candidates every planning doc's personalization language was actually
// about; Browse.tsx's centre/club lists already have their own explicit
// sort controls (price/rating) and retrofitting this scoring onto that
// separate, filter-heavy page is a distinct piece of work.

export interface PersonalizationResult {
  bonus: number;
  reasons: string[];
}

const NO_PERSONALIZATION: PersonalizationResult = { bonus: 0, reasons: [] };

async function getResidentInterests(residentId: string): Promise<string[]> {
  const row = (await db.prepare(`SELECT interests FROM residents WHERE id = ?`).get(residentId)) as { interests: string | null } | undefined;
  if (!row?.interests) return [];
  return row.interests
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Scores one scheduled activity against a signed-in resident's real
 * signals. Returns a zero bonus with no reasons for a signed-out visitor
 * (`residentId === null`) — personalization only ever applies on top of
 * the same real results everyone else sees, never gating them. */
export async function personalizeActivity(activity: ScheduledActivity, residentId: string | null, residentHomeCounty: string | null): Promise<PersonalizationResult> {
  if (!residentId) return NO_PERSONALIZATION;

  let bonus = 0;
  const reasons: string[] = [];

  const interests = await getResidentInterests(residentId);
  const titleLower = activity.title.toLowerCase();
  const matchedInterest = interests.find((i) => titleLower.includes(i) || i.includes(titleLower));
  if (matchedInterest) {
    bonus += 80;
    reasons.push(`Matches your interest in ${capitalize(matchedInterest)}`);
  }

  if (residentHomeCounty && activity.county && activity.county.toLowerCase() === residentHomeCounty.toLowerCase()) {
    bonus += 15;
    reasons.push("In your home county");
  }

  // Familiarity (Phase 8) — games only, same scoping reasoning as that
  // phase: game_participants is the one table with a clean multi-resident
  // membership signal to derive this from.
  if (activity.kind === "game") {
    const familiar = await countFamiliarCoParticipants(residentId, activity.id);
    if (familiar > 0) {
      bonus += Math.min(familiar, 3) * 40;
      reasons.push(`${familiar} ${familiar === 1 ? "person" : "people"} you've played with before`);
    }
  }

  return { bonus, reasons };
}
