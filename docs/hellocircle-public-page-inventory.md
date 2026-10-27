# HelloCircle — Public Page Inventory

**Date:** 2026-10-21 · **Branch:** `feature/workspace-detail-pages` @ `315f0d2` · Audit only. Evidence tags and gap IDs (`PUB-nn`) are defined in `hellocircle-public-gap-matrix.md`.

## 1. Counting method

Source: the main router in `client/src/App.tsx:351-465` (84 `path=` entries).

| Group | Count | Notes |
|---|---|---|
| Public, resident and auth **page routes** | **64** | Render a page. Includes `/:county/:activity` (one pattern, many URLs). |
| Redirect-only public routes | 5 | `/landing`→`/`, `/compare`→`/browse/centres`, `/onboarding`→`/bookings?setup=1`, `/search` and `/ask`→`/explore?q=` |
| Catch-all | 1 | `*` → NotFound |
| Workspace routes (out of scope; see `workspace-page-inventory.md`) | 13 | `/vendor`, `/vendor/{centres,clubs,programs,experiences}/:id`, `/vendor/pro`, `/vendor/rewards`, `/manage`, `/manage/pro`, `/manage/rewards`, `/manage/activities` (redirect), `/manage/circles/:id`, `/admin` |
| Dev-only | 1 | `/dev/booking-kit` |
| **Total** | **84** | |

Launch gates change what a visitor can reach: with `VITE_LAUNCH_MODE` not `public`, everything non-exempt redirects to `/coming-soon`; with `VITE_VENUE_PAGES_PUBLIC` unset (the current `client/.env`), `/browse/*`, `/centres/:id`, `/clubs/:id`, `/book/:id`, `/register/:id` redirect to `/coming-soon` (`App.tsx:306-307`). This audit opened the venue gate in a separate audit-only Vite instance to inspect those pages.

**Status vocabulary** — every target entry gets exactly one:
- **Complete** — required behaviour works; verified in browser in this audit and/or by a passing prior QA spec (stated).
- **Partial** — exists, but a required behaviour is missing, wrong or gated.
- **Combined** — supported inside another route by design (a section, tab, step or popup). Not double-counted as a page.
- **Missing** — no implementation (or content) at all.
- **Broken** — exists but fails its purpose.
- **Deferred** — built, intentionally switched off.

## 2. Actual route inventory (64 page routes)

UX: G = good, F = fair, P = poor. Resp.: widths with no overflow; all 64 rendered without horizontal overflow at the widths tested. "B" = browser-tested in this audit (390/768/1024/1440/1920 unless noted), "B-res" = signed-in at 390/1440, "C" = code-inspected only.

