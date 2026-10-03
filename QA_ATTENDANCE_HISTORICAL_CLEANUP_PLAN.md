# Historical malformed attendance — inventory & cleanup PLAN (not executed)

Status: **PLAN ONLY.** Nothing here has been run against `hello_circle`,
`hello_circle_dev` or production. No migration occurred during Stage B.

## Current facts (2026-09-29)

- Before HC-QA-009, `POST /vendor/program-sessions/:sessionId/attendance/:enrollmentId`
  accepted an enrollment from a different programme, so **historical malformed
  `attendance` rows may exist** (`kind='program_session'`, `ref = <session>:<enrollment>`
  where the enrollment's programme ≠ the session's programme, or the enrollment
  no longer exists).
- **New reads exclude invalid relationships**: the HC-QA-008 fix joins session and
  enrollment on the same `program_id`, so malformed rows are not returned.
- **New writes prevent creation**: the HC-QA-009 fix resolves the enrollment with
  `program_id = session.program_id` (404 otherwise).
- **Production inventory has NOT been performed.** The count of affected rows is unknown.
- Regressions: ATTENDANCE-READ (malformed row fixture excluded), ATTENDANCE-WRITE
  (HC-QA-009), both in the permanent `npm run qa:security-gate`.

## Step 1 — read-only inventory (requires explicit approval, prod read access)

```sql
-- Malformed or orphaned programme-session attendance. Read-only.
SELECT a.ref, a.status, a.checked_in_at, a.checked_in_by,
       ps.program_id AS session_program, pe.program_id AS enrollment_program,
       CASE WHEN ps.id IS NULL THEN 'orphan_session'
            WHEN pe.id IS NULL THEN 'orphan_enrollment'
            ELSE 'cross_programme' END AS kind
FROM attendance a
LEFT JOIN program_sessions ps ON ps.id = SUBSTRING_INDEX(a.ref, ':', 1)
LEFT JOIN program_enrollments pe ON pe.id = SUBSTRING_INDEX(a.ref, ':', -1)
WHERE a.kind = 'program_session'
  AND (ps.id IS NULL OR pe.id IS NULL OR pe.program_id <> ps.program_id);
```

Record only counts per `kind` and per affected organisation in the report; do not
export participant names/emails.

## Step 2 — decide (owner decision)

Malformed rows are already invisible to reads. Options: (a) leave in place (no user
impact; residual stale data), (b) quarantine then delete. Cross-organisation rows
(`checked_in_by` in a different org than the enrollment's programme) should be
reviewed as potential historical HC-QA-008/009 exploitation before deletion.

## Step 3 — if cleanup is approved

1. Full backup / snapshot; confirm restore procedure.
2. `CREATE TABLE attendance_quarantine_<date> AS SELECT a.* … <Step 1 predicate>`.
3. Verify quarantine count equals the Step 1 count.
4. `DELETE a FROM attendance a JOIN attendance_quarantine_<date> q ON q.kind = a.kind AND q.ref = a.ref;`
   inside a transaction; verify affected rows = quarantine count; commit.
5. Re-run Step 1 (expect 0) and `npm run qa:security-gate` against isolated QA.
6. Retain quarantine per data-retention policy, then drop.

Idempotent, no schema change, no down-migration needed (quarantine is the rollback).
Never run against a shared database from the QA harness.
