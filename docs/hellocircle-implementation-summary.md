# HelloCircle implementation summary — OG-01 … OG-32

_2026-10-16, updated 2026-10-17 (final QA and release-readiness pass). **Local only**: branch `feature/commerce-engine`, nothing committed, pushed or deployed; staging and production
are untouched. Test numbers are from runs executed in this pass; see `hellocircle-qa-results.md`._

## Totals

| | Count | Items |
|---|---|---|
| Backlog items | 32 | OG-01 … OG-32 |
| Tested — server tests and/or real-stack browser runs executed and passed | **30** | OG-01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, **13**, 14, **15**, 16, 17, 18, 19, 20, 21, 22, 23, **24**, 25, 26, 27, 28, 29, 31, 32 |
| Tested on the server, UI partial | 0 | — (OG-24 Vendors and All listings switched to server pages on 2026-10-17) |
| Implemented, no dedicated test yet | 0 | — (OG-01, OG-13, OG-15 got browser specs on 2026-10-17) |
| Blocked — foundation only | 1 | OG-08 resident restrictions (D-07) |
| Not built by decision | 1 | OG-30 request-to-book (DEC-15) |
| Deferred | 0 | — |

Within "Tested": OG-29's erasure is recorded and answered but never executed (D-07, DEC-14) — and since 2026-10-17 an
erasure request can't be marked "completed". OG-22 is covered through the OG-26 browser journey.

The tracker (`hellocircle-implementation-tracker.md`) has the per-item files, backend, frontend, tests and blockers.

## Final QA pass (2026-10-17)

- **SANDBOX-SPLIT:** the stale QA transfer was documented, and the fix was a freshly provisioned disposable QA
  database. The spec now refuses up front when a partner already has transfers. The complete `qa:stripe` passed: 19/19
  batches, 51/51 tests.
- **OG-24:** the Vendors and All listings pages use numbered server pages. Status counts, filters, search, every sort
  and record links are all kept. New `server/src/adminListPages.ts`, and the records open by id.
- **New tests:** dedicated browser specs for OG-01, OG-13, OG-15, OG-19 and OG-24, plus a cross-tenant isolation spec.
- **OG-29:** an erasure request is never "completed" (server 409). It stays open with a reply, or it is declined.
- **OG-07:**
  - A changed MFA key now gives a clear error.
  - The server checks the key at boot, without printing it.
  - The key test runs in the isolated database.
  - The ops procedure is in the release-readiness doc.
- **Departures form:** the date, time and capacity inputs are now labelled.
- **Responsive check:** split into one test per width; it timed out on a slow machine as a single 600 s test.
- **Uninterrupted runs:** `qa:validation` 23/23. The other suites are in `hellocircle-qa-results.md` §C.

## Security decision (2026-10-17, Option A)

- **Order records** go to managers and finance.
- **Listing rosters** go to the two manager roles.
- **The Customers directory** goes to managers, finance and communications.
- **The read-only analyst** sees no customer personal data (Overview without names, CSV without contact columns).
- **Code:** `server/src/routes/vendorHelpers.ts` (role sets), gates in `vendorOperations.ts`, `vendorInsights.ts`,
  `vendorExperiences.ts` and `vendorPrograms.ts`. UI changes in `VendorCustomers.tsx`, `VendorDashboard.tsx` and
  `VendorOrg.tsx`.
- **Tests:** `vendorPiiRoles.test.ts`, `hc-pii-roles`, `hc-pii-ui` (with `pii-fixture.ts`).
- **Also new:** `hellocircle-commit-plan.md` and `hellocircle-staging-deployment-checklist.md`.

## What changed, by area

**Stability.** Linked partner/host accounts switch explicitly instead of locking out (OG-01). Every listed screen with a
silent failed load now shows an error with Retry, never an empty list; an editor whose record failed to load can't be
saved blank (OG-02). The isolated QA profile was restored and re-baselined; failing specs were fixed (OG-09).

