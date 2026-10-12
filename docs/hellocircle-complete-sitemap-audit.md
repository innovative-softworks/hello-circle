# HelloCircle — Complete Sitemap, UX & Functional Audit

**Date:** 2026-10-11 · **Branch audited:** `feature/commerce-engine` @ `e2a74a6` plus ~127 uncommitted working-tree changes (the commerce, booking-UX and release-gate work from 2026-10-11). **Mode:** read-only audit. No application code, database rows, switches, commits, pushes or deploys were changed. The only file written is this report.

---

## 0. Method, evidence levels and limits

| Evidence tag | Meaning |
|---|---|
| **[code]** | Verified by reading source in this audit. Cited as `path:line`. |
| **[browser]** | Measured in this audit with headless Chromium (Playwright) against the dev server already running on `localhost:5173`. Every non-GET request was aborted so nothing was written to `hello_circle_dev`. 25 public/signed-out routes × 5 widths (320/375/390/768/1280). Signed-in surfaces were **not** browser-tested. |
| **[prior-QA]** | Reported as passing in an earlier 2026-10-11 document (`docs/booking-release-readiness-2026-10-11.md`, `docs/commercial-claims-safety-audit-2026-10-11.md`). **Not re-run here.** The integration suites need the isolated Docker profile and some call the Stripe TEST API. |
| **[prior-doc]** | A finding carried over from an earlier audit document and re-checked in code only where stated. |
| **[recommendation]** | Opinion or proposal, not a confirmed defect. |

**Local dev environment during the browser pass:** `client/.env` sets `VITE_LAUNCH_MODE=public` (main launch gate open). `VITE_VENUE_PAGES_PUBLIC` is unset, so the centre/club pages redirect to `/coming-soon`. This matches the "partial launch" configuration the code is designed for.

**Not done in this audit:** signed-in browser walkthroughs (resident, host, vendor, staff, admin); any submit or booking; any Stripe call; Firefox/WebKit; screen-reader testing; production inspection. Production facts below come from the read-only prod check recorded on 2026-10-11 (project memory, `deployment-hello-circle-ie`), not from a new check.

---

## Deliverable 1 — Actual sitemap (implemented routes)

Source: `client/src/App.tsx:331-441` (main router), `client/src/App.tsx:325-329` (gated router). Status tags are explained in Deliverable 3.

```
GLOBAL CHROME
├─ Header (desktop): Logo→"/" · Explore▾ · Circles · My Life · Start▾ · search · Free Time · notifications · chats · account menu
├─ MobileTabBar (<768): Home(/home) · Explore(sheet) · Start(sheet) · Circles · My Life        [hidden on /vendor, /admin, /manage, auth pages]
├─ Footer: Discover / Your account / Help / For venues columns + legal bar
├─ Overlays: CookieNotice · AccountSetupGate (onboarding popup) · PolicyAcceptanceGate · SessionExpiryBanner
└─ Launch gates: LAUNCH_GATE_ENABLED (VITE_LAUNCH_MODE) → everything non-exempt → /coming-soon
                 VENUE_PAGES_PUBLIC (VITE_VENUE_PAGES_PUBLIC) → centres/clubs/book/register → /coming-soon

PUBLIC / MARKETING
├─ /                      ForVenues (vendor-recruitment pitch — also the root)
├─ /for-venues            ForVenues (same component as /)                              DUPLICATE
├─ /home                  Home (consumer home feed)
├─ /landing               LandingPage (standalone marketing site, own header/footer)  DUPLICATE / orphan
├─ /coming-soon           ComingSoon (waitlist splash)
├─ /pricing               Pricing (partner pricing — "pending" page while fee model unapproved)   FEATURE-GATED
├─ /become-a-host         BecomeAHost
├─ /help-guide            HelpGuideIndex
│   ├─ /help-guide/explore
│   ├─ /help-guide/circles
│   ├─ /help-guide/my-life
│   └─ /help-guide/start
├─ /policies              Policy Centre index (CMS)
│   └─ /policies/:key     Policy document
├─ /privacy               CMS policy, falls back to PrivacyPolicy
├─ /cookies               CMS policy, falls back to CookiePolicy + choice control
├─ /complaints            Complaints & appeals
├─ /:county/:activity     Local SEO landing (e.g. /dublin/badminton)
└─ *                      NotFound

DISCOVERY
├─ /explore               Explore (mixed results + search mode)
│   └─ /search            → redirect into Explore results                             REDIRECT
├─ /browse/:category      Browse (centres | clubs, list + map + compare-select)       FEATURE-GATED (venue)
│   └─ /compare           → /browse/centres                                            REDIRECT
├─ /centres/:id           CentreDetail                                                 FEATURE-GATED (venue)
├─ /clubs/:id             ClubDetail (+ pass purchase)                                 FEATURE-GATED (venue)
├─ /games                 Games ("Activities" — ad-hoc sessions)
│   └─ /games/:id         GameDetail (join / pay / waitlist / chat)
├─ /circles               Circles
│   └─ /circles/:id       CircleDetail (plans, polls, members, chat)
├─ /programs              Programs (ExperienceKindBrowse-style list)
│   └─ /programs/:id      ProgramDetail (enrol, coupon, checkout summary)
├─ /adventures            ExperienceKindBrowse kind=adventure
│   └─ /adventures/:id    ExperienceDetail
├─ /experiences           ExperienceKindBrowse kind=experience
│   └─ /experiences/:id   ExperienceDetail
├─ /volunteer             ExperienceKindBrowse kind=volunteer                          orphan (no inbound link)
├─ /provider/:id          Provider public profile
├─ /host/:id              Host public profile
├─ /free-time             Free Time Mode (header icon)
└─ /ask                   Ask HelloCircle (rule-based search chat)                     effectively orphan

TRANSACTIONS
├─ /book/:centreId        BookingFlow (room → date/slot → details → review)            FEATURE-GATED (venue + paid)
├─ /register/:clubId      RegistrationFlow                                             FEATURE-GATED (venue + paid)
├─ /payment/success       PaymentSuccess (all Stripe types)                            FEATURE-GATED (paid)
├─ /payment/cancel        PaymentCancel (releases own hold)                            FEATURE-GATED (paid)
├─ /make-it-happen        Make It Happen / Open Booking                                FEATURE-GATED (commerce.open_booking off)
└─ /suggest-place         Suggest a place

CREATE (resident-as-host)
├─ /games/host            HostGamePage (create)
├─ /games/host/:gameId    HostGamePage (edit)
└─ /circles/start         StartCirclePage

RESIDENT ACCOUNT ("My Life")
├─ /bookings              MyBookings = "My Life" (canonical)
│   ├─ /my-life           same page, alias                                              ALIAS
│   └─ /onboarding        → /bookings?setup=1                                           REDIRECT
├─ /profile               Profile & settings (16 in-page sections, ?tab=)
│     account · notificationPrefs · preferences · privacy · payment · credit (wallet)
│     household · favourites ("Saved") · following · routines · passes · receipts (ReceiptDrawer)
│     inbox (notifications) · hosting ("Become a host") · safety · help
├─ /chats                 Chats inbox
└─ /i/:token              Personal invitation landing

AUTH & ONBOARDING
├─ /signin                Resident sign-in (magic link / password / Google)
│   ├─ /signin/create     Resident sign-up
│   └─ /signin/email-link Magic-link completion
├─ /login                 Business (vendor/admin) login
├─ /forgot-password · /reset-password
├─ /accept-invite         Vendor staff invite acceptance
├─ /manage/link-confirm   Vendor⇄resident account-link confirmation
└─ /vendor/signup         Provider signup (full listing intake)

HOST WORKSPACE ("HelloCircle Manage", resident identity)
├─ /manage                ManageHome tabs: overview · activities · circles · calendar · insights · earnings · reviews · offers
│   └─ /manage/activities → /manage?tab=activities                                      REDIRECT
├─ /manage/pro            Pro details (host)                                            FEATURE-GATED
├─ /manage/rewards        Reward history (host)                                         FEATURE-GATED
└─ /manage/circles/:id    ManageCircle tabs: overview · plans · members · settings

VENDOR WORKSPACE (vendor identity)
├─ /vendor                VendorDashboard tabs: overview · listings · programs · experiences · schedule(Calendar)
│                         · messages · bookings · earnings · reviews · offers · demand · org
├─ /vendor/pro            Pro details (vendor)                                          FEATURE-GATED
├─ /vendor/rewards        Reward history (vendor)                                       FEATURE-GATED
├─ /vendor/centres/:id    Centre editor (rooms, hours, blocks)
├─ /vendor/clubs/:id      Club editor (sessions, waitlist)
├─ /vendor/programs/:id   Programme editor
└─ /vendor/experiences/:id Experience editor

ADMIN CONSOLE
└─ /admin                 AdminDashboard tabs: overview · pending · vendors · listings · claims · hostApplications
                          · placeSuggestions · reviews(+Reports queue) · coupons · commerce(Commercial rules)
                          · finance(15 sub-sections incl. Admin roles, Field help) · policies(4 sub-sections)
                          · organisations · demand · marketplaceHealth · audit · support · notificationTemplates · media

DEV ONLY
└─ /dev/booking-kit       BookingKitPreview (+ CommercePreview fixtures) — import.meta.env.DEV only
```

