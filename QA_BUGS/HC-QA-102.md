# HC-QA-102 — Firefox: long UI journeys intermittently fail in the full browser batch, then pass in isolation

Severity: P3. Category: QA-INFRA (test reliability). Status: OPEN — recorded (Phase 13, 2026-10-04).

**Observed** in `QA_PROD_BUILD=1 QA_BROWSER=firefox npm run qa:browsers` (full batch, production build):

| Phase | Failed in the full batch | Rerun in isolation |
|---|---|---|
| 12 | LC-UI-DESKTOP-PARTICIPANT (timeout) | passed 2/2 |
| 13 | LC-UI-MOBILE (timeout), HC-QA-057 desktop (assertion) | passed (057 desktop and mobile, LC-UI-MOBILE) |

- The failing tests differ between runs.
- Chromium passes the same batch in full, and WebKit passes everything except the known BRW-2 Tab test.
- Each failing test exercises a long multi-page UI journey (host create → discover → join → Circle → chat).

**Why it matters:** an intermittent cross-browser failure can hide a real Firefox regression. Each case needed a manual isolated rerun. In Phase 13 that rerun mattered: LC-UI-MOBILE goes through the new HC-QA-100 date code, and it passed.

**Recommendation (not applied):**
- Capture the timed-out step (test steps / per-action timeouts) in these journeys so a timeout names its locator.
- Consider running Firefox long journeys with one worker and a higher per-test timeout.
- Treat a Firefox-only, isolation-passing failure as flaky only after one isolated rerun, as done here.
