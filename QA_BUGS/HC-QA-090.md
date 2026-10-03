# HC-QA-090 — After any deploy, an already-open tab goes blank on its next in-app navigation

Severity: P2. Category: DEPLOYMENT / STAGING. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11A, 2026-10-03). Found Phase 11.
Found during Phase 11 production-build validation on an isolated local stack. No production system was touched.

- **Screen:** Any route that is lazy-loaded (60 `lazy()` routes in `client/src/App.tsx`, 141 JS chunks) plus lazy components (map views).
- **Actor:** Every visitor who has a tab open when a new client build is deployed.
- **Viewport / browser:** All engines. Chromium reports `Failed to fetch dynamically imported module`; WebKit's text for the same failure is `Importing a module script failed`.

**Steps**

1. Open `/adventures` on build A (production bundle served by the Node server).
2. Deploy build B the way the runbook does: `vite build` (empties `client/dist`), then restart the server.
3. In the same tab, without reloading, click a nav link to a route not visited yet (reproduced with `/circles`).

- **Expected:** The route loads, or the app notices the new version and reloads or offers a "New version, reload" message.
- **Actual:** **A completely blank page.** Body text length was 0 and no error UI appeared. The old chunk URLs (`/assets/Circles-<old hash>.js`, etc.) answer **`200 text/html`** (the SPA fallback's `index.html`) instead of 404. The module load fails strict MIME checking, and nothing catches the rejected dynamic import.
- **Evidence:** Scratchpad repro script `stale-chunk.mjs` (synthetic data, loopback only). Asset responses after the deploy: `200 text/html /assets/Circles-<hash>.js`, `…/IntentCaptureForm-<hash>.js`, `…/SectionHeader-<hash>.js`, `…/CircleDiscoveryCard-<hash>.js`. `curl -I /assets/does-not-exist.js` returns `200 text/html`.
- **Root cause (three parts):**
  1. The SPA catch-all in `server/src/index.ts` (`app.get("*")`) only skips `/api/` and `/uploads/`, so missing `/assets/*` files get HTML.
  2. There is no `vite:preloadError` / chunk-load recovery handler.
  3. There is no React error boundary anywhere in `client/src`.
- **Secondary (operational, documented, no finding):** the server caches the `index.html` template in memory on first request. Rebuilding `client/dist` without restarting therefore serves stale asset hashes to *every* visitor (reproduced: a blank page for all routes until restart). The runbook already restarts after build; staging and prod deploys must keep that order.
- **Relation to BRW-1:** BRW-1 (WebKit dev-server `Importing a module script failed`) did **not** reproduce on the production build (5/5 passes). This finding is the production cause of the same browser error class, triggered by deploys rather than by the dev server.
- **Suggested fix direction (not applied):**
  - return 404 for unmatched `/assets/*`;
  - add a one-shot reload on `vite:preloadError` / dynamic-import rejection;
  - add a route-level error boundary with a "Reload" action;
  - optionally keep the previous build's chunks for one release.
- **Regression status:** None yet. A harness test needs a two-build fixture (scratchpad script is the template).

## Phase 11A remediation

**Root cause (confirmed):** Only the application contributes; production nginx proxies everything to Node.
- The SPA catch-all in `server/src/index.ts` answered every unmatched GET with `index.html` (200), including missing `/assets/*` chunks.
- `express.static` used default caching (`max-age=0`), even for content-hashed assets.
- The `index.html` template was cached in memory until restart.
- The client had no chunk-load recovery and no error boundary.

**Fix:**
- **Server** (`server/src/clientAssets.ts`, wired in `index.ts`):
  - a missing static asset (`/assets/*`, `*.js|mjs|css|map|wasm`) gets a real **404** `text/plain` with `no-store`, never HTML;
  - hashed `/assets/*` is served `public, max-age=31536000, immutable`;
  - the SPA shell is `no-cache`;
  - the shell template is re-read when `index.html` changes on disk, so a rebuild can't keep serving stale hashes.
- **Client:**
  - `client/src/chunkRecovery.ts` recognises the Chromium, Firefox and WebKit chunk-load errors and Vite `vite:preloadError`;
  - it reloads **once** per 5-minute window, recorded in `sessionStorage`, and never reloads if the attempt can't be recorded;
  - `client/src/components/AppUpdateBoundary.tsx` (the app's first error boundary, around the routes, reset on navigation) shows **"HelloCircle has been updated — Refresh to continue"** with a Refresh button when a reload already happened, or a recoverable message for any other render error. The page is never blank.

**Regressions:**

| Test | Before | After |
|---|---|---|
| `product-deploy.spec.ts` HC-QA-090-STALE-TAB | **FAIL** with the recovery removed ("page must not go blank", root text length 0) | PASS: Chromium, Firefox (dev + production build) |
| HC-QA-090-PERSISTENT (no reload loop, notice shown) | — | PASS: Chromium, Firefox, WebKit (production build) |
| `server/src/clientAssets.test.ts` (404/immutable/no-cache/API pass-through/rebuild) | — | PASS |
| `client/src/chunkRecovery.test.ts` (engine messages, loop guard) | — | PASS |
| HC-QA-090-NAVIGATE-AWAY (leaving during an in-flight chunk load must not trigger a reload) | FAIL on the first fix (HC-QA-094) | PASS: Chromium, Firefox, WebKit |
| **Real deploy simulation** (tab open on build A → real `vite build` with new hashes + server restart → in-app navigation), isolated stack | Phase 11: blank page | **PASS in Chromium, Firefox, WebKit:** old Circles chunk removed, exactly **1** reload, route renders, never blank, no notice needed |

Recovery is suppressed while the page is being left or offline (HC-QA-094). Without that, an aborted in-flight chunk triggered a reload that hijacked the user's own navigation. The real deploy simulation was repeated with the final client and passed in all three engines.

The same-URL STALE-TAB harness simulation is skipped on WebKit only. WebKit keeps a failed module record for an identical URL across a reload; a real deploy changes the URL, and the real deploy simulation above covers WebKit.
