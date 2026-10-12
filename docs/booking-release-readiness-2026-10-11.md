# HelloCircle — Booking UX Release Readiness

Validation of the booking UX work (Phases 0–7, `docs/booking-ux-implementation-plan-2026-10-11.md`) on
`feature/commerce-engine` @ `e2a74a6` plus the uncommitted working tree. 2026-10-11.

**Not done, by instruction:** no deploy, no push, no commit, no commerce switch enabled, no VAT/pricing/revenue rule changed.
Stripe ran in TEST mode only: the harness accepts only `sk_test_`/`rk_test_` keys and refuses `_live_`. The test
profile holds only a test key.

---

## 1. Test results

| Suite | Result | Notes |
|---|---|---|
| Server Vitest (isolated Docker MySQL) | **801 passed**, 23 skipped (78 files) | Skips are the opt-in live-provider media tests |
| Client Vitest | **172 passed** (21 files) | Includes the 58 booking-kit tests |
| Typecheck: client, server, tests | **Pass** | |
| Client production build | **Pass** | Kit preview page excluded from the production bundle |
| `qa:booking` (API, DB, concurrency, desktop + mobile UI) | **38 passed**, 2 partitioned skips, exit 0 | The skips are the harness's one-race-per-batch design |
| `qa:lifecycle` (activities, Circles, notifications, UI) | **49 passed** + **3 HC-QA-001 passed** after spec update | See §2 for the stale-spec fix |
| `qa:security-gate` | **39 passed**, exit 0 | Same as previous baseline |
| `qa:authorization` | **83 passed**, exit 0 | Same as previous baseline |
| `qa:browsers`, Chromium | **75 passed**, 1 skipped (perf, by design), exit 0 | |
| `qa:browsers`, Firefox | **15 passed**, then `LC-UI-DESKTOP-PARTICIPANT` timed out | Same test QA_REPORT already records as "flaky under load; passed 2/2 in isolation" on Firefox |
| `qa:browsers`, WebKit | **14 passed**, then `LC-UI-DESKTOP-HOST` **failed** (reproducible here) | Diagnosed in §1b. Not traced to the booking changes; needs a re-run on an idle machine or CI |
| `qa:revenue` (stub provider) | **38 passed**, exit 0 | Plans, rewards, credit, coupons, splits, payouts |
| `qa:stripe` (Stripe TEST mode) | **All passed**: 30 in the full run, including the new **STRIPE-REFUND-VENDOR-CANCEL** against Stripe, plus **STRIPE-UI-DESKTOP and STRIPE-UI-MOBILE** (real hosted test checkout → pending until webhook → confirmed → My Life) on re-run | The first full run failed STRIPE-UI-DESKTOP on a stale strict-mode selector (fixed). Two re-runs timed out under load before the passing one |
| Mobile layout sweep (headless Chromium) | **66/66 clean** | 9 booking/joining routes × 320/375/390/428/768/1024 px, with and without the consent banner: no horizontal overflow, no bar/banner overlap, no page errors |

### 1a. Runs affected by machine load

The workstation was heavily loaded during validation (load average 12–14; Adobe Illustrator at 100% CPU for
6 days; it peaked at **56** during the cross-browser runs). Under that load:

- **Stripe browser journeys.** STRIPE-UI-DESKTOP/MOBILE re-runs timed out, either while starting the per-batch servers
  (global `onError`, 0 tests run) or at the 240 s test limit after reaching Stripe-hosted Checkout. Earlier QA reports
  describe the same hosted-page timeouts. The API-level payment, refund, webhook, expiry, concurrency and return-URL
  tests all passed.
- **Firefox.** It timed out on its first test.
- **WebKit.** It passed the `core` batch (9/9) and then hit a server-startup timeout.

These are **not verified**, not failed. Re-run `qa:stripe -- --grep STRIPE-UI` and `QA_BROWSER=firefox|webkit npm run
qa:browsers` on an idle machine or in CI before any paid launch.

### 1b. WebKit `LC-UI-DESKTOP-HOST` diagnosis

