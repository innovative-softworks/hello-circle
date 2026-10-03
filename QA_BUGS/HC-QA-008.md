# HC-QA-008 — Cross-organisation programme attendance disclosure via parent substitution

## Remediation checkpoint — design before code

Trace: vendorRouter applies requireVendor/attachVendorIds; programOwnership checks
programs.vendor_id against the authenticated organisation's vendor IDs. The GET
handler then queries attendance.ref LIKE sessionId-prefix globally, ignoring the
authorized programme and never resolving the session relationship. No separate
service/repository supplies an additional check. That is why B-parent/A-child works.

Minimum fix: validate session.id AND session.program_id against the authorized
parent, then select attendance through the session/programme/enrollment relationship.
The schema attaches enrollments to programmes, not directly to sessions; attendance
uses a composite session:enrollment ref. Join both children to the same programme
and match that composite ref exactly rather than trusting a global prefix.
Keep foreign/missing parent 403; foreign/missing child under owned parent 404 with
the same generic body. Owner read unchanged. Existing failing test remains unchanged.

Immediate sibling write source review: POST /program-sessions/:sessionId/attendance/
:enrollmentId checks actual session ownership and staff role, but not enrollment's
programme. A focused regression will establish impact before a narrow child guard.
Cancel-enrollment and session-delete already constrain both IDs in SQL; refund
source does likewise but will NOT be executed. No bulk/reset/delete attendance
endpoint exists in this router. Broader Stage B remains paused.

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.

## Fix / verification

The SAME original failing regression was run unchanged before the fix (FAIL) and
after (PASS). GET now verifies session ID with program_id after org ownership,
then joins program_sessions, program_enrollments and attendance on the same
programme and exact composite ref. Historical malformed child associations are
omitted by the SQL relationship, not by response-field stripping. No LIKE-prefix
wildcard can select other sessions.

Owner parent/child reads remain 200. Foreign or nonexistent parent remains 403;
foreign or nonexistent child under an owned parent returns identical 404 JSON.
No enrollment IDs/status are returned on denial. New tests cover both directions,
nonexistent IDs, guest denial, corrupted descendant association, complete resource
snapshots, authenticated session and audit-read invariants. Three adjacent scenarios
and the original regression pass. Production change: routes/vendorPrograms.ts only.
Sibling write gap is tracked separately as HC-QA-009, narrowly fixed and tested.
No broader Stage B resumption, customer/payment test or deployment occurred.

The reproduction and stop narrative below is historical before-fix evidence.
Category: APPLICATION SECURITY DEFECT, API-level cross-organisation child-resource IDOR.

## Resource / endpoint / actors

Resource: programme session attendance and associated enrollment identifiers.
Endpoint: GET /api/vendor/programs/:id/sessions/:sessionId/attendance.
Attacker: approved vendor B owning a programme in organisation B.
Victim/owner: vendor A in a distinct organisation A. Only synthetic QA data used.

## Preconditions and safe reproduction

1. In guarded isolated QA, verify paired vendors have different non-null org IDs.
2. Create one centre/programme per vendor using normal APIs. Create session A under
   programme A. Seed one synthetic unpaid enrollment and attendance entry for A.
3. Owner A requests A/programme + A/session attendance: 200 with expected entry.
4. Vendor B requests A/programme + A/session: 403 (correct denial control).
5. Vendor B substitutes B/programme while keeping A/session: 200 containing A's
   enrollment identifier and `present` attendance status.

No payment/checkout, contact-data dump, customer record, external service or real
tenant was involved. No mutation-based exploitation followed this disclosure.

## Expected / actual / database evidence

Expected: changing the parent ID must not authorize another organisation's session.
Reject (403/404) or otherwise return no foreign attendance.
Actual: ownership check accepts B's parent, then returns rows for the unbound child.
Sanitized evidence: separateOrganisations=true; ownerStatus=200;
foreignParentStatus=403; substitutedParentStatus=200; foreignAttendanceDisclosed=true;
scopedDatabaseUnchanged=true; paymentUsed=false.

Full snapshots of both programmes, victim session, unpaid enrollment and attendance
were unchanged before/after the read attempts. Cleanup removed only exact synthetic
fixture records. No secret or real participant detail is included in evidence.

## Root cause / impact

`server/src/routes/vendorPrograms.ts` checks `programOwnership(req.vendorIds, :id)`
but never establishes `program_sessions.id = :sessionId AND program_id = :id`.
It queries attendance by the session prefix alone and projects enrollmentId/status.
An approved vendor with its own programme can read another organisation's private
attendance when the foreign session ID is known. This is sensitive participation
data, not merely exposure of an innocuous identifier. Names/emails, write access,
bulk enumeration and privilege escalation were NOT demonstrated.

## Historical regression / stop (before remediation)

`tests/integration/specs/stage-b-attendance.spec.ts` was FAILING, without skips,
expected-failure marking or weakened assertions. Run:
`npm run qa:authorization -- --grep 'STAGE-B-CHILD:'`.
Safe evidence: ignored current-run evidence/stage-b-attendance.json, booleans/statuses
only. Before remediation the default authorization runner executed this first and
stopped red. The unchanged regression now passes, including in the full 41-case run.

Significant cross-organisation bypass triggered the user-mandated Stage B stop.
Only pre-existing baseline regressions are rerun separately; no further new probes.

## Recommended remediation (not implemented)

Resolve session-to-programme association and vendor organisation ownership together
before querying attendance. Bind the attendance query to the authorized session;
review the adjacent attendance-write enrollment/session association separately.
Preserve owner positive control, foreign-parent denial and substituted-child
regression, and add same-org/different-parent checks after scoped approval.
