# HelloCircle: complete operational gap analysis

_2026-10-16 · audit only, no code changed · branch `feature/commerce-engine` working tree (146 uncommitted files)._

**Evidence levels:**
- **CR**: code-reviewed this session (file:line given).
- **PR**: proven by an earlier recorded test run. That run was on earlier code; nothing was re-run here.
- **NV**: not verified.

**Nothing in this document was live-tested.** The isolated QA profile is missing (`qa:preflight` fails), and reusing
stored dev sessions was refused by the session safety check. **Every scenario verdict below is "unverified live".**

---

## 1. Executive assessment

The earlier "22 covered / 24 partial" count measured pages. Measured by **operational actions**, all three workspaces
have real holes.

| Workspace | Verdict | Why |
|---|---|---|
| **Super Admin** | **Not operationally complete.** It can govern partners, listings and money. It **cannot act on residents, bookings, activities or chat content**. | Report "suspend" only works for Circles and reviews (`routes/admin.ts:1181-1192`). It is a no-op for chat messages, activities and listings. There is no admin cancel or reschedule of any order, only a Finance refund (`adminFinance.ts:175`). No resident restriction (D-07). No admin invite, no MFA, no privacy-request workflow, no alert on payout failures. |
| **Vendor** | **Mostly complete for hall and club bookings; partial elsewhere.** | Closures and blocked dates ignore existing bookings and are whole-day only (`vendorListings.ts:556-568`). The vendor can't reschedule a booking; only the customer can (`bookings.ts:687`). Experiences have single departures, no repeat and no sales cut-off. Order types are split across three tabs. No statements. No notice when a payout fails or Pro payment fails. Complaints about the vendor are never routed to them. |
| **Host** | **Complete for free activities. Gaps in the paid + venue journey and in community moderation.** | A linked partner+host can't open `/manage` (`ManageHome.tsx:110`). A venue booking linked to an activity can't be rescheduled by the host (guest reschedule returns 409 when an activity is linked). No Reservations view. No recurring activities. No join approval for activities. Circle chat can't be moderated (report only). No profitability view (by design until rules are approved). |

There is no P0 data-corruption or security hole in workspace code. Server-side ownership and role checks hold on every
write route reviewed. The paid launch stays blocked by D-04 / D-09 (commercial model), which is outside this audit.

## 2. Page inventory (existing + missing)

**Existing pages:** the full list is in `workspace-page-inventory.md`.
- Admin: 20 tools, about 45 sub-sections, 14 record types.
- Partner: 12 tabs, 4 editors, 2 plan pages, 4 account-state pages, sign-up and invite acceptance.
- Host: 8 tabs, the Circle manage page, create/edit activity, 2 plan pages and the check-in screen.

**Missing pages** (all reuse existing data unless marked "new data"):

| Workspace | Missing page | Notes |
|---|---|---|
| Admin | People directory + person actions | The person record exists (Support). Actions need D-07. |
| Admin | Orders directory (all 6 order types) | `supportLookup.ts` normalises them |
| Admin | Activities (games) directory + activity record with admin actions | No admin view of games beyond search |
| Admin | Circles directory | Search only |
| Admin | Hosts directory | Applications queue only |
| Admin | Exceptions inbox (failed refunds, failed payouts, parked events, payment reviews, Pro past-due, unresolved complaints) | Pieces exist in Finance and Overview; failed payouts and past-due aren't surfaced |
| Admin | Admin invitations | New data (`admin_invites`) |
| Admin | Privacy requests (export / erasure queue) | New data; D-07 |
| Partner | All orders | `/vendor/orders` already covers 4 types |
| Partner | Customers (promoted) + customer record (history across order types) | Participants list exists |
| Partner | Statements (monthly, downloadable) | Data in ledger / `payment_records`; switch-dependent |
| Partner | Complaints about my business | Complaints are admin-only today |
| Host | Reservations | `GET /games/host/venue-bookings` exists |
| Host | Activity series (recurring) | New data |
| Host | Complaints about my activities | as Partner |

## 3. Missing functionality inside existing pages (actions)