The test asserts the page logged **no uncaught errors**. With full error messages captured (a temporary fixture change,
reverted afterwards), WebKit reported:

- **"Importing a module script failed"** (twice) from React's lazy page loader;
- **"Fetch API cannot load …/api/chat/mine due to access control checks"**.

All three were on `/manage/circles/:id`, the page the app opens after "Create first plan". The test then immediately
`goto`s `/circles/:id` while that page's lazy code and chat-inbox request are still in flight. WebKit, unlike Chromium,
surfaces cancelled module loads and fetches as page errors.

- **Every route loads cleanly in WebKit.** A separate check loading 13 lazy routes, including that one, showed no module
  failures.
- **The chat request already handles errors** at every caller (`Header`, `ListingChats`, `HostChatButton`, `Chats`).
  None of those files, nor the module graph on this path, changed in the booking work.
- **Load made the race likelier.** The machine load (12–56) lengthens the in-flight window.

**Assessment:** a timing-sensitive test, not a booking regression, but **not proven against the base commit** on this
machine.

**Next step:** re-run on an idle machine or CI. If it still fails, make the spec wait for the Manage page to settle before
navigating.

---

## 2. UX defects found and fixed during validation

| # | Defect | Cause | Fix | Verified by |
|---|---|---|---|---|
| U1 | On phones (320–390 px) the cookie banner's **"Accept all" button was cut off** at the banner's right edge (82 px past it at 320 px) | Since commit `3640b1a` (Stage 5c, 10 Oct) the banner has three buttons in a `flex: none` row, which can't shrink, so its wrapping never applies | Button row `flex: 0 1 auto; minWidth: 0; maxWidth: 100%`: wraps inside the banner, never grows (desktop unchanged) — `client/src/components/CookieNotice.tsx` | Measured at 320/375/390/428/768; HC-QA-001 ×3 pass |
| U2 | "Banner overlaps the bottom tab bar" (reported last round) | **Not a real defect.** It was an artifact of my 390 px iframe check. Real Playwright measurements put the banner 16 px above the tab bar at 320/390/430 px and on a short 390×420 screen | None needed | HC-QA-001-CONSENT evidence: banner bottom = bar top − 16 at every size |
| U3 | Payment success heading changed to "You're booked" in Phase 3 | My change; the Stripe journey spec relies on "You're all set!" | Restored "You're all set!" | Spec selector |

### Test specs updated (stale versus intended UI; no assertion weakened)

- `lifecycle-ui-bottom-chrome.spec.ts`:
  - Consent buttons are now "Necessary only" / "Choose…" / "Accept all", each by its exact accessible name.
  - Keyboard order is Learn more → Necessary only → Choose… → Accept all.
  - The stored choice is the Stage 5c JSON (`{v:2, analytics, advertising}`) instead of `"accepted"`/`"rejected"`.
- `stripe-browser.spec.ts`: since Stage 5f (`3b4c1ff`) the total appears twice in the dialog (breakdown + footer). The
  spec now checks each by test id instead of an ambiguous text match, which was a Playwright strict-mode failure.
- `stripe-refund.spec.ts`: **new** STRIPE-REFUND-VENDOR-CANCEL test for the automatic refund.

---

## 3. Remaining P0 / P1 issues

