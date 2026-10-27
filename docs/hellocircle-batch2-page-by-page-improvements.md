# HelloCircle — Batch 2: Page-by-Page Improvements

**Date:** 2026-10-22 · Proposal only, awaiting approval. Screens: `docs/hellocircle-batch2-visuals/{before,after}/`. Gap IDs: `hellocircle-public-gap-matrix.md` (PUB-44 added in this pass, see proposal §A).

Each page lists: existing problem → proposed change → why it helps → affected component → responsive notes, then role differences.

---

## 1. Explore and discovery lists — `/explore`, `/games`, `/programs`, `/experiences`, `/adventures`, `/volunteer`, `/circles`, `/browse/*`
Screens: `before-explore-*`, `before-games-list-*` → `after-explore-*`, `after-filters-*`.

| Existing problem | Proposed change | Why | Component | Responsive |
|---|---|---|---|---|
| First result ~800px down on a 390px phone; Explore leads with category tiles (PUB-18) | Compact header: title, pill search (what + where/when as subtitle on phones), then type chips with counts, then result count + Filters + Sort | Listings are the content; the first card lands at ~275px | `DiscoveryHeader` (new) replaces `Explore.tsx` header, `Games.tsx` search card, `BrowseLayout` header | Phone: where/when open a full-screen picker; chips scroll horizontally |
| 4 filter patterns (PUB-19) | One `FilterBar` (type chips + Filters button with active count + Sort + List/Map) and one `FilterDialog` | Learn once, use everywhere | `FilterBar`, `FilterDialog` on `Modal`; reuses `FilterDropdown` logic | Dialog is centred on desktop, full-screen on phones; no side drawer |
| Results grouped by type with wide gaps ("Things to do" one card, then a new heading) | Single grid; type is a chip filter with counts ("Adventures & experiences 3") | No empty half-rows; scanning one grid is faster | `Explore.tsx` result rendering | 4 / 3 / 2 / 1 columns at 1440 / 1200 / 980 / 560 |
| 8 card components, different fields (PUB-19) | One `ListingCard` anatomy: media · kind · organiser · title · date/time+duration · place · price · availability · Save | Same reading order on every list | `ListingCard` (extend); adapters for `DiscoverCard`, `ExperienceSearchCard`, `CentreCard`, `ClubCard`, `CircleDiscoveryCard` | Phone uses row cards (120px square thumb) to show 3–4 results per screen |
| Striped placeholder (PUB-28) | `NoPhotoMedia`: category colour, kind eyebrow, title, date in peach | Looks intentional; carries information | `NoPhotoMedia` (new) | Same component at card and hero sizes |
| Programme sessions repeated as separate results (PUB-17) | One result per programme: "Programme · 6 weeks", "Starts Tue 3 Nov · Tuesdays 19:00" | Matches what you actually enrol in | Explore result mapping | – |
| "Compare places" competes with search | Lives in the centres list toolbar only (already hidden when gated, Batch 1) | Fewer competing actions | `Browse.tsx` | – |
| Loading / empty / error look different per list | Skeleton cards at final size; empty state with "widen area / any time / clear filters" and "I'm interested"; error alert with Try again | No layout shift; never "0 results" on failure | `CardSkeleton`, `EmptyState`, `LoadErrorState` | – |

Roles: identical for guests and residents except Save (guests are asked to sign in) and "I'm interested" (resident only).

## 2. My Life — `/my-life` (`/bookings`)
Screens: `before-my-life-*` → `after-my-life-*`; states in `after-components-*-full`.

