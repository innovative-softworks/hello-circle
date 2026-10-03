# HC-QA-015 — Public club schedule ignores parent club publication status

## Remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Policy: public schedule only while the club is `approved` (same as `GET /api/clubs/:id`);
the owning organisation keeps editor access in any status (VendorClubEditor reads this
route). Hidden or unknown clubs return an empty schedule (as unknown ids always did), so
"hidden" is indistinguishable from "no sessions". Original regression unchanged: PASS
(pending/paused/deleted hidden). VIS-014-015: pending club — owner sees, foreign vendor/
resident/guest do not; after approval guest sees.


Severity: **P3** (schedule/label/instructor name/image of an unapproved, paused or
deleted club; requires the club UUID). Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery)
Classification: aggregation visibility defect.

## Endpoint

`GET /api/club-sessions?clubId=` (`routes/clubSessions.ts`) joins `clubs` only for the
cover image; no `clubs.status = 'approved'` filter. Canonical `GET /api/clubs/:id`
returns 404 for non-approved clubs.

## Reproduction (isolated QA)

Synthetic club + active session. Approved: canonical 200, schedule visible (control).

| Club status | `GET /clubs/:id` | schedule returned |
|---|---|---|
| pending | 404 | **yes** |
| paused | 404 | **yes** |
| deleted | 404 | **yes** |

Evidence: `hc-qa-015-club-sessions.json`. Regression: `HC-QA-015:`.
Vendor club-session mutations (create/update/delete) are correctly organisation-
scoped (STAGE-B-CLUBS PASS). Saved-session hydration already follows parent status
(VISIBILITY-CLUB PASS).

## Suggested direction (not implemented)

Add `AND cl.status = 'approved'` to the public query (vendor editor uses its own path).