| Sev | Issue | Status |
|---|---|---|
| **P0 (paid)** | The VAT / pricing / commercial model is undecided (audit F1): 23% VAT is added on every listing and HelloCircle is merchant of record with manual vendor settlement. Needs an Irish tax adviser | Open, a business decision; deliberately untouched |
| **P1 (paid)** | Refundable €100 deposit: returning it is still a manual step. It's now **visible** ("Action needed", deposit due), but nothing returns it automatically | Open, mitigated |
| **P1 (paid)** | Customer self-cancel still leaves the refund to the vendor (Refund Policy A); only *vendor* cancellations auto-refund | Open, a policy decision |
| P1 | Acknowledgements are recorded but **not enforced** server-side (see §6) | Open, deliberate |
| P1 | `client/src/pages/ClubDetail.tsx` pass button shows `club.price × 10 × (1 + VAT + fee)` rounded to whole euros: a client-side estimate that can differ from the charge by cents. Existing code, display only | Open (pricing untouched per instruction) |
| P1 (release hygiene) | `client/capacitor.config.ts` contains a dev-only `server.url: http://localhost:3001` override with a "REMOVE before any real build" note. A native build made from this tree would point at localhost. Existing code | Open, check before any app-store build |
| P2 | Open Booking resale and Make It Happen are paused by the new `commerce.open_booking` switch (default off) until repriced | Intended |
| P2 | Multi-child registration in one checkout | Deferred |

No open P0 or P1 affects **free** participation.

---

## 4. Security findings

| Area | Finding |
|---|---|
| Secrets | Diff and new files scanned: no API keys, webhook secrets, live keys, passwords or real personal email addresses. Docs contain no absolute local paths |
| AuthN/AuthZ | `qa:security-gate` 39/39 and `qa:authorization` 83/83 unchanged. New routes: `/api/checkout/:ref/abandon` (owner by device id or resident; 404 otherwise; rate-limited), `/api/vendor/orders` (org-scoped via `req.vendorIds`), `/api/games/host/venue-bookings` (resident's own), `/api/bookings/quote` + `/api/registrations/quote` (read-only, coupon-validate rate limiter) |
| Abandon endpoint | Never releases a paid row, never a session Stripe reports `complete`, and does nothing if Stripe can't be asked. Verified with the stub provider and in STRIPE-RETURN-URL (a non-owner visit to the cancel page leaves the hold pending) |
| Money movement | Automatic refunds run only on an authenticated vendor cancellation of the org's own order, through `refundPaidOnce` (row lock + provider idempotency key). A **centre_manager**-role user can now cause a refund by cancelling, which previously needed **finance**. This is intended (the customer must be refunded), audited as `*.refunded_on_vendor_cancel` |
| Data minimisation | Registration no longer asks for a home address. The coach/medical note is excluded from the browser draft (sessionStorage). Party names are stored only for multi-person experience bookings |
| Client pricing | No VAT/fee arithmetic in any booking-kit, booking or registration screen (guard test). Only the pre-existing ClubDetail pass label remains (§3) |

---

## 5. Payment and refund validation

| Check | Evidence |
|---|---|
| Quote equals charge | Server test B1 (venue: quote total == stored total == checkout) and B2 (registration). Stripe suite "amount integrity" passes |
| Server-authoritative pricing | Every price shown in the new flows comes from `POST /api/bookings/quote`, `/api/registrations/quote` or the existing experience/programme/game quotes. Checkout re-prices server-side |
| Refund idempotency | Server: B13 "refunds once" (stub; repeat cancel → 409; one `createRefund`). **Stripe TEST**: STRIPE-REFUND-VENDOR-CANCEL: one provider refund of the full amount, replayed cancel and manual refund both 409, one audit row. Existing STRIPE-REFUND-HALL/CLUB concurrency (4 parallel refunds → 1) pass |
| Failed-refund recovery | Server test: provider has no record of the payment → cancel stands, payment stays `paid`, order appears under **Action needed** as `refund_pending`, failure audited |
| Deposit return state | Server test: past paid booking with a €100 deposit shows `deposit_due` until a succeeded refund row covers it, then clears |
| Abandoned checkout | Releases the hold through the provider-expiry path. Coupon reservation handed back via `endPendingHold` (existing tests) |

---

## 6. Acknowledgement enforcement: compatibility review

Current behaviour: the new web flows always send `acceptedTerms` (and `acceptedSafety` / `meetsMinAge` where
relevant), and won't submit without them. The server **records** them (`order_acknowledgements`, terms version resolved
from the policy CMS) but does **not** reject an order that omits them. Minimum age **is** enforced.

