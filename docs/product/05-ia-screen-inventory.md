# Document 05 — Information Architecture & Screen Inventory

The real route tables from `client/src/App.tsx` and `apps/mobile/src/app/**` — no page in the client scope was found to be UI-only or mock; every route below calls a real API except the two marked static/legal.

## Web client — screen inventory

| Route | Page | User | Purpose | Status |
|---|---|---|---|---|
| `/` | Home.tsx | Visitor/Resident | Personalized discovery feed | Implemented |
| `/landing` | LandingPage.tsx | Visitor | Standalone marketing page | Implemented |
| `/explore` | Explore.tsx | Visitor/Resident | Discovery Mode + Results Mode, ranked+personalized | Implemented |
| `/browse/:category` | Browse.tsx | Visitor | Centre/club listing, plain price/rating sort | Implemented |
| `/search` | SearchRedirect.tsx | — | Legacy redirect into Explore's Results Mode | Deprecated / redirect |
| `/centres/:id`, `/clubs/:id` | CentreDetail, ClubDetail | Visitor | Listing detail | Implemented |
| `/book/:centreId` | BookingFlow.tsx | Visitor/Resident | Room booking wizard | Implemented |
| `/register/:clubId` | RegistrationFlow.tsx | Visitor/Resident | Club registration | Implemented |
| `/programs/:id` | ProgramDetail.tsx | Resident | Program detail + enroll | Implemented |
| `/adventures`, `/experiences` (+`:id`) | Adventures.tsx, Experiences.tsx (thin wrappers around shared ExperienceKindBrowse), ExperienceDetail | Visitor | 3rd listing type browse/detail | Implemented |
| `/games`, `/games/:id` | Games.tsx, GameDetail | Resident | Ad-hoc game browse/join | Implemented |
| `/games/host(/:gameId)` | HostGamePage.tsx | Resident | Create/edit a game | Implemented |
| `/free-time` | FreeTimeMode.tsx | Resident | Mood-based discovery mode | Implemented |
| `/make-it-happen` | MakeItHappen.tsx | Resident | Min-participation intent capture | Implemented |
| `/suggest-place` | SuggestPlace.tsx | Resident | Suggest a new venue | Implemented |
| `/ask` | AskHelloCircle.tsx | Visitor | Conversational discovery helper | Implemented (backend unconfirmed) |
| `/circles`, `/circles/:id`, `/circles/start` | Circles.tsx, CircleDetail, StartCirclePage | Resident | Circle discovery/detail/creation | Implemented |
| `/bookings` | MyBookings.tsx | Resident | MyLife hub — unifies all 5 participation tables | Implemented |
| `/profile` | Profile.tsx | Resident | Account/household/preferences | Implemented |
| `/manage/activities` | ManageActivities.tsx | Resident | Resident-side "Manage" surface | Implemented |
| `/manage/circles/:id` | ManageCircle.tsx | Circle organiser | Circle management | Implemented |
| `/manage` | → redirect to `/vendor` | — | Legacy alias | Deprecated / redirect |
| `/compare` | → redirect to `/browse/centres` | — | Dead route kept for old bookmarks | Deprecated / redirect |
| `/signin` (+`/create`, `/email-link`) | SignIn/SignUp/EmailLinkSignIn | Visitor | Resident auth (password + magic link) | Implemented |
| `/onboarding` | Onboarding.tsx | New resident | Interests/county capture → personalization | Implemented |
| `/payment/success`, `/payment/cancel` | PaymentSuccess/PaymentCancel | Visitor/Resident | Stripe redirect landing | Implemented |
| `/provider/:id`, `/host/:id` | ProviderProfile, HostProfile | Visitor | Public vendor/host profile + reviews | Implemented |
| `/for-venues` | ForVenues.tsx | Visitor | Vendor-acquisition marketing | Implemented (static) |
| `/vendor/signup` | VendorSignup.tsx | Prospective vendor | Listing intake + org creation | Implemented |
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invite` | vendor/admin + staff-invite auth | Vendor/Admin/Staff | Password auth surfaces | Implemented |
| `/vendor` | VendorDashboard.tsx (shell + Vendor*.tsx tabs) | Vendor | Listings/Programs/Operations/Insights/Experiences/Org | Implemented |
| `/vendor/centres/:id`, `/clubs/:id`, `/programs/:id`, `/experiences/:id` | Vendor*EditPage.tsx | Vendor | Listing edit forms | Implemented |
| `/admin` | AdminDashboard.tsx (84KB, largest page in the repo) | Admin | Full moderation/RBAC/analytics console | Implemented |
| `/privacy`, `/cookies` | PrivacyPolicy, CookiePolicy | Visitor | Legal | Implemented (static) |
| `/:county/:activity` | LocalActivity.tsx | Visitor | Local-SEO landing pages (deliberately last-declared route) | Implemented |
| `*` | NotFound.tsx | — | 404 | Implemented |

## Mobile app (Expo/RN) — screen inventory

| Route | Area | Purpose | Status |
|---|---|---|---|
| `(tabs)/index, explore, start, my-life, messages` | Tabs | Home / Search+map / Action launcher / Personal hub / Conversations | Implemented |
| `(modals)/start-sheet` | Modal | Join game / Make It Happen action picker | Implemented |
| `(details)/centre\|club\|circle\|game/[id]` | Detail | Full detail, chat, invites (circle/game) | Implemented |
| `(details)/circle/[id]/edit` | Detail | Circle organiser edit form | Implemented |
| `(details)/receipt/[ref]` | Detail | Receipt / QR view | Implemented |
| `auth/sign-in, check-email, verify` | Auth | Magic-link resident auth | Implemented |
| `onboarding/*` | Onboarding | 5-step: welcome/location/interests/availability/done | Implemented |
| `booking/[centreId]/*` | Booking | Full room-booking wizard | Implemented |
| `registration/[clubId]/*` | Registration | Full club-registration wizard | Implemented |
| `make-it-happen/*` | Feature | 4-screen min-participation flow | Implemented |
| `host/games/*` | Host | Create/edit/manage-participants for hosted games | Implemented |

**No mobile screen exists for:** Vendor dashboard, Admin console, Passes, or a standalone Programs list (Programs surfaces only as a sub-list inside centre/club detail).

**Uncommitted `.web.*` files** (visible in the working tree) are complete, deliberate platform-override fallbacks, not in-progress work: `secureStore.web.ts`/`clientId.web.ts`/`pendingAction.web.ts` shim `expo-secure-store` (which has no web implementation at all) with a `localStorage`-backed store explicitly commented "never for anything resembling production," and `DetailMap.web.tsx`/`ResultsMap.web.tsx` stand in for `react-native-maps` (which crashes the web bundle at import time) with an honest "not available on web, see mobile app" message rather than a fake map.

## Feature parity: web vs. mobile

| Feature | Web | Mobile |
|---|---|---|
| Circles (browse/join/detail/chat) | ✔ | ✔ |
| Games (join/host/manage) | ✔ | ✔ |
| Programs | ✔ (own pages) | Sub-list only, no dedicated screen |
| Passes | ✔ | No mobile screen |
| Centre/room booking, club registration | ✔ | ✔ (full wizards) |
| Vendor dashboard | ✔ | None |
| Admin dashboard | ✔ | None |
| Reviews | ✔ | ✔ |
| Notifications | In-app | In-app + native push (web lacks push) |

## Information architecture, by audience

### Public / visitor
```
HelloCircle
├── Home (personalized if signed in)
├── Explore
│   ├── Discovery Mode (category tiles, today/weekend)
│   └── Results Mode (filter+sort, ranked feed)
├── Browse
│   ├── Centres
│   └── Clubs
├── Adventures / Experiences
├── Games (browse only until signed in)
├── Ask HelloCircle
├── For Venues (vendor acquisition)
└── Local activity pages (/:county/:activity)
```

### Signed-in resident
```
MyLife (hub)
├── Upcoming / Ongoing / Past
│   ├── Bookings · Registrations · Enrollments
│   ├── Game participation · Circle membership
│   └── Experience bookings · Intents
├── Circles (mine, suggestions, start one)
├── Following / Saved (favourites)
├── Household
└── Profile & preferences

Manage (resident-side host tools)
├── Manage Activities (hosted games)
└── Manage Circle (organiser tools)
```

### Vendor workspace
```
/vendor
├── Listings (centres, clubs, rooms, hours, blocks)
├── Programs (+ sessions, attendance)
├── Experiences (+ sessions)
├── Operations (bookings, registrations, schedule, check-in, messages)
├── Insights (CSV export, payments, demand — role-gated)
└── Org (profile, policies, staff invites — owner-only writes)
```

### Admin console
```
/admin
├── Vendors & host applications (approve/reject)
├── Listings moderation (pending, featured, status)
├── Organisations (CRUD, reassignment, RBAC, provider tier)
├── Reviews (unhide) & Reports (case queue)
├── Coupons & notification templates
├── Analytics (demand, liquidity, funnel, referrals)
└── Audit log
```

---
[← Module & Feature Catalogue](04-module-feature-catalogue.md) · [Next: User Journeys →](06-user-journeys.md)
