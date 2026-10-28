# Trust & Retention 06 — Your next plan → attend → review → go again / follow

Local, 2026-10-28. Uncommitted, not pushed, not deployed. Builds on 01–05.

## The journey

1. **Your next plan** (top of My Life, `/my-life`). The nearest *commitment*: a confirmed booking, a free Circle
   meetup RSVP, a place held while payment finishes, or a join request waiting for the host. A waitlist place or
   interest in a Circle plan is **never** the next plan — it is listed under "Not booked yet" with a label that says
   so ("On the waitlist — not a place yet", "Interested — not a booking"). Cancelled plans stay visible as cancelled.
2. **Prepare / on the day.** Before the day the card leads with what to bring, arrival, who welcomes newcomers and where
   to meet; on the day (Ireland date) the order is place first, plus a Directions link. Only what the organiser entered is
   shown; nothing → "The organiser hasn't added preparation notes yet." Hall bookings get a **Get ready** block on the
   booking page (`VenueGetReady`) from the venue's own facts (arrival person, hours, accessibility, facilities).
3. **Attend → confirmed.** Unchanged from 04/05: person-level confirmation only.
4. **One review invitation** (in-app only, no email). Scheduled when attendance is confirmed; sent once the occurrence has
   ended (unknown length → end of that Ireland day). One row per person per occurrence (`UNIQUE` key; concurrent calls
   make one). Skipped if the preference is off or the person already reviewed. Withdrawn/no-show → the invitation is
   voided and its notification rewritten to a neutral "attendance record changed"; restoring never re-sends.
   Sweep: every 5 minutes in `server/src/index.ts`, plus immediately when the visit has already ended.
5. **Recent visits** (finished commitments, last 14 days): attendance state, one main action (Write a review / Ask the
   organiser to confirm / See your booking), **Go again** and **Follow**.
6. **Go again** = the next published, open, publicly visible, bookable occurrence with places left of the *same* game
   series or the *same* experience; a hall → "Book <venue> for another time". Never guessed from similar names, never
   books automatically. Nothing → "No next date yet — follow X to hear when there is."
7. **Follow** reuses `follows`. Any host with public activity (or an open Circle) is followable, not only verified hosts;
   you can't follow yourself (incl. your own vendor org/centre). Levels now change delivery: *Highlights* = new activities;
   *Everything* = also later dates added to a series.

## Child registrations (decision needed)

A club registration for a child (`registrant_type <> 'adult'`) never gives the account holder "Verified attendance", a
review, or a review invitation, even if the club records attendance. The review form says: feedback from parents and
guardians isn't available yet; use Complaints & appeals for a problem. **Owner decision needed:** whether to add a
separate, labelled guardian-feedback route. Programme enrolments can also be for a child (`participant_name`/`dob`);
they stay confirmable only by explicit person confirmation — revisit with that decision.

## Data changes (additive)

- New table `review_invitations` (unique per resident + occurrence, status scheduled|sending|sent|skipped|void).
- New notification kind `review_invite`; new preference `reviewInvites` (default on, Notification settings → You choose).
- `review_claims` key now computed in Node (`server/src/reviewClaimKey.ts`) — MySQL 9 removed `SHA1()`.

## Main files

Server: `myLifePlanRules.ts` (pure ordering/phase/Ireland-time rules), `myLifePlans.ts` (`GET /api/my-life/plans`,
go again, invitations), `reviewEligibility.ts`, `routes/reviews.ts`, `routes/attendanceCorrections.ts`,
`reviewAttendanceFlags.ts`, `routes/follows.ts`, `routes/games.ts`, `notifications.ts`, `db/index.ts`, `index.ts`.
Client: `components/mylife/NextPlan.tsx`, `components/trust/VenueGetReady.tsx`, `AfterYourVisit.tsx`,
`AttendeeConfirmPanel.tsx`, `AttendanceRequestsPanel.tsx`, `trust.css`, `FollowButton.tsx` (`quiet`), `Reviews.tsx`
(`followAfter`), `pages/MyBookings.tsx`, `BookingDetailPage.tsx`, `GameDetail.tsx`, `ExperienceDetail.tsx`,
`NotificationSettingsPage.tsx`, `notificationLink.ts`, `api/trust.ts`; `packages/types`.

