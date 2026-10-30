# 11 · Defects and remediation

Severity:
- **P0:** security breach, payment corruption, data loss or capacity corruption.
- **P1:** broken supported booking, unauthorised access or a major operational failure.
- **P2:** a significant secondary workflow, reporting, accessibility or usability defect.
- **P3:** minor.

## 1. New regressions found and fixed in this validation

| ID | Found by | Signature | Severity | Root cause | Fix | Regression test | Re-run |
|---|---|---|---|---|---|---|---|
| DEF-01 | `validation-og-responsive` OG-23-RESPONSIVE-320 | `admin-settings @320: button.adm-btn right=371` (horizontal overflow) | P2 (accessibility and layout) | Phase N added the switch label "Turn Questions on resident-hosted activities on", which is too long for the 320 px Settings row | `0998764`: label shortened to "Host activity questions" (`server/src/circleFeatures.ts`) | The existing OG-23-RESPONSIVE suite (9 widths) | **PASS** at all 9 widths |
| DEF-02 | `booking-config-messages` CFG-MESSAGES | `locator.selectOption: Timeout … getByRole('dialog').getByLabel('Listing')` | P1 (a partner with only events or programmes couldn't open the message composer, a supported operation) | A pre-Phase-K guard in `VendorMessages.tsx` showed "You need an approved listing" unless the partner had a hall or club. A fresh QA DB exposed it. | `d22f4a6`: the composer always renders its fields once listings load; the empty note shows only when there are truly no listings | CFG-MESSAGES (fresh-DB partner with only an event) | **PASS** |

| DEF-07 | New batch `booking-final-a11y` FINAL-A11Y-375 | `partner-reports@375 overflow: label. right=461` | P2 (WCAG 1.4.10 reflow, on the Phase L Reports tab) | Report filter `<select>`s size to their longest listing name, so a long name widens the label past the 375 px viewport | Labels and selects in `client/src/components/VendorReports.tsx` constrained to `maxWidth: 100%` | FINAL-A11Y at 375, 768, 1024 and 1440 | see [09](09-ui-ux-accessibility.md) |

**No fix changes a business rule.**

## 2. Defects found, not fixed (outside the P0/P1 fix mandate or behind a switch that's off)

| ID | Area | Severity | Reproduction | Impact | Remediation |
|---|---|---|---|---|---|
| DEF-03 | Day-before reminders (`server/src/participation/bookingReminders.ts`) | P2 (feature off) | More than 200 reminders due for one day: `slice(0, 200)` runs before already-sent orders are skipped, with no `ORDER BY` | Later sweeps may never reach orders past the first 200 | Skip already-sent orders in SQL before limiting, order deterministically, and add a test with >200 due. Required before the switch is turned on. |
| DEF-04 | Reports (`server/src/routes/vendorReports.ts` lines 82–90) | P2 | An event booking for 4 people marked no-show | "Events and experiences (people)" shows 1 no-show and 3 unmarked: no-shows count bookings while expected and attended count people | Count `party_size` for no-show bookings, or record no-shows per attendee |
| DEF-05 | Reports summary | P3 | A club registration checked in | Club check-ins appear in the per-listing detail but not in the summary attendance table | Add a "Club registrations" row to the summary attendance |
| DEF-08 | Resident pages (pre-existing) | P3 | PERF-P13 API accounting | `/circles`, My Life and Profile fetch the same endpoint twice per load | Share one request (context or cache) |
| DEF-06 | QA harness (`stripe-sandbox-split.spec.ts`) | P3 (test) | Run SANDBOX-SPLIT twice on one QA DB | It refuses the second run (by its own precondition) | Create per-run synthetic partners so the spec is idempotent |

## 3. Failures confirmed as baseline (same signature on `f22294f`)

**Method:**
1. Each failing batch was re-run on a clean worktree at `f22294f`, against its own fresh isolated QA database (`QA_PORT_OFFSET=20`).
2. The `Error details` and `Failure locations` were compared line by line with the current run.
3. Assertion failures were compared on locator, expected value and spec line.
4. Timeouts were compared on test, timeout value and (where recorded) the step. The harness keeps no page snapshot for a test-level timeout, so a timeout match is by test and timeout budget only. That is stated as the limit of the evidence.

| Test | Current signature (`d22f4a6`) | Baseline (`f22294f`) | Same? | Underlying cause |
|---|---|---|---|---|
| REAL-AUTH-001 | heading "Sign in to edit your profile." not found (`auth.spec.ts:30`) | identical | Yes | Test expects old copy; the page says "Sign in to see your account." |
| REAL-AUTH-GUEST (*hidden*) | same heading, `auth.spec.ts:91` | identical | Yes | Same stale copy. The guest **is** refused; there's no access issue. |
| COMPLETE-REVIEW-STATE | strict mode: "Please don't pay again" resolves to 2 elements (`hc-completion-c.spec.ts:179`) | identical | Yes | The text appears twice (banner and body); a test locator problem |
| COMPLETE-SILENT | "We couldn't check whether you can review this right now." not found (`hc-completion-d.spec.ts:153`) | identical | Yes | Copy changed |
| OG-27-UI | heading "Request sent" not found (`hc-og-features-ui.spec.ts:57`) | identical | Yes | Join-request confirmation copy changed |
| OG-26-UI (*hidden*) | test timeout | timeout | Yes (by test and budget) | Pre-existing |
| CAT-PUBLIC | timeout 150 s | timeout 150 s | Yes (by test and budget) | Pre-existing |
| LC-UI-DESKTOP-HOST | timeout 120 s | timeout 120 s | Yes (by test and budget) | Pre-existing Circle and host UI drift |
| LC-UI-DESKTOP-PARTICIPANT (*hidden*) | timeout | timeout | Yes (by test and budget) | Pre-existing |
| LC-UI-TABLET | timeout 150 s | timeout 150 s | Yes (by test and budget) | Pre-existing |
| LC-UI-MOBILE (*hidden*) | timeout | timeout | Yes (by test and budget) | Pre-existing |
| HC-QA-001-STACK | timeout 180 s | timeout 180 s | Yes (by test and budget) | Pre-existing |
| HC-QA-032-DRAFT-COPY | timeout 30 s | timeout 30 s | Yes (by test and budget) | Pre-existing |
| HC-QA-032-SEMANTICS (*hidden*) | timeout | timeout | Yes (by test and budget) | Pre-existing |
| BK-UI-DESKTOP | timeout 150 s | timeout 150 s | Yes (by test and budget) | Pre-existing |
| HC-QA-043 | timeout 30 s | timeout 30 s | Yes (by test and budget) | Pre-existing |
| HC-QA-066 | button /View full activity/ not found (`product-a11y-a.spec.ts:24`) | identical | Yes | My Life row redesign removed that button |
| HC-QA-069 (*hidden*) | `alertdialog` not visible after Enter on "I'm in" (`product-a11y-a.spec.ts:55`) | identical | Yes | One-tap join (owner 2026-10-27) means a free, open activity has no confirm dialog. Phase N kept one-tap when no host questions are asked. |
| HC-QA-068 | "A few more details." not found (`product-a11y-b.spec.ts:67`) | identical | Yes | Copy changed |
| HC-GAP-UI-EXP | button /(View\|Hide) full activity/ not found (`product-gaps-ui.spec.ts:18`) | identical | Yes | Same My Life row redesign |
| HC-GAP-UI-EXP-PAID (*hidden*) | same helper, `product-gaps-ui.spec.ts:18` (call at :75) | identical | Yes | Same My Life row redesign |
| HC-GAP-UI-PROG (*hidden*) | same helper, `product-gaps-ui.spec.ts:18` (call at :115) | identical | Yes | Same My Life row redesign |
| PUB-05/33 | heading "Sign in to see your life" not found (`product-public-batch1.spec.ts:37`) | identical | Yes | Copy changed |
| PUB-08/31 (*hidden*) | timeout | timeout | Yes (by test and budget) | Pre-existing |
| PUB-09/10 (*hidden*) | heading "Explore" (H1) not found (`product-public-batch1.spec.ts:213`) | identical | Yes | The spec assumes `VITE_LAUNCH_MODE=public`, but the QA client build serves the pre-launch page (also seen by FINAL-A11Y on `/register/:clubId`). Harness configuration drift. |
| OG-29/OG-31-UI (*hidden*) | timeout | timeout | Yes (by test and budget) | Pre-existing |
| PUB-21/22/23 | e-mail row text in `.settings-row--stack` not found (`product-public-batch1b.spec.ts:18`) | identical | Yes | Profile layout changed |
| B2-LISTS | label "Sort results" not found (`product-public-batch2.spec.ts:32`) | identical | Yes | Results toolbar changed |

*Hidden* means the test sits behind a failing test in its batch. The harness stops each batch at the first failure (`maxFailures: 1`) and doesn't allow that to be overridden. These tests were run by excluding the known failure with `--grep-invert` (the harness's allowed filter), on both commits.

**Classification of every remaining failure:** confirmed baseline failures (test drift against the redesigned public and My Life UI, or long pre-existing timeouts). **None is a payment, capacity, permission or data defect.** They're tracked as P3 test-maintenance debt, except that HC-QA-069's focus-trap check still needs a target dialog (see [09](09-ui-ux-accessibility.md)).

## 4. Environment issues during the run (not product defects)
- **Misrouted auth batches:** four batches (`core`, `collisions`, `flows`, `recovery`) belong to the default `qa:auth` suite. The orchestration first sent them through `qa:authorization`, which gave `QA SAFETY ABORT`. They were re-run with `npm run qa:auth`.
- **Server suite port collision:** one full server-suite run, made while browser batches ran in parallel, had 13 failures in `vendorPiiRoles.test.ts`. They were all `fetch failed … Response does not match the HTTP/1.1 protocol`: another process answered on the test server's ephemeral port. The file passes on its own (13/13), and the full suite re-run in isolation passed: **152 files, 1,371 passed, 0 failed**.
- **Refused stop-on-failure override:** an attempt to override `maxFailures` with `--max-failures=0` was refused by the harness guard ("Only --list, --grep and --grep-invert filters are allowed"). It was replaced by `--grep-invert` runs.