**Route arithmetic [code]:** 78 `<Route>` entries in the main router. Of these, 4 are redirects (`/compare`, `/search`, `/onboarding`, `/manage/activities`), 1 is an alias (`/my-life`) and 1 is dev-only (`/dev/booking-kit`). That leaves **72 navigable page routes**. `pages/CommercePreview.tsx` has no route of its own; it is only imported by the dev kit page.

**Server API [code]:** 61 `app.use("/api/…")` mounts plus 2 raw-body Stripe webhook routes (`server/src/index.ts:143-222`), plus SEO/native endpoints (`/robots.txt`, `/sitemap.xml`, `/.well-known/*`, `/mobile-verify`, `/mobile-checkout-return`).

---

## Deliverable 2 — Proposed final sitemap [recommendation]

Aims: one front door per role, no orphan routes, and venue/paid surfaces hidden from navigation (not only redirected) while their gates are closed. Existing routes are kept wherever possible so emails and bookmarks keep working.

```
PUBLIC
├─ /                     Consumer home (today's /home). Keep /home as an alias.
├─ /explore              ONE discovery hub. Category chips: Activities · Adventures · Experiences · Programmes
│                        · Volunteer · Circles · Places* · Clubs*. List/Map toggle. (*only when VENUE_PAGES_PUBLIC)
│   ├─ /games/:id · /circles/:id · /programs/:id · /experiences/:id · /adventures/:id · /centres/:id* · /clubs/:id*
│   └─ category routes kept as deep links (/games, /adventures, /experiences, /programs, /volunteer, /circles, /browse/*)
├─ /how-it-works         NEW — Customers · Hosts · Partners (lift the existing Home "How HelloCircle works" section)
├─ /partners             Today's /for-venues (vendor pitch) + /pricing + Partner FAQ section
├─ /become-a-host
├─ /about                NEW (short) — who runs HelloCircle, company details from the Policy CMS "Company details"
├─ /contact              NEW — support email, complaints link, response times (replaces mailto-only footer link)
├─ /help                 Today's /help-guide/* + the FAQ now inside Profile → Help (one help centre)
├─ /policies/*           Policy Centre (privacy, cookies, terms, refunds…) + /complaints
└─ /:county/:activity    SEO landings
   (RETIRE: /landing, /ask → fold into Explore search; /coming-soon only while gated)

AUTH
├─ /signin               ONE sign-in screen with "I'm here to take part" / "I run a venue or club" switch
│   ├─ /signin/create · /signin/email-link · /forgot-password · /reset-password
│   └─ /login            kept as an alias that opens the business tab
├─ /vendor/signup → /partners/apply (alias)
└─ /accept-invite · /manage/link-confirm · /i/:token

MY LIFE (resident)
├─ /my-life              Overview + bookings with Upcoming · Past · Cancelled filters (/bookings kept canonical for emails)
│   └─ /my-life/orders/:ref   NEW — booking/order detail (status, policy, cancel, refund timeline, receipt)
├─ /my-life/circles      (today: section on My Life + /circles)
├─ /my-life/saved        (today: Profile → Saved/Following)
├─ /my-life/wallet       (today: Profile → HelloCircle credit + Receipts)
├─ /chats · notifications (today: Profile → Notifications + header bell)
└─ /profile              Settings only: details · notifications · interests · privacy & data (export + DELETE ACCOUNT)
                         · payment methods · household · help · safety

HOST (/manage)           Overview · Activities (drafts/published/past) · Circles · Calendar · Earnings · Offers · Reviews
                         · Insights  — /manage/circles/:id, /games/host[/:id], /manage/pro*, /manage/rewards* (*paid launch)

VENDOR (/vendor)         Overview · Listings (centres/clubs/programmes/experiences in ONE tab with type filter)
                         · Calendar · Bookings (with status filters + Action needed) · Messages · Earnings · Offers
                         · Reviews · Demand · Organisation (profile, staff, policies, trader details)
                         — tabs filtered by the staff member's platform_role

ADMIN (/admin)           Overview · Approvals (vendors, listings, claims, host applications, place suggestions)
                         · Listings · People (NEW user/resident directory, built on the existing Support search)
                         · Bookings (NEW read-only cross-type list) · Moderation (reviews + reports + chat reports)
                         · Finance · Commercial rules · Policies & trust · Content (help entries, notification templates, media)
                         · Insights (demand, marketplace health, funnel) · Audit · Settings (admin roles, maps toggle, orgs/flags)
                         — tabs filtered by admin_role
```

---

## Deliverable 3 — Page inventory

**Status values:** Complete · Needs improvement · Partially implemented · Missing · Broken · Duplicate · Deprecated · Feature-gated.
**Priority:** P0–P3 as defined in Deliverable 10 ("—" = no action needed).

### 3a. Implemented routes (72)