| Route | Page (title) | Roles | Template | Component | Backend | Evidence | UX | Main issues | Pri | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | Home | all | Editorial landing | `pages/Home.tsx` (ForVenues while gated) | `/discover/*`, `/games` | B | F | 9.3 screens mobile; two searches desktop (PUB-26) | P2 | Complete |
| `/home` | Home | all | same | `Home.tsx` | same | B | F | Duplicate URL of `/` (kept for links) | P3 | Complete |
| `/coming-soon` | Coming soon | all | Splash | `ComingSoon.tsx` | waitlist | C | – | Launch gate target | – | Complete |
| `/explore` | Explore | all | Discovery | `Explore.tsx` | `/discover/*` | B | F | Results below fold mobile (PUB-18); "Compare places" dead-ends when gated (PUB-09) | P1 | Complete |
| `/browse/:category` | Community centres / Sports clubs | all | Discovery + map | `Browse.tsx` | `/centres`, `/clubs` | B (gate opened) | F | Gated (PUB-09); unnamed icon buttons, unlabelled selects (PUB-15) | P1 | Partial |
| `/centres/:id` | Centre | all | Venue detail | `CentreDetail.tsx` | `/centres/:id`, reviews | B (gate opened) | G | Gated | P1 | Partial |
| `/clubs/:id` | Club | all | Club detail | `ClubDetail.tsx` | `/clubs/:id`, passes | B (gate opened) | G | Gated | P1 | Partial |
| `/book/:centreId` | Book a space | all (guest ok) | Booking kit, 4 steps | `BookingFlow.tsx` | `/bookings/*`, quote, Stripe | B step 1 only; [prior-QA] `booking-centre.spec` | F | Gated; sparse summary rail on step 1 | P1 | Partial |
| `/register/:clubId` | Register | all (guest ok) | Booking kit, 3 steps | `RegistrationFlow.tsx` | `/registrations/*` | B step 1; [prior-QA] `booking-club.spec` | F | Gated; fires a quote POST on load | P1 | Partial |
| `/games` | Activities | all | Discovery | `Games.tsx` | `/games` | B | F | Own filter pattern (PUB-19); "games & sessions" copy | P2 | Complete |
| `/games/:id` | Activity | all; join = resident | Activity detail | `GameDetail.tsx`, `GameJoinCard.tsx` | `/games/:id`, join/quote/waitlist | B (+B-res); [prior-QA] `booking-activity.spec`, lifecycle-activity-* | F | 404 as load error (PUB-14); action row (PUB-27) | P1 | Complete |
| `/games/host`, `/games/host/:gameId` | Host a session | resident | Create/edit form | `HostGamePage.tsx` | `POST/PUT /games` | B (signed out: no H1), B-res | F | Signed-out view has no H1 | P2 | Complete |
| `/free-time` | Free Time Mode | all | Wizard | `FreeTimeMode.tsx` | `/discover/*` | B | G | – | – | Complete |
| `/make-it-happen` | Make It Happen | resident | Form | `MakeItHappen.tsx` | `/make-it-happen` | B ("paused") | G | Switched off (commerce switch) | – | Deferred |
| `/suggest-place` | Suggest a place | all | Form | `SuggestPlace.tsx` | `/place-suggestions` | B | F | 6 unlabelled fields (PUB-15) | P1 | Complete |
| `/circles` | Circles | all | Discovery | `Circles.tsx` | `/circles` | B (+B-res) | F | 7.3 screens mobile | P2 | Complete |
| `/circles/start` | Start a Circle | resident | Form | `StartCirclePage.tsx` | `POST /circles` | B, B-res | G | – | – | Complete |
| `/circles/:id` | Circle | all; actions members | Circle detail | `CircleDetail.tsx` | 40 circle endpoints | B, B-res; [prior-QA] lifecycle-circle-* | F | Member actions buried (PUB-30) | P2 | Complete |
| `/bookings` = `/my-life` | My Life | resident; guest by client id | Dashboard | `MyBookings.tsx` | ~14 resident reads | B, B-res | P | False expiry banner (PUB-05); void/missing upcoming (PUB-08) | P1 | Partial |
| `/receipts/:ref` | Receipt | resident | Record | `ReceiptPage.tsx` | `/residents/me/receipts/:ref` | B (signed out) | F | Expiry banner (PUB-05) | P1 | Complete |
| `/profile` (+ `?tab=` ×17) | Profile | resident | Account settings | `Profile.tsx` | residents, household, favourites, follows, passes, notifications | B-res (14 tabs) | F | Clipping (PUB-23); dead credit tab (PUB-22); unlabelled fields (PUB-15) | P2 | Partial |
| `/chats` | Chats | resident, vendor | Inbox | `Chats.tsx` | `/chat/inbox` | B, B-res | P | Wrong view on direct load (PUB-06) | P1 | Broken (direct load) |
| `/signin` | Sign in | all | Auth | `SignIn.tsx` | `/guest/login`, magic link, Google | B | G | Two login doors (PUB-35) | P2 | Complete |
| `/signin/create` | Create account | all | Auth | `SignUp.tsx`, `AuthForms.tsx` | `/guest/signup` | B | F | "Terms" unlinked (PUB-02) | P0 | Partial |
| `/signin/email-link` | Email link | all | Auth | `EmailLinkSignIn.tsx` | `/guest/request-link` | C | – | – | – | Complete |
| `/programs` | Programmes | all | Discovery + map | `Programs.tsx` | `/programs` | B | F | Heading skip | P2 | Complete |
| `/programs/:id` | Programme | all; enrol any | Programme detail + enrol popup | `ProgramDetail.tsx` | enrol/quote/Stripe | B; [prior-QA] `booking-program.spec` | F | US spelling; late enrolment (PUB-17) | P1 | Complete |
| `/provider/:id` | Provider profile | all | Public profile | `ProviderProfile.tsx` | `/providers/:id` | B | F | Thin/mislabelled (PUB-38) | P2 | Partial |
| `/host/:id` | Host profile | all | Public profile | `HostProfile.tsx` | `/hosts/:id` | B | P | 1.9 screens, raw dates (PUB-24/38) | P2 | Partial |
| `/experiences`, `/adventures`, `/volunteer` | Experiences / Adventures / Volunteer | all | Discovery + map | `ExperienceKindBrowse` via thin pages | `/experiences?kind=` | B | F | Undated listings (PUB-13); volunteer empty (PUB-37) | P1 | Partial |
| `/experiences/:id`, `/adventures/:id` | Experience | all; book any | Experience detail + inline booking | `ExperienceDetail.tsx` | sessions/quote/Stripe | B; [prior-QA] `booking-experience.spec`, `hc-og19-departures.spec` | G | Image mismatch [data] | P1 | Complete |
| `/payment/success` | Payment result | all | Confirmation | `PaymentSuccess.tsx` | order status endpoints | B (not-found state); [prior-QA] `qa:stripe` 51/51 | F | Title always "Payment confirmed" (PUB-04) | P0 | Partial |
| `/payment/cancel` | Payment cancelled | all | Confirmation | `PaymentCancel.tsx` | – | B | G | – | – | Complete |
| `/login` | Business log in | vendor/admin | Auth | `Login.tsx` | `/auth/login` | B | G | – | – | Complete |
| `/forgot-password`, `/reset-password` | Reset password | vendor/admin | Auth | `ForgotPassword.tsx`, `ResetPassword.tsx` | `/auth/request-reset` | B / C | F | Vendor-only copy (PUB-35) | P2 | Complete |
| `/accept-invite`, `/admin-invite` | Accept invite | invited staff | Auth | `AcceptInvite.tsx`, `AdminInviteAccept.tsx` | `/auth/accept-invite` | C; [prior-QA] D-08 specs | – | Workspace entry | – | Complete |
| `/booking-change` | Booking change | booker | Token form | `BookingChangePage.tsx` | booking change tokens | C | – | – | – | Complete (code) |
| `/manage/link-confirm` | Link confirm | resident | Token | `ManageLinkConfirm.tsx` | `/manage/link/confirm` | C; [prior-QA] `account-link-*` | – | – | – | Complete |
| `/i/:token` | Invitation | invitee | Landing | `InvitationLanding.tsx` | invitations | C; [prior-QA] invitation-* (6 specs) | – | – | – | Complete |
| `/for-venues`, `/partners` | For venues | all | Editorial landing | `ForVenues.tsx` | waitlist | B | F | Pre-launch banner always on (PUB-10) | P1 | Partial |
| `/pricing` | Pricing for partners | all | Content | `Pricing.tsx` | – | B | F | "We're finalising the fees" (pending decision) | – | Deferred |
| `/become-a-host` | Become a host | all | Editorial landing | `BecomeAHost.tsx` | – | B | F | Paid-hosting claim (PUB-11) | P1 | Partial |
| `/vendor/signup` | Become a provider | all | Multi-step form | `VendorSignup.tsx` | `/auth/signup` | B step 1; [prior-QA] lifecycle | G | – | – | Complete |
| `/privacy` | Privacy Policy | all | Policy | `CmsPolicy` → `PrivacyPolicy.tsx` | `/policies/privacy-policy` | B | P | Placeholders (PUB-01) | P0 | Broken |
| `/cookies` | Cookie Policy | all | Policy + control | `CmsPolicy` → `CookiePolicy.tsx` | `/policies/cookie-policy` | B | F | Intro contradicts table (PUB-34) | P2 | Partial |
| `/policies`, `/policies/:key` | Policy Centre | all | Policy index/doc | `Policies.tsx` | `/policies` | B | F | All 18 docs "Being prepared" on dev (PUB-02) | P0 | Partial |
| `/about` | About | all | Content | `About.tsx` | – | B | G | – | – | Complete |
| `/contact` | Contact us | all | Content | `Contact.tsx` | – | B | G | Mailto routing, no form (fine) | – | Complete |
| `/complaints` | Complaints and appeals | all | Form | `Complaints.tsx` | `/complaints` | B | G | – | – | Complete |
| `/help-guide` + 4 sub-pages | Help guide | all | Content | `HelpGuide*.tsx` | – | B (index, explore) | F | `/help-guide/explore` is 11 screens at 390px | P2 | Complete |
| `/:county/:activity` | Local landing | all | Discovery (SEO) | `LocalActivity.tsx` | `/discover/local/:c/:a` | B (2 URLs, 0 results) | F | PUB-25 | P2 | Partial |
| `*` | Not found | all | Error | `NotFound.tsx` | – | B | G | – | – | Complete |

