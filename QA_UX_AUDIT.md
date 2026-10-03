# HelloCircle — UX, journeys, forms and states (Phase 10)

These are real browser journeys (Playwright Chromium, plus Chrome briefly) on the isolated exploration stack, using synthetic personas created through the real signup UI: resident Aoife, resident Niamh, host Cian, vendor Sinead, and the seeded admin. No production data or providers were used. Findings are listed only; nothing was redesigned or fixed.

## Phase B — user journeys

| # | Journey | Result | Notes / findings |
|---|---|---|---|
| 1 | Landing → Explore → activity → sign up → join → My Life → leave | **PASS** | The signup form validates and lands on My Life with a skippable 2-step setup. Join has a clear "Confirm your spot" dialog, and a double-click made exactly one row. My Life showed it under "Next up". Leave asks for confirmation ("Stay in / Leave session"). Issues: 079 (stale avatar, duplicate description, copy) and 069 (dialog focus). |
| 2 | Explore → Circle → join/request → plan → poll → chat → leave | **PASS with defects** | Open join is confirmed by a dialog (201). An approval request shows "Waiting on the organiser" with Withdraw (202). The organiser approves from Members, and the member gets an "Approved" notification. Circle plans are created via the activity form. Defects: duplicate poll on double-click (054), chat text lost on rapid send (055), members not notified of new plans (056), "Message Circle" doesn't open chat (057), polish (080). Leave Circle is present; not exercised. |
| 3 | Search → filter → map → detail → save → return → saved item | **PARTIAL** | Search and filters work and map UI hides cleanly (Mapbox disabled in isolation). Save/favourite was not exercised through to the Saved list. With the API failing, the list shows a false empty state (063). |
| 4 | Sign in → notifications → profile → settings → logout → login | **PASS (core)** | Keyboard sign-in works. Notifications are scoped correctly (another user's notification → 404). Logout and re-login were covered by the auth gate (20 PASS). Profile was visited; settings forms weren't exhaustively edited. |
| 5 | Free booking → confirmation → My Life → cancellation | **PASS (activity)** | A free activity join and leave covers this. Free hall booking and club registration are venue-gated in the UI; the booking gate covers them at API level (38 PASS). |
| 6 | Paid TEST booking → quote → checkout → confirmation | **PASS (gate)** | The Stripe test-mode gate passed 26/26, including desktop and mobile hosted-checkout journeys. Without a provider, the UI shows "Payments aren't configured yet" (understandable). The itemized quote showed €8 → €10.24 incl. VAT and fee. |

## Phase C — host journey

| Step | Result |
|---|---|
| Sign in | PASS |
| Create activity (2 steps) with Publish now / Coming soon / Draft | PASS. Step 1 validates inline ("What are you planning? Give it a name."). HTML in the description is safely escaped. Double-click on Create → one record. Each state gets an accurate confirmation ("You're live." / "Draft saved. Only you can see…"). |
| Save draft / preview / publish | Draft PASS. Publishing is only in Edit → STATUS (078). There's no preview, and no "View activity" link after creating (078). |
| Edit / add image | Edit works. A cover photo can be added from the confirmation and from Edit, but only by mouse (067), and resident hosts can't upload at all without R2 (062). |
| Participants / waitlist / post update / cancel / archive | Manage row actions are present: Participants, Share, Duplicate, Check-in, Edit, Post update, Cancel. Their behaviour is covered by the lifecycle gate (52 PASS). Archive is API-only (existing product gap). |
| Share | Published items: OK. Draft: infinite spinner (053). |
| State clarity (draft / coming soon / live / full / cancelled / past / archived) | Badges for Draft, Coming soon, Open and Almost full are visible. "Almost full" appears at 1/3 joined (078). Past and Cancelled appear via filters. Dates show as ISO (078). Overall a host can tell the state, but the actions available per state aren't tailored. |

## Phase D — vendor journey

| Question | Answer |
|---|---|
| Can a vendor sign up? | Yes with a mouse; **not by keyboard or screen reader (052, P1)**. Double-submit safe. |
| Do they know they're approved? | **No.** There's no acknowledgement or approval email (058). |
| Understand what to do next? | Yes. The Overview checklist is clear ("2 steps left… Add a cover photo, Set your room capacity"). Checklists differ between Overview (8 steps) and My centre (3) (081). |
| Create programme / experience? | Yes. The programme form is unlabelled for screen readers (068). The experience 6-step wizard is clear, but resumed drafts and the settings view show wrong price/duration (061). Departures are added after admin approval, and the wizard explains this. |
| Find bookings / today's activity / capacity / payment status? | Bookings tab filters (All / Confirmed / Cancelled / Upcoming / Past, list/calendar) and Calendar "Today / Next 30 days" exist with good empty states. Booking detail rows are mouse-only (066). Capacity shows per programme and departure only partially: departure rows lack booked/capacity (081). Payment and refund status were verified by the Stripe gate (refunds 4/4). |
| Correct mistakes? | Listings and the experience can be edited. Programme session and departure rows show no edit/cancel affordance (081). |
| Is the listing live? | The dashboard says "Live", but the public can't open centre or club pages (059). |

## Phase E — UX audit (heuristics)

- **Purpose and primary CTA:** clear on every major screen visited, e.g. "Find something", "I'm in", "Join Circle", "Create session", "Continue setup".
- **Hierarchy:** generally good. Weak spots:
  - Manage activity rows give seven equal-weight buttons (078).
  - The activity detail repeats the description (079).
  - The Circle page has an empty "Moments" section (080).
- **Dead ends and misleading controls:**
  - Draft Share spins forever (053).
  - "Message Circle" doesn't open chat (057).
  - Footer "Community centres", "Sports clubs" and "Clubs" lead to `/coming-soon` (059).
  - The Apple button is a placeholder (082).
- **Feedback:** confirmation dialogs for join, leave and Circle join are good. Toasts and inline errors are present, but not always announced (083).
- **Consistency:**
  - Terminology varies: "session", "plan", "activity", "game" all describe the same object (e.g. "Join a session", "Host a session", "OPEN PLAN", "games & sessions nearby", "/games").
  - Brand name varies between "Hello Circle" and "HelloCircle" (087).
- **Modal overload:** the setup popup reappears on every page until skipped; acceptable as designed, but noticeable.

## Phase F — form QA

| Form | Required / validation | Labels | Double submit | Notes |
|---|---|---|---|---|
| Resident signup | Submit disabled until name, email, password ≥8 and terms; server errors in `role=alert` | Correct (`htmlFor`) | Safe (1 account) | No hint why the button is disabled (082) |
| Vendor signup | Disabled until complete | Correct except type tiles | Safe (1 user, 1 centre) | 052 |
| Host activity (2 steps) | Inline first-error message; past date blocked (HC-QA-032) | Step 1 inputs have ids but are not all associated; step 2 unlabeled (068) | Safe | Special characters and HTML escaped on output |
| Circle start | Name required | Unlabeled (068) | Safe | "+ Add more detail" does not submit early (verified) |
| Circle poll | Question + ≥1 date | Inline | **Unsafe: duplicate poll (054)** | No error handling |
| Plan idea | Title | — | Same pattern as poll (unverified) | — |
| Programme create | — | Unlabeled (068) | Safe (1 programme) | Single listing still needs "— choose —" |
| Programme session add | Date, time | Date/time unlabeled | — | — |
| Experience wizard | Per-step save | Correctly labelled | Publish has confirm dialog | 061 display defect |
| Chat composer | Non-empty | Placeholder | Sends are serialised | **Loses text typed during a send (055)** |
| Profile, staff, rooms, booking (hall/club) | — | — | — | Not exhaustively exercised in the UI. Booking/staff validation covered by booking and authorization gates (e.g. HC-QA-035/036 negative/fractional inputs fixed) |

Long text: a 1,200-character chat message was stored intact. Emoji and `<script>` were stored and rendered as text. Paste and min/max limits beyond these weren't systematically fuzzed.

## Phase G — empty states

| Screen | Explains what / why / next? |
|---|---|
| My Life (new account) | Yes: "Make HelloCircle yours" with 01 interests, 02 availability, 03 first plan |
| My Life after leaving the only activity | Yes (falls back to the setup steps) |
| Vendor Programs / Experiences / Bookings / Calendar | Yes ("No programs yet — Create one above.", "Nothing scheduled today") |
| Circle with no plans | Partly: correct for visitors, but members still see "Join the Circle…" (080) |
| Polls / Planning | Yes ("No polls yet — Propose a few dates…") |
| Manage Circle Members (just the organiser) | Yes ("It's just you for now. Invite a few people…"), but it doesn't mention a pending request shown just above |
| Admin pending (nothing waiting) | Yes ("All caught up!") |
| Experience departures | Explanation + Add departure (no explicit "none yet" line) |
| Activity list with API failure | **No: shows a false empty state (063)** |

## Phases H / I — loading and error states

The API was mocked (500, network timeout, 4 s delay) on `/games`, `/circles/:id`, `/games/:id` and `/my-life` at 390 px:
- **Loading:** skeletons on lists and My Life, spinners on details. No blank screens or infinite spinners in these flows (except the Share sheet, 053).
- **Errors:**
  - Detail pages show friendly "We couldn't load this … Try again" with a way back.
  - `/games` shows a false empty state (063).
  - `/my-life` shows a contradictory signed-out prompt (064).
- **Leakage:** none. Mocked error bodies containing SQL, stack and path text were never displayed (no stack traces, SQL, paths or provider errors).
- **404:** unknown activity and Circle IDs show friendly not-found states; unknown routes show the NotFound page (HTTP 200, 086).
- **Other statuses:** 401 on protected pages redirects to login. 403 and 409 behaviour is covered by the authorization and booking gates.