**Marketplace safety.** Reports are acted on per type with the impact shown: hide a chat message (text kept), cancel an
activity (participants refunded through the existing path), suspend a listing (prior status kept, reinstate), against an
allow-listed set of target types (OG-03/32). Blocking time first lists the bookings it covers and makes the partner choose
keep or cancel+refund; creation re-checks under room locks (OG-04). Failed payouts and Pro past-due payments notify the
partner once and land in one admin exceptions inbox (OG-05/15).

**Admin.** Super-admin invitations (72h, single use), two-step sign-in for every admin with a 30-minute step-up on money,
suspensions, settings and destructive actions (OG-06/07). Operations directories for people, orders, activities, Circles
and hosts, with order cancel-on-behalf and propose-a-new-time (OG-10/14). Server paging for the audit log, directories, **Vendors and All listings** (OG-24). Privacy request queue and consent lookup; Maps switch (OG-29/31).

**Partner.** Venue-proposed time changes that move a booking only if the customer accepts (OG-11). Read-only All orders
(OG-13). Complaints about the organisation with one response (OG-17). Experience departures: weekly repeat, stop-sales
cut-off, capacity edit, move a booking the customer asked to move (OG-19). Customers directory, now server-gated by role
(OG-20). Monthly statement CSV of recorded orders, fees, refunds and payouts — not a VAT invoice (OG-25).

**Host.** Move an activity together with its venue booking (OG-12). Reservations page (OG-16). Circle moderation:
remove messages, mute, reported messages without reporters, history, announcements (OG-18). Activity series (weekly or
chosen weekdays to an end date; cancel remaining; apply edits to later dates) (OG-26). Join approval for free activities
and closing bookings (OG-27). Recorded money per activity, never netted (OG-28).

**Shared UI.** One action-menu implementation (OG-21). The activity form renders in the host shell from the workspace
(OG-22). Workspace data tables stack into labelled rows on phones; 11 pages verified at 9 widths (OG-23).

## Database changes (all additive, idempotent, in `initSchema()`; no down-migrations)

- New tables: `admin_mfa_recovery_codes`, `admin_invites`, `booking_change_proposals`, `resident_restrictions`,
  `privacy_requests`, `game_series`, `game_join_requests`.
- New columns: `room_blocks.group_id`; `chat_messages.hidden_at/hidden_by/hidden_by_kind/hidden_reason`;
  `circle_members.muted_until/muted_by`; `reports.action_taken`; `moderation_prior_status` on centres, clubs, experiences;
  `users.mfa_*`; `sessions.mfa_verified_at`; `games.series_id`, `games.join_mode`; `experience_sessions.sales_close_at`,
  `series_id`; `complaints.subject_vendor_id/subject_host_resident_id/partner_response/_at/_by`;
  `connected_payouts.failure_notified_at`; `partner_subscriptions.past_due_notified_at`.
- New dependency: `otpauth@9.5.1` (server, TOTP).

## Changed files (this pass)

New server modules: `adminDirectories.ts`, `adminInvites.ts`, `adminMfa.ts`, `bookingChanges.ts`, `bookingMove.ts`,
`financialExceptions.ts`, `hallBookingCancel.ts`, `privacyRequests.ts`, `reportModeration.ts`, `vendorStatements.ts`,
`venueClosures.ts`; routes `adminAccess.ts`, `adminOperations.ts`, `adminPrivacy.ts`, `bookingChangeRoutes.ts`.
Changed server: `db/index.ts`, `auth.ts`, `adminPermissions.ts`, `supportLookup.ts`, `notifications.ts`, `payments/connect.ts`,
`commerce/subscriptions.ts`, routes `admin.ts`, `adminFinance.ts`, `auth.ts`, `chat.ts`, `circles.ts`, `complaints.ts`,
`experiences.ts`, `games.ts`, `reports.ts`, `residents.ts`, `vendorExperiences.ts`, `vendorInsights.ts`,
`vendorListings.ts`, `vendorOperations.ts`, `tests/integration/seed.ts`.