| ID | Role | Page | Subpage | Route | Status | Priority | Evidence |
|---|---|---|---|---|---|---|---|
| PG-01 | Public | Partner pitch (root) | — | `/` | Needs improvement | P1 | `App.tsx:337`. The root is the vendor pitch even with `VITE_LAUNCH_MODE=public`. Header logo → `/` (`Header.tsx:490`), while the tab bar's Home → `/home` (`MobileTabBar.tsx:135`). |
| PG-02 | Public | Partner pitch | duplicate | `/for-venues` | Duplicate | P3 | `App.tsx:395`, same component as `/`. |
| PG-03 | Public | Home feed | — | `/home` | Needs improvement | P2 | [browser] 16px horizontal overflow at 320px from the hero column `minWidth: 320` (`Home.tsx:612`, `:640`). 35 targets under 24px. Page title is bare "HelloCircle" (`pageTitle.ts:25`). |
| PG-04 | Public | Standalone landing | — | `/landing` | Duplicate | P3 | `App.tsx:339`. Only `landing/components/LandingHeader.tsx:40` links to it (itself). Its footer maps "Contact" and "Help" to `/ask` (`LandingFooter.tsx:34-35`). |
| PG-05 | Public | Coming soon | — | `/coming-soon` | Needs improvement | P2 | [browser] overflow 121px @320, 66px @375, 51px @390. Cause: `.lc-chip` row (`ComingSoon.tsx:113`). |
| PG-06 | Public/Partner | Partner pricing | — | `/pricing` | Feature-gated | — | `partnerPricing.ts:11` `PARTNER_FEE_MODEL_CONFIRMED=false` shows a neutral pending page. Correct for now. |
| PG-07 | Public | Become a host | — | `/become-a-host` | Complete | — | `BecomeAHost.tsx`. |
| PG-08…12 | Public | Help guide | index, explore, circles, my-life, start | `/help-guide/*` | Complete | P2 (links) | `HelpGuideIndex.tsx:43` links to `/bookings?tab=help`, which is a broken deep link (UX-02). |
| PG-13 | Public | Policy Centre | index | `/policies` | Partially implemented | P1 | CMS drafts can't be published until named legal sign-off (Stage 4 design, [prior-doc] revenue-connect). |
| PG-14 | Public | Policy Centre | document | `/policies/:key` | Partially implemented | P1 | Same as PG-13. |
| PG-15 | Public | Privacy | — | `/privacy` | Needs improvement | P1 | CMS-first, falls back to `PrivacyPolicy.tsx`. [prior-doc] fallback has placeholders. |
| PG-16 | Public | Cookies | — | `/cookies` | Complete | — | CMS + `CookieChoiceControl`. |
| PG-17 | Public | Complaints & appeals | — | `/complaints` | Complete | — | `Complaints.tsx`. |
| PG-18 | Public | Local SEO landing | — | `/:county/:activity` | Complete | — | `LocalActivity.tsx`. |
| PG-19 | Public | Not found | — | `*` | Complete | — | `NotFound.tsx`. |
| PG-20 | Customer | Explore | results/search | `/explore` | Needs improvement | P2 | [browser] 41 targets under 24px at every width. Reachable only from the mega-menu image tile, the search icon and Home. |
| PG-21 | Customer | Browse places | centres / clubs + map | `/browse/:category` | Feature-gated | P1 (nav) | `App.tsx:178-188`. Nav still advertises it (UX-03). |
| PG-22 | Customer | Centre detail | — | `/centres/:id` | Feature-gated | — | venue gate. |
| PG-23 | Customer | Club detail | + passes | `/clubs/:id` | Feature-gated | — | venue gate. Pass purchase gated by `usePaidCheckoutOpen`. |
| PG-24 | Customer | Activities | list | `/games` | Complete | — | Title "Activities", nav label "Join a session", route "games" (terminology, UX-06). |
| PG-25 | Customer | Activity detail | join/pay/waitlist/chat | `/games/:id` | Complete | — | `GameJoinCard.tsx:231-233,434` shows the paid-closed message. |
| PG-26 | Customer | Circles | discover | `/circles` | Complete | — | |
| PG-27 | Customer | Circle detail | plans/polls/members/chat | `/circles/:id` | Complete | — | polls `CircleDetail.tsx:8-28`. |
| PG-28 | Customer | Programmes | list | `/programs` | Needs improvement | P2 | [browser] toolbar overflow 59px @320 / 4px @375 (`BrowseLayout.tsx:517`). Title "Programmes", nav "Programs". |
| PG-29 | Customer | Programme detail | enrol | `/programs/:id` | Complete | — | Kit `CheckoutSummary` + coupon (`ProgramDetail.tsx:6,344`). |
| PG-30 | Customer | Adventures | list | `/adventures` | Needs improvement | P2 | same toolbar overflow. |
| PG-31 | Customer | Adventure detail | book | `/adventures/:id` | Complete | — | `ExperienceDetail.tsx`. |
| PG-32 | Customer | Experiences | list | `/experiences` | Needs improvement | P2 | same toolbar overflow. |
| PG-33 | Customer | Experience detail | book | `/experiences/:id` | Complete | — | Uses legacy `CheckoutBreakdown` (`ExperienceDetail.tsx:8,562`). |
| PG-34 | Customer | Volunteer | list | `/volunteer` | Needs improvement | P2 | No inbound link anywhere in the client [code]. Same toolbar overflow. |
| PG-35 | Customer | Provider profile | — | `/provider/:id` | Complete | — | |
| PG-36 | Customer | Host profile | — | `/host/:id` | Complete | — | |
| PG-37 | Customer | Free Time Mode | — | `/free-time` | Complete | — | header icon. |
| PG-38 | Customer | Ask HelloCircle | — | `/ask` | Needs improvement | P3 | Only reached from the orphan `/landing` footer, labelled "Contact"/"Help". |
| PG-39 | Customer | Venue booking | 4-step kit | `/book/:centreId` | Feature-gated | — | venue gate + paid gate. Rebuilt on booking kit (uncommitted). |
| PG-40 | Customer | Club registration | 3-step kit | `/register/:clubId` | Feature-gated | — | venue gate + paid gate. |
| PG-41 | Customer | Payment success | — | `/payment/success` | Feature-gated | — | reached only from Stripe. |
| PG-42 | Customer | Payment cancelled | — | `/payment/cancel` | Feature-gated | — | releases own hold (`routes/checkoutAbandon.ts`). |
| PG-43 | Customer/Host | Make It Happen | — | `/make-it-happen` | Feature-gated | P1 (nav) | Server returns 503 when `commerce.open_booking` is off (`makeItHappen.ts:133,152`). The page doesn't check up front, so users fill the form and then see an error (`MakeItHappen.tsx:74,106`). It is promoted in both Start menus. |
| PG-44 | Customer | Suggest a place | — | `/suggest-place` | Complete | — | |
| PG-45 | Host | Host an activity | create | `/games/host` | Needs improvement | P1 | A price can be set with no warning while paid checkout is closed (`HostGamePage.tsx:98,231`; no `usePaidCheckoutOpen`). |
| PG-46 | Host | Host an activity | edit | `/games/host/:gameId` | Needs improvement | P1 | same. |
| PG-47 | Host | Start a Circle | — | `/circles/start` | Complete | — | Not in either Start menu (UX-05). |
| PG-48 | Customer | My Life | — | `/bookings` (+`/my-life`) | Needs improvement | P1 | Signed-out view has no `<h1>` [browser]. Ignores `?tab=` (UX-02). No Upcoming/Past/Cancelled filter, only inline sections (`MyBookings.tsx:1162-1188`). |
| PG-49 | Customer | Profile & settings | 16 sections | `/profile` | Needs improvement | P1 | No account deletion, only deactivate (`Profile.tsx:977`, `:1192` copy "Nothing is deleted"). 16 sections mix account settings with content (Saved, Passes, Receipts, Notifications). |
| PG-50 | Customer | Chats | — | `/chats` | Complete | — | |
| PG-51 | Customer | Invitation landing | — | `/i/:token` | Complete | — | |
| PG-52…59 | All | Auth | signin, create, email-link, login, forgot, reset, accept-invite, link-confirm | various | Complete | P2 (IA) | Two sign-in front doors (`/signin` residents, `/login` business), see UX-08. |
| PG-60 | Vendor | Provider signup | — | `/vendor/signup` | Complete | — | single-transaction listing intake. |
| PG-61 | Host | Host workspace | 8 tabs | `/manage` | Needs improvement | P2 | No Drafts/Published/Past filter in the Activities tab (lifecycle `draft` exists server-side, `games.ts:1268`). Earnings sections link to Pro/Rewards (gated). |
| PG-62 | Host | Pro details | — | `/manage/pro` | Feature-gated | — | `proPurchaseAllowed()` false outside test (`releaseGates.ts:47-49`). |
| PG-63 | Host | Reward history | — | `/manage/rewards` | Feature-gated | — | |
| PG-64 | Host | Manage Circle | 4 tabs | `/manage/circles/:id` | Complete | P2 | No announcements (UX-11). |
| PG-65 | Vendor | Vendor workspace | 12 tabs | `/vendor` | Needs improvement | P2 | Every tab is shown to invited staff whatever their `platform_role`; the server answers 403 (`VendorDashboard.tsx:54-65`; client never reads `platformRole` outside `VendorOrg.tsx`). |
| PG-66 | Vendor | Pro details | — | `/vendor/pro` | Feature-gated | — | |
| PG-67 | Vendor | Reward history | — | `/vendor/rewards` | Feature-gated | — | |
| PG-68…71 | Vendor | Listing editors | centre, club, programme, experience | `/vendor/{centres,clubs,programs,experiences}/:id` | Complete | — | |
| PG-72 | Admin | Admin console | 20 tabs | `/admin` | Needs improvement | P2 | Top-level tabs ignore `admin_role` (Commercial rules, Finance, Coupons all show and then 403 for a support admin). Finance does filter its own sub-sections (`AdminFinance.tsx:1125-1139`). No user directory, no cross-type bookings list. |

### 3b. Redirects, aliases, dev-only (not counted as pages)

| Route | Kind | Status | Evidence |
|---|---|---|---|
| `/search` | redirect → Explore results | Deprecated (kept for links) | `App.tsx` `SearchRedirect` |
| `/compare` | redirect → `/browse/centres` | Deprecated | `App.tsx` |
| `/onboarding` | redirect → `/bookings?setup=1` | Deprecated | `App.tsx` |
| `/manage/activities` | redirect → `/manage?tab=activities` | Deprecated | `App.tsx` |
| `/my-life` | alias of `/bookings` | Duplicate (intentional) | `App.tsx:363` |
| `/dev/booking-kit` | dev-only preview | Hidden | `App.tsx:438`, tree-shaken from prod |

### 3c. Missing target pages (from the master sitemap)

"Missing" means no route **and** no in-page equivalent. Target items that exist as a tab or drawer are mapped in Deliverable 6, not listed here.

| ID | Role | Page | Status | Priority | Evidence |
|---|---|---|---|---|---|
| MS-01 | Public | About | Missing | P1 | no route |
| MS-02 | Public | Contact | Missing | P1 | footer "Contact us" is `mailto:` only (`Footer.tsx:44`) |
| MS-03 | Public | How it works (Customers / Hosts / Vendors) | Missing | P2 | only a Home section (`Home.tsx:1028`) |
| MS-04 | Public | Partner FAQ | Missing | P2 | "/pricing → partner FAQ" link goes to `/for-venues` |
| MS-05 | Public | Launch updates | Missing | P3 | none |
| MS-06 | Public | Events category | Missing | P3 | no "event" listing type; host activities = `games` |
| MS-07 | Customer | Booking / order detail page | Missing | P1 (paid) / P2 (free) | bookings are inline cards in My Life; receipts are a drawer in Profile |
| MS-08 | Customer | Account deletion (erasure) | Missing | **P1** | only deactivate; data export exists (`residents.ts:564`) |
| MS-09 | Admin | People / user directory | Missing | P2 | only `GET /admin/support/search` |
| MS-10 | Admin | Bookings & cancellations list | Missing | P2 | only Support search; Finance → Refunds is read-only |
| MS-11 | Admin | FAQ / content CMS | Partially implemented | P3 | Field help (help entries) lives under Finance; Help FAQ is hard-coded in Profile |
| MS-12 | Vendor | Pass products management | Missing | P2 (paid) | passes are auto-priced at club price × credits, no vendor control (`passes.ts:45-62`, comment "out of scope for this scaffolding") |
| MS-13 | Auth | Role selection | Partially implemented | P2 | implicit: `/signin` vs `/login` vs `/vendor/signup` |
| MS-14 | Auth | Business verification | Partially implemented | P2 | admin approval + trader profile self-cert; no vendor-facing "verification status" page beyond the pending card (`VendorDashboard.tsx:119-137`) |