| Existing problem | Proposed change | Why | Component | Responsive |
|---|---|---|---|---|
| Page header has Find a booking · Sign out · Edit profile buttons | Remove; Sign out stays in the account menu, Edit profile in Profile; "Find a booking" only for signed-out guests | The page is about plans, not account admin | `MyBookings.tsx` header | – |
| Greeting then stats; next plan not stated | Greeting + one line "Next up: X on Saturday at 09:00" | Answers "what am I doing next?" in one glance | `MyLifeHeader` | – |
| Next-up card lacks status/actions consistency | Next-up card: photo or `NoPhotoMedia`, date eyebrow, title, place, status pill, people, cancellation deadline, actions View booking (primary) · Get directions · Add to calendar | One obvious action | `MyLifeNextUp` | Photo stacks above text on phones |
| "Coming up" covers 4 kinds; Circle plans only if the activity was joined | Timeline rows across activities, experiences, programme sessions, venue bookings, club registrations and **joined** Circle plans (labelled "Circle plan · You're going"); each row's one action opens its booking record or Circle | Whole week in one list | `ParticipationTimeline` → `UpcomingItem` | Action moves under the title on phones |
| Needs-you and stats compete in the rail | Needs-you becomes a single amber bar above the content; rail = Saved, Hosting (if host), This month (last) | Attention items first, stats last | `MyLifeNeedsYou`, rail | Rail stacks after My Circles |
| My Circles capped (fixed in Batch 1 with Show all) | Header shows count "My Circles · 5", rows show next **own** plan / poll open / nothing planned | Consistent with the header count | `MyLifeCircles` | – |

Roles: signed-out → single sign-in card (Batch 1). Guest with client-id bookings → their bookings list + sign-in card. Resident who is a host → Hosting panel. Organiser → "Manage" on their Circle row.

## 3. Booking record — **New page** `/bookings/:kind/:ref`
Screens: `after-booking-*`, `after-cancel-*`, status variants in `after-components-*-full`.

Route compatibility: `/bookings` and `/my-life` render `MyBookings`; no nested `/bookings/*` routes exist today, emails link to `/bookings?ref=…&token=…` (unaffected). `kind ∈ booking | registration | program | experience | game | pass` — the same literals as the checkout metadata `type`, so links can be built from existing data.

