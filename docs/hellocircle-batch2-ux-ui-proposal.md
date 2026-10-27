# HelloCircle — Batch 2: Public UX/UI Redesign Proposal

**Date:** 2026-10-22 · **Status:** proposal only — **awaiting product-owner approval**. No application code, styles, routes, schema, Stripe, pricing, booking rules, permissions or launch gates were changed. Batch 1 (uncommitted) is the baseline and is untouched.

| Companion | Contents |
|---|---|
| `hellocircle-batch2-page-by-page-improvements.md` | Changes by page and by role |
| `hellocircle-batch2-design-system.md` | Type scale, colour rules, spacing, components, states |
| `hellocircle-batch2-component-plan.md` | Component-level implementation table |
| `hellocircle-batch2-mobile-ux.md` | Layouts at 390 / 768 / 1024 / 1440 / 1920 |
| `hellocircle-batch2-implementation-roadmap.md` | Phases, dependencies, risks |
| `hellocircle-batch2-decisions.md` | Decisions only you can make |
| `hellocircle-batch2-visuals/` | `before/` (live app), `after/` (prototype renders), `prototype/` (static HTML/CSS) |

## How the visuals were made
- **Before** — the current working tree (Batch 1 included) on a local read-only Vite (`:5573`) proxied to the dev API `:3301` (`hello_circle_dev`). Every non-GET request was aborted. Signed-in views used one temporary `guest_sessions` row for the seeded demo resident, deleted afterwards (1 row). The Terms dialog was hidden with CSS, not accepted. Venue pages were opened in that local instance only (`VITE_VENUE_PAGES_PUBLIC=true` env var); the real gate is unchanged. API `:3001` (connected to `hello_circle`) was not used.
- **After** — a separate static prototype in `docs/hellocircle-batch2-visuals/prototype/` (plain HTML/CSS, Google Fonts, the app's own Unsplash photo IDs), served on `127.0.0.1:5680` and rendered with the same Playwright at 1440×900 and 390×844. **Prototype data is illustrative** (e.g. the demo resident has no paid bookings; booking amounts and VAT lines are placeholders — the real page shows the server's lines unchanged). The prototype is not production code and is not production-ready.
- Booking detail is a **New page** (no "before" exists).

---

## A. Executive assessment

**Overall:** The visual identity is strong and distinctive (Home hero, editorial eyebrows, venue detail). The product pages are functionally rich but inconsistent: 8 card components, 4 discovery headers, 6 copies of the detail action row, and a My Life page that leads with stats rather than plans. Batch 1 fixed correctness; Batch 2 is about **hierarchy, consistency and getting real listings in front of people sooner**.

**Top 10 problems** (gap IDs from `hellocircle-public-gap-matrix.md`)
1. Mobile discovery shows no listing in the first screen (PUB-18) — Explore 4.7 screens, Activities 6.5.
2. Four different search/filter patterns (PUB-19).
3. Striped no-photo placeholder dominates cards and heroes; the activity title sits below the fold on desktop (PUB-28).
4. Wrong or repeated photos (PUB-16) — e.g. the hike shows a yoga photo.
5. No booking record page; managing a booking means visiting 3 places (PUB-12).
6. My Life leads with greeting + stats; "Coming up" is easy to miss and Circle plans aren't part of it (PUB-08 follow-up).
7. Circle member actions are ~2,300px down on mobile (PUB-30).
8. Detail action row: Share / Save / Report at equal weight, Share duplicated (PUB-27).
9. Home is 9.3 screens on mobile with two search boxes at desktop (PUB-26).
10. No type scale: 23 inline font sizes, body copy mostly 12.5–14px (UX §4).
11. **New, measured in this pass — PUB-44 (P1, accessibility):** the primary CTAs on `/for-venues` ("List your venue" ×3, "Become an early venue partner") and `/become-a-host` ("Become a host" ×2) are white text on `#FF4B24` = **3.34:1, failing WCAG AA** for 14–15.5px text. Home, the booking kit and other orange buttons already use forest text (5.0:1). Fix = text colour only; no decision needed.