**Super Admin**
1. Order record: **cancel on behalf** (with automatic refund through the existing provider-cancel path), **reschedule**
   and **contact the customer**. Today it can only refund (CR `adminFinance.ts:175`).
2. Report case:
   - "Suspend content" for **chat messages, activities (games) and listings** does nothing. Only Circle → closed and
     review → hidden are implemented (CR `admin.ts:1186-1192`).
   - Report `targetType` is accepted unvalidated (CR `reports.ts:19`).
3. Activity (game) moderation: **cancel a harmful activity** with participant refunds and notifications. No admin
   route exists for games or Circles outside the report flow (CR).
4. Resident: **restrict, suspend, reinstate** (D-07).
5. Finance:
   - Failed payouts are stored with status (`connect.ts:710,768`), but nobody is told and there's no retry or contact
     action (NV in UI).
   - Pro `past_due` sends no notice (CR: no notify call in `subscriptions.ts`).
6. Governance:
   - **No admin invitations and no MFA** (CR: no totp or mfa anywhere).
   - **No data-retention job** (CR).
   - The Maps switch has no UI.
   - Consent records have no viewer.

**Vendor**
1. **Closures and blocks:**
   - Creating a block doesn't check existing bookings, warn about them or offer to cancel and refund them.
   - Blocks are **whole-day only** (`time` is always NULL, `vendorListings.ts:565`).
   - So "maintenance 2–4pm" isn't possible, and a closed day can still hold paid bookings.
2. **Vendor reschedule** of a hall booking or registration (only the guest route exists, `bookings.ts:687`).
3. **Booking requests** (accept/reject before charging): every booking is instant (CR: no request status).
   **Decision**: may not be wanted.