(The table groups 7 sub-routes — `/games/host/:gameId`, `/adventures`, `/volunteer`, `/adventures/:id`, `/reset-password`, `/admin-invite`, `/partners`, `/policies/:key`, 4 help-guide sub-pages — into their family rows; all 64 routes are covered.)

## 3. The 73 target entries

| # | Target | Actual route / location | Status | Evidence | Notes / gaps |
|---|---|---|---|---|---|
| 1 | Homepage | `/` (`/home`) | Complete | B | PUB-26 |
| 2 | Explore All | `/explore` | Complete | B | PUB-18, PUB-09 |
| 3 | Activities & Games | `/games` | Complete | B | PUB-19, PUB-20 |
| 4 | Experiences & Adventures | `/experiences`, `/adventures` | Partial | B | Undated listings shown first (PUB-13) |
| 5 | Programmes & Classes | `/programs` | Complete | B | Spelling (PUB-20) |
| 6 | Venues & Spaces | `/browse/centres` | Partial | B (gate opened) | Gated off (PUB-09) |
| 7 | Clubs & Communities | `/browse/clubs` | Partial | B (gate opened) | Gated off (PUB-09) |
| 8 | Circles Discovery | `/circles` | Complete | B | – |
| 9 | Search Results | `/explore?q=` (`/search`, `/ask` redirect) | Combined | B | Header search → Explore |
| 10 | Map Discovery | Map toggle on Browse, Programmes, Experiences, Adventures, Volunteer | Partial | B | No map on Explore/Activities/Circles (PUB-40) |
| 11 | Category Landing | Category filters: `/games?activity=`, `/experiences`, `/adventures`, Home tiles | Combined | B | – |
| 12 | Location Landing | `/:county/:activity` | Partial | B, C | PUB-25 |
| 13 | Activity / Game Detail | `/games/:id` | Complete | B; prior-QA | PUB-14, PUB-27 |
| 14 | Experience Detail | `/experiences/:id`, `/adventures/:id` | Complete | B; prior-QA | – |
| 15 | Programme Detail | `/programs/:id` | Complete | B; prior-QA | PUB-17 |
| 16 | Class / Session Detail | Sessions listed inside Programme / Activity detail | Combined | B | Programme sessions also appear as separate Explore cards (PUB-17) |
| 17 | Venue / Place Detail | `/centres/:id` | Partial | B (gate opened) | Gated |
| 18 | Room / Facility Detail | Room picker = step 1 of `/book/:centreId`; rooms listed on centre page | Combined | B | No standalone room page — not needed |
| 19 | Club Detail | `/clubs/:id` | Partial | B (gate opened) | Gated |
| 20 | Circle Detail | `/circles/:id` | Complete | B, B-res; prior-QA | PUB-30 |
| 21 | Event Detail | "Events" menu → `/explore?when=weekend`; events are activities/experiences | Combined | B | No separate event type exists or is needed |
| 22 | Host Public Profile | `/host/:id` | Partial | B | PUB-24, PUB-38 |
| 23 | Vendor Public Profile | `/provider/:id` | Partial | B | PUB-38 |
| 24 | Select Date & Time | Step 2 of `/book/:id`; session picker on experience/programme; activity has one time | Combined | C; prior-QA | – |
| 25 | Select Tickets | Party size on experience booking; 1 seat per activity join | Combined | C | – |
| 26 | Venue Booking | `/book/:centreId` | Partial | B step 1; prior-QA | Gated |
| 27 | Programme Enrolment | Enrol popup on `/programs/:id` | Complete | C; prior-QA `booking-program.spec` | Late-join rule (PUB-17) |
| 28 | Booking Review | Last step of each booking kit flow | Combined | C; prior-QA | – |
| 29 | Checkout & Payment | Stripe Checkout via `checkoutService.ts` | Complete | prior-QA `qa:stripe` 51/51 | Not executed here (no writes) |
| 30 | Booking Confirmation | `/payment/success`; free bookings confirm inline | Partial | B (not-found); prior-QA | PUB-04 |
| 31 | Booking Details | Inline My Life cards, listing pages, `/receipts/:ref` | Partial | C | No booking record page (PUB-12) |
| 32 | Booking Cancellation | Cancel in My Life cards / join cards | Complete | C; prior-QA `booking-remediation-cancel.spec` | Not executed here |
| 33 | Payment Result | `/payment/success`, `/payment/cancel` | Combined | B | Shares #30's page and its gap |
| 34 | My Circles | "My Circles" section in My Life; `/manage?tab=circles` for organisers | Partial | B-res | Shows 3 of 5 Circles (PUB-08) |
| 35 | Circle Overview | `/circles/:id` | Complete | B-res | – |
| 36 | Circle Members | Members section in Circle detail; manage in `/manage/circles/:id` | Combined | B-res; prior-QA | – |
| 37 | Circle Events | "Upcoming plans" section | Combined | B-res | – |
| 38 | Circle Discussions | Group chat popup per Circle; announcements | Partial | C; prior-QA `chat-closure.spec` | No threads (PUB-42, deferred) |
| 39 | Circle Polls | Polls section | Combined | B-res; prior-QA `lifecycle-findings-polls-states.spec` | – |
| 40 | Circle Planning | Plan ideas section | Combined | B-res; prior-QA `lifecycle-circle-planning.spec` | – |
| 41 | Create Circle | `/circles/start` | Complete | B-res | – |
| 42 | Edit Circle | `/manage/circles/:id` settings | Combined | B-res | Host workspace |
| 43 | Circle Invitations | Invite API + `/i/:token` | Complete | prior-QA invitation-* | – |
| 44 | Login / Sign Up | `/signin`, `/signin/create`, `/login`, `/vendor/signup` | Partial | B | PUB-02, PUB-35 |
| 45 | Account Setup | `AccountSetupGate` popup (`/onboarding` redirects) | Combined | B-res | – |
| 46 | My Life Dashboard | `/my-life` | Partial | B, B-res | PUB-05, PUB-08 |
| 47 | My Bookings | Same page, "View full activity" section | Combined | B-res | Inherits #46 gaps |
| 48 | My Activities | My Life + `/manage` (hosted) | Combined | B-res | – |
| 49 | Saved / Favourites | `/profile?tab=favourites` | Partial | B-res | PUB-21 |
| 50 | Following | `/profile?tab=following` | Complete | B-res | – |
| 51 | Notifications | Header bell + `/profile?tab=inbox` | Complete | B-res | – |
| 52 | My Profile | `/profile` | Partial | B-res | PUB-23 |
| 53 | Edit Profile | Inline in `/profile` | Combined | B-res | – |
| 54 | Account Settings | Profile tabs (notifications, privacy & accessibility, payment, data download, deactivate, erasure request) | Combined | B-res | – |
| 55 | Credits & Rewards | `/profile?tab=credit` | Deferred | B-res | Commerce switch off; tab still shown (PUB-22) |
| 56 | Reviews & Ratings | Reviews on each detail page | Partial | C | No prompts / no "my reviews" (PUB-32) |
| 57 | Become a Host | `/become-a-host` | Partial | B | PUB-11 |
| 58 | Host Application | `/profile?tab=hosting` (Verified Host) | Partial | B-res | Unlabelled fields (PUB-15) |
| 59 | List Your Venue | `/for-venues`, `/partners` | Partial | B | PUB-10 |
| 60 | Vendor Registration | `/vendor/signup` | Complete | B step 1; prior-QA | – |
| 61 | Create Activity Entry | `/games/host` | Complete | B-res | – |
| 62 | Host Resources | `/help-guide/start` only | Partial | B | PUB-41 |
| 63 | Partner Resources | none | Missing | C (`Footer.tsx:61`) | PUB-41 |
| 64 | About HelloCircle | `/about` | Complete | B | – |
| 65 | How It Works | `/help-guide` | Combined | B | – |
| 66 | Help Centre | `/help-guide` + signed-in `/profile?tab=help` | Partial | B | PUB-07 |
| 67 | Contact Us | `/contact` | Complete | B | – |
| 68 | Trust & Safety | Signed-in `/profile?tab=safety`; Community & Safety policy unpublished | Partial | B | PUB-07, PUB-02 |
| 69 | Cancellation & Refund Policy | `/policies/cancellation-refunds` — unpublished | Missing | B, API | PUB-03 (legal) |
| 70 | Terms & Conditions | `/policies/general-terms` — unpublished | Missing | B, API | PUB-02 (legal) |
| 71 | Privacy Policy | `/privacy` — placeholder fallback | Broken | B | PUB-01 (legal) |
| 72 | Cookie Policy | `/cookies` — fallback with consent control | Partial | B | PUB-34 |
| 73 | Accessibility Information | `/policies/accessibility-statement` — unpublished | Missing | API | PUB-36 (legal) |

