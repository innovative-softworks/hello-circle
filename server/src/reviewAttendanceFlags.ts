import { writeAudit } from "./audit.js";
import { voidReviewInvitations } from "./myLifePlans.js";
import { db } from "./db/index.js";

// Trust & Retention — what happens to a published review when the attendance
// behind it changes (docs/trust-retention/05-*).
//
// The review's "Verified attendance" label is computed live (verifiedSql), so
// it disappears at once when attendance is revoked or disputed and comes back
// only if a valid confirmation is restored. The review itself — its words and
// its score — is NOT hidden by an attendance change: an organiser recording a
// no-show must not be a way to make a negative review vanish. Instead the
// review is flagged into the existing moderation queue (a system report),
// where support decides with a recorded reason; the author can ask for
// reconsideration through the existing appeal route.

const SYSTEM_REPORTER = "system:attendance";

/** Reviews published for the occurrence behind an attendance record. */
async function reviewsForAttendance(kind: string, ref: string): Promise<{ id: number }[]> {
  if (kind === "booking" || kind === "registration" || kind === "experience") {
    return (await db.prepare(`SELECT id FROM reviews WHERE occurrence_kind = ? AND occurrence_ref = ? AND hidden = 0`).all(kind, ref)) as { id: number }[];
  }
  if (kind === "program_session") {
    const enrollmentId = ref.split(":")[1];
    return (await db
      .prepare(`SELECT r.id FROM reviews r JOIN program_enrollments pe ON pe.ref = r.occurrence_ref WHERE r.occurrence_kind = 'enrollment' AND pe.id = ? AND r.hidden = 0`)
      .all(enrollmentId)) as { id: number }[];
  }
  if (kind === "game") {
    const [gameId, residentId] = ref.split(":");
    return (await db.prepare(`SELECT id FROM reviews WHERE occurrence_kind = 'game' AND occurrence_ref = ? AND resident_id = ? AND hidden = 0`).all(gameId, residentId)) as { id: number }[];
  }
  return [];
}

/**
 * Call after attendance for (kind, ref) is set to a no-show/absent, or an
 * organiser withdraws a person's confirmation. Flags each affected review once
 * (one pending system report per review) and audits it. Never hides anything.
 */
export async function flagReviewsAfterAttendanceChange(kind: string, ref: string, what: string, actor: { id: string; kind: "user" | "resident" | "system" }): Promise<number> {
  // A review invitation for this visit stops inviting and is never re-sent.
  await voidReviewInvitations(kind, ref);
  const reviews = await reviewsForAttendance(kind, ref);
  let flagged = 0;
  for (const r of reviews) {
    const open = await db.prepare(`SELECT 1 FROM reports WHERE target_type = 'review' AND target_id = ? AND reporter_client_id = ? AND status = 'pending'`).get(String(r.id), SYSTEM_REPORTER);
    if (open) continue;
    await db
      .prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason, category) VALUES ('review', ?, ?, ?, 'content')`)
      .run(
        String(r.id),
        SYSTEM_REPORTER,
        `Attendance changed after this review was published: ${what}. Its "Verified attendance" label has been removed. Check whether the review was eligible — don't hide it just because it's critical.`
      );
    await writeAudit({ actorUserId: actor.id, actorKind: actor.kind, action: "review.attendance_changed", objectType: "review", objectId: String(r.id), newValue: { attendanceKind: kind, attendanceRef: ref, what } });
    flagged++;
  }
  return flagged;
}

export const isAbsence = (status: string | null | undefined) => status === "no_show" || status === "absent";
