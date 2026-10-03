# HC-QA-092 — Server unit suite is red: 3 tests still assert behaviour that earlier QA security fixes intentionally removed

Severity: P3. Category: QA-INFRA / REGRESSION SAFETY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11A, 2026-10-03). Found Phase 11.
Found during the Phase 11 local gate rerun (`npm run test --workspace server`, which is not part of the guarded `qa:*` harness).

**Evidence.** The same suite was run on identical, freshly seeded throwaway MySQL databases for the current working tree and for HEAD `6fccaf6`, with `server/.env` suppressed. These three tests fail only on the working tree, and also failed in the dev-DB run:

| Test | Failure | Cause | Verdict |
|---|---|---|---|
| `games.test.ts` → paid leave notifies the host | expected 1 notification, got 0 | The fixture inserts a game with no `price_cents`. The HC-QA-027 fix notifies the host only for a genuinely priced activity | Stale fixture: needs `price_cents > 0` |
| `org.test.ts` → staff invite DELETE | expected `revoked`, got `pending` | The revoke route became `DELETE /staff/invite/:id` with the SHA-256 management id, so the bearer token is no longer a management identifier. The test still sends the raw token | Stale test: must use the listed `id` |
| `termsRenewalAndSetup.test.ts` → password signup on a pre-existing consent-less account | expected 201, got 409 | The HC-QA-002 fix: signup must not take over an existing passwordless resident | Stale expectation: should assert 409 and an untouched terms row |

**Also observed (both trees, environment-dependent, not regressions):**
- `media.test.ts` and `adminMedia.test.ts` (~20 tests) need real R2/Cloudinary env;
- `vendorInsights` "exact totals" depends on the calendar month;
- `participationExperience` / `programsBrowse` / `participationLoop` have file-level setup failures on a freshly seeded DB.

The suite is not hermetic. It assumes `hello_circle_dev` contents plus real provider credentials, so it can't serve as a staging gate as it stands.

**Recommendation:**
- Update the 3 stale tests to the fixed contracts.
- Gate provider-dependent media tests behind an explicit env flag.
- Pin dates in `vendorInsights`.
- Run the suite against a disposable DB (like the `qa:*` harness) instead of `hello_circle_dev`.

## Phase 11A remediation

**Isolated server-test profile.** `npm test --workspace server` now runs `server/src/scripts/testIsolated.ts`. It:
- starts a disposable MySQL 8.0 container: tmpfs, loopback-only random port, random root password passed through the child environment;
- creates `hello_circle_test_<12-hex run id>`, a user granted **only** that database, and an identity marker row;
- applies the schema plus the deterministic demo seed and fixed fixtures (`server/src/scripts/testDbSeed.ts`);
- runs Vitest with a **scrubbed environment**: no inherited variables, an empty dotenv file, `NODE_ENV=test`, no provider credentials;
- always removes the container.

**Guards** (`server/src/testProfile.ts`, enforced in `vitest.setup.ts` and the seed step, before anything runs). The previous setup **loaded `server/.env`** and allowed `hello_circle_dev`; it no longer loads it. The new guards are:
- an explicit profile marker plus `NODE_ENV=test`;
- the DB name must be `hello_circle_test_<runid>`; `hello_circle` and `hello_circle_dev` are refused by name;
- a loopback DB host;
- no Stripe, SMTP, R2, Cloudinary or Firebase credentials present;
- a **live identity check** that the connected DB carries this run's marker row, which is stronger than name matching.

Verified: a plain `vitest` run, and a spoofed `DB_NAME=hello_circle_dev`, are both refused before any connection.

**Stale tests updated to the current security contracts** (secure behaviour not reverted):

| Test | Old expectation | New expectation | Why |
|---|---|---|---|
| `games.test.ts` paid leave notifies host | Fixture game had no price | Fixture has `price_cents = 800` | HC-QA-027: only a priced activity has anything to refund (`payment_status` defaults to `paid` even for free joins) |
| `org.test.ts` staff invite revoke | DELETE by raw bearer token → `revoked` | DELETE by the listed management id (SHA-256) → `revoked`. Also asserts the id ≠ token, and that the raw token **does not** revoke | Invitation hardening: a bearer credential is never a management identifier |
| `termsRenewalAndSetup.test.ts` signup on a pre-existing consent-less account | 201 + terms recorded | **409**, no password set, no terms recorded on that account (earlier-acceptance check kept) | HC-QA-002: signup must not take over an existing passwordless resident |

**Non-hermetic tests fixed:**
- `participationExperience`, `programsBrowse` and `participationLoop` now get deterministic fixtures from the test seed: an approved vendor owning the listings, an experience, a published programme with an upcoming session, and an archived programme. Before, they relied on whatever `hello_circle_dev` contained, or on test-file order.
- `vendorInsights` trend fixtures are now relative to the current month; they broke when the calendar left September 2026.
- **Live-provider tests** (21: real R2/Cloudinary in `media`, `adminMedia`, `residents`) are explicitly gated behind `HC_LIVE_PROVIDER_TESTS=1`, which additionally requires a bucket name that is clearly staging/test/QA. The release gate skips them; every authorization-denial case in those files still runs.

**Result (final, including the new HC-QA-090/091 unit tests):** the isolated server suite gives **47/47 files, 475 passed, 23 skipped** (21 live-provider plus 2 pre-existing skips), with no leftover container. Before the fixes, the same isolated run had 29 failures.