---

## Deliverable 4 — Functional audit (by area)

Only confirmed items are listed as Working, Incomplete or Broken. "Working" means traced in code, plus [prior-QA] where noted.

### 4.1 Public & discovery
- **Working:** launch and venue gates fail closed (`App.tsx:125`, `venueLaunch.ts`); per-route code splitting; skip link; scroll reset; SEO robots/sitemap honour launch mode (`index.ts:237-340`); map view in Browse (`BrowseLayout.tsx:539` Grid/Map toggle); referral capture.
- **Incomplete:** nav entries for gated venue pages still render and bounce to `/coming-soon` [browser: `/browse/centres` → `/coming-soon`]; `/volunteer` has no entry point; `/ask` is reachable only from the orphan `/landing`.
- **Broken:** none at page level.

### 4.2 Auth & onboarding
- **Working:** magic link, password, Google (Firebase), email verification, forgot/reset, staff invite, account link confirm; the onboarding popup replaced the page (`AccountSetupGate`); vendor signup creates user + listing in one transaction.
- **Incomplete:** two separate sign-in surfaces with different visual weight; no "role selection" step; vendor "verification" is approval-only with a static pending card.

### 4.3 My Life / Profile
- **Working:** aggregates all six participation sources (`MyBookings.tsx:541-553`); server-driven cancel/reschedule state (`SelfCancelControl`, `RefundStatus`); receipts list + detail drawer with cross-tenant 404 (`server/src/receipts.ts:5-6,47-84`); credit wallet; data export; household; follows; routines; passes.
- **Incomplete:**
  - No erasure (MS-08).
  - Receipts are keyed on `resident_id` only (`receipts.ts:56-84`), so a pure-guest (`X-Client-Id`) booking never appears in Receipts.
  - No UI to leave a club waitlist or see your waitlist position: `leaveClubWaitlist` and `fetchWaitlistPosition` are defined in `client/src/api/resident.ts` but never called.
  - No UI to turn off a game "notify me": `unsubscribeGameNotifyMe` is never called.
  - The "Circle announcements" notification preference is saved but never read by the server (`Profile.tsx:1214,1239`; no server reference).
  - My Life's "is past" check uses the device's local date (`MyBookings.tsx:143,356`), not Ireland time.
- **Broken:** 6 deep links: `/bookings?tab=favourites|profile|help|safety` (`Footer.tsx:34-35,42-43`), `/bookings?tab=help` (`HelpGuideIndex.tsx:43`) and `/bookings?tab=routines` (`Home.tsx:1267`). `MyBookings` never reads `tab`, so all six land on the My Life root. The intended panels live at `/profile?tab=…` (`Profile.tsx:1759-1762`).

### 4.4 Booking & checkout (each type)

| # | Type | Entry | Quote source | Coupon | Credit | Paid when closed | Cancel/refund | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Venue booking | `/book/:centreId` | server `POST /bookings/quote` | ✓ | — | client message + server 503 | self-cancel + deadline; vendor cancel auto-refund (`providerCancelRefund.ts`) | Feature-gated (venue) |
| 2 | Club registration | `/register/:clubId` | server `POST /registrations/quote` | ✓ | — | client + server | self-cancel; **no deadline** [prior-doc R3B] | Feature-gated (venue) |
| 3 | Programme enrolment | `/programs/:id` | server quote | ✓ | — | client + server | self-cancel; **no deadline** [prior-doc] | Working (free) |
| 4 | Experience booking | `/experiences/:id` | server quote | ✓ | ✓ (engine-priced only) | client + server | session cancel auto-refund | Working (free) |
| 5 | Host activity | `/games/:id` | server | — | — | client + server | host cancel now refunds (`cancelGameAndNotify`, uncommitted) | Working (free) |
| 6 | Club pass | `/clubs/:id` | server `GET /passes/quote` | — | — | client + server | none | Feature-gated (venue); scaffolding pricing |
| 7 | Open Booking / Make It Happen | `/make-it-happen` | — | — | — | switch off → 503 | — | Feature-gated (switch) |

- **Working [code]:** every paid path goes through `createCheckoutSession()`, which calls `paidCheckoutOpen()` first (`checkoutService.ts:143`). Six callers: `bookings.ts:351`, `registrations.ts:410`, `programs.ts:317`, `experiences.ts:520`, `games.ts:1730`, `passes.ts:98`. No other route creates a one-off Checkout Session (`payments/provider.ts:172` is reached only through checkoutService). Pro subscription checkout (`provider.ts:355`) is reached only through `subscriptions.ts:107`, behind `proPurchaseAllowed()` (`subscriptions.ts:87`).
- **Incomplete:**
  - Four different price-summary components: kit `QuoteSummary` (Booking/Registration), kit `CheckoutSummary` (Programme), legacy `CheckoutBreakdown` (Experience), and inline price blocks in `GameJoinCard`/`ClubDetail` (UX-09).
  - Acknowledgements are recorded but not mandatory [prior-doc].
  - Deposits are manual [prior-doc].
- **Prior P0s from the booking audit:** the trial bypass, the availability bug and the Open Booking double charge are fixed in the uncommitted Phase 0. The VAT/fee model remains undecided (R3B D1).

### 4.5 Circles & community
- **Working:** discover, create, join/leave, join requests with questions, invitations (send/revoke/respond), member promote/demote/remove, plan ideas → confirm/cancel, polls (create/vote/close), moments, recent activity, per-Circle chat (`chat.ts:32` scope `circle`), report message.
- **Incomplete:** no Circle announcements feature (the preference exists, no endpoint; announcements exist only for games, `games.ts:853`). `updateCirclePlanIdea` and `fetchCirclePlanIdea` are never called from the UI, so plan ideas can't be edited after posting. No dedicated "Discussions" beyond chat.

### 4.6 Host workspace (`/manage`)
- **Working:** activities, circles, calendar, insights, earnings (Balance · Payouts · Plan & billing sections), offers, reviews; venue-booking picker for hosting at a booked venue (`HostGamePage.tsx:3` `fetchHostVenueBookings`); check-in screen; payout account (Connect switch off).
- **Incomplete:** no status filter for drafts/published/past; prices can be set while paid is closed (PG-45); host payout routes accept any signed-in resident, not just verified hosts (`payouts.ts:51-53`). Low risk while Connect is off.

### 4.7 Vendor workspace (`/vendor`)
- **Working:** listings (centre + club both), rooms/hours/blocks, programmes, experiences, calendar, messages, bookings + "Action needed" (refund_pending/deposit_due), earnings (+ payout history in `PayoutAccountCard.tsx:136`), reviews, offers (centre/club only, [prior-doc] G8), demand, organisation (profile, staff invites, policies). Server RBAC on 50+ endpoints (`requirePlatformRole` across vendorListings 19, vendorOperations 12, vendorExperiences 9, vendorInsights 5, clubSessions 3, traders 2, payouts/partnerPlan/venueSplits 1 each).
- **Incomplete:** the client doesn't filter tabs by staff role (PG-65); no pass-product management (MS-12); `fetchVendorSchedule` and `fetchVendorToday` are never called (dead wrappers); "Listings / Programs / Adventures & Experiences" are three tabs for one concept.
- An admin who visits `/vendor` is sent to the business login (`VendorDashboard.tsx:110-112`) instead of to `/admin` [code; behaviour of the login page for an already-signed-in admin not browser-checked].

### 4.8 Admin console (`/admin`)
- **Working:** `adminRouter.use(requireAdmin)` covers every route (`admin.ts:25`). Sub-role guards: commerce/finance/coupons = finance (`admin.ts:27,29,37`); help/policies = legal; complaints = support; traders = legal|support. Approvals, claims, host applications, place suggestions, reviews + reports queue with case view (`AdminDashboard.tsx:814,836-931`), coupons, commercial rules with draft/review/approve/publish/rollback, fee-model switches refused (`catalog.ts:427`), finance (15 sections), policies, organisations + flags, demand, health, audit, support search, notification templates, media.
- **Incomplete:** `adminUpdateCentre` and `adminUpdateClub` exist in `api/admin.ts` but nothing calls them, so admins can change a listing's status but not edit its content from the UI. No people directory or bookings list. Moderation is split across "Reviews" (reports queue sits under it) and Policies → Complaints. "Admin roles" and "Field help" are buried in Finance. Top-level tabs ignore `admin_role`.

---

## Deliverable 5 — UX audit