**Top 10 improvements proposed**
1. One `DiscoveryHeader` + `FilterBar` across every list; first card at ~275px on a 390px phone (was ~800px).
2. One `ListingCard` anatomy for all listing types, with only the fields each type has.
3. `NoPhotoMedia`: typographic category-colour fallback for cards and a compact 220px hero band.
4. `DetailActions`: Save + Share as icons by the title; Report in a "More" menu.
5. `BookingRecordPage` at `/bookings/:kind/:ref` (new, reuses existing APIs) with a 70/30 layout.
6. My Life: Next up → Coming up (all participation types incl. joined Circle plans) → My Circles → Saved; Sign out removed from the page.
7. Circle member view: membership strip, chat, next plan and planning in screen 1; URL-backed section tabs.
8. Programme schedule list with done/next sessions; grouped programme results.
9. Home Option A (recommended): same hero, real listings in screen 2, 6.5 → 3 screens on desktop.
10. A 9-step type scale and 4px spacing scale as tokens; green primary / orange-red accent rule.

**Keep unchanged:** the Home hero composition and wordmark; slash eyebrows; Bricolage + Figtree; cream/forest palette; the venue detail layout (gallery + price rail — the model for the others); the booking kit's steps and server-quoted totals; the mobile tab bar; mobile sticky join bars; the payment-result state logic; workspace pages.

## B. Proposed redesign summary

| Page | Current state (before) | Proposed layout (after) | Main improvements | Mobile | Reusable parts | Effort |
|---|---|---|---|---|---|---|
| Explore / discovery | Title + Compare + boxed search + pills + quick chips + grouped sections; one card per row group; first result ~600px desktop / ~800px phone | Title, one pill search (what / where / when), type chips with counts, results row (count · Filters · Sort · List/Map), single 4-col grid | No grouping gaps; consistent filters; counts per type | Compact search with where/when as subtitle; chips scroll; row cards (120px thumb) | DiscoveryHeader, FilterBar, ListingCard, NoPhotoMedia, FilterDialog | L |
| My Life | Greeting, 3 account buttons, nudge, (Batch 1) "Nothing booked yet", rail of stats | Greeting + one-line "Next up", Needs-you bar, Next-up card with actions, Coming up timeline across types, My Circles (with count + show all), rail: Saved, Hosting, This month | Answers "what am I doing next?" first | Single column; Next up then Needs you then list | NextUpCard, UpcomingItem, CircleRow, SavedRow | M |
| Booking detail | **New page** (today: inline My Life cards + receipt page) | 70/30: header with ref/type/facts; Details, Payment (server lines), Cancellation (deadline + Cancel), Timeline; rail: Status + one primary action + links | One place for status, receipt, cancel, directions, chat | Status card first, then details | BookingRecordPage, StatusCard, BookingTimeline | L |
| Circle — visitor | 670px photo hero, stats bar, long single column; Join card in rail | 300px hero with identity; section tabs; about + faces, upcoming plans, values, organiser; Join rail; Report in More | Shorter, scannable; one Share | 220px hero; sticky "Sign in to join" bar | CircleHeader, SectionTabs, PlanRow | M |
| Circle — member | Same page as visitor, member items far down | Compact header + membership strip (Chat with unread, notifications, More: leave/report) + tabs (Overview · Plans · Planning · Polls · Members · About); Overview = next plan, planning, poll, announcement | Member tasks first | Strip + next plan + "I'm going" in screen 1 | MembershipStrip, PollCard, IdeaRow | M |
| Activity | 550px striped placeholder, title below fold, 3-button toolbar | Compact typographic band (date/time is the hero), title + icon actions, facts row, About, Good to know, Host, Where, Cancellation; rail with price, spots, CTA, trust | Title + CTA in first screen | Sticky bar retained above tab bar | NoPhotoMedia (hero), DetailActions, TrustRow | M |
| Programme | Large placeholder/photo, "Enroll", sessions hidden behind count | 21:7 photo band; Schedule list (done / next / upcoming); late-start notice (copy only after decision); "Enrol" | Schedule is the hero fact | Sticky "Enrol" bar | SessionList, DetailActions | M |
| Venue | Already strong (gallery, rail) | Keep; move Save/Share/Report into DetailActions; Rooms as cards with "Check dates" deep-linking to booking step 2 | Fewer steps for multi-room venues | 4:3 swipe gallery with dots; sticky "Check availability" | RoomCard, PhotoGallery | S–M (gated) |
| Home | 6.5 / 9.3 screens; listings only from screen 3 | **A:** same hero; "This weekend" listings in screen 2; category photo row; Circles + Outside split; trust row; host/list band. **B:** split hero, listings immediately, Circles row, trust, host/list | Real listings earlier; one search | A: 3.4 screens; B: 4.1 | ListingCard, TrustRow | A: M · B: L |

