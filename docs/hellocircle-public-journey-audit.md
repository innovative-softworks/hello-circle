# HelloCircle — Public Journey Audit

**Date:** 2026-10-21 · **Branch:** `feature/workspace-detail-pages` @ `315f0d2` · Audit only.

**Safety limits.** The only safe environment available was Vite → dev API `:3301` → `hello_circle_dev`. (The API on `:3001` holds connections to the prod-designated `hello_circle` database and was not used.) The dev API has real SMTP configured, so **no sign-up, booking, join, save, or payment was submitted** — every non-GET request was aborted. Signed-in pages were viewed with one temporary session row for the seeded demo resident `demo-resident-6` (a Verified Host), deleted afterwards. Steps that need a write are marked **unverified here** and, where available, linked to the prior QA run (`docs/hellocircle-qa-results.md`, isolated Docker DB + Stripe TEST, 2026-10-16..19, before commit `315f0d2`).

Legend: ✅ verified in browser · 🟡 code-inspected only · 🔵 prior-QA pass · ⛔ broken · ⚠️ confusing.

---

## Journey A — Find and book an activity
**Route sequence:** `/` → hero search → `/explore?q=…` → `/games/:id` → "Sign in to join" → `/signin?next=…` → back to `/games/:id` → Join (free) or Pay → Stripe Checkout → `/payment/success?…` → `/my-life`.
**Steps:** 7 for a paid activity (search, open, sign in, join, pay, confirm, view). 5 for a free one.

| Step | Result |
|---|---|
| Home search → Explore results | ✅ (`/search?q=hike` → `/explore?q=hike`, 2 matches) |
| Results list | ✅ but ⚠️ first result below the fold at 390px (PUB-18); programme sessions shown as separate cards (PUB-17) |
| Activity detail | ✅ host, verification, price, spots, location, mobile join bar |
| Join requires sign-in | ✅ "Sign in to join" — guests can't join activities (residents only, by design: `games.ts` `requireResident`) |
| Join / paid join / waitlist | 🔵 `booking-activity.spec`, `lifecycle-activity-participation.spec` |
| Stripe Checkout → confirmation | 🔵 `qa:stripe` 51/51; ⛔ tab title "Payment confirmed" in every state (PUB-04) |
| My Life shows the activity | 🟡 rendered for demo resident, but "Coming up" didn't appear in this account (PUB-08 — cause not traced) |

**Broken:** PUB-04. **Confusing:** results position, duplicated programme cards, "plan/session/activity" wording (PUB-20). **Unnecessary steps:** none — sign-in before join is a rule. **Permissions:** correct (join is resident-only server-side). **Error recovery:** a removed activity shows "couldn't load… Try again" instead of "no longer available" (PUB-14).
**Improve:** results in screen 1; one card per programme; outcome-specific confirmation title; "Coming up" in My Life.

## Journey B — Join a Circle
**Route sequence:** `/circles` → `/circles/:id` → "Sign in to join" → join (open) or request (approval) → member view → Upcoming plans / Planning / Polls → join a plan (an activity) → chat.
**Steps:** 4 to membership (browse, open, sign in, join).

| Step | Result |
|---|---|
| Circles list | ✅ 12 Circles, search, filters |
| Circle detail (visitor) | ✅ join card, about, organiser, members count |
| Join / request / leave | 🔵 `lifecycle-circle-membership.spec`, `join-visibility.spec` |
| Member view | ✅ (`demo-circle-2`, `demo-circle-6`) ⚠️ status, Message, Leave, Planning, Polls are ~2,300px down at 390px (PUB-30) |
| Planning / polls / plan → activity | 🔵 `lifecycle-circle-planning.spec`, `lifecycle-findings-polls-states.spec` |
| Circle chat | ⛔ when `/chats` is opened directly it shows the provider view and no chats (PUB-06); chat from inside the Circle page is 🔵 `chat-closure.spec` |
| Organiser management | ✅ `/manage/circles/:id` renders for the organiser |

**Broken:** PUB-06. **Confusing:** member-first content order; "5 Circles active" vs 3 listed in My Life (PUB-08). **Permissions:** organiser/member roles enforced server-side (promote/demote/mute/remove routes in `circles.ts`). **Improve:** member-first layout with anchor tabs; fix Chats initial view.

## Journey C — Book a venue
**Route sequence:** `/browse/centres` → `/centres/:id` → "Check availability" → `/book/:id` step 1 Room → 2 Date & time → 3 Details → 4 Review → Stripe (or free/cash) → `/payment/success` → My Life.
**Steps:** 8.

| Step | Result |
|---|---|
| Reachability | ⛔ **Not reachable in the current launch configuration**: `VITE_VENUE_PAGES_PUBLIC` unset → every venue route redirects to `/coming-soon` (PUB-09). Inspected by opening the gate in an audit-only Vite instance. |
| Venue list + map | ✅ (gate opened) 20 centres; ⚠️ unnamed icon buttons, unlabelled selects (PUB-15) |
| Venue detail | ✅ rooms, facilities, reviews, "Check availability", mobile bar |
| Step 1 Room | ✅ three rooms with capacity and hourly rate |
| Steps 2–4, deposit, Stripe | 🔵 `booking-centre.spec`, `booking-findings-*.spec`, `qa:stripe` |
| Confirmation | 🔵; PUB-04 applies |

**Data issue:** none in flow. **Improve:** room cards on the venue page should open the flow at step 2 with that room preselected (saves a step for multi-room venues). **Decision needed:** whether venues launch publicly.