Screenshots from this audit: `/private/tmp/claude-501/…/scratchpad/shots/` (320px and 1280px PNGs for each of the 25 routes; session-local, not committed). Measured values are listed below.

| ID | Severity | Roles | Problem | Evidence | Recommended fix |
|---|---|---|---|---|---|
| UX-01 | High | All | **Two "homes".** Logo → `/` (vendor pitch); mobile Home tab → `/home`; footer logo → `/`. A signed-in resident tapping the logo lands on "List your venue". | `App.tsx:337`, `Header.tsx:490`, `MobileTabBar.tsx:135`, `Footer.tsx:70` | Make `/` the consumer Home once `VITE_LAUNCH_MODE=public`. Move the pitch to `/partners` (keep `/for-venues`). |
| UX-02 | High | Customer | **Six broken deep links** to `/bookings?tab=…`. | §4.3 | Point them at `/profile?tab=favourites|account|help|safety|routines`, or make MyBookings forward `?tab=` to `/profile`. |
| UX-03 | High | Customer | **Nav advertises gated pages.** Explore → Places, Start → "Book a place", and footer "Community centres/Sports clubs/Councils/Clubs" all go to `/coming-soon` while the venue gate is closed. | [browser] `/browse/centres` → `/coming-soon`; `Header.tsx:600-617,633`; `MobileTabBar.tsx:161-172`; `Footer.tsx:25-26,99-104` | Hide these entries when `!VENUE_PAGES_PUBLIC` (one helper shared by Header, MobileTabBar and Footer). |
| UX-04 | High | Customer/Host | **Make It Happen is a dead end** while `commerce.open_booking` is off: promoted in both Start menus, the user fills the form, then gets an error. | `makeItHappen.ts:133,152`; `MakeItHappen.tsx:74,106` | Expose switch state via `/api/config` and hide the nav entry, or show a "paused" state before the form. |
| UX-05 | Medium | Host | **"Start" menu doesn't start things.** "Book a place" says "List a hall or room to hire out" but opens browse centres; "Start a session" opens `/games` (browse), not `/games/host`; no "Start a Circle". | `Header.tsx:630-645`, `MobileTabBar.tsx:170-182` | Start = Host an activity (`/games/host`) · Start a Circle (`/circles/start`) · Make It Happen (when on) · Suggest a place. |
| UX-06 | Medium | All | **Terminology drift.** Programs vs Programmes (`pageTitle.ts:45` vs nav); games/"Activities"/"Join a session"/"session"/"event"; Saved vs Favourites (`Footer.tsx:34` vs `Profile.tsx:1742`); Councils vs Community centres (`Footer.tsx:102`); "Hello Circle" vs "HelloCircle" (`Footer.tsx:71`). | as cited | One glossary (Activity, Circle, Programme, Experience, Place, Club; Saved) applied to nav, titles and footer. |
| UX-07 | High (launch copy) | Public | Footer says "A concept prototype — not affiliated with any council or governing body." | `Footer.tsx:74` | Replace with real company line before free launch. |
| UX-08 | Medium | Customer/Vendor | Two sign-in doors (`/signin`, `/login`); a vendor who uses `/signin` gets a resident session. | `App.tsx` auth routes | One sign-in screen with a "business" tab; `/login` opens that tab. |
| UX-09 | Medium | Customer | Four price-summary patterns across booking types. | §4.4 | Converge on the kit (`components/booking/checkout.tsx` `CheckoutSummary`) for every type. |
| UX-10 | Medium | Customer | Profile has 16 sections that mix settings with content (Saved, Passes, Receipts, Notifications). My Life duplicates Circles/Interests/Saved summaries. | `Profile.tsx:1734-1752` | Split per Deliverable 2: My Life = things; Profile = settings. |
| UX-11 | Medium | Customer/Host | The "Circle announcements" preference does nothing. | §4.5 | Hide the toggle until the feature exists, or build announcements (reuse the games announcement model). |
| UX-12 | Medium | Mobile | Horizontal overflow at small widths: Browse toolbar (Filters · Sort · Grid/Map) on `/adventures`, `/experiences`, `/programs`, `/volunteer` = **59px @320, 4px @375**; `/home` hero = **16px @320**; `/coming-soon` chip row = **121/66/51px @320/375/390**. None at 768/1280. | [browser]; `BrowseLayout.tsx:517`; `Home.tsx:612,640`; `ComingSoon.tsx:113` | `flexWrap: "wrap"` on the toolbar; `minWidth: min(320px, 100%)` on hero columns; wrap the chip row. |
| UX-13 | Medium | Mobile/a11y | Small touch targets (<24px CSS): `/explore` 41, `/home` 35, `/policies` 23, most others 3–8 (footer text links, "See all"). | [browser] | 44×44 hit area for card-overlay links and footer links (padding, not visual size). |
| UX-14 | Medium | a11y | Footer links are `<span onClick>`: not focusable, not announced as links. The "Councils/Clubs/Privacy/Cookies" bar is the same. | `Footer.tsx:90-108` | Use `<Link>` (as already done for Terms & Complaints at `:114-119`). |
| UX-15 | Low | a11y | My Life signed-out view has no `<h1>`. | [browser] h1=0 at every width | Add a heading to the signed-out state. |
| UX-16 | Low | All | `/` and `/home` both have the bare title "HelloCircle". | `pageTitle.ts:24-25` | Distinct titles. |
| UX-17 | Medium | Vendor staff | Staff see tabs that 403. | PG-65 | Filter tabs by `platform_role` (server stays the authority). |
| UX-18 | Medium | Admin | Support/legal admins see Commercial rules/Finance/Coupons tabs that 403. | PG-72 | Filter top-level tabs by `admin_role`, as Finance already does internally. |
| UX-19 | Low | Mobile | On first visit at 320px the cookie banner covers about 40% of the viewport, over page content (not over the tab bar). | [browser] screenshots `320_home.png`, `320_adventures.png` | Acceptable for consent. Consider a compact layout below 360px (already compact on checkout, [prior-doc] R3A). |
| UX-20 | Low | Host | Prices accepted on host/vendor editors while paid checkout is closed, with no warning that the listing will show "free bookings only". | PG-45 | Banner on price fields when `paidCheckoutOpen=false`. |

Not verified (no claims made): dialog behaviour, sticky-footer behaviour on signed-in pages, the dashboards at any width, keyboard traps, colour contrast.

---

## Deliverable 6 — Missing pages: what is needed when

| Target item | Today | MVP | Free launch | Paid launch |
|---|---|---|---|---|
| About | missing | — | **Essential** (trust, company identity) | essential |
| Contact | mailto only | — | **Essential** | essential |
| Account deletion | deactivate only | — | **Essential** (GDPR Art. 17) | essential |
| Real company footer copy | "concept prototype" | — | **Essential** | essential |
| Published Terms/Privacy (CMS) | drafts | — | **Essential** (signup copy promises Terms) | essential |
| How it works | Home section | nice | Recommended | recommended |
| Partner FAQ | → /for-venues | nice | Recommended (vendor recruitment) | essential |
| Booking/order detail | inline cards + receipt drawer | — | Optional | **Essential** (refund timeline, receipt, policy in one place) |
| Wallet | Profile → credit | — | n/a (credits off) | Essential if customer credits ship |
| Notifications | Profile → inbox + bell | ok | ok | ok |
| Admin people directory | support search | — | Recommended | essential |
| Admin bookings list | support search | — | Recommended | **Essential** (refund/dispute handling) |
| Vendor pass products | auto-derived | — | n/a (venue-gated) | Essential before passes are sold |
| Launch updates, Events | missing | — | Optional | optional |
| Role selection | implicit | — | Recommended (UX-08) | recommended |

---

## Deliverable 7 — Navigation proposals [recommendation]

**Customer.** Desktop header: Logo→Home · Explore▾ (Activities, Adventures, Experiences, Programmes, Volunteer, Circles · Places/Clubs only when the venue gate is open) · Circles · My Life · **Host▾** (Host an activity, Start a Circle, Make It Happen [when on], Suggest a place) · search · bell · chats · account. Mobile tab bar unchanged: Home · Explore · Start · Circles · My Life. The Start sheet gets the same items as desktop "Host". The footer shows only live pages, and every footer link is a `<Link>`.

**Host.** Desktop: `/manage` sidebar (ManageShell) — Overview · Activities (filters: Draft/Published/Past) · Circles · Calendar · Earnings · Offers · Reviews · Insights. Account menu keeps the "Personal ⇄ Business" switch. Mobile: same ManageShell drawer (tab bar is hidden on `/manage`, `App.tsx` `hideTabBar`). Add a persistent "Back to My Life" in the drawer header.

**Vendor.** Overview · Listings (one tab, type filter: Places/Clubs/Programmes/Experiences) · Calendar · Bookings (Action needed · Upcoming · Pending · Completed · Cancelled) · Messages · Earnings · Offers · Reviews · Demand · Organisation. Tabs filtered by `platform_role`. Mobile: ManageShell drawer, with the "Action needed" count badge on the drawer trigger.

