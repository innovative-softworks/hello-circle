# HC-QA-009 — Attendance write accepts an enrollment from another programme

Severity: P2 (demonstrated invalid cross-programme association; no foreign account,
enrollment or existing victim attendance modification). Status: FIXED LOCALLY —
NOT DEPLOYED. API/application defect, not a test/environment failure.

## Fix / verification

The endpoint now resolves enrollment.id with program_id equal to the actual
authorized session's programme. Foreign/nonexistent enrollments return generic 404.
Composite attendance references use canonical DB IDs. The same newly failing test
now passes; scoped programmes/sessions/enrollments/attendance remain unchanged on
denied writes. Owner creation and update work; another owner's real session remains
403. A new invalid association is not created. No paid state or Stripe operation.
Read SQL also excludes historical malformed associations; no historical records
were rewritten. Scope is limited integrity hardening, not a broad vendor refactor.

Endpoint: POST /api/vendor/program-sessions/:sessionId/attendance/:enrollmentId.
Attacker: approved vendor owning the session's programme. Victim enrollment belongs
to another synthetic organisation/programme. QA-only, zero-value unpaid fixtures.

Root cause: actual session ownership and platform role are checked, but enrollment
is not looked up at all. The caller's enrollment ID is concatenated into attendance
ref and inserted. Programme-owned enrollments, not session-owned enrollments, are
the real schema relationship.

Safe reproduction: create two isolated vendor programmes with session/enrollment
pairs. Owner A posts status for Session A + Enrollment B. Before fix response 200
and a new invalid composite attendance row appears. This does not overwrite
Session B's real attendance; broader compromise or escalation was not demonstrated.

Expected: foreign/nonexistent enrollment rejected and all scoped rows unchanged.
Proposed minimum fix: lookup enrollment by BOTH id and actual authorized session's
program_id; generic 404 if missing, then construct composite ref from canonical DB
IDs. Do not change ownership architecture, payment state or enrollment lifecycle.

Regression: ATTENDANCE-WRITE in attendance-relations.spec.ts; preserved failing
assertion. Safe evidence records responseStatus=200 and
invalidCrossProgrammeAssociationCreated=true, paymentUsed=false. No private values.
Cleanup is exact fixture-scoped. This bounded association defect is within the
requested attendance descendant fix, not broad cross-tenant compromise.