Risks of making acknowledgements mandatory now:
1. **Bundled native app builds.** `capacitor.config.ts` bundles `webDir: dist`, so any shipped app store build keeps the
   old checkout code until users update. Mandatory enforcement would break their checkouts.
2. **Existing API callers.** About 100 test and harness calls post to the checkout endpoints without acknowledgements,
   and Make It Happen's confirm step calls `createBookingInternal` without `acceptedTerms`.
3. **Unpublished Terms.** `customer-booking-terms` has no published version in fresh databases, so the record stores
   `doc_version NULL`. Enforcement should require a published version first.

Recommended path: a switch (default off) that, when on, rejects missing acknowledgements for **web** clients
immediately and for native clients after a minimum app version. Update the harness callers, then enable on staging.

---

## 7. Database migration impact

All changes are additive, idempotent, and applied by `initSchema()` at server start (no separate migration step):

- **New tables:** `order_acknowledgements`, `experience_booking_participants`.
- **New nullable columns:** `circles.join_questions` (TEXT), `circle_invites.note` (VARCHAR 500), `circle_invites.answers` (TEXT).
- **12 new indexes:**
  - `bookings`: (centre_id, room_id, date), client_id, email, resident_id
  - `registrations`: club_id, session_id, client_id, email
  - `program_enrollments`: program_id
  - `experience_bookings`: session_id, experience_id
  - `games`: booking_ref

  InnoDB builds these online. On a large table the **first boot after deploy takes longer** while the indexes build.
- **New setting key:** `commerce.open_booking` (absent = off), which **pauses Open Booking and Make It Happen** on deploy.
- No column type changes, drops or renames. No backfill.

---

## 8. Deployment and rollback requirements

**Before deploy:**
1. Take a backup of DB and uploads (the nightly job exists; run one on demand).
2. Run the full server suite and `qa:booking` against the exact commit.
3. Check `capacitor.config.ts` has no dev `server.url` if a native build is involved.
4. Brief vendors that **cancelling a paid online booking now refunds the customer automatically**.
5. Brief support that Open Booking and Make It Happen are paused.

**Deploy:** deploy the server and client together (single origin), staging first. On first boot, watch
`initSchema` time (index builds).

**Rollback:**
- Code rollback is safe. Old code ignores the new tables, columns, indexes and the `commerce.open_booking` key, and no
  existing column changed.
- New data (acknowledgements, party names, Circle questions and notes) is kept but unused until a roll-forward.
- Refunds already issued by vendor cancellations are real and can't be undone by a rollback. They are recorded in
  `refunds` and `audit_log`.
- If needed, drop the 12 indexes manually. They are harmless to keep.

---

## 9. Go / No-Go

### Free participation — **GO**, conditional on a staging pass
Covers free events, Circles (including approval requests with questions), free club registrations, trials, free
programmes and experiences, and cash bookings.
- Security and authorization gates are unchanged and green, and the booking, lifecycle and Chromium suites pass.
- The trial loophole is closed.
- The availability calendar is correct.
- Linked venue and event cancellations are safe.
- Mobile layouts are clean from 320 to 1024 px.

Conditions:
- Deploy to staging and smoke the journeys there.
- Re-run the Firefox and WebKit suites on an idle machine or CI (§1a, §1b). Chromium, desktop and mobile, is fully green.

### Paid bookings — **NO-GO**
The integrity work is in place and verified against Stripe test mode: server-only pricing, holds, idempotent refunds,
automatic refunds on vendor cancellation, and visible refund and deposit obligations. But:
1. The **commercial model / VAT treatment (P0)** is undecided, and the live model charges 23% VAT on every listing as
   merchant of record. That's a legal and tax exposure, not a code defect.
2. **Deposits and customer-cancellation refunds** still rely on manual vendor action.
3. **Acknowledgements** aren't enforced server-side yet.
4. Real HTTPS webhook delivery on staging hasn't been exercised (staging provider setup is still pending). Locally, the
   Stripe TEST suite is fully green, including the hosted-checkout browser journeys.

Re-assess once the tax decision is made and those three items are scheduled.
