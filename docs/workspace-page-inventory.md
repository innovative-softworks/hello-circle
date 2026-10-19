# Workspace page inventory: Admin, Partner (Vendor) and Host

_Audit date 2026-10-16. Branch `feature/commerce-engine` at `1ba8c7b` **plus 146 uncommitted files** (the 2026-10-16
admin page-by-page work and the partner/host workspace redesign). Everything below describes the working tree, not
the last commit._

**Verification key**
- **CR**: code-reviewed in this audit (route table, nav catalogue, component, API handler, guard).
- **PR**: proven by an earlier recorded run. The source document is named. It was not re-run in this audit.
- **NV**: not verified, neither live nor by a recorded run.

No page was live-tested in this audit. The isolated QA profile (`npm run qa:preflight`) is not provisioned on this
machine. Restoring it needs owner approval (see §7 of `workspace-audit.md`), and I was not allowed to reuse stored
session tokens against the dev server.

All three workspaces render inside `components/workspace/WorkspaceShell.tsx`. That shell provides the cream system
from `components/admin/admin.css`, a grouped sidebar that collapses to an icon rail, URL-driven tabs
(`useUrlTab`), and record pages via `?record=<type>:<id>` (`RecordView`).

---

## A. Super Admin: `/admin?tab=<key>`

Navigation source: `client/src/components/admin/adminNav.ts`. Server permissions come from
`server/src/adminPermissions.ts` and are deny-by-default (D-02). In the role column: S = super, F = finance,
U = support, L = legal.

| # | Page (`?tab=`) | Sub-pages / record pages | Purpose | Roles that can open it | Main API | Verif. |
|---|---|---|---|---|---|---|
| A1 | Overview `overview` | none | Urgency-sorted decision queue, attention strip, totals, activity timeline | all (`workspace.view`) | `/admin/stats`, `/listings`, `/claims`, `/host-applications`, `/place-suggestions`, `/reports`, `/finance/payment-reviews`, `/audit` | CR |
| A2 | Pending approvals `pending` | `record=centre\|club\|experience:<id>` review page with a Decision panel and Approve/Reject & next | Publish decision on partner listings | all view; S,U decide | `/listings/pending`, `/listings/:type/:id/detail`, `PUT /:table/:id/status` | CR; PR (D-03 validation) |
| A3 | Support `support` | `record=person:<email>`, `record=order:<kind>:<ref>` | Find any person, order, game or Circle | all (`support.search`) | `/support/search`, `/support/people/:email`, `/support/orders/:kind/:ref` | CR |
| A4 | All listings `listings` | listing record (shared with A2) | Every centre, club and experience: filter, feature, reject, delete | all view; S,U edit/feature; S delete | `/listings`, `/:table/:id/featured`, `DELETE /centres\|clubs/:id` | CR |
| A5 | Vendors `vendors` | `record=vendor:<id>` | Partner accounts: approve, suspend, platform role, tier | all view; S,U approve; S suspend/role/tier | `/vendors`, `/vendors/:id/status\|platform-role\|provider-tier` | CR; PR (D-01/D-08 validation) |
| A6 | Claims `claims` | `record=claim:<id>` | Ownership claims on unclaimed listings | S,U,L view; S,U decide | `/claims`, `/claims/:id/status` | CR |
| A7 | Host applications `hostApplications` | `record=host:<residentId>` | Verified Host badge decisions | S,U,L view; S,U decide | `/host-applications` | CR |
| A8 | Place suggestions `placeSuggestions` | `record=suggestion:<id>` | Resident-suggested places, with a duplicate check | S,U,L view; S,U decide | `/place-suggestions` | CR |
| A9 | Organisations `organisations` | `record=org:<id>`: flags, suspension (D-01), custom orgs | Partner organisations | all view; S manage/suspend | `/organisations*` | CR; PR (D-01) |
| A10 | Insights `marketplaceHealth` (`demand` is a hidden alias) | icon tabs: health, demand, funnel | Liquidity, unmet demand, referrals, funnel | all; S,U notify residents | `/marketplace-health`, `/demand*`, `/referrals`, `/analytics/funnel` | CR |
| A11 | Coupons `coupons` | `section=usage` (Usage & cost) | HelloCircle-funded and split codes | S,F; S delete | `/coupons`, `/finance/coupons/usage` | CR |
| A12 | Commercial rules `commerce` | icon tabs per rule group, switches, shadow report, history | Versioned fees, VAT, plans, switches | S,F; governance switches S only | `/commerce/*` | CR; PR (revenue suites) |
| A13 | Finance `finance` | Overview + ledger, Payment reviews, Disputes, Payment events, Refunds, Settlements, Transfers, Bank payouts, Partner debts; record pages for each | Money operations | S,F; U read-only payment state | `/finance/*` | CR; PR (D-10/D-11, 51/51 `qa:stripe`) |
| A14 | Plans & credit `plansCredit` | Credits & Pro, Reward points, Plans & promotions, Simulator | Customer credit, reward points, plans | S,F | `/finance/credits\|rewards\|subscriptions`, `/commerce/plans\|campaigns\|simulate` | CR |
| A15 | Reviews & reports `reviews` | `record=report:<id>` case page | Hide/restore reviews, work through user reports | S,U,L | `/reviews`, `/reports*`, `/decisions` | CR; PR (D-03) |
| A16 | Policies & trust `policies` | Policy documents, Company details, Complaints & appeals, Trader verification | Legal CMS, complaints, DSA trader checks | S,L policies; S,U,L complaints and traders | `/policies/*`, `/complaints`, `/traders` | CR |
| A17 | Audit log `audit` | none | Who changed what (latest 200) | all | `/audit` | CR |
| A18 | Notification templates `notificationTemplates` | one editor + sample preview | Confirmation and cancellation wording | S,L; S reset | `/notification-templates*` | CR |
| A19 | Media `media` | none | Upload switches, editorial library | S,U; S delete | `/admin/media/*` | CR |
| A20 | Settings `settings` | System status, Admin roles, Field help, Market categories, For You weights | Platform configuration | mixed (roles S; help S,L) | `/status`, `/admins`, `/help/*`, `/market-categories`, `/recommendation-weights` | CR |