**Admin.** Overview · Approvals (5 queues with counts) · Listings · People · Bookings · Moderation · Finance · Commercial rules · Policies & trust · Content · Insights · Audit · Settings. Tabs filtered by `admin_role`. Mobile: drawer; admin is desktop-first, but nothing should overflow.

---

## Deliverable 8 — Role & permission matrix

**Key:** V view · C create · E edit · D delete/deactivate · A approve · X cancel · M manage. "own" = rows they own (resident_id, client id, org-scoped vendor ids, or Circle organiser). Enforcement is on the **server** unless marked (UI).

| Feature | Anonymous | Resident | Host (verified resident) | Vendor owner | Vendor staff | Admin (super) | Admin sub-role |
|---|---|---|---|---|---|---|---|
| Browse public listings | V | V | V | V | V | V | V |
| Book venue / register club | C (client id) | C, X own | C, X own | — | — | — | — |
| Join activity / programme / experience | sign-in required for most | C, X own | C, X own | — | — | — | — |
| Receipts | — | V own (404 otherwise) | V own | — | — | via finance | finance |
| Saved / follows / household | — | C/E/D own | same | — | — | — | — |
| Host activity (game) | — | C (unverified allowed per host-tier memory: badge-only) | C/E/X own | — | — | M (moderation) | — |
| Circle | — | C; join; leave | C; organiser: E, members M, polls, plans | — | — | M (reports) | support (complaints) |
| Host earnings / payout account | — | V/M own (any resident — see §4.6) | V/M own | — | — | V | finance |
| Pro / rewards (host) | — | refused (gate) | refused (gate) | — | — | — | — |
| Listings (centre/club/programme/experience) | — | — | — | C/E/D own org | per `platform_role` | A, E status, featured, D | — |
| Rooms / hours / blocks | — | — | — | M own | centre_manager / facility_manager | — | — |
| Vendor bookings, cancel + refund | — | — | — | V/X own | per role (finance for refunds) | V via support | finance |
| Vendor earnings / payout account | — | — | — | V/M | **finance** role (`payouts.ts:43`) | V | finance |
| Vendor Pro / rewards | — | — | — | refused (gate); owner-only routes | — | — | — |
| Org profile / staff invites | — | — | — | M (owner only) | — | M orgs + flags | — |
| Coupons (platform) | — | apply | apply | offers on own listings | per role | C/E/D | **finance** |
| Commercial rules & switches | — | — | — | — | — | M (fee-model switches refused) | **finance** |
| Finance views | — | — | — | — | — | V | **finance** |
| Policies CMS / help | V published | V | V | V | V | M | **legal** |
| Complaints & appeals | C | C | C | C | C | M | **support** |
| Trader verification | — | — | self-cert own | self-cert own | per role | M | legal / support |
| Vendor/host approvals, claims | — | — | — | — | — | A | (no sub-role guard — any admin) |
| Audit log | — | — | — | — | — | V | (any admin) |

Confirmed gaps: **(a)** the client doesn't filter by vendor staff role or admin sub-role (UX-17/18); the server does. **(b)** Approvals, audit, support search and notification templates are open to every admin sub-role [code: only `/commerce`, `/finance`, `/help`, `/policies`, `/complaints`, `/traders`, `/coupons` carry `requireAdminRole`, `admin.ts:27-37`]. Decide whether a "support" admin should approve vendors. **(c)** Host payout routes don't require verified-host status.

---

## Deliverable 9 — End-to-end journey matrix

Status: **Works (code)** = traced end-to-end in code; **Works (QA)** = also covered by a named integration spec reported passing on 2026-10-11 [prior-QA, not re-run]; **Gated** = blocked by design; **Gap** = dead end or missing step confirmed.

| # | Journey | Role | Entry point | Steps | Result | Missing step | Status |
|---|---|---|---|---|---|---|---|
| J01 | Discover → view → save | Customer | `/home`, `/explore` | card → detail → SaveButton | saved in Profile → Saved | Footer "Favourites" link broken (UX-02) | Works (code) |
| J02 | Discover → join free activity | Customer | `/games` | detail → GameJoinCard → join | in My Life | — | Works (QA: lifecycle-activity-participation) |
| J03 | Discover → book free venue | Customer | Explore → Places | → `/coming-soon` | — | venue gate | **Gated** (QA: booking-centre on test profile) |
| J04 | Discover → paid booking unavailable | Customer | paid listing | detail → "free bookings only" message; server 503 | blocked | — | Works (code; client + server) |
| J05 | Register → join Circle → participate | Customer | `/signin/create` → `/circles/:id` | join (questions) → plans/polls/chat | member | Circle announcements absent | Works (QA: lifecycle-circle-membership/planning) |
| J06 | Book → view → cancel | Customer | My Life | card → SelfCancelControl → confirm | cancelled + refund state | no detail page | Works (QA: booking-remediation-cancel) |
| J07 | Book → receipt → refund status | Customer | Profile → Receipts | ReceiptDrawer | refund timeline | pure-guest bookings absent; not on My Life | Works (QA: stripe-r3a) for residents |
| J08 | Apply coupon | Customer | programme/experience/venue checkout | CouponField → re-quote | discount shown | — | Works (QA: revenue-resident) |
| J09 | Use HelloCircle credit | Customer | experience checkout | CreditToggle | — | `commerce.customer_credits` off | **Gated** |
| J10 | Update profile & preferences | Customer | `/profile` | sections | saved | announcements toggle no-op | Works (code) |
| J11 | Register → complete host profile | Host | Profile → Become a host | application → admin approves | verified badge | — | Works (QA: product-host) |
| J12 | Create activity → publish → manage | Host | `/games/host` (not from Start menu) | draft/coming_soon/active → manage | live | Start menu misroutes (UX-05); no drafts filter | Works (QA: lifecycle-activity-publish) |
| J13 | Book venue → organise activity | Host | `/book` → `/games/host` (venue picker) | pick booked venue | linked game | venue gate | **Gated** |
| J14 | Invite participants | Host | InviteSheet | link / personal invite | `/i/:token` | — | Works (QA: invitation-*) |
| J15 | Manage attendance | Host | HostCheckInScreen | mark | attendance | — | Works (QA: attendance-relations) |
| J16 | Cancel activity | Host | manage | cancel → notify (+refund paid, uncommitted) | cancelled | — | Works (QA: gameCancelRefund unit) |
| J17 | View earnings / payout status | Host | `/manage?tab=earnings` | Balance · Payouts · Plan | read-only | Connect off | Partially (code) |
| J18 | Manage plan & rewards | Host | `/manage/pro`, `/manage/rewards` | — | refused | fee model unapproved | **Gated** |
| J19 | Register → verify business | Vendor | `/vendor/signup` | intake → pending card → admin approves | approved | no status detail beyond static card | Works (QA: product-vendor-signup) |
| J20 | Create venue → facilities → publish | Vendor | Listings → editor | rooms/hours/photos → admin approval | approved but not public | venue gate | Works (code) / public view Gated |
| J21 | Configure availability | Vendor | centre editor | hours/blocks/rooms | — | per-room hours don't exist (CLAUDE.md) | Works (code) |
| J22 | Receive & manage bookings | Vendor | Bookings + Action needed | view/cancel/refund | — | — | Works (QA: booking-provider) |
| J23 | Create experience | Vendor | Adventures & Experiences tab | editor → sessions | — | — | Works (QA: booking-experience) |
| J24 | Create programme | Vendor | Programs tab | editor | — | feature-flag `programs` per org | Works (QA: booking-program) |
| J25 | Manage club registrations | Vendor | club editor → participants | — | — | — | Works (code) |
| J26 | Create coupons/offers | Vendor | Offers tab | centre/club only | — | no programme/experience offers ([prior-doc] G8) | Partially |
| J27 | Manage staff | Vendor owner | Organisation | invite → `/accept-invite` | staff | staff UI not role-filtered | Works (QA: authorization-staff) |
| J28 | View earnings & payouts | Vendor | Earnings | sections | read-only | Connect off; finance role only | Partially |
| J29 | Approve partner | Admin | Pending approval / Vendors | approve | vendor live | — | Works (QA: stage-b-admin) |
| J30 | Approve listing | Admin | Pending approval | approve | listing approved | — | Works (code) |
| J31 | Review bookings | Admin | Support search | search by email/ref | — | no bookings list (MS-10) | **Gap** |
| J32 | Handle refunds | Admin | Finance → Refunds | view | read-only | no admin-initiated refund UI | **Gap** (by design pre-paid) |
| J33 | Manage commercial rules | Admin (finance) | Commercial rules | draft→review→approve→publish | — | fee-model switches refused | Works (QA: revenue-admin) |
| J34 | Review financial records | Admin (finance) | Finance | 13 sections | — | — | Works (QA: revenue-admin-b) |
| J35 | Manage content | Admin | Policies & trust / Notification templates / Media | — | — | FAQ not CMS-managed | Partially |
| J36 | Moderate community | Admin | Reviews (+Reports) | hide/unhide, resolve report | — | reports queue hidden under "Reviews" | Works (code), IA gap |
| J37 | Review audit logs | Admin | Audit | — | — | — | Works (code) |
| J38 | Edit a listing's content as admin | Admin | Listings | — | — | `adminUpdateCentre/Club` never called | **Gap** |