## UI/UX pass (same day)

My Life leads with "Your next plan" on every width; booked plans are no longer listed twice (they're the cards in
"Your next moments"); recent visits are a two-column row (state + one action | Go again + quiet Follow), stacked on
phones. Partner panels use the workspace tab control and compact buttons with status tags. Booking page "After your
visit" leads with the status instead of repeating the title.

## Tests

- Server: `myLifePlanRules.test.ts` (DST, Ireland day boundaries, ordering), `routes/myLifeJourney.test.ts`
  (statuses, cross-account isolation, invitations: once/concurrent/preference/already-reviewed/withdraw/restore,
  go again skipping cancelled/private/full/same-name, follow self/levels, child registration, and the verification
  evidence restriction via an isolated permission fixture). Full suite: 135 files, 1234 passed.
- Client: 341 passed; production build OK; `qa:check` 97 passed.
- Isolated QA (`npm run qa:trust`, Docker MySQL, no real email/payments): trust-admin, trust-venue, trust-confirm and the
  new **trust-journey** (1280/820/390, keyboard settings switch, dialog focus/Escape) all pass.

## Gaps

- No series-level follow: series are created in one go and can't be extended, so following the host covers it.
- Guardian feedback route (above). Recent window is fixed at 14 days. Invitations are in-app only by design.

## Card style (owner request, same day)

"Your next plan" uses the approved C · title-on-photo card with the photo beside it (stacked on phones); "Not booked
yet" and "Recent visits" use D · compact rows (`CompactRow`) with the date on the photo and the shared label colours.
Recent visits show 3, then "Show all N". Photos come from the activity, else its Circle, else its venue (server
`imageUrl`); none → the green panel with the activity icon. No hover zoom (no page animations).

**v2 after owner review (same day):** the tall title-on-photo card left an empty band and wrapped long Circle names, so
the next plan is now photo (full card height, only a date chip on it) + details: kicker with time and length, the title
as the heading, status chip / host / Circle, a two-column facts grid, and the actions. "All plans" is a text link.

**v3 — horizontal pass (owner, same day):** the next plan is a horizontal boarding pass (`NextPass` in
`components/mylife/NextPlan.tsx`, `boardingPass.css`): kind-coloured spine, status pill, title, Date | Time | Where |
Admit columns, organiser / bring / newcomers, meeting point, actions, then a perforated stub with the check-in code
(activities: `HCG:` code; bookings: the reference; nothing while not a place). Same kind colours and tones as the booking
page passes (`pass.css`; `useCodeSvg` and `KIND_LABEL` now exported from `Pass.tsx`, the shared component is unchanged).
Stacks on phones with the stub underneath. "After that" (up to 3 compact rows) sits below.

**Booking page v2 + shared pass (owner, same day):** the horizontal pass is now a shared component
(`components/pass/BoardingPass.tsx` + `boardingPass.css`) used by My Life and `/bookings/:kind/:ref`. The booking page
(`BookingDetailPage.tsx`, `pages/bookingDetail.css`) shows the pass with Add to calendar / View / Directions, then Get
ready and After your visit; a "Your booking" side panel holds payment, reference, cancellation policy, receipt, Back to
My Life and the quiet Leave/Cancel link (same confirm dialog). Past bookings get a "Completed" stamp, cancelled ones
"Cancelled". The pass lays itself out by its own width (CSS container query): horizontal when there's room, stacked with
the stub underneath when narrow — checked at 1280/1024/768/600/375/320 with no sideways scroll from these parts.
`ConfirmationPanel` (checkout success pages) and the original wallet/ticket/lanyard passes are unchanged.
