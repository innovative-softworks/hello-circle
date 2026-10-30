# 04 · Security and permissions

**Commit:** web `d22f4a6`. **Environment:** isolated QA (synthetic personas `QA_ADMIN`, `QA_VENDOR`, `QA_VENDOR_B`, `QA_HOST`, `QA_HOST_B`, `QA_USER`, `QA_USER_B`, plus per-test staff members created with random passwords and removed afterwards).
**Method:** direct API calls with real sessions, not hidden UI controls.
- The existing `authorization` (39 batches) and `security-gate` (19 batches) suites, all passed, plus the auth `collisions`, `flows` and `recovery` batches (11 tests, all passed).
- A new probe batch, `booking-final-security`, written for this validation for the Phase H–O endpoints: `tests/integration/specs/final-security-probe.spec.ts`.

**Result of the probe:** **PASSED** on the final code (twice, each on a fresh QA DB).

## 1. Authentication

| Case | Result | Evidence |
|---|---|---|
| Missing session | PASS | FINAL-SEC: the record, reports, form questions and messages each return 401 with no cookie. RBAC-001, STAGE-B-ADMIN. |
| Invalid or forged session token | PASS | FINAL-SEC: a random 64-hex `hello_circle_session` returns 401 |
| Expired session | PASS | FINAL-SEC: `sessions.expires_at` moved into the past returns 401 on the next request (`userFromToken` filters `expires_at > NOW()`) |
| Revoked access (staff removed, role changed) | PASS | D08-STAFF "role changes and removal take effect on the next request"; D08-REINVITE |
| Session changes (workspace switch, linking) | PASS | STAGE-B-MANAGE, CLOSURE-LINK, CLOSURE-LINK-RACE |
| Account suspension | PASS | FINAL-SEC: a suspended staff account gets 403 on its next request (`requireVendor` checks `status` every request); organisation suspension in the D-01 suites |
| Sign-up and recovery abuse | PASS | AUTH-SEC-001…008, -RACE, -PASSWORDLESS, -RECOVERY-001/002, HC-QA-003 |
| Resident UI login journey | **Baseline failure** (REAL-AUTH-001, same signature on `f22294f`; see [11](11-defects-and-remediation.md)) | — |

## 2. Authorisation

| Case | Result | Evidence |
|---|---|---|
| Resident reads or edits another resident's booking | PASS | FINAL-SEC: `QA_USER_B` gets 404 on GET registration and PUT answers; IDOR-BOOKING; STAGE-B-BOOKING |
| Vendor reads another organisation | PASS | FINAL-SEC: record 404, notes 404, answers and CSV 403/404, draft 403/404, reports exclude it; IDOR-VENDOR; STAGE-B-* |
| Host reads or manages another host's activity | PASS | FINAL-SEC: `QA_HOST_B` gets 403 on manage participants and set questions; IDOR-HOST; STAGE-B-HOST-MUTATIONS |
| Finance reads private answers | PASS | CFG-OPERATIONS: `answersVisible: false`, answer CSV 403; `vendorOrders.test.ts`: team notes 403 |
| Check-in staff reads finance or other data | PASS | FINAL-SEC: earnings, reports, record and message preview all 403; P2-DOOR; CFG-OPERATIONS |
| Read-only staff mutate | PASS | FINAL-SEC (`read_only_analyst`): form draft, publish, team note, message send and answers CSV 403, reports 200; RBAC-STAFF |
| Staff on unassigned listings | PASS | STAGE-B-ORG; role checks per listing type (`assertPlatformRole`) |
| Vendor self-enables restricted capabilities | PASS | FINAL-SEC: a vendor's PUT on `/api/admin/organisations/:id/capabilities` is refused; CFG-CAPABILITIES (the API follows the admin template) |
| Unauthorised exports | PASS | `vendorReports.test.ts` (finance, other managers, other organisations 403); FINAL-SEC |
| Cross-organisation communications | PASS | FINAL-SEC: preview and send for another organisation's listing return 403; `vendorMessages.test.ts` |
| Admin permissions (D-02) | PASS | D02-MATRIX, D02-LAST-SUPER; `adminPermissions.test.ts` walks every admin route |

## 3. Data security

| Area | Result | Evidence |
|---|---|---|
| Input validation | PASS | Question keys `/^q_[a-z0-9]{6,20}$/`, choice and length checks (`questions.ts`); message subject ≤ 200, body ≤ 5,000 characters; date formats |
| SQL injection | PASS | Every query is parameterised (`db.prepare(…).run/get/all(params)`); dynamic `IN (…)` lists are built from `?` placeholders. FINAL-SEC: a quote-and-comment path segment returns 404 without internals. |
| Cross-site scripting | PASS | FINAL-SEC: an answer `<img src=x onerror=…>` is stored and **rendered as text** on the partner record (no script run, no dialog). React escapes by default. E-mail HTML is escaped (`escapeHtml` in `email.ts`). |
| CSRF | PASS (by design) | Session cookies are `httpOnly`, `SameSite=Lax`; mutations are JSON `POST/PUT/DELETE` (a cross-site form can't send `application/json`); single origin; CORS limited to `PUBLIC_ORIGINS` when set |
| File uploads | PASS | STAGE-B-MEDIA; type and size checks (existing, unchanged in H–O) |
| Rate limiting | PASS (existing) | Login, magic link, lookup and coupon limiters; in-memory, single instance (known limitation in CLAUDE.md) |
| Sensitive data in logs | PASS | LOGGING-ADJACENT ×9, HC-QA-004; `[error-report]` is scrubbed; the audit holds keys and counts, not values |
| Error-message disclosure | PASS | STAGE-B-ERRORS; FINAL-SEC (no `SELECT`, stack or `ER_` codes) |
| Export formula injection | PASS | `csvCell` prefixes `= + - @ \t \r` with `'`; FINAL-SEC asserts `"'=HYPERLINK…` in the answers CSV |
| Excessive data exposure | PASS | Public question shape `toPublicQuestion` drops category, export flag and ids; message preview shows first names only; reports are counts only |

## 4. Probe run (`booking-final-security`)
**FINAL-SEC: PASSED** (09:07 and 09:39, 2026-10-30, each on a fresh QA DB). It covers every row marked FINAL-SEC above, plus Make It Happen paused: search and confirm return 503 and the booking count is unchanged.

```bash
QA_PORT_OFFSET=10 npm run qa:db:reset && QA_PORT_OFFSET=10 npm run qa:db:seed
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-final-security npm run qa:booking
```

## 5. Vulnerabilities found
**None.** No reproducible authorisation bypass, injection or data exposure was found on the new endpoints or in the existing suites.

**Hardening recommendations (not vulnerabilities):**
- **Shared rate-limit store** before running more than one instance (known, CLAUDE.md).
- **Partner message e-mail links:** partners write free text that reaches residents. The text is escaped, but links are not restricted. Consider a link policy before opening messages to all partners (P3).