## B. Partner (Vendor) workspace: `/vendor?tab=<key>` plus editor pages

Navigation source: `components/workspace/PartnerWorkspace.tsx` (`VENDOR_TABS`). Which tabs invited staff see is set
in `client/src/vendorTabAccess.ts`, which mirrors `requirePlatformRole`/`assertPlatformRole`.

| # | Page | Sub-pages / records | Purpose | Who sees it (owner sees all) | Main API | Verif. |
|---|---|---|---|---|---|---|
| B1 | Sign-up `/vendor/signup` | none | Account, organisation and first pending listing in one transaction | public | `POST /api/auth/signup` | CR; PR (`signup-*` specs) |
| B2 | Account-state pages (inside `/vendor`) | Awaiting approval + setup checklist; Account suspended + reason (D-03); Organisation suspended → read-only obligations (D-01); Removed member (D-08) | Gate the workspace | the account itself | `/auth/me`, `/auth/account-decision` | CR; PR (D-01/D-08) |
| B3 | Overview `overview` | none | Attention queue (setup step first), KPIs, coming up | all | `/vendor/stats`, `/schedule-items`, `/orders?attention=1` | CR |
| B4 | Calendar `schedule` | Block time dialog | Everything scheduled by day | all | `/vendor/schedule`, `/schedule-items`, `/centres/:id/blocks` | CR |
| B5 | Bookings `bookings` | Hall/Club tabs (`?bsec=`), `record=booking:<ref>` | Hall bookings + club registrations: check-in, cancel (auto refund), resend, refund | managers, finance | `/vendor/bookings`, `/registrations`, `/orders`, `/:kind/:ref/cancel\|refund\|resend-confirmation`, `/checkin/:kind/:ref` | CR; PR (`qa:booking` 38) |
| B6 | Messages `messages` | Notifications (All/Unread), Sent, "New message" popup | Inbox + broadcast to participants | communications | `/vendor/notifications`, `/vendor/messages` | CR |
| B7 | Listings `listings` | All / Centres / Clubs; photo cards with "Profile x% complete" | Own centres and clubs: create, publish, pause, duplicate, delete, claim | managers | `/vendor/listings`, `/centres*`, `/clubs*`, `/claims` | CR |
| B8 | Centre editor `/vendor/centres/:id` | Section cards with popup save; Rooms, Hours, Blocked times, Participation | Edit a centre | managers | `PUT /vendor/centres/:id`, `/rooms`, `/hours`, `/blocks`, `/participation/*` | CR |
| B9 | Club editor `/vendor/clubs/:id` | Sections; recurring sessions; waitlist + offer a place | Edit a club | facility_manager | `PUT /vendor/clubs/:id`, `/club-sessions`, `/clubs/:id/waitlist*` | CR |
| B10 | Programmes `programs` + `/vendor/programs/:id` | List/Month; 4-panel new form; Sessions, Enrolments, Add sessions popup; check-in kiosk | Multi-week courses | managers; refunds finance | `/vendor/programs*`, `/program-sessions/:id/attendance/*` | CR; PR (`programme` specs) |
| B11 | Experiences `experiences` + `/vendor/experiences/:id` | Departures, bookings, attendance, cancel departure, refund | Bookable experiences | managers | `/vendor/experiences*` | CR |
| B12 | Earnings `earnings` | Balance, payout account (Stripe Express), payouts, Plan & rewards, Venue splits, transactions, CSV export | Money in and out | finance | `/vendor/earnings`, `/payments`, `/reports/bookings.csv`, `/api/vendor/payout-account/*`, `/api/vendor/plan`, `/api/vendor/splits/*` | CR; PR (revenue + stripe suites) |
| B13 | Pro `/vendor/pro`, Rewards `/vendor/rewards` | none | Plan details, reward-points history | finance (plan changes: owner only) | `/api/vendor/plan/*` | CR |
| B14 | Offers `offers` | "New offer" popup (`?create=1`) | Partner-funded coupons | finance | `/vendor/coupons*` | CR |
| B15 | Reviews `reviews` | All / Needs a reply; reply popup | Read reviews and reply publicly | communications | `/vendor/reviews`, `/reviews/:id/reply` | CR |
| B16 | Demand `demand` | none | Unmet searches nearby | finance, read_only_analyst | `/vendor/demand` | CR |
| B17 | Organisation `org` | Settings, Staff & roles (`record=` member page), Participants, Insights, Trader details | Org profile, policies, staff, customers, utilisation | all (actions owner-only) | `/api/vendor/org/*`, `/vendor/participants`, `/vendor/insights`, `/api/vendor/trader-profile` | CR; PR (D-08) |
| B18 | Accept invite `/accept-invite` | none | Staff joins the organisation | invitee | `/api/invites/*`, `/auth/accept-invite` | CR; PR (D-08 rejoin) |