---

## Deliverable 10 — Prioritised backlog

### P0 — Security, data integrity, financial exposure

| ID | Page | Problem | User impact | Solution | Deps | Acceptance criteria | Size |
|---|---|---|---|---|---|---|---|
| P0-01 | All paid flows (prod) | **The release gate exists only locally.** `releaseGates.ts` is untracked on `feature/commerce-engine` and also on the pushed, **unmerged** `hotfix/paid-checkout-gate` (`afc8392`). `origin/main` / prod gates paid checkout only on the presence of `STRIPE_SECRET_KEY` (`origin/main:server/src/checkoutService.ts:141`). Prod is **safe today** only because the key is absent (prod check 2026-10-11). | If anyone adds a Stripe key to prod before the gate ships, paid checkout opens through six APIs at legacy VAT/fee pricing. | Merge the hotfix (or the equivalent commit) to `main` and deploy it before any Stripe key goes on prod. Add `PAID_CHECKOUT=closed` explicitly to the prod env. | Owner approval to merge/deploy | Prod `GET /api/config` returns `paidCheckoutOpen:false`; a paid POST on prod returns 503 with the closed message even with a test key set. | S |
| P0-02 | Commercial model | Paid launch has no approved VAT/fee formula (R3B F1–F5, D1). | Wrong VAT liability and partner payouts once paid opens. | Keep paid NO-GO. Resolve D1–D9 with adviser. | Tax adviser/solicitor | One formula drives checkout, settlement and `/pricing`; `PARTNER_FEE_MODEL_STATUS` flipped by a reviewed change. | L |

No new P0 security defects were found in the areas checked: receipt isolation (`receipts.ts`), admin server guards (`admin.ts:25-37`), vendor payout tenant scoping (`payouts.ts:43` finance role + org party), and the Pro/rewards gates.

### P1 — Free-launch blockers

