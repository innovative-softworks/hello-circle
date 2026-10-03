# HC-QA-094 — First HC-QA-090 fix could hijack a user's navigation with a recovery reload

Severity: P1 for the release path (it would have broken ordinary navigation in Firefox/WebKit). Category: REGRESSION / DEPLOYMENT. Status: FIXED LOCALLY — NOT DEPLOYED; **never released** (introduced and caught within Phase 11A, before any commit).
Found by the Phase 11A cross-browser regression (production build): HC-QA-066 started failing in Firefox and WebKit with `page.goto: NS_BINDING_ABORTED`.

- **Screen:** Any page, while a lazy chunk is still loading.
- **Actor:** Any user who navigates away (types a URL, follows a full-page link) during a lazy load.
- **Viewport / browser:** Firefox and WebKit (they abort in-flight module loads when a navigation starts). Chromium is unaffected in testing.

**Steps**

1. Start an in-app navigation, so a lazy chunk begins loading.
2. Before it finishes, navigate to another URL.

- **Expected:** The user's navigation completes.
- **Actual (first HC-QA-090 fix):** The browser aborts the pending chunk. The aborted import looks identical to a stale-build chunk failure, so the new recovery called `location.reload()`, which aborted the user's navigation (`NS_BINDING_ABORTED`).
- **Root cause:** The recovery treated *any* chunk-load failure as a stale build, without considering page unload or offline state.
- **Fix:** `client/src/chunkRecovery.ts`:
  - `beforeunload`/`pagehide` mark the page as leaving; the mark is cleared after 10 s if the navigation doesn't happen;
  - auto-reload is suppressed while leaving or offline (`navigator.onLine === false`);
  - `AppUpdateBoundary` renders nothing new while the page is leaving.
- **Regressions:**

| Test | Before | After |
|---|---|---|
| `product-deploy.spec.ts` HC-QA-090-NAVIGATE-AWAY (navigate away during an in-flight chunk load) | **FAIL** on the first fix, Firefox (`NS_BINDING_ABORTED`) | PASS: Chromium, Firefox, WebKit (production build) |
| HC-QA-066 | FAIL in Firefox and WebKit with the first fix | PASS in all three |
| `chunkRecovery.test.ts` "never hijacks a navigation" | — | PASS |

  The real deploy simulation was repeated with the final client: PASS in all three engines (1 reload, route renders).