4. **Experiences:**
   - Create repeating departures (programmes have repeat; experiences don't).
   - Close sales or registrations for a departure.
   - Move a booking to another departure.
5. **No-shows:** the endpoint supports present/no_show on bookings, experiences and programmes (CR
   `attendanceState.ts:27`). There is no no-show *policy outcome* (fee, strike), which is a **decision**.
6. **Money:**
   - No downloadable statement or VAT invoice for platform fees.
   - No partner notice on a failed payout or a Pro payment failure.
   - Dispute notice to the partner is NV.
7. **Complaints** about the business: no visibility, no response path.
8. **Customer record:** no per-customer history across order types, and no "message this customer" except the
   broadcast or the mailto link in the booking record.

**Host**
1. Open `/manage` while also signed in as a partner (WA-01).
2. **Reschedule an activity that has a linked venue booking.** The guest reschedule of the booking is blocked (409) once
   an activity is attached, and there is no combined "move activity + booking" action. The host must cancel both.
3. **Recurring activities** (weekly series). There is none for games; Circles have plans, but those are one-off games.
4. **Join approval** for an activity (Circles have `join_mode = approval`; games don't).
5. **Close sales** or registrations before the start.
6. **Circle chat moderation:** remove a message or mute a member. Report only (`chat.ts:309`).
7. **Announcements** to a whole Circle as a dedicated post type. Chat and plans exist; there is no pinned or
   organiser-only notice (NV).
8. **Profitability:** ticket revenue vs venue cost per activity. Show stored amounts only; no new calculations until
   rules are approved.

## 4. Missing workflows (journeys that can't be completed end to end)

| # | Journey | Where it breaks |
|---|---|---|
| W1 | Vendor closes a room for maintenance on a day with bookings | Block saves; bookings stay live; customers aren't told |
| W2 | Vendor moves a customer to another slot | No vendor reschedule |
| W3 | Host moves a venue-based paid activity to another day | Booking locked by the linked activity; cancel + rebook only |
| W4 | Admin removes abusive chat content or a harmful activity | Report "suspend" is a no-op for those types |
| W5 | Admin stops an abusive resident | No lever (D-07) |
| W6 | Partner learns a payout failed and fixes the bank details | No notice; status only |
| W7 | Partner's Pro payment fails → grace → downgrade | Happens silently |
| W8 | Customer complains about a booking → partner responds | Complaint stays admin-only |
| W9 | Linked partner+host switches to hosting | Bounced to `/vendor` |
| W10 | New finance or support admin joins the team | Database seeding only |
| W11 | Resident asks for erasure | Self-deactivate + export only; no erasure workflow (D-07) |
| W12 | Host runs a weekly paid session | Must create each date by hand |

## 5. Missing UX/UI

- **Failed loads (WA-03):** 25 load calls have no error state, so the screen hangs or shows empty.
  - Partner: Offers, Reviews, Programmes, Experiences, Org.
  - Host: Circles, Earnings, Insights, Offers, Reviews.
  - Both check-in screens, the centre editor blocks, and Admin Media/Policy versions.
  - Silent empty lists hide host join requests and the rooms in Block time.
- **Duplicated kits (WA-17):** two separate component sets (menus, modals, empty and error states).
- **Not yet restyled:** `/games/host`, `/manage/circles/:id`, centre Rooms/Hours/Blocks, club Sessions/Waitlist.
- **Missing dialogs:**
  - Block time → "N bookings affected: cancel & refund / keep" confirmation.
  - Reschedule (vendor, host, admin).
  - Admin cancel-on-behalf with a reason.
  - Remove chat message.
  - Resident restriction with a reason (D-03 pattern).
- **Missing filters:** an order list by type, status, date, payment and listing (partner + admin); failed payouts in
  Finance; complaints by subject.
- **Missing detail views:** customer record (partner), activity record (admin), payout record (failed payout, with
  next steps).
- **Missing feedback:** notifications for payout failed, Pro past-due, block conflicts, a complaint received.
- **Responsive:** workspace tables only scroll sideways. No stacked mobile rows. Not measured at 320–1920 (NV).
- **Kept as is:** 8px workspace radius, no side drawers, records as pages, popups for short forms, popovers for row
  actions.

## 6. Backend and data gaps (no invented structures; each item says new or existing)

| Gap | Existing pieces | Needed |
|---|---|---|
| Block vs bookings conflict | `room_blocks`, `bookingIntegrity.ts` overlap helpers | Pre-check endpoint (bookings on date/room) + optional cascade through `providerCancelRefund.ts`; a `time`/`end_time` range on blocks (the `time` column exists but is unused) |
| Vendor/admin reschedule | Guest reschedule with a row-locked double-book check (`bookings.ts:687`) | Partner/admin route reusing the same check + notify |
| Host move activity + booking | `venueBookingProblem()`, guest reschedule, game edit | One transaction moving both, or explicit unlink/relink |
| Admin cancel order | `providerCancelRefund.ts`, per-type cancel routes | Admin routes with permission (new `orders.cancel`, S/U) |
| Report actions for chat, game, listing | `reports`, `moderation_decisions` | Hide chat message (new `hidden` flag), cancel game (existing `cancelGameAndNotify`), listing → reject/pause (existing) |
| Report target validation | `reports.ts` | Allow-list of types |
| Resident restriction | none | D-07 (new column + checks on join/host/chat) |
| Payout failed / Pro past-due notices | `connected_payouts.status`, subscription states | Notification hooks + Finance exception list |
| Admin invites, MFA | `users.admin_role` | New `admin_invites`; MFA = decision (TOTP needs a new secret store) |
| Recurring activities | `programs` repeat pattern (vendor side) | New series concept for games: **new data, needs approval** |
| Activity join approval | `circles.join_mode` | Game join mode: new column |
| Experience repeat / close sales | programme repeat code | Reuse the pattern; `sales_close_at`: new column |
| Complaints routed to the subject | `complaints.subject_type` | Link to owner (vendor/host) + partner view; **decision on visibility** |
| Statements | ledger, `payment_records` (switch-dependent) | Read-only monthly export; VAT invoice = decision (D-04) |
| Retention | none | Retention job: decision on periods (legal) |
| Server pagination | lists return all rows; audit `LIMIT 200` | Cursor params |

## 7. Financial and security risks (no rules changed)

| Risk | Severity | Note |
|---|---|---|
| Paid bookings on a closed day (W1) | High (operational and refund exposure) | Customer shows up at a closed venue; refund handled ad hoc |
| Failed payouts unnoticed (W6) | High | Partner unpaid; balance sits; no owner |
| Pro past-due silent (W7) | Medium | Unexpected downgrade; support load |
| No admin MFA; admins seeded outside the product | High (security) | Finance admins can refund money; no second factor; no audited onboarding |
| Report "suspend" no-op for chat, games, listings | High (trust and safety / DSA notice-and-action) | Admin believes content was actioned; it wasn't. The decision is recorded, but nothing changes. |
| No resident restriction | High | Repeat abusers can keep joining and hosting |
| Unvalidated report `targetType` | Low | Junk rows; no privilege impact |
| In-memory rate limiter | Medium at scale | Single instance only (known) |
| 2026-10-16 UI untested | Medium | Regressions possible in money screens' presentation |

## 8. Recommended target architecture

Keep every existing route and `?tab=` key. Additions are marked **+**.

**Super Admin:** Overview (+ exceptions strip)
- **Operations:** Pending approvals · Support (search | **+People | +Orders | +Activities | +Circles | +Hosts**)
  · **+Exceptions**
- **Marketplace:** All listings · Vendors · Claims · Host applications · Place suggestions · Organisations · Insights
- **Business:** Coupons · Commercial rules · Finance (+failed payouts, +past-due) · Plans & credit
- **Trust & Platform:** Reviews & reports (all target types actionable) · Policies & trust (+privacy requests after
  D-07) · Audit log · Notification templates · Media · Settings (+Admin invitations, +Maps switch, +MFA after decision)

**Vendor:**
- **Run:** Overview · Calendar (Block time with conflict check) · Bookings (**+All orders** | Hall | Club; record gains
  reschedule) · Messages
- **Listings:** Listings · editors · Programmes · Experiences (+repeat departures, +close sales)
- **Business:** **+Customers** (+customer record) · Earnings (+statements, +payout-failed banner) · Offers · Reviews
  (+complaints about you) · Demand
- **Organisation:** profile, policies, staff, trader, account & security

**Host:**
- **Hosting:** Overview · Activities (+series, +join approval, +close sales, +move with venue) · **+Reservations** ·
  Calendar
- **Community:** Circles (manage page in the shell; +chat moderation, +announcements)
- **Results:** Insights · Earnings (+per-activity venue cost line, stored values only) · Reviews (+complaints about you)
  · Offers
- `/manage` always opens for a resident session (WA-01 fix)

## 9. Prioritised backlog

| ID | Role | Module | Missing capability | Current evidence | Required solution | Priority | Complexity | Dependencies |
|---|---|---|---|---|---|---|---|---|
| OG-01 | Host | Access | Linked partner+host can't open `/manage` | `ManageHome.tsx:110`; switch keeps both cookies (`manage.ts:264`) | Prefer the resident session on `/manage` | **P1** | S | DEC-03 |
| OG-02 | All | UX | Failed loads hang or show empty | 25 call sites (`workspace-audit.md` §3.3) | `useLoad` + error/Retry | **P1** | S | none |
| OG-03 | Admin | Trust & Safety | "Suspend" no-op for chat messages, games, listings | `admin.ts:1181-1192` | Real actions per type + allow-list of target types | **P1** | M | DEC-10 |
| OG-04 | Vendor | Availability | Blocks ignore existing bookings; whole-day only | `vendorListings.ts:556-568` | Conflict pre-check + "cancel & refund affected" dialog; time-range blocks | **P1** | M | none (refund path exists) |
| OG-05 | Admin/Vendor/Host | Finance | Failed payout and Pro past-due are silent | `connect.ts:710,768`; no notify in `subscriptions.ts` | Notifications + Finance exception list | **P1** | M | none |
| OG-06 | Admin | Governance | No admin invitations | `admin.ts:68` list only | Invite/accept/revoke, Super only, audited | **P1** | M | DEC-02 |
| OG-07 | Admin | Governance | No MFA for admins | none in code | TOTP for admins (finance/super first) | **P1** | M | DEC-11 |
| OG-08 | Admin | Trust & Safety | No resident restriction | D-07 NEEDS INPUT | Restriction lever + checks | P1 | M | D-07 |
| OG-09 | All | QA | 2026-10-16 UI never run in `qa:*` | memory / `qa:preflight` | Restore the QA profile, run suites | **P1** | M | Owner approval |
| OG-10 | Admin | Operations | Can't cancel or reschedule an order on behalf | only `POST /finance/refunds` | Admin cancel (reuse provider-cancel refund) + reschedule | P2 | M | new permission |
| OG-11 | Vendor | Bookings | Vendor can't reschedule | `bookings.ts:687` guest-only | Partner reschedule with the same lock + notify | P2 | M | none |
| OG-12 | Host | Activities | Can't move an activity with a linked venue booking | guest reschedule 409 | Move both in one transaction | P2 | M | OG-11 |
| OG-13 | Vendor | Bookings | No single order list | three tabs; `/vendor/orders` | All orders tab | P2 | M | DEC-04 |
| OG-14 | Admin | Operations | No People/Orders/Activities/Circles/Hosts directories | Support search only | Directory tabs in Support | P2 | M | none |
| OG-15 | Admin | Operations | No exceptions inbox | spread across Finance and Overview | One list of open exceptions | P2 | M | OG-05 |
| OG-16 | Host | Reservations | No reservations view | `games.ts:364` | Reservations tab | P2 | S | none |
| OG-17 | Vendor/Host | Complaints | Subject never sees a complaint | `complaints.ts` admin-only | Route to owner + response | P2 | M | DEC-12 |
| OG-18 | Host | Circles | No chat moderation | `chat.ts:309` report only | Organiser hide message / mute | P2 | M | OG-03 |
| OG-19 | Vendor | Experiences | No repeat departures, no sales close | none | Reuse programme repeat; close-sales flag | P2 | M | new column |
| OG-20 | Vendor | Customers | Buried; no customer history | Org → Participants | Customers page + record | P2 | M | none |
| OG-21 | All | UX | Two component kits | `adminUi.tsx:473` vs `ActionMenu.tsx:26` | One workspace kit | P2 | M | OG-02 |
| OG-22 | All | UX | Pages not restyled | `/games/host`, `ManageCircle` | Into the shell | P2 | L | OG-21 |
| OG-23 | All | Responsive | Tables only scroll; no mobile check | `admin.css:674,702` | Stacked rows + 9-width check | P2 | M | OG-21 |
| OG-24 | Admin | Scale | No server pagination; audit capped at 200 | `admin.ts:1216` | Cursor pagination | P2 | M | none |
| OG-25 | Vendor | Finance | No statements | none | Monthly read-only statement | P2 | M | settlement switch; D-04 for VAT invoices |
| OG-26 | Host | Activities | No recurring activities | none | Activity series | P3 | L | DEC-13 |
| OG-27 | Host | Activities | No join approval / close sales | games have no join mode | Join mode + close-sales flag | P3 | M | new column |
| OG-28 | Host | Earnings | No venue cost vs revenue view | separate orders | Show stored amounts side by side | P3 | S | no new calculations |
| OG-29 | Admin | Governance | No privacy-request queue or retention | none | Request queue + retention job | P3 (legal may raise it) | M | D-07, DEC-14 |
| OG-30 | Vendor | Bookings | Booking requests (accept/reject) | instant only | Request-to-book mode | P3 | L | DEC-15 |
| OG-31 | Admin | Settings | Maps switch, consent viewer | API only | Small UI | P3 | XS | none |
| OG-32 | Admin | Reports | Unvalidated `targetType` | `reports.ts:19` | Allow-list | P3 | XS | in OG-03 |

## 10. Implementation roadmap

1. **Critical fixes:** OG-02, OG-01, OG-09 (QA gate), OG-03, OG-04, OG-05.
2. **Essential operational workflows:** OG-10, OG-11, OG-12, OG-17, OG-18, OG-06/OG-07 (after security approval),
   OG-08 (after D-07).
3. **Missing management pages:** OG-13, OG-14, OG-15, OG-16, OG-20, OG-25.
4. **UX/UI consolidation:** OG-21, OG-22, OG-23, OG-24.
5. **Commercial improvements (after D-04 / D-09):** statements with VAT invoices, Pro/rewards go-live, OG-28.
6. **Future enhancements:** OG-19, OG-26, OG-27, OG-29, OG-30, OG-31, OG-32.

## 11. Business decisions requiring approval

| ID | Decision | Recommendation |
|---|---|---|
| DEC-02 | Admin invitations: who invites, expiry | Super only; 72h single-use token; audited |
| DEC-03 | `/manage` with both sessions | Use the resident session whenever one exists |
| DEC-04 | Partner "All orders" (read-only aggregation, no table unification) | Approve |
| DEC-10 | What "suspend" does per reported type | Chat message → hidden; activity → cancelled with refunds; listing → paused; user → D-07 |
| DEC-11 | Admin MFA | Required for super and finance before paid launch |
| DEC-12 | Can partners/hosts see complaints about them, and respond? | Yes: subject, summary and response; not the complainant's contact unless consented |
| DEC-13 | Recurring activities for hosts | Defer until after launch |
| DEC-14 | Data-retention periods | Legal to set; then a scheduled job |
| DEC-15 | Request-to-book for venues | Defer; instant booking stays |
| DEC-16 | No-show consequences (fees, strikes) | None at launch; record only |
| DEC-17 | Vendor-initiated reschedule: customer consent required? | Notify + allow the customer to cancel with a full refund |
| D-04 / D-09 | Commercial model, VAT, Pro and rewards | Existing open decisions; block paid launch |
| D-05 / D-06 / D-07 | Listing edit re-approval, staff claims, resident suspension and deletion | Existing open decisions |
| DEC-01 | Workspace radius | Settled: 8px (owner confirmed in this brief) |

## 12. QA and verification plan

Every item is verified in the **isolated QA container** (`qa:*`, Stripe TEST only). Nothing runs on `hello_circle`,
staging or live Stripe. A test is reported passing only when executed.

| Scenario (brief Part 6) | Status now (CR) | Verified by |
|---|---|---|
| 1 Vendor registers → approved → publishes | Supported (PR `signup-*`, `product-vendor-signup`) | re-run `qa:product` |
| 2 Facility with availability and pricing | Partial: whole-day blocks; no per-room hours | new spec for OG-04 |
| 3 Customer books a venue | Supported (PR `booking-centre`, `qa:stripe`) | `qa:booking`, `qa:stripe` |
| 4 Vendor manages and completes | Partial: check-in and no-show yes; settlement switch-gated | `qa:booking` + new statement spec |
| 5 Vendor cancels → refund | Supported (PR `STRIPE-REFUND-VENDOR-CANCEL`) | `qa:stripe` |
| 6 Paid experience | Partial: single departures | `booking-experience` + OG-19 spec |
| 7 Host books a venue | Supported (consumer flow) | `booking-activity` |
| 8 Host paid activity on that reservation | Supported; reschedule blocked (OG-12) | new spec |
| 9 Participants book | Supported (PR `lifecycle`) | `qa:lifecycle` |
| 10 Attendance and completion | Supported | `qa:lifecycle` |
| 11 Host cancels after payment | Supported (refund once) | `gameCancelRefund.test` + `qa:stripe` |
| 12 Payout received | Partial: `connect_v1` and settlement off; Express onboarding manual | `stripe-sandbox-money` |
| 13 Payout fails | **Gap** (OG-05) | new spec using the Stripe test `payout.failed` event |
| 14 Vendor Pro | Partial: switch off; past-due silent | `stripe-sandbox-billing` + new spec |
| 15 Host reward points | Partial: switch-gated | `revenue-rewards` |
| 16 Customer credit | Partial: experiences only | `revenue-credit` |
| 17 Customer complaint | Partial: admin-only (OG-17) | new spec |
| 18 Admin resolves a dispute | Supported in Finance; partner notice NV | `stripe-sandbox-disputes` |
| 19 Staff restricted access | Supported (PR D-08) | `qa:validation`, `qa:authorization` |
| 20 Multi-role switch | **Blocked** for partner+host (OG-01) | new manage spec |

Plus:
- Forced-error test per WA-03 screen.
- Overflow check at 320/375/390/428/768/1024/1280/1440/1920 per role.
- Keyboard and axe pass on the new dialogs.
- Role-matrix API tests for every new route (403 for each disallowed role).