## Journey D — Join a programme
**Route sequence:** `/programs` → `/programs/:id` → Enrol (popup: participant, contact, coupon, quote) → Stripe → `/payment/success` → My Life.
**Steps:** 5.

| Step | Result |
|---|---|
| Programmes list | ✅ (1 programme on dev) |
| Programme detail | ✅ sessions, spots, price "for the whole program", mobile Enrol bar |
| Enrol popup + quote | 🟡 not opened (would POST a quote); 🔵 `booking-program.spec` |
| Payment + confirmation | 🔵 `qa:stripe`; PUB-04 |
| Cancel enrolment | 🔵 self-cancel via `cancelProgramEnrollment` |

**Confusing:** a programme that "Starts Tue 20 Oct · 19:00" is still enrollable on its start day with no note about missed sessions or pricing (PUB-17 — decision); "Enroll"/"program" spelling. **Improve:** "Already started — N of M sessions left" label once the late-join rule is decided.

## Journey E — Discover and save
**Route sequence:** `/explore` → filters → detail → Save (heart) → `/profile?tab=favourites` → revisit.
**Steps:** 4.

| Step | Result |
|---|---|
| Filters | ✅ quick chips (Needs people, Free, Outdoors, Social, Sports), Filters panel, sort |
| Save button | ✅ present on activity, Circle, experience, programme, centre ("Add to favourites") detail pages and on cards; saving is a POST — 🟡 not executed |
| Saved list | ✅ renders; ⚠️ empty state says only centres/clubs can be saved (PUB-21); statuses All / Interested / Planning / Joined exist (`Profile.tsx:334-337`) |
| Header heart icon | ✅ present for residents |
| Guests | ⚠️ Save needs sign-in — not stated until tapped (🟡) |

**Improve:** consistent "Save/Saved" label; correct empty copy; footer "Saved" link works only signed in (expected).

## Journey F — Become a host
**Route sequence:** `/become-a-host` → "Become a host" → sign in → `/games/host` (create a session) — hosting needs no approval; optional **Verified Host** application in `/profile?tab=hosting` → admin decision → badge (and paid hosting) → `/manage`.
**Steps:** 3 to a first free session; 5+ to verified.

| Step | Result |
|---|---|
| Landing | ✅ ⚠️ FAQ says payments need a provider account; product lets Verified Hosts charge directly (PUB-11) |
| Create session form | ✅ (signed in) 2 steps: basics, details; venue booking link option |
| Verified Host application | ✅ tab renders; ⚠️ 2 unlabelled fields (PUB-15) |
| Approval | 🔵 admin decision with reasons (D-03 specs) |
| Host workspace | ✅ `/manage` Overview, Circles; "Manage your hosting" link from My Life |

**Improve:** correct the paid-hosting claim; show application status (pending/approved/rejected with reason) at the top of the Hosting tab — 🟡 confirm current behaviour.

## Journey G — Register as a vendor
**Route sequence:** `/for-venues` → "List your venue" → `/vendor/signup` (account → listing intake, one transaction, no session) → admin approves account → `/login` → `/vendor` → complete & publish listing → admin approves listing.
**Steps:** 6 including two admin waits.

| Step | Result |
|---|---|
| Landing | ✅ ⛔ shows "launches soon… Notify me" banner even in public mode (PUB-10) |
| Signup step 1 | ✅ name, email, password, Google |
| Step 2 + submit | 🔵 `lifecycle-*`, `hc-completion-*` specs |
| Pending state | 🟡 vendor can't log in until approved (by design; `/signup` sets no session) — confirm the post-signup screen explains this and the expected wait |
| Approval, listing lifecycle | 🔵 `hc-d03-*`, lifecycle specs |
| Pricing | ✅ `/pricing` says fees are being finalised — honest, pending decision |

**Improve:** remove pre-launch banner after launch; post-signup "what happens next" timeline; clear cross-link between `/signin` (residents) and `/login` (business) (PUB-35).

## Journey H — Manage a booking
**Route sequence:** `/my-life` → "View full activity — bookings, references and history" → expand a booking → Cancel (if before the deadline) → ConfirmDialog → status "Cancelled / refund pending" → `/receipts/:ref` (paid).
**Steps:** 4.

| Step | Result |
|---|---|
| Find the booking | ✅ section exists; demo resident has no bookings → list not visible with data 🟡 |
| Booking detail | ⚠️ no booking page; experience/programme rows open the **listing** (PUB-12) |
| Cancel | 🔵 `booking-remediation-cancel.spec` (self-cancel window, refund-once path, activity-on-booking 409) |
| Receipt | ✅ page renders (signed-out: sign-in prompt) |
| Guest booking lookup | ✅ "Find a booking" button for email+ref lookup |

**Error recovery:** cancel errors stay in `ConfirmDialog` (`ui.tsx` async confirm). **Improve:** booking record page with policy, deadline, receipt, cancel and calendar in one place.

---

## Cross-journey blockers (summary)
| Blocker | Journeys | Gap |
|---|---|---|
| Legal pages unpublished / placeholder | all paid journeys, sign-up | PUB-01, 02, 03 |
| Confirmation title states payment confirmed regardless of outcome | A, C, D | PUB-04 |
| Venue/club journeys gated off | C, (Home chips) | PUB-09 |
| Chats direct-load bug | B | PUB-06 |
| False session-expired alert | H (guests), E | PUB-05 |
| No booking record page | H | PUB-12 |
