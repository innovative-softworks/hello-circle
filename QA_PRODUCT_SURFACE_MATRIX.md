# HelloCircle — Product surface matrix (Phase 10)

Built from `client/src/App.tsx` (route table), the server router mounts in `server/src/index.ts`, and real browser runs. Checked 2026-10-02/03 on the isolated exploration stack described in QA_REPORT.md (Phase 10).

**Legend**
- **Desktop / Mobile:** result of the width sweep. Desktop is 1024–1440 px; mobile is 320–430 px, plus 768/820 for core routes. PASS means no horizontal overflow, the page renders, and there are no console errors beyond expected 401s.
- **Loading / Empty / Error:** observed behaviour.
- **Status:**
  - OK: works, no open finding beyond P3 polish.
  - ISSUES: an open P2 finding (ID given).
  - BLOCKER: an open P1.
  - GATED: redirected by the venue launch gate.
  - NOT TESTED: listed in the inventory but not exercised.

Venue routes (`/browse/centres|clubs`, `/centres/:id`, `/clubs/:id`, `/book/:id`, `/register/:id`) redirect to `/coming-soon` in the current public launch mode (`isVenueGatedPath`). The booking gate (HC-QA-034..047) covers them at API level only.

## Public

| Route | Actor | Purpose | Desktop | Mobile | Loading | Empty | Error | Permissions | Primary CTA | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` (ForVenues) | Visitor / venue | Pre-launch landing for venues and hosts | PASS | PASS | Spinner → content | n/a | n/a | Public | List your venue | ISSUES (075 CLS, 074 LCP 5.7 s mobile) |
| `/home` | Visitor | Discovery home | PASS | PASS | Spinner, reveal animations | Rails hide | Not simulated | Public | Find something | ISSUES (074, 075) |
| `/landing` | Visitor | Standalone landing | PASS | PASS | Spinner | n/a | n/a | Public | — | OK |
| `/explore` | Visitor | Search / results mode | PASS | PASS | Spinner | "No results" | Not simulated | Public | Search | ISSUES (075 CLS 0.43 mobile) |
| `/search` | Visitor | Redirect to Explore | — | — | — | — | — | Public | — | OK (redirect) |
| `/games` | Visitor / resident | Activity list, filters | PASS | PASS | 48 skeletons | "0 games" | **False empty state** | Public | I'm in / Join | ISSUES (063, 068, 073) |
| `/games/:id` | Visitor / resident | Activity detail, join, leave | PASS | PASS | Spinner | n/a | "We couldn't load this plan. Try again" | Public; draft → 404 | I'm in / Join · €x | ISSUES (069, 074, 079) |
| `/circles` | Visitor | Circle discovery | PASS | PASS | Spinner | "No Circles" | Not simulated | Public | Join Circle | ISSUES (073) |
| `/circles/:id` | Visitor / member | Circle detail, join/request, plans, polls, chat | PASS | PASS | Spinner | "Nothing planned yet" | "We couldn't load this Circle. Try again" | Restricted layout for non-members of approval/invite Circles | Join / Request to join | ISSUES (054, 055, 056, 057) |
| `/programs`, `/programs/:id` | Visitor | Programme browse and detail | PASS | PASS | Spinner | Empty list copy | Not simulated | Published only | Enrol | OK (paid enrol needs Stripe, covered by gate) |
| `/experiences`, `/adventures`, `/adventures/:id`, `/experiences/:id`, `/volunteer` | Visitor | Experience browse and detail | PASS | PASS | Spinner | Empty list copy | Not simulated | Approved only | Book this adventure | OK |
| `/provider/:id` | Visitor | Vendor public profile | PASS | PASS | Spinner | — | Not simulated | Approved vendors | — | OK |
| `/host/:id` | Visitor | Host public profile | PASS | PASS | Spinner | — | Not-found state (unverified host returns 404) | Verified hosts only; links gated on `hostVerified` | — | OK |
| `/:county/:activity` | Visitor / SEO | Local landing page | PASS | PASS | Spinner | Interest capture | — | Public | I'm interested | OK (086 title casing) |
| `/free-time`, `/make-it-happen`, `/ask`, `/suggest-place` | Visitor | Intent and suggestion tools | PASS | PASS | — | — | Not simulated | Public | Varies | ISSUES (068 suggest-place unlabeled) |
| `/for-venues`, `/become-a-host` | Visitor | Marketing | PASS | PASS | — | — | — | Public | List / Become a host | OK (084 hero size) |
| `/help-guide/*`, `/privacy`, `/cookies` | Visitor | Help and legal | PASS | PASS | — | — | — | Public | Change my cookie choice (`/cookies`) | OK |
| `/coming-soon` | Visitor | Launch gate target | PASS | PASS | — | — | — | Public | Notify me | OK |
| Venue routes (above) | Visitor | Centres, clubs, hall booking, club registration | — | — | — | — | — | Gated | — | GATED (059, 060) |
| `*` (404) | Visitor | Not found | PASS | PASS | — | — | NotFound page (HTTP 200) | — | Back home | OK (086 soft 404) |

## Authentication

| Route | Actor | Purpose | Desktop | Mobile | Error | Primary CTA | Status |
|---|---|---|---|---|---|---|---|
| `/signin/create` | Resident | Password signup | PASS | PASS | Inline `role=alert`; submit disabled until valid | Create account | OK (082) |
| `/signin`, `/signin/email-link` | Resident | Password and magic-link sign-in | PASS | PASS | Inline alert | Log in / Email me a link | OK — keyboard sign-in verified |
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invite` | Vendor / admin | Business auth | PASS | PASS | Inline alert | Log in | OK (082 deep-link loss) |
| `/vendor/signup` | Vendor | Two-step vendor intake | PASS | PASS | Disabled submit | Create vendor account | **BLOCKER (052)** |
| Google / Apple buttons | All | OAuth | — | — | "Google sign-in isn't available right now" / "Apple coming soon" | — | BLOCKED (Firebase not configured); 082 |

## Resident ("My Life")

| Route | Purpose | Desktop | Mobile | Loading | Empty | Error | Status |
|---|---|---|---|---|---|---|---|
| `/my-life`, `/bookings` | Next up, Circles, history, stats | PASS | PASS (085 layout gap) | 16 skeletons | "Make HelloCircle yours" 3-step setup (good) | **"Sign in" shown to signed-in user** | ISSUES (064, 085) |
| Account setup popup | County and interests | PASS | PASS | — | Skippable | — | OK |
| `/profile` | Profile, settings, preferences | PASS | PASS | — | — | Not simulated | OK (083 no H1) |
| `/chats` | Chat inbox | PASS | PASS | — | Empty inbox | Not simulated | ISSUES (055) |
| Notifications (bell) | In-app notifications | PASS | PASS | — | Empty | — | ISSUES (056, 073 unbounded) |
| Saved / Following | Favourites, follows | NOT TESTED in UI | — | — | — | — | NOT TESTED (API 401 for anonymous only) |

## Host (resident hosting activities and Circles)

| Route | Purpose | Desktop | Mobile | Status |
|---|---|---|---|---|
| `/games/host` | Create activity (2 steps; Publish now / Coming soon / Draft) | PASS | PASS | ISSUES (068, 067); double-submit safe; state-accurate confirmation |
| `/games/host/:id` | Edit; publish via STATUS | PASS | PASS | OK (078 publish hidden) |
| `/manage?tab=activities` | Manage activities (participants, share, duplicate, check-in, edit, update, cancel) | PASS | PASS | ISSUES (053) + 078 |
| `/manage` (Overview, Calendar, Insights, Earnings, Reviews, Offers) | Host dashboard | PASS | PASS | Visited only; CLS 0.38–0.65 (075) |
| `/circles/start` | Create Circle | PASS | PASS | OK; double-submit safe |
| `/manage/circles/:id` | Plans, Members (approve/decline), Settings | PASS | PASS | OK (080) |

## Vendor

| Route | Purpose | Desktop | Mobile | Status |
|---|---|---|---|---|
| `/vendor` Overview | Setup checklist, KPIs, today | PASS | PASS | OK — clear next steps |
| My centre / clubs (`/vendor/centres/:id`, `/vendor/clubs/:id`) | Listing edit, rooms, hours, blocks | PASS | PASS | Visited; rooms editing NOT TESTED in UI (API covered by gates); 059, 081 |
| Programs (`/vendor/programs/new`, `/:id`) | Create, publish, sessions, enrolments | PASS | PASS | ISSUES (068); 081 |
| Experiences (`/vendor/experiences/new`, `/:id`) | 6-step wizard, departures, bookings | PASS | PASS | ISSUES (061); 081 |
| Calendar, Bookings, Messages, Earnings, Reviews, Offers, Demand | Operations | PASS | PASS | Empty states OK; bookings drawer rows mouse-only (066); refunds covered by Stripe gate |
| Organisation / staff (`VendorOrg`) | Org profile, staff invites, RBAC | Visited | — | Covered by authorization gate; UI NOT TESTED in Phase 10 |

## Admin

| Route | Purpose | Status |
|---|---|---|
| `/admin` (Overview, Pending approval, Vendors, Listings, Claims, Host applications, …, Media) | Moderation and approvals | Overview and pending approval exercised; vendor approval drill-down friction (081). Other tabs visited only. No destructive admin actions performed. |

## Activity / Circle / Booking actions (cross-reference)

| Action | Result |
|---|---|
| Join free activity (confirm dialog) / leave | PASS (one row despite double-click; counts update) — 079 stale avatar |
| Join paid activity without payment provider | Clear "Payments aren't configured yet" (good); with Stripe the gate passes 26/26 |
| Waitlist, cancel, archive, updates, participants | Covered by lifecycle gate (52 PASS); UI visited |
| Circle join (open) / request (approval) / approve / withdraw | PASS |
| Plans, polls, chat | Plan PASS; poll duplicate (054); chat send PASS, message loss on rapid send (055) |
| Invitation (Circle) | API requires a resident ID; there's no email invite (product gap) |
| Share | Works for published items; draft spins forever (053) |