### Totals (each entry counted once)
| Status | Count | Entries |
|---|---|---|
| Complete | 21 | 1, 2, 3, 5, 8, 13, 14, 15, 20, 27, 29, 32, 35, 41, 43, 50, 51, 60, 61, 64, 67 |
| Combined | 20 | 9, 11, 16, 18, 21, 24, 25, 28, 33, 36, 37, 39, 40, 42, 45, 47, 48, 53, 54, 65 |
| Partial | 26 | 4, 6, 7, 10, 12, 17, 19, 22, 23, 26, 30, 31, 34, 38, 44, 46, 49, 52, 56, 57, 58, 59, 62, 66, 68, 72 |
| Missing | 4 | 63, 69, 70, 73 (69/70/73 are unpublished legal content, not missing code) |
| Broken | 1 | 71 |
| Deferred | 1 | 55 |
| **Total** | **73** | |

**Fully supported** = Complete + Combined whose host page is Complete. Combined entries whose host is itself Partial: 33 (in #30), 47 and 48 (in #46), 24/28 for venues (in #26, gated). So 21 Complete + 15 fully-supported Combined = **36 fully supported**; **26 Partial**; **5 Missing or Broken**; **1 Deferred**; and **5 Combined entries inherit their host's Partial status** (36+26+5+1+5 = 73).

Entries that should stay combined rather than become separate routes: 9, 11, 16, 18, 21, 24, 25, 28, 33, 36, 37, 39, 40, 42, 45, 47, 48, 53, 54, 65 — and the Circle sub-areas should be URL-backed tabs/anchors on `/circles/:id` (see `hellocircle-public-ux-ui-audit.md` §Circles), not new pages. The one place a new route is recommended is **Booking Details** (#31, PUB-12), plus public **Help** and **Safety** pages (#66/#68, PUB-07).
