# Circles 3.0 — 08 Test results (2026-10-28, local)

| Suite | Result |
|---|---|
| New `server/src/routes/circlePlanListings.test.ts` (isolated Docker MySQL) | 20 / 20 pass (incl. My Life plans, cancellation notices, reopen rules) |
| `adminOperations.test.ts` (+ close/reopen) | 9 / 9 pass |
| Accessibility (axe-core 4.10, WCAG 2.0/2.1/2.2 A+AA rules) on plan card, Plan-with-Circle dialog, Explore with others, My Life plans | **0 violations**; Esc closes the dialog and returns focus to its button |
| Responsive sweep 320 · 375 · 390 · 430 · 768 · 1024 · 1280 · 1440 · 1920 (plan card, Explore with others, My Life plans) | No page overflow, nothing clipped, all fit, at every width |
| Full server suite, fourth run (after shared plans) | **128 / 128 files, 1173 pass**, 23 skipped |
| `circleSharedPlans.test.ts` (new) | 10 / 10 pass — incl. partner can't decide, outsider 403 on the private partner Circle, suggester's name hidden from the partner |
| Browser — shared plan | Howth Hill Walkers organiser shares the Sea Swim plan with Sunday Pier Walkers; their organiser agrees; the partner card shows "Shared by…", "suggested in Howth Hill Walkers", I'm in and Report, no Confirm/Cancel. Test data and temporary sessions removed |
| Full server suite, third run (after reminders + admin close) | **127 / 127 files, 1163 pass**, 23 skipped |
| Full server suite, second run (after notices + My Life) | **127 / 127 files, 1158 pass**, 23 skipped — the complaints test passed this time (intermittent, unrelated) |
| Existing `circles.test.ts` | 63 / 63 pass |
| Full server suite (isolated) | 1153 pass, 23 skipped (live-provider), **2 fail**: `complaintsSubject.test.ts` — passes 2/2 when run alone; order-dependent shared state in the full run, untouched by this work. Recorded, not hidden |
| Client typecheck / server typecheck | Clean |
| Browser, round 2 | "Explore with others" on hiking adventure, pottery and yoga programmes (honest heading after fix); "Plan with my Circle" on a programme and an activity; My Life "Plans you're in" (Interested; Interested · no dates yet); no errors, no overflow at 1280/390. Volunteering not exercised (no dev volunteering listing with dates; same page component as experiences). Test plans deleted |
| Browser, dev DB (`ce2-tok-a`), 1280 + 390 | Plan with my Circle → suggested in Howth Hill Walkers; second attempt → "Already suggested"; plan card shows Experience, live facts, "You're interested (not booked)", "Book experience →"; kind filter present; no console errors; no horizontal overflow. Test plan deleted afterwards |

Security cases covered by tests: private activity of another Circle (404, no title leak), unpublished listing,
suspended-organisation listing, non-member, invalid reference/session, duplicate race, booked state only for the
booker, cancelled departure, conversion refused.

Client unit tests after these edits: 321 / 321 pass. Not yet run: the guarded Playwright suites.
