# HelloCircle — Public Site Batch 1: Results

**Date:** 2026-10-21 · **Branch:** `feature/workspace-detail-pages` (uncommitted; nothing committed, pushed or deployed) · Source of truth: `hellocircle-public-gap-matrix.md`.

## Safety checks done before testing
- API `:3001` is still connected to the prod-designated `hello_circle` database — **not used, not modified**.
- Dev API `:3301` (`hello_circle_dev`) has real SMTP configured — used only through read-only GET page loads (all writes aborted) for screenshots and label inspection; no sign-ups or submissions.
- All tests that write data ran in isolated environments with email blocked:
  - server Vitest: disposable `hello_circle_test_<runid>` container, provider credentials stripped (`[email] delivery skipped: transport unavailable`), container removed afterwards;
  - browser/regression suites: the isolated QA run `qa_8f564226525b54ad` (database `hello_circle_e2e_qa_…`, QA personas only, external network blocked, no Stripe calls in these suites). Reused without resetting so earlier evidence is preserved; `qa:db:seed` is idempotent.

## What changed (client only — no server, schema, Stripe, pricing, booking-rule or permission change)

| Gap | Fix | Files |
|---|---|---|
| PUB-04 | Payment result title comes from the state actually shown (Booking confirmed only when paid; "Payment needs a check", "Refund on its way", "Payment didn't go through", "Booking not found", "Couldn't check your payment", …). Route-level title is now the neutral "Payment status". | `pages/paymentResultTitle.ts` (new), `pages/PaymentSuccess.tsx`, `pageTitle.ts` |
| PUB-05 | Expiry alert only when the page currently knows a session of that kind; never for visitors who never signed in or just signed out. Real mid-visit expiry still alerts. | `components/SessionExpiryBanner.tsx` |
| PUB-06 | Chats view derived after sessions load (resident → personal; vendor-only → host; linked resident+vendor keep the tab choice); waits for the vendor session too. | `pages/Chats.tsx` |
| PUB-14 | `isNotFound()` helper (404/410). Activity, Circle, experience: 404 → existing "no longer available" state, no retry. Programme, host and provider profiles: real failures now get "We couldn't load … / Try again" instead of being shown as "not available". | `api/core.ts`, `pages/{GameDetail,CircleDetail,ExperienceDetail,ProgramDetail,HostProfile,ProviderProfile}.tsx` |
| PUB-15 | Labels associated (`htmlFor`/`id`) on Suggest a place (6), Household (3), host application (4), My Life booking lookup (2); `aria-label` on the shared "Anything to add?" field, Browse search/sort/pagination buttons, Circle activity period select. | `pages/SuggestPlace.tsx`, `pages/Profile.tsx`, `components/HostApplicationPanel.tsx`, `pages/MyBookings.tsx`, `components/IntentCaptureForm.tsx`, `pages/Browse.tsx`, `components/CircleActivityCard.tsx` |
| PUB-21 | Saved empty state: "Nothing saved yet — Tap Save on an activity, Circle, experience, programme session, club or venue…" | `pages/Profile.tsx` |
| PUB-22 | "HelloCircle credit" section appears only when `/credits/me` reports `enabled` (a direct `?tab=credit` link still shows the wallet's own note). | `pages/Profile.tsx` |
| PUB-23 | Value/input settings rows stack label above value under 560px; long emails wrap. Switch rows unchanged. | `pages/Profile.tsx`, `index.css` |
| PUB-31 | My Life Circle rows use the existing stretched-link pattern: one link to the Circle, "Manage" a separate link — no nested buttons. | `components/MyLifeCircles.tsx` |
| PUB-33 | One signed-out My Life state: the sign-in card is the page H1 with "Sign in" + "Explore HelloCircle"; the second "Nothing here yet" box is gone for signed-out visitors. | `pages/MyBookings.tsx` |
| PUB-35 | `/signin` ⇄ `/login` cross-links ("Business log in →" / "Personal sign in"); `/forgot-password` says it's for business accounts and links to `/signin?forgot=1`, which opens the resident reset form. | `pages/SignIn.tsx`, `pages/Login.tsx`, `pages/ForgotPassword.tsx` |
| PUB-08 | See investigation below. My Life lists every Circle ("Show all N Circles"), shows NEXT only for a plan that belongs to the Circle, and shows "Nothing booked yet" with one action instead of an empty column. | `components/MyLifeCircles.tsx`, `pages/MyBookings.tsx` |
| PUB-09 | Explore's "Compare places" and the local-landing unknown-county fallback follow the venue switch; nothing links into the venue gate while it's closed. Venue routes not activated. | `pages/Explore.tsx`, `pages/LocalActivity.tsx` |
| PUB-10 | For Venues shows the "launches soon / Notify me" banner and section only while the launch gate is closed. The gate flag moved to `launchMode.ts` (same expression); launch state unchanged. | `launchMode.ts` (new), `App.tsx`, `pages/ForVenues.tsx` |

## PUB-08 investigation (root cause before fixing)
Checked read-only against `hello_circle_dev` for `demo-resident-6`:
1. **No Circle plan was missing.** None of the resident's 5 Circles had an upcoming plan linked to it (`games.circle_id`). "Coming up" is built from activities the resident has joined, venue bookings, experience bookings and programme enrolments; the resident's joined activities were all in the past, so it was empty — correctly.
2. **The "NEXT Fri 23 Oct 12:00" under Kilkenny Coffee & Chat was not that Circle's plan.** It was `adm-demo-game-3` (`circle_id = NULL`), returned by the server as `nextPlan.source = "nearby"` (an unrelated public activity sharing the activity label). Every other Circle component already hides nearby plans; `MyLifeCircles` showed it as NEXT.
3. **5 vs 3:** the header counts all memberships; the list was hard-capped at 3 with no way to see the rest.
4. **Blank area:** with nothing upcoming, column 1 rendered nothing while the sticky rail spans every grid row.
Data source used for the fix: the resident's own `/circles/mine` response (already loaded, already permission-scoped). No server or permission change. Whether My Life should *also* surface not-yet-joined Circle plans as suggestions is a product choice left for batch 2.

## Tests run (fresh, this session)
| Suite | Result |
|---|---|
| Client Vitest | **35 files, 288 passed** (7 new: `paymentResultTitle.test.ts`, `MyLifeCircles.test.tsx`, `isNotFound` in `api/core.test.ts`) |
| Client type-check + production build | passed (existing >500 kB chunk warning only) |
| Server Vitest (isolated container) | **118 files, 1,027 passed, 23 skipped** (live-provider tests, skipped by design) |
| `qa:check` (harness unit + test-project type-check) | **97 passed** |
| New browser specs `product-public-batch1` + `product-public-batch1b` | **9/9 passed** (PUB-04/05/06/08/09/10/14/15/21/22/23/31/33/35; desktop + 390px where relevant) |
| `qa:booking` | 13/13 batches, **38 passed**, 2 skipped (concurrency halves, by design) |
| `qa:authorization` | 39/39 batches, **83 passed** |
| `qa:lifecycle` | 19/19 batches, **52 passed** |
| `qa:product` (now 23 batches, includes the new specs) | **77 passed**, 1 skipped (PERF-P13, by design) |

During development one new test failed, a test bug in each case and not an app bug: an anchored regex didn't match the " Verified" badge, and the first version of the batch exceeded the harness's real 10-login limiter. The spec was split rather than weakening the limiter. Both were fixed and re-run green.

**Not run:** `qa:stripe` (no payment code touched; PUB-04 changes only the document title), `qa:revenue`, `qa:validation`, cross-browser (`qa:browsers`). Production not inspected.

## Screenshots (`docs/public-audit-2026-10-21/batch1/`)
- Isolated QA personas: `pub-my-life-signed-out-{mobile,desktop}`, `pub-my-life-circles-{mobile,desktop}`, `pub-chats-{mobile,desktop}`, `pub-profile-email-mobile`, `pub-activity-not-found`.
- Dev read-only: `after-my-life-signed-out-390`, `after-for-venues-390`, `after-explore-1440`, `after-forgot-password-1440`, `after-activity-not-found-390`, `after-payment-not-found-390`, `after-suggest-place-390`.

## Unresolved / follow-ups
- "plan" wording remains in not-found headings ("This plan is no longer available") and "This program isn't available" — terminology change is PUB-20, awaiting your choice of terms.
- For Venues dateline still uses the browser's date (PUB-39, P3).
- My Life still shows "Sign out" as a page-level button and the stats rail is unchanged (batch 2 proposal).
- Footer "Help & Support" / "Safety Centre" still need sign-in (PUB-07 — needs approved safety copy).
- The 401 console noise for signed-out My Life remains (requests are expected; only the alert was wrong).

## Awaiting your approval
See `hellocircle-public-batch1-prepared-decisions.md`: legal publication and consent links (PUB-01/02/03/34/36), paid-host wording (PUB-11), venue/club activation (PUB-09), late programme enrolment (PUB-17), and whether paid checkout stays closed until the booking terms are published. Batch 2 (UX/UI proposal + screenshots) has not been started.