New client: `api/adminAccess.ts`; components `CircleModerationTab`, `HostReservationsTab`, `PrivacyRequestRow`,
`ReportContentButton`, `VendorAllOrders`, `VendorBlockTimeDialog`, `VendorCustomers`, `VendorStatementCard`,
`admin/AdminMfa`, `admin/AdminOperations`, `admin/AdminPrivacy`, `admin/AdminTeamAccess`,
`workspace/BookingChangeParts`, `workspace/ComplaintsAboutYou`, `workspace/PersonalAccountGate`; pages
`AdminInviteAccept`, `BookingChangePage`. Changed client: `App.tsx`, `api/*`, `ActionMenu.tsx`, `ui.tsx`, `index.css`,
`admin/adminUi.tsx`, `admin/adminNav.ts`, `admin/admin.css`, `admin/AdminSettings.tsx`, `AdminDashboard.tsx`,
`AdminReviews.tsx`, `AdminSupport.tsx`, `AdminAudit.tsx`, `AdminFinance.tsx`, `AdminCommerce.tsx`, `AdminPolicy.tsx`,
`EarningsSummary.tsx`, `PayoutHistory.tsx`, `VenueSplitsCard.tsx`, `VendorOrg.tsx`, `ClubParticipantsTab.tsx`,
`VendorBookings.tsx`, `VendorExperiences.tsx`, `VendorCentreEditor.tsx`, `GameJoinCard.tsx`, `HostActivitiesTab.tsx`,
`HostCalendarTab.tsx`, `ChatModal.tsx`, `HostGamePage.tsx`, `ManageHome.tsx`, `ManageCircle.tsx`, `Profile.tsx`,
`irelandDate.ts`, `vendorTabAccess.ts`, the ~25 OG-02 screens, `packages/types`. New tests listed in the QA results.

**Final QA pass (2026-10-17) files.**
- **New server:** `adminListPages.ts`, `routes/adminListPages.test.ts`, `adminMfaKey.test.ts`.
- **Changed server:** `routes/admin.ts`, `adminMfa.ts`, `index.ts`, `privacyRequests.ts`, `privacyRequests.test.ts`.
- **Changed client:** `api/admin.ts`, `admin/adminUi.tsx` (`useUrlPage`), `admin/AdminVendors.tsx`, `admin/AdminListings.tsx`,
  `admin/AdminPrivacy.tsx`, `PrivacyRequestRow.tsx`, `VendorExperiences.tsx`.
- **New tests:** `hc-og01-switch`, `hc-og13-orders`, `hc-og19-departures`, `hc-og15-24-admin`, `hc-og-isolation` specs.
- **Changed tests:** `hc-og-features-ui`, `hc-og-responsive`, `stripe-sandbox-split`, `lifecycle-ui-fixture.ts` (`staffActor`),
  `run.ts` (5 batches).

The working tree also holds earlier uncommitted work from previous sessions (workspace redesign, header, homepage,
D-01…D-11); `git status` shows both together.

## Known limitations

- OG-08 restrictions and the deletion half of OG-29 are blocked (D-07, DEC-14).
- OG-27 approval is for free activities only; OG-26 series are address-based only (venue dates need their own booking).
- OG-21: buttons and inputs still come from two files (`adminUi.tsx` and `ui.tsx` with the workspace switch).
- OG-15 exceptions have no assignment/resolution state (no approved operating policy); resolution stays on the Finance record.
- The in-memory rate limiter and other pre-existing scale notes in `CLAUDE.md` are unchanged.
- Production must set `HELLO_CIRCLE_MFA_KEY` before deploying, or admin sign-in stops at "two-step not configured" (procedure in `hellocircle-release-readiness.md`).
- Partner staff of every role can read customer names/emails through the existing order lists (pre-existing; owner decision in `hellocircle-remaining-decisions.md`). Never across organisations.
- Pending approvals still loads the whole pending set (its review flow compares against it).