| ID | Page | Problem | Impact | Solution | Deps | Acceptance | Size |
|---|---|---|---|---|---|---|---|
| P1-01 | Profile | No account deletion (erasure). | GDPR exposure; users can't leave. | "Delete my account": confirm, anonymise resident row, cascade per retention policy, keep financial records as legally required. | Retention decision | Deleting removes PII from `residents` and linked tables; the audit row stays; signing in again creates a fresh account. | M |
| P1-02 | Footer / About / Contact | "Concept prototype" copy; no About or Contact page. | Trust; consumer-law trader identity. | Real footer line; `/about`, `/contact` pulling company details from the Policy CMS values. | Company details | No "prototype" string in the client bundle; footer links to both pages. | S |
| P1-03 | Policies | Terms/Privacy are unpublished drafts; signup copy promises Terms. | Legal. | Legal sign-off → publish via the CMS. | Solicitor | `/policies/terms` and `/privacy` show published versions with no placeholders. | S (eng) |
| P1-04 | `/` + Header logo | Root is the vendor pitch. | Consumers bounce. | `/` = Home when public; pitch at `/partners` (+ `/for-venues`). | — | Logo and `/` show Home in public mode; gated mode unchanged. | S |
| P1-05 | Footer, Help guide, Home | 6 broken `/bookings?tab=` links. | Dead ends. | Repoint to `/profile?tab=…`. | — | Each link opens the named section [browser test]. | S |
| P1-06 | Header, MobileTabBar, Footer | Venue entries shown while venue gate is closed. | Users land on Coming soon from primary nav. | One `VENUE_PAGES_PUBLIC` check hides the entries. | — | With the gate closed, no nav item routes to `/coming-soon`. | S |
| P1-07 | Make It Happen | Promoted while its switch is off. | Form then error. | Expose `open_booking` in `/api/config`; hide entry or show paused state. | — | Switch off: no nav entry, and direct visit shows "paused" before the form. | S |
| P1-08 | Host/vendor editors | Paid prices can be published while paid is closed. | Hosts promise paid events nobody can pay for. | Warning on price fields + "free only" chip on the host's own view. | — | With paid closed, the price field shows the notice. | S |
| P1-09 | Mobile | Overflow on Browse toolbar (4 pages), Home hero, Coming soon. | Sideways scroll at 320–390px. | Wrap toolbar; clamp `minWidth`; wrap chips. | — | `scrollWidth == clientWidth` at 320/375/390 on all 25 audited routes (re-run this audit's script). | S |
| P1-10 | Footer | `<span onClick>` links. | Keyboard/screen-reader users can't use the footer. | `<Link>`. | — | All footer items reachable by Tab and announced as links. | S |

### P2 — UX and functionality

| ID | Page | Problem | Solution | Acceptance | Size |
|---|---|---|---|---|---|
| P2-01 | Start menus | Misrouted items; no Start a Circle. | Items per UX-05. | Each Start item opens a create flow. | S |
| P2-02 | Global | Terminology drift. | Glossary + apply to nav, titles, footer. | One term per concept across nav, titles, footer. | S |
| P2-03 | `/vendor` | Staff tabs not role-filtered. | Filter by `platform_role` (expose it on `/auth/me` if absent). | read_only_analyst sees no write tabs. | S |
| P2-04 | `/admin` | Tabs ignore `admin_role`; roles/help buried in Finance; reports under Reviews. | Filter tabs; restructure per Deliverable 7. | Support admin sees no finance tabs. | M |
| P2-05 | My Life | No Upcoming/Past/Cancelled filter; no order detail. | Filters + `/my-life/orders/:ref`. | Each booking type opens one detail view with receipt + refund timeline. | M |
| P2-06 | Profile | 16 mixed sections. | Split settings vs content. | ≤9 settings sections. | M |
| P2-07 | Checkout | 4 summary components. | Migrate Experience/Game/Pass to the kit `CheckoutSummary`. | One component renders every price breakdown. | M |
| P2-08 | Circles | Announcements preference no-op. | Hide toggle or build feature. | No preference without a sender. | S/M |
| P2-09 | Waitlists / notify-me | No leave/position/unsubscribe UI though APIs exist. | Wire the existing wrappers. | Resident can leave a waitlist and stop notify-me. | S |
| P2-10 | Admin | Can't edit listing content; no people/bookings lists. | Wire `adminUpdateCentre/Club`; People + Bookings tabs on the support-search queries. | Admin can fix a typo on a listing. | M |
| P2-11 | Sign-in | Two doors. | Unified screen with business tab. | `/login` = `/signin?as=business`. | M |
| P2-12 | Touch targets | 23–41 sub-24px targets on Explore/Home/Policies. | Enlarge hit areas. | 0 interactive targets <24px on audited routes. | S |
| P2-13 | Receipts | Pure-guest bookings excluded. | Link guest bookings to the resident on verified-email sign-in, or show receipts by client id. | A guest who later signs in sees the receipt. | M |
| P2-14 | My Life dates | Device-local "past" check. | Use `irelandToday()`. | Correct at 23:30 on a UTC+1 device. | S |
| P2-15 | `/volunteer`, `/ask`, `/landing` | Orphans. | Add Volunteer to Explore; retire `/landing`; fold `/ask` into Explore search. | No navigable route without an entry point (except tokens/SEO). | S |
| P2-16 | Host workspace | No draft/published/past filter. | Filter chips. | Drafts listable. | S |
| P2-17 | Host payouts | Any resident can open host payout onboarding. | Require verified host (or active priced activity). | Unverified resident gets 403. | S |
| P2-18 | Admin approvals | No sub-role guard on approvals/audit/support. | Decide policy; add `requireAdminRole` where needed. | Matrix row matches decision. | S |

### P3 — Future enhancements
Launch updates page; Events category; FAQ CMS; vendor pass products with tiered pricing (MS-12; essential before passes are sold); per-room opening hours; offers on programmes/experiences ([prior-doc] G8); Circle discussions beyond chat; remove `/for-venues` duplication after the redirect period; dead wrappers clean-up (`fetchVendorSchedule`, `fetchVendorToday`, `fetchGameNextSteps`, `fetchResidentNotifications`, `uploadImage`).

### Paid-launch-only items (keep disabled)
Paid checkout (all 6 types), Pro subscriptions, partner rewards, customer credits, Connect payouts/settlement, Open Booking resale, deposits automation, acknowledgement enforcement, registration/programme cancel deadlines, Stripe-fee handling on refunds (R3B F4). All remain behind `PAID_CHECKOUT`, `PARTNER_FEE_MODEL_STATUS="proposed"` and the `commerce.*` switches (default off).

---

## Deliverable 11 — Coverage summary

**Counting rules.** A *page* is a distinct route pattern in `App.tsx`'s main router that renders a page component. Not counted: redirects (4), aliases (`/my-life`), dev-only (`/dev/booking-kit`), tabs, drawers, dialogs and sections (e.g. the 16 Profile sections or 20 Admin tabs). Create and edit routes sharing one component (`/games/host`, `/games/host/:gameId`) count as two routes. A *missing target page* is a master-sitemap item with no route and no in-page equivalent (§3c). Items covered by a tab are *not* counted as missing.

| Metric | Count | Notes |
|---|---|---|
| Total implemented pages | **72** | §3a |
| Complete | **38** | |
| Needs improvement | **17** | |
| Partially implemented | **2** | `/policies`, `/policies/:key` |
| Feature-gated | **13** | venue (5 incl. book/register), paid (2 payment pages), switch (MIH), fee model (4 Pro/rewards + `/pricing`) |
| Duplicate | **2** | `/for-venues`, `/landing` |
| Broken pages | **0** | 6 broken *links* (UX-02), no broken page |
| Deprecated redirects | 4 | kept for old links |
| Missing target pages | **12** fully missing + 2 partial | MS-01…MS-14 (MS-11, MS-13, MS-14 partial; MS-12 counted missing) |
| Journeys audited | **38** | J01–J38 |
| — covered by named integration specs (prior-QA, not re-run) | **18** | J02, J05–J08, J11, J12, J14–J16, J19, J22–J24, J27, J29, J33, J34 (J03/J13 also run on the test profile with gates open) |
| — traced in code only (untested by automation) | **13** | J01, J04, J10, J17, J20, J21, J25, J26, J28, J30, J35–J37 (some partial) |
| — gated by design | **4** | J03, J09, J13, J18 |
| — confirmed gaps | **3** | J31, J32, J38 |
| Browser-verified in this audit | 25 routes × 5 widths | signed-out only; overflow, touch targets, h1 count, titles |

18 + 13 + 4 + 3 = 38.

---

## Deliverable 12 — Implementation roadmap

1. **Critical safety fixes:** P0-01 (merge + deploy the paid-checkout gate before any prod Stripe key), and keep P0-02 open as the paid-launch blocker.
2. **Free-launch essentials:** P1-01 (account deletion) · P1-02 (footer copy, About, Contact) · P1-03 (publish legal docs) · P1-04 (root = Home) · P1-05 (deep links) · P1-06 (hide venue nav) · P1-07 (Make It Happen paused state) · P1-08 (price-field warning) · P1-09 (mobile overflow) · P1-10 (footer links). Apart from P1-01 and P1-03 these are all S-sized; a reasonable estimate is one or two focused days of engineering plus the legal/retention decisions.
3. **Customer UX:** P2-01, P2-02, P2-05, P2-06, P2-08, P2-09, P2-12, P2-13, P2-14, P2-15.
4. **Host UX:** P2-16, P2-17, Start menu (P2-01), Circle announcements decision (P2-08).
5. **Vendor UX:** P2-03, merge Listings/Programs/Experiences tabs, Bookings status filters, pass products (before passes sell).
6. **Admin:** P2-04, P2-10, P2-18.
7. **Paid-launch readiness:** R3B D1–D9 decisions → one fee formula → flip `PARTNER_FEE_MODEL_STATUS` → order detail page (MS-07) → unified checkout summary (P2-07) → mandatory acknowledgements → cancel deadlines → deposits automation → admin bookings/refunds tools → Connect test-mode end-to-end → `PAID_CHECKOUT=open` on staging only → live sign-off.
8. **Post-launch:** P3 list.

---

## Phase 5 — Commercial & security safety (verification detail)

| Check | Local branch (`feature/commerce-engine`, uncommitted) | Production (`main`, archive deploy 2026-09-20) |
|---|---|---|
| Paid checkout closed by default | ✓ `paidCheckoutOpen()`: unset + `NODE_ENV=production` → closed (`releaseGates.ts:18-23`) | ✗ gate not present; closed only because `STRIPE_SECRET_KEY` is absent (prod check 2026-10-11) |
| A Stripe key alone can't open paid | ✓ needs `PAID_CHECKOUT=open` | ✗ a key alone **would** open it |
| Free bookings keep working | ✓ gate is inside `createCheckoutSession()` only; free/cash/€0 never reach it [code] + [prior-QA booking 38 pass] | ✓ (no paid path at all) |
| No alternate paid route | ✓ 6 callers, all through checkoutService; only other Checkout is Pro subscription, behind `proPurchaseAllowed()` | n/a |
| Pro & rewards disabled | ✓ `proPurchaseAllowed()` false outside `NODE_ENV=test`; admin can't enable `commerce.pro_subscriptions` / `commerce.circle_credits` (`catalog.ts:427`) | not deployed (feature absent on main) |
| Fee estimates not shown as live | ✓ `/pricing` pending page; `X-HelloCircle-Fee-Model: proposed` (`pricingPublic.ts:27`); EarningsSummary fee rows hidden (`EarningsSummary.tsx:135`) | main has no `/pricing` fee calculator [not re-checked in prod] |
| Receipts isolated per customer | ✓ resident-scoped queries; foreign ref → 404 (`receipts.ts:5-6,56-84`) [prior-QA authz 83 pass] | receipts detail not deployed |
| Partner earnings/payouts tenant-scoped | ✓ vendor: `requireVendor` + `requirePlatformRole("finance")` + org party (`payouts.ts:43`); host: resident id (`payouts.ts:53`) | Connect not deployed |
| Admin-only actions server-protected | ✓ `adminRouter.use(requireAdmin)` (`admin.ts:25`) + sub-role guards (`:27-37`) | ✓ `requireAdmin` exists on main (sub-roles not deployed) |
| Historical receipts not recalculated | ✓ receipt detail reads stored `pricing_snapshots` first, then stored columns, then total-only (`receipts.ts:1-6,196`) — never re-prices | n/a |

**The production-vs-local split is the key safety fact.** Every protection in the left column is local and uncommitted, except the hotfix-branch copy of the checkout gate, which is pushed but not merged.

---

## Executive summary

**1. Overall completeness.** 72 navigable pages. 38 complete (53%), 17 need improvement, 2 partial, 13 deliberately feature-gated, 2 duplicates, 0 broken pages. Against the master sitemap, 12 target pages are fully missing; most of the rest exist as tabs. The product is functionally broad and deep for free participation. What's missing is mainly trust/legal surfaces, navigation coherence and paid-launch tooling.

**2. Top 10 critical gaps**
1. Paid-checkout release gate not on `main`/prod. Prod is safe only because no Stripe key is set (P0-01).
2. No approved VAT/fee model, so paid stays NO-GO (P0-02).
3. No account deletion (P1-01).
4. "Concept prototype" footer; no About/Contact (P1-02).
5. Terms/Privacy unpublished (P1-03).
6. Root `/` and the logo send everyone to the vendor pitch (P1-04).
7. Six broken `/bookings?tab=` deep links (P1-05).
8. Primary nav routes to Coming soon for venue pages (P1-06).
9. Make It Happen promoted while switched off (P1-07).
10. Hosts can publish paid prices that can't be paid (P1-08).

**3. Top 10 UX improvements:** Start menu that actually starts things; one glossary (Programme, Activity, Saved); fix mobile overflow (Browse toolbar, Home hero, Coming soon); footer links as real links; larger touch targets on Explore/Home; role-filtered vendor and admin tabs; My Life filters + order detail; split Profile settings from content; one checkout summary component; one sign-in screen.

**4. Missing essential pages:** About, Contact, account deletion (free launch); order/booking detail, admin bookings list, vendor pass products (paid launch).

**5. Recommended final navigation:** Customer: Home · Explore · Circles · My Life · Host▾ (tab bar unchanged). Host / Vendor / Admin: ManageShell sidebars per Deliverable 7, filtered by role.

**6. Free-launch readiness: NOT READY, but close.** The core free journeys work and most are covered by passing integration specs [prior-QA]. Blockers are P1-01 to P1-10. Eight of them are small engineering items. P1-01 needs a retention decision and P1-03 needs legal sign-off.

**7. Paid-launch readiness: NO-GO.** This is unchanged from R3B: fee/VAT model, mandatory acknowledgements, cancel deadlines, deposits, refund tooling and Connect end-to-end are all outstanding. Deploying the release gate to prod is the first prerequisite.

**8. Suggested order:** P0-01 → P1-04/05/06/07/10 (navigation and link fixes) → P1-09 (mobile) → P1-08 → P1-02 → P1-01 → P1-03 (as legal allows) → P2 by role → paid-launch track.

*Audit stops here. No changes will be made until approved.*