| Need | Proposed | Component / API |
|---|---|---|
| One place for a booking | Header: image, "{Type} booking · Ref", title, facts (date, place, people) | `BookingRecordPage` (consumer styling; borrows the 70/30 idea from workspace `RecordView`) |
| What, where, who | Details list; participants; organiser | per-kind adapter over existing "mine" endpoints |
| Money | Server-provided lines exactly as charged + "VAT on your receipt"; link to receipt | `/residents/me/receipts/:ref` |
| Cancel | Cancellation facts from `components/booking/policy.ts`; "Cancel booking" opens the existing async `ConfirmDialog`; button hidden when the window has closed (no disabled buttons) | existing cancel endpoints |
| Status | Status card (Confirmed / Confirming payment / Payment being checked / Payment didn't go through / Cancelled / Refund on its way / Refunded / Completed) with exactly one primary action | maps existing `payment_status`, `status`, `paymentReview`, `paymentCase.state` |
| Next steps | Get directions, receipt, group chat (exists for bookings/departures), view the listing, Add to calendar (`.ics` downloads exist) | existing ICS + chat |
| Not found / not yours | "We couldn't find that booking" + My Life; never reveals someone else's booking | ownership = resident_id or client id (existing) |

Responsive: rail (status) moves **above** details on tablet/phone.

## 4. Circle detail — `/circles/:id`
Screens: `before-circle-visitor-*`, `before-circle-member-*` → `after-circle-visitor-*`, `after-circle-member-*`; join states in components sheet.

| Role | Existing problem | Proposed |
|---|---|---|
| Visitor (signed out) | 670px hero + stats bar push content down; Share twice; Report as a toolbar button | 300px hero with name, public/open label, area, cadence; section tabs Overview · Plans · Members · About; about text + member faces; upcoming plans; values; organiser; Save/Share in rail; Report in More; sticky "Sign in to join" on phones |
| Signed-in non-member | Same | Same, CTA "Join Circle" (open) or "Request to join" (approval) |
| Pending | "Requested" buried in join card | Pill "Request pending" + "Withdraw request" in the rail/strip |
| Member | Membership state, Leave, Planning, Polls ~2,300px down on phones (PUB-30) | Compact header (84px image) + **membership strip**: "✓ You're a member", Chat (unread count), Notifications, More (share, leave, report); tabs Overview · Plans · Planning · Polls · Members · About; Overview = Next plan with "I'm going", Planning ideas with interest count, open poll with results bars, latest announcement |
| Organiser | Manage lives on `/manage/circles/:id` | Strip adds "Manage Circle" (link to existing workspace page); no editing on the public page |

Tabs are URL-backed (`?section=planning`) via `useUrlParam`; content is the existing endpoints (`/plans`, `/plan-ideas`, `/polls`, `/members`, `/announcements`, chat). No new discussion system.

## 5. Activity detail — `/games/:id`
Screens: `before-activity-*` → `after-activity-*`.

| Existing problem | Proposed | Why | Component |
|---|---|---|---|
| 550px striped placeholder; title below the fold (PUB-28) | 220px `NoPhotoMedia` band where the **date/time is the headline**; real photos when present | Title + price + CTA in screen 1 | `NoPhotoMedia` hero |
| Share / Save / Report toolbar (PUB-27) | Save + Share icon buttons by the title; Report in More | Conversion action stands out | `DetailActions` |
| "OPEN PLAN" eyebrow (PUB-20) | "Activity · hosted by a Verified Host" | Plain language | copy |
| Facts scattered | Facts row: date · duration · place · going · level | Scannable | `DetailFacts` style |
| Trust thin | Rail trust row: Verified Host; refund if host cancels (wording to approve, D-B2-7) | Confidence to pay | `TrustRow` |
Mobile: existing `MobileJoinBar` kept, sits above the tab bar; actions row above the title.

## 6. Programme detail — `/programs/:id`
Screens: `before-programme-*` → `after-programme-*`.
- Photo band 21:7 (not 16:9) so title is visible; "Programme · 6 weeks · Ages 16+" eyebrow; **Schedule list** with done / next / upcoming sessions and "Show all"; late-start notice only after D-B2-6; "Enrol" (Irish/UK spelling, D-B2-5); provider block; cancellation facts. Component: `SessionList` (new), `DetailActions`.

## 7. Venue detail — `/centres/:id` (gated; proposal for when venues launch)
Screens: `before-venue-*` → `after-venue-*`.
- Keep the gallery and price rail (strongest current template). Move the inline heart/share/flag icons into `DetailActions`; drop the separate "+ Follow" button into More; **Rooms as cards** with "Check dates" deep-linking to `/book/:id` step 2 with the room preselected (saves one step); facilities in two columns; opening hours as a definition list. Phones: swipe gallery with dots and "Show all photos".

## 8. Homepage — `/`
Screens: `before-home-*` → `after-home-a-*` (recommended), `after-home-b-*`.

| | Option A — minimal refinement | Option B — marketplace emphasis |
|---|---|---|
| Hero | Unchanged composition, search, chips | Split hero (headline + search left, photo right), shorter |
| Listings | "This weekend" grid in screen 2 | Listings directly under the hero with type chips |
| Editorial | Category photo row; Circles + Outside merged into one split band | One host/venue split band |
| Trust | Trust row (copy needs sign-off) | Same |
| Length (prototype) | 3.0 screens desktop / 3.4 phone (was 6.5 / 9.3) | 2.9 / 4.1 |
| Visual continuity | ~85% | ~60% |
| Effort | M | L |
| Usability | Big gain (listings by screen 2) | Slightly bigger gain on desktop |
Both hide the header search on `/` while the hero search is visible.

## 9. Profiles — `/host/:id`, `/provider/:id`
Same `DetailActions`, a `PublicProfile` header (avatar/logo, name, verification, rating summary, hosted count, area), bio, upcoming listings as `ListingCard`s, reviews. Formatted dates (PUB-24). Effort M.

## 10. Global
- Header: hide search on `/` while the hero search is on screen; otherwise unchanged. Account menu unchanged (Sign out lives there).
- Footer: unchanged; add Help/Safety public pages when PUB-07 copy is approved.
- **PUB-44:** For Venues and Become a host orange CTAs switch to forest text (no design change otherwise).