## C. Host workspace: `/manage?tab=<key>` and related pages

Navigation source: `components/workspace/HostWorkspace.tsx` (`HOST_TABS`). Identity is the resident (`req.resident`);
ownership comes from `games.host_resident_id` or the Circle organiser role.

| # | Page | Sub-pages / records | Purpose | Who | Main API | Verif. |
|---|---|---|---|---|---|---|
| C1 | Become a host `/become-a-host` | none | Pitch + start | public | none | CR |
| C2 | Overview `overview` | Attention queue (join requests, waitlists) | What's coming up and what needs the host | resident host/organiser | `/games/mine`, `/circles/mine`, join requests | CR |
| C3 | Activities `activities` | Upcoming/Past/Drafts; `record=activity:<id>` with participants (Remove/Refund), waitlist offers, check-in, update templates, cancel | Run hosted activities | host of each game | `/games/*` (host-checked) | CR; PR (`lifecycle`, `stage-b-host`) |
| C4 | Create/edit activity `/games/host`, `/games/host/:gameId` | venue booking picker (`bookingRef`) or an address | Create an activity, at a venue or not | resident (paid needs a Verified Host or payout eligibility) | `POST /games`, `PUT /games/:id`, `/games/host/venue-bookings` | CR. Still uses the consumer layout. |
| C5 | Calendar `calendar` | List / Month | Everything hosted, by day | host | `/games/mine` | CR |
| C6 | Circles `circles` | list → `/manage/circles/:id` | Circles organised | organiser | `/circles/mine` | CR |
| C7 | Circle manage `/manage/circles/:id` | Overview, Plans, Members (remove/promote/demote, invites, join requests), Settings | Run a Circle | organiser | `/circles/:id/*` (`isOrganiser`) | CR; PR (`lifecycle-circle-*`). Not restyled. |
| C8 | Insights `insights` | none | Turnout, repeat attendance | host | `/games/host/insights` | CR |
| C9 | Earnings `earnings` | Earnings; Trader details (`?view=trader`); payout account; Plan & rewards; split proposals | Paid-activity money | host | `/games/host/earnings`, `/api/host/payout-account/*`, `/api/host/plan`, `/api/host/game-splits/*`, `/api/host/trader-profile` | CR; PR (`revenue-resident`) |
| C10 | Pro `/manage/pro`, Rewards `/manage/rewards` | none | Host plan, reward history | host | `/api/host/plan/*` | CR |
| C11 | Reviews `reviews` | All / Needs a reply | Host reviews + replies | host | `/residents/me/host-reviews`, `/host-reviews/:id/reply` | CR |
| C12 | Offers `offers` | "New offer" popup | Codes for own activities | host | `/games/coupons*` | CR |
| C13 | Check-in screen | none | Door check-in for one activity | host | `/games/:id/participants*` | CR |

## D. Counts
- Admin: 20 navigable tools (plus 1 hidden alias), about 45 sub-sections and 14 record-page types.
- Partner: 12 tabs, 4 editor pages, 2 plan pages, 4 account-state pages, sign-up and accept-invite.
- Host: 8 tabs, 1 Circle manage page, 2 plan pages, the create/edit activity page and the check-in screen.
