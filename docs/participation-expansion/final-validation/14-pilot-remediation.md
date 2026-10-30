# 14 · Pilot remediation and review preparation

**Date:** 2026-10-30.
**Starting point:** branch `feature/participation-phase2` at `2f279ad` (clean). The earlier CONDITIONAL GO is treated as conditional evidence, not deployment permission.
**State reviewed:** **uncommitted working-tree changes on top of `2f279ad`**, left for local review. Nothing is committed, pushed, deployed or opened as a PR.
**Environment:**
- isolated QA only: disposable MySQL container per reset (`QA_PORT_OFFSET=10`), seven synthetic personas, no SMTP, outbound sockets blocked, Stripe TEST only inside the `qa:stripe` profile;
- the server suite on its own disposable MySQL (`npm run test --workspace server`).

**Stop conditions:** none hit.
- **Production data, notifications, credentials:** no production data touched; no real person notified; no live credentials present.
- **Isolation, money, capacity:** no cross-organisation exposure found; no financial or capacity corruption.

## 1. Changes made and why

| Area | Change | Why | Files |
|---|---|---|---|
| Reports: event no-shows (DEF-04) | Events reported as **bookings** and as **people**, from per-person evidence; "not recorded" shown as unknown; definitions in the UI and CSV; one shared rule for the summary, the per-listing table and the CSV | No-shows were counted per booking while attendance was counted per person | `server/src/participation/eventAttendance.ts` (new), `server/src/routes/vendorReports.ts`, `client/src/components/VendorReports.tsx`, `client/src/api/vendor.ts` |
| Reports: per listing | Each row states its unit (events: people; halls and clubs: bookings; programmes: per session, shown as "—"); attendance only for past dates | It used to divide check-ins by all people, including future bookings | same |
| Reports: check-ins by day (DEF-11) | A door check-in is no longer counted twice (the per-person check-in plus the booking's `present` mark) | Double counting | `vendorReports.ts` |
| Reminders (DEF-03) | Keyset pagination over every due order; a durable claim per order and day (`booking_reminder_sends`); a re-check just before sending; no transaction held during delivery; `sent`/`failed`/`skipped_*` with attempts; retry ×3; failures to `reportException` | More than 200 due could starve; no protection against overlapping runs; no record of a failed delivery | `server/src/participation/bookingReminders.ts`, `server/src/participation/schema.ts` (additive table), `server/src/notifications.ts` (`notifyResidentWithOutcome`, with `notifyResident` behaviour unchanged) |
| Cancel dialog (DEF-10) | A dropped connection now says "We couldn't reach HelloCircle — check your connection and try again." instead of the raw "Failed to fetch" | Found while repairing HC-GAP-UI-EXP-PAID; an honest-outcome issue on cancellation | `client/src/components/ui.tsx` (`ConfirmDialog`) |
| Date inputs, focus (DEF-09) | Workspace date and time inputs keep the brand focus ring while focus is on their internal parts (`:focus-within`) | Found by the new keyboard sweep: no visible focus on some stops of the Reports date filter (WCAG 2.4.7) | `client/src/components/admin/admin.css` |
| Stale browser tests (28) | Repaired to the intended current behaviour (§4) | All 28 were test drift; none hid an application defect | 18 spec files under `tests/integration/specs/` |
| New QA batches | `booking-final-restrictions` (direct-API bypass attempts, §6); `booking-final-a11y` extended to 320 px plus a keyboard-focus sweep | Evidence the brief asked for | `final-pilot-restrictions.spec.ts` (new), `final-a11y.spec.ts`, `run.ts` |

**No business rule, price, VAT, capacity or permission rule was changed. No restricted feature was enabled.**

## 2. No-show metric: definitions and verified examples
**Scope of the attendance counts:**
- only sessions **before today** (Ireland date; the existing `pastTo` rule), so an upcoming event can't be a no-show;
- only paid, not-cancelled bookings on not-cancelled sessions;
- people removed from a booking (`booking_attendees.status = 'removed'`) are left out;
- a legacy booking without attendee rows counts its party size, as everywhere else in the product.

**Event bookings:**
- **attended:** at least one person on the booking has a door check-in, or the organiser marked the booking present;
- **no-show:** the organiser marked "didn't come" and nobody on the booking was checked in;
- **not recorded:** neither.

**Event attendees (people):**
- **attended:** that person has a door check-in (per-person evidence only);
- **no-show:** their booking was marked "didn't come" and they weren't checked in;
- **not recorded:** everyone else. That includes the rest of a partly checked-in group, and people on a booking marked present without person-by-person check-in (also shown as a separate count).

**Precedence:** a door check-in outranks a "didn't come" mark.

### Verified example
Deterministic organisation "C" in `server/src/routes/vendorReports.test.ts`; the expected values were worked out by hand before running:

| Booking | Situation | Counted? | Booking result | People (expected / attended / no-show / not recorded) |
|---|---|---|---|---|
| B1 | 1 person, checked in | yes | attended | 1 / 1 / 0 / 0 |
| B2 | 3 people, person 3 removed, person 1 checked in | yes | attended | 2 / 1 / 0 / 1 (partial group) |
| B3 | 2 people, marked "didn't come" | yes | no-show | 2 / 0 / 2 / 0 |
| B4 | cancelled booking (had a no-show mark) | no | — | — |
| B5 | upcoming session (stray no-show mark) | no | — | — |
| B6 | legacy, 2 people, no attendee rows, marked present | yes | attended | 2 / 0 / 0 / 2 (marked present, people not recorded) |
| B7 | legacy, 1 person, nothing recorded | yes | not recorded | 1 / 0 / 0 / 1 |
| B8 | cancelled session | no | — | — |
| D1 | another organisation, 4 people, no-show | only for D | — | — |

**Totals for C:**
- **Bookings:** 5 expected, 3 attended, 1 no-show, 1 not recorded.
- **People:** 8 expected, 2 attended, 2 no-show, 4 not recorded (2 of them on a booking marked present).

**Asserted in all three places:**
- the summary;
- the per-listing result (people 8/2/2/4);
- the CSV ("no-show bookings" 1, "no-show people" 2, the definitions rows).

**Check-ins by day:** 3, not the 5 the old double count gave. **Organisation D** sees only its own booking (1 no-show booking, 4 no-show people) and gets an empty per-listing result for C's listing.

**Tests:** 4 new route tests in `vendorReports.test.ts`, plus the existing 6, which were updated for the two-row attendance. 7 pure tests in `eventAttendance.test.ts` (single, partial group, removed person, no-show, check-in outranks mark, marked present without people, nothing recorded).

## 3. Reminder reliability results
**Where it ran:** the switch was turned on **only inside the disposable server-test database**. The fixed far-future day (2031-03-29, so tomorrow is 2031-03-30, the morning of Ireland's spring clock change) keeps other tests' data out. **Production reminders stay disabled.**

| Required check | Result | Evidence (`bookingRemindersReliability.test.ts`) |
|---|---|---|
| More than 200 eligible; several pages | **PASS** | 450 hall bookings plus 2 more due; all 447 eligible sent once, 3 pages of 200 |
| Equal scheduled timestamps | **PASS** | all 450 at the same date and time; pagination is by order key, not time |
| Cancellation before delivery | **PASS** | one booking cancelled after its page was read (claim released, nothing sent) and one cancelled before its page was read (never selected) |
| Rescheduled sessions | **PASS** | a session moved off the day isn't reminded; a session moved onto the day is |
| Partial delivery failure | **PASS** | 2 of 452 deliveries fail: status `failed`, attempts 1, `sent_at` empty, the error recorded, both reported as `job.booking-reminders.delivery` |
| Retry after failure | **PASS** | the next sweep sends exactly those 2 (attempts 2); every order has exactly 1 notification |
| Give up | **PASS** | a delivery that keeps failing stops at 3 attempts |
| Concurrent or overlapping runs | **PASS** | 3 sweeps in parallel over 60 new orders: each sent exactly once |
| Restart during processing | **PASS** | a claim abandoned 20 minutes ago is taken over; a fresh claim held by a live run is left alone |
| Duplicate prevention | **PASS** | at most one notification per order and day in every scenario |
| Preferences | **PASS** | an opted-out resident is recorded `skipped_preference`; nothing sent |
| Attempt vs success | **PASS** | `attempts` counts tries; `status = 'sent'` and `sent_at` only after the in-app notice is written; the push outcome is recorded separately (`push_status`) |
| No transaction during delivery | **PASS** (by design) | claim, delivery and record are separate statements; no `db.transaction` wraps delivery |
| Switch off | **PASS** | nothing sent |
| Timezone | **PASS** | "tomorrow" = Ireland's today + 1, across the DST boundary |

Both existing tests in `bookingReminders.test.ts` still pass.

## 4. Status of the 28 browser failures
**Method:**
- each failure's original signature (from the earlier run and identical on `f22294f`) was rechecked against the current application source before anything was changed;
- the timeouts were diagnosed with a **temporary** 20 s action timeout in the Playwright config, so the stuck step failed with its locator and a page snapshot. That config was reverted before the clean run (verified: 0 diagnostic markers).

**Result:**
- **No assertion was weakened, no test removed, and no wait added.**
- Two vacuous checks were found and fixed: an absence check on outdated copy that could never fail (`auth.spec.ts:15`, `hc-completion-d.spec.ts:171`).

| # | Test | Original signature | Cause | Classification | Repair |
|---|---|---|---|---|---|
| 1 | REAL-AUTH-001 | heading "Sign in to edit your profile." missing | account redesign copy (`60929d2`) | stale test | current heading in all 3 places, incl. the vacuous absence check |
| 2 | REAL-AUTH-GUEST | same | same | stale test | same |
| 3 | COMPLETE-REVIEW-STATE | strict mode: 2 × "Please don't pay again" | said in the status lead *and* on the pass (booking-box pass, 2026-10-27) | stale test | assert both, each by its role or class |
| 4 | COMPLETE-SILENT | "…review this right now." missing | copy shortened, "Try again" added (`f22294f`) | stale test | new copy (×3, incl. the vacuous absence check), plus the retry button asserted |
| 5 | OG-27-UI | heading "Request sent" missing | state moved onto the activity pass | stale test | `article "Activity pass: Request sent"` / `"…You're going"` |
| 6 | OG-26-UI | timeout | host form now requires Free or Paid | stale test | choose "Free" (as a host must) |
| 7 | OG-29/OG-31-UI | timeout | privacy request moved to `/profile?tab=security` | stale test | new location (×2) |
| 8 | CAT-PUBLIC | timeout | a category's types are now checkboxes in the "Refine" panel; the card repeats its title (one hidden) | stale test | the checkbox (opening Filters on a phone); match the visible title |
| 9 | LC-UI-DESKTOP-HOST | timeout | Free or Paid required | stale test | choose "Free" |
| 10 | LC-UI-DESKTOP-PARTICIPANT | timeout | one-tap join (no confirm); leave control renamed | stale test | assert the pass and the Undo; "Can't make it? Leave this activity" |
| 11 | LC-UI-TABLET | timeout | Free or Paid; one-tap join | stale test | as above |
| 12 | LC-UI-MOBILE | timeout | same | stale test | same; LC-UI-MOBILE-CONSENT's join step corrected too |
| 13 | HC-QA-001-STACK | timeout | one-tap join | stale test | no confirm click; the DB check that the join happened kept |
| 14 | HC-QA-032-DRAFT-COPY | timeout | Free or Paid required | stale test | choose "Free" |
| 15 | HC-QA-032-SEMANTICS | timeout | same | stale test | same |
| 16 | BK-UI-DESKTOP | timeout | the guest expander renamed "Show all bookings, references and history" | stale test | new name, plus `aria-expanded` asserted |
| 17 | HC-QA-043 | timeout | same | stale test | same |
| 18 | HC-QA-066 | "View full activity" missing | My Life 3.0 tabs (My Plans / My Circles) | stale test | keyboard reach to the plan card and the Circle card on their tabs |
| 19 | HC-QA-068 | "A few more details." missing | Free or Paid required on step 1 | stale test | choose "Free" |
| 20 | HC-QA-069 (×2 viewports) | no `alertdialog` | one-tap join has no dialog | stale test | the same focus-trap checks on the approval join dialog that still exists |
| 21 | HC-GAP-UI-EXP | "View full activity" missing | cancel moved to the booking page | stale test | keyboard: card → booking page → Cancel → dialog; honest outcome; capacity released |
| 22 | HC-GAP-UI-EXP-PAID | same | same, **plus app defect DEF-10** (raw "Failed to fetch") | stale test + app defect fixed | as above; network error shown plainly; "Cancelled — refund on its way" after refresh and Back |
| 23 | HC-GAP-UI-PROG | same | programme rows on My Plans | stale test | My Plans tab |
| 24 | PUB-05/33 | H1 "Sign in to see your life" missing | H1 is "My Life", the prompt below it | stale test | H1 plus the prompt shown exactly once, plus the Sign in button |
| 25 | PUB-08/31 | timeout | Circles on the My Circles tab | stale test | all cards listed, the nearby plan not shown as "Next", no nested buttons |
| 26 | PUB-09/10 | H1 "Explore" missing | Explore H1 is "Find something worth doing." | stale test | new heading; the rest unchanged |
| 27 | PUB-21/22/23 | `.settings-row--stack` missing | account redesign (`.acct-row--stack`); Saved moved to My Life; Credit is a Payments view | stale test | new structure, credit shown only when enabled |
| 28 | B2-LISTS | label "Sort results" missing | "Sort" button in the "Filter and sort" toolbar | stale test | new control |

**Also uncovered:** BK-UI-MOBILE was hidden behind BK-UI-DESKTOP, the same loop, and had never run in the earlier validation. It now runs and passes.

**Results:**
- every one of the 28 passed in the diagnostic runs;
- the clean run's result is in §8;
- **all 28 were stale tests**: 1 application defect (DEF-10) was found and fixed while repairing them; no unsupported workflow; no environment issue.

## 5. Accessibility
**Automated (recorded separately from manual review):** `booking-final-a11y`.
- **Coverage:** 13 participation pages × 5 widths (320 for reflow at 400% zoom, then 375, 768, 1024 and 1440) = 65 page views.
- **Enforced:**
  - no horizontal scroll;
  - one H1;
  - a `<main>` landmark;
  - every control and button named;
  - **keyboard sweep at 375 and 1440:** every Tab stop is on screen, outside `aria-hidden`, and shows a focus indicator (on the element or a `:focus-within` wrapper), and no element keeps focus.
- **Measured for manual review:** targets under 24×24 and text below the contrast ratios (see [09](09-ui-ux-accessibility.md)).
- **Found and fixed:** DEF-09 (date-input focus ring). Result: **PASS**.

**Existing keyboard and focus suites:** pass (HC-QA-066/067/068/069 (+ADJACENT)/083/088, COMPLETE-FORMS, COMPLETE-MENUS, HC-QA-043, OG-23-RESPONSIVE at 9 widths).

**Screen reader: NOT TESTED.**
- **Why:** VoiceOver is present on this Mac, but this session can't operate it. macOS denies synthetic input to automation here (error −25204), and there's no assistive-technology driver.
- **Not substituted:** automated scans and DOM inspection weren't used in place of a review.

**Remaining manual checklist** (a person with VoiceOver + Safari on macOS and iOS, or NVDA + Firefox on Windows):
1. **Resident registration form** (club and event), signed in and as a guest:
   - every question is announced with its label, hint, purpose and "required";
   - conditional questions are announced when they appear;
   - an error summary is announced and moves focus;
   - each error is linked to its field.
2. **Booking confirmation and My Life:**
   - the booking status is announced (the `role="status"` lead);
   - the pass is read as one article with its status;
   - "Cancel booking" opens a dialog announced with its title and message;
   - focus returns to the trigger on close.
3. **Partner Messages:**
   - audience choices are announced;
   - the preview count and "send me a test" result are announced (status/alert);
   - delivery history is read as a table.
4. **Partner Reports:**
   - the date and listing filters are labelled;
   - the weekly chart's text alternative is read;
   - tables are read with headers;
   - the definitions list is read after the attendance table.
5. **Door check-in on a phone:**
   - search results are announced;
   - "Checked in" and "already checked in" outcomes are announced;
   - partial-group selection is operable by swipe and double-tap.
6. **Admin Settings switches and Organisation capabilities:** the switch state ("on"/"off", "locked") is announced, and the refusal message for a locked or unavailable switch is announced.
7. **Contrast, by hand:**
   - avatar initials on coloured circles (2.2–3.4:1 measured);
   - the pass reference text over its gradient;
   - the pre-launch "Notify me" button.
8. **Touch targets:** check spacing for the text-style buttons under 24 px tall (`adm-linkish`, `bd-link`, footer links).
9. **Zoom:**
   - 200% browser zoom on the registration form and Reports;
   - text-spacing override (WCAG 1.4.12) on the booking page.

## 6. Pilot restrictions: configuration matrix and evidence
**Isolated-QA direct-API evidence:** `booking-final-restrictions` (FINAL-RESTRICT) **passed**.
- **Precondition:** it first asserts the switches' stored values in the fresh QA DB.
- **Afterwards:** it asserts that nothing it did changed them.

| Feature | Pilot state | Server-side enforcement | Bypass attempt in isolated QA | Production state |
|---|---|---|---|---|
| Mobile app | Excluded (none exists) | Any client that skips a published form gets `409 form_required` (`compatibility.test.ts`) | n/a | n/a |
| Online paid checkout | Disabled | `paidCheckoutOpen()` fails closed in production unless `PAID_CHECKOUT=open` (`commerce/releaseGates.ts`, tested in `releaseGates.test.ts`); every Checkout goes through `checkoutService` | QA runs as a non-production profile where the gate is open by design (Stripe TEST suite); the production behaviour is unit-tested only | **BLOCKED:** operator check of `PAID_CHECKOUT` and the absence of live keys ([15](15-pilot-operations-checklist.md) §6) |
| Donations | Disabled | Capability `unavailable`; no route implements it | Admin PUT capabilities `{donations: true}` → **409** "can't be switched on"; no flag row written | BLOCKED (operator query) |
| External payment verification | Disabled | Capability `unavailable`; no route marks an order paid outside Stripe or cash | Admin PUT `{external_payments: true}` → **409** | BLOCKED |
| Sensitive questions | Locked | `participation.special_category_questions` locked; wording, hint, purpose and choices checked | Admin switch-on → **409 locked**; a partner publishing "Any medical conditions or allergies?" → **refused** (draft kept private, publish 4xx); no live question; the public listing doesn't ask it | BLOCKED |
| Partial cancellation | Locked | `participation.partial_cancel` locked; the route checks the switch first | Admin switch-on → **409 locked**; `POST /api/experiences/bookings/:ref/remove` → **404** "isn't available yet" | BLOCKED |
| Day-before reminders | Disabled | `featureOn` defaults to off; no API triggers the sweep | Switch absent in QA; the sweep does nothing while off (unit test) | BLOCKED |
| Make It Happen | Paused | `commerce.open_booking` off → 503 | `POST /make-it-happen/search` and `/confirm` → **503**; booking count unchanged (FINAL-SEC) | BLOCKED |
| Host questions | Disabled unless separately approved | `participation.host_questions` off → setting questions refused | Host PUT `/api/games/:id/questions` → **404**; no question stored | BLOCKED |
| Free bookings | **Candidate pilot scope** | Free and €0 orders never reach Stripe | Booking suites pass | — |
| Cash on arrival | **Candidate only: pending explicit commercial approval** | Existing cash path (confirmed, "due on arrival") | Existing suites | Commercial approval outstanding; not approved by default |

**Production-state verification:** **BLOCKED.** There's no authorised read-only production inspection mechanism in this session. The exact read-only checklist is in [15](15-pilot-operations-checklist.md) §6.

## 7. Partner service messages, and privacy wording for legal review
**Messages (verified):**
- **Organisation isolation:** another organisation's preview and send return 403 (FINAL-SEC, unit tests).
- **Recipients:**
  - only confirmed people on the partner's own listing, filtered by session or attendance;
  - previews show counts and first names only, never addresses;
  - "send me a test" goes only to the sender, and the reply masks the address (`q…@example.test`).
- **Templates, delivery and audit:**
  - unfinished templates are refused;
  - delivery status is per channel;
  - retries are capped at 3;
  - duplicates are prevented by an idempotency key;
  - the audit row `vendor_message.sent` holds counts only.
- **Policy:** no promotional messaging exists, and the consent policy wasn't changed. **Unresolved policy decision:** organiser messages have no opt-out key (treated as service messages about the person's own booking). That needs owner and legal acceptance.

**Privacy wording: change summary for legal review.** Not edited, not published, not approved.

| Location | Current text (summary) | Why it's outdated | Suggested direction (for legal to decide) |
|---|---|---|---|
| `client/src/pages/PrivacyPolicy.tsx` §2 "Club registrations" | "…and any medical information you choose to share so the club can look after your child safely." | Medical free text is no longer collected, and special-category questions are locked | Remove the medical clause, or reword per legal advice on the legacy notes |
| `PrivacyPolicy.tsx` §3 "Children's data" | "…name, date of birth, and any medical information relevant to their participation" | Same | Same |
| `server/src/policy/drafts.ts` (managed draft), "Club registrations" | Same medical clause | Same | Same |
| Both: not yet described | Registration questions set by the organiser (per booking and per attendee); attendee names in group bookings; door check-in records; organiser messages; day-before reminders (when enabled); team notes on bookings (staff-only); answer exports by authorised partner staff | New processing since the policy was written | Add purposes, recipients (the organiser only), retention, and the export and staff-access rules |
| Both | Retention of registration answers and of legacy medical notes | No periods set | Legal and owner decision (doc 18) |

**Data handling:** historical medical notes and registration answers were not deleted.

## 8. Test totals: final clean run on the working tree
*(See the next section, written from the actual run.)*

## 9. Suggested PR (not opened)
**Title:** `fix(participation): pilot remediation — no-show reporting, reminder reliability, stale browser tests, a11y focus`

**Description:**
```
Pilot remediation for the Irish web pilot (docs/participation-expansion/final-validation/14).

Fixes
- Reports: event attendance as bookings and as people from per-person evidence; "not recorded" is unknown; definitions in UI + CSV; per-listing units; no double-counted door check-ins (DEF-04, DEF-11).
- Reminders: keyset pagination, durable per-order claim, re-check before send, attempts vs sent, retry ×3, failures reported; no parallel scheduler (DEF-03). Switch stays off.
- ConfirmDialog: plain message on a dropped connection (DEF-10).
- Workspace date inputs keep a visible focus ring (DEF-09).

Tests
- 28 stale browser tests repaired to current behaviour (no assertions weakened); 2 vacuous checks fixed; BK-UI-MOBILE now runs.
- New: eventAttendance unit tests, reminder reliability (450 due, overlap, restart, retry), report no-show cases, pilot-restriction direct-API batch, keyboard/320px a11y sweep.

Not included / still required
- Legal: privacy wording (medical), retention, organiser-message consent. Commercial: paid bookings, VAT, cash on arrival. Ops: named organisations, DPAs, support rota, production read-only config check.
- Screen-reader review NOT TESTED (checklist in report 14 §5).

No restricted feature enabled; no production data touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