## C. Visual review (Existing → Proposed)

All files in `docs/hellocircle-batch2-visuals/`. Viewport shots plus `-full` full-page versions.

| # | Template | Existing | Proposed |
|---|---|---|---|
| 1 | Explore desktop / mobile | `before/before-explore-{desktop,mobile}.png` | `after/after-explore-{desktop,mobile}.png`, filters: `after/after-filters-{desktop,mobile}.png` |
| 2 | My Life desktop / mobile | `before/before-my-life-*.png` | `after/after-my-life-*.png` |
| 3 | Booking detail | **New page** (`before/before-receipts-*.png` is today's nearest surface) | `after/after-booking-*.png`, cancel dialog `after/after-cancel-*.png` |
| 4 | Circle visitor / member | `before/before-circle-visitor-*.png`, `before/before-circle-member-*.png` | `after/after-circle-visitor-*.png`, `after/after-circle-member-*.png` |
| 5 | Activity | `before/before-activity-*.png` | `after/after-activity-*.png` |
| 6 | Programme | `before/before-programme-*.png` | `after/after-programme-*.png` |
| 7 | Venue | `before/before-venue-*.png` | `after/after-venue-*.png` |
| 8 | Homepage | `before/before-home-*.png` | `after/after-home-a-*.png`, `after/after-home-b-*.png` |
| – | Components & states | – | `after/after-components-*-full.png` |

Per-pair problem / change / reason / component / responsive notes: `hellocircle-batch2-page-by-page-improvements.md`.

Measured page length (screens of content, before → after prototype): Explore desktop 2.8 → 1.3, mobile 4.8 → 1.9 · My Life 2.7 → 1.4 / 4.4 → 2.9 · Circle member 4.0 → 1.3 / 7.3 → 2.1 · Activity 2.6 → 1.7 / 4.1 → 2.5 · Programme 3.5 → 1.8 / 5.1 → 2.2 · Home 6.5 → 3.0 (A) / 9.3 → 3.4 (A). Prototype pages carry less real content than production (e.g. reviews omitted), so treat these as directional.

## D. Implementation readiness (summary — detail in the component plan)

- **Modify:** `Explore.tsx`, `Games.tsx`, `BrowseLayout.tsx`, `Browse.tsx`, `Circles.tsx` (headers); `ListingCard.tsx` (anatomy + NoPhotoMedia); `GameDetail.tsx`, `ExperienceDetail.tsx`, `ProgramDetail.tsx`, `CentreDetail.tsx`, `ClubDetail.tsx`, `CircleDetail.tsx` (DetailActions, hero); `MyBookings.tsx`, `MyLifeNextUp.tsx`, `ParticipationTimeline.tsx`, `MyLifeCircles.tsx`; `Home.tsx` + `homeEditorial.css`; `index.css`/`theme.ts` (type and spacing tokens).
- **Create:** `DiscoveryHeader`, `FilterBar`, `FilterDialog` (built on existing `Modal`), `NoPhotoMedia`, `DetailActions` (built on existing `ActionMenu`), `TrustRow`, `SessionList`, `BookingRecordPage` + per-kind adapters, `MembershipStrip`, `SectionTabs` (URL-backed via `useUrlParam`).
- **Retire over time:** `DiscoverCard`, `ExperienceSearchCard`, `CentreCard`/`ClubCard` card variants → `ListingCard` (keep behind adapters until each list migrates).
- **APIs reused:** existing list endpoints, `/residents/me/participation`, `/games/mine`, `/circles/mine`, per-type "mine" endpoints, `/residents/me/receipts/:ref`, existing cancel endpoints, `/circles/:id/*` (plans, polls, plan-ideas, members, announcements), chat inbox.
- **Backend changes:** none required for B2-A, B2-B, B2-E, B2-F. B2-C (booking record) can be built from existing endpoints; an optional read-only aggregate `GET /residents/me/orders/:kind/:ref` would simplify it (decision D-B2-4). B2-D "Circle plans in Coming up" uses `/circles/mine` + each Circle's own plans where the resident has joined — no new endpoint; listing *un-joined* Circle plans as suggestions is optional.
- **Dependencies:** tokens (B2-0) → cards/no-photo (B2-A) → detail parts (B2-B) → booking record (B2-C) → My Life (B2-D, links to records); Circles (B2-E) can run in parallel after B2-0; Home (B2-F) last (reuses cards, trust row).
- **Risks:** URL-param compatibility in discovery (Medium); migrating 8 card components (Medium); booking record per-kind data shapes (Medium); visual regressions in long-lived pages without visual-diff tooling (Medium; mitigated by screenshot specs in `qa:product`).
- **Approvals:** see section E.

## E. Product-owner decisions (only those that change implementation)
Full list with options in `hellocircle-batch2-decisions.md`:
1. **D-B2-1** Primary button colour: keep green `#1E7A4C` (recommended) vs dark forest `#172019`.
2. **D-B2-2** Homepage: Option A (recommended) vs B.
3. **D-B2-3** Should "Coming up" also suggest Circle plans you haven't joined yet (labelled "From your Circles")?
4. **D-B2-4** Booking record scope: all six participation kinds at once vs paid kinds first; optional read-only aggregate endpoint.
5. **D-B2-5** Terminology (affects copy in every template): Activity / Session / Programme / Enrol / Save.
6. **D-B2-6** Late programme enrolment notice (already pending as PUB-17).
7. **D-B2-7** Trust-row wording on Home and detail rails (claims need sign-off).

## F. Recommended next implementation batch (B2-0 + B2-A, bounded)
1. Type and spacing tokens added to `index.css`/`theme.ts` (no visual change on their own).
2. `NoPhotoMedia` + unified `ListingCard` anatomy; migrate Explore, Activities and Home "near you" to it.
3. `DiscoveryHeader` + `FilterBar` + `FilterDialog` on Explore and Activities (other lists in the next batch), preserving all current URL params (`q`, `when`, `where`, filters, sort).
4. Programme sessions grouped into one result in Explore.
5. Tests: unit tests for card field selection; browser spec asserting first result top < 600px at 390px, no overflow at 5 widths, filter dialog focus trap, URL params round-trip; screenshot evidence. Full `qa:product`, `qa:booking`, `qa:lifecycle`, client + server suites.
Out of scope for that batch: detail pages, booking record, My Life, Circles, Home.

## Accessibility and performance (applies to all templates)
- WCAG 2.2 AA: one H1 per page; tabs are real links with `aria-current`; dialogs use the existing `Modal` focus trap and restore focus; filter chips are toggle buttons with `aria-pressed`; icon buttons always named (`aria-label`); no colour-only states (every status pill has text); touch targets ≥ 44px for primary controls, ≥ 24px minimum; visible focus ring (existing green outline); reduced motion: no new animation beyond existing fades.
- No-photo tones (computed): white on `#1f4d36` 9.7:1, `#6b2a1a` 10.7:1, `#2b3a59` 11.3:1, `#3d4a22` 9.5:1, `#4a3f33` 10.2:1, `#172019` 16.7:1; the peach date text `#ffb39f` on those 5.5–9.7:1 — all pass AA.
- **Orange-red buttons:** white text on `#FF4B24` is **3.34:1 — fails AA** for button text. Rule: orange-red buttons carry forest text (`#172019` on `#FF4B24` = 5.0:1), as the booking kit's Continue button already does. Green primary with white text = 5.33:1 (passes).
- Performance: cards use `srcset` + `loading="lazy"` (as Home already does); skeletons match card size (no CLS); no new libraries; one search request per change (debounced) as today.
