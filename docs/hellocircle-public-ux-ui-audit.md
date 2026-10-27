# HelloCircle — Public UX/UI Audit

**Date:** 2026-10-21 · **Branch:** `feature/workspace-detail-pages` @ `315f0d2` · Audit only. Gap IDs refer to `hellocircle-public-gap-matrix.md`. Screenshots: `docs/public-audit-2026-10-21/` (file names below).

**What was looked at:** 59 public routes at 390 / 768 / 1024 / 1440 / 1920 px and 26 signed-in resident routes at 390 / 1440 px, headless Chromium, cookie banner pre-dismissed, all writes aborted. Viewport screenshots at 390 and 1440 for every route; full-page screenshots for the signed-in set. Automated checks per render: horizontal overflow, H1 count and heading order, unlabelled inputs, unnamed controls, sub-24px targets, image alt/broken, console errors, page length in screens.

**Visual direction to preserve:** editorial, Bricolage Grotesque display + Figtree body, cream (`#f7f4ec`) and forest (`#172019`) grounds, orange-red (`#ff4b24`) accent, documentary photography, Swiss-style composition with slash eyebrows (`/ IRELAND`) and hairline rules. Nothing below asks to remove it. Most problems are about the **product pages not carrying that identity as well as Home does**, and about hierarchy inside dense pages.

## 1. What already works well
- **No horizontal overflow** at any width on any route tested (347 renders). Every route has exactly one H1 except three signed-out gates (PUB-29 note).
- **Home hero** (`public-home-1440.png`, `public-root-390.png`): the strongest page — one clear message, a real three-part search (What / Where / When) and category chips. It does explain what HelloCircle is and how to search.
- **Detail pages share one rhythm**: back link → media → eyebrow + title + price → facts → sections; right rail booking card on desktop; a fixed **mobile join bar** above the tab bar on all six detail types (`public-games_adm_demo_game_1-390.png`).
- **Booking kit** (`components/booking/*`): numbered steps ("STEP 1 OF 4 · ROOM"), server quotes, cancellation copy derived from server facts, a fixed submit bar on mobile.
- **Error/empty states exist almost everywhere** (`LoadErrorState`, `EmptyState`), and the 404 page offers two ways on.
- **Mobile tab bar** (Home · Explore · Start · Circles · My Life) is consistent and hidden in workspaces.

## 2. Homepage questions (Phase 3)
| Question | Answer | Evidence |
|---|---|---|
| What HelloCircle offers | Clear: "Local activities, clubs, venues and experiences across Ireland — all in one place." | hero |
| What users can discover | Clear via chips (Sports & games, Venues & spaces, Experiences & adventures, Clubs & programmes, Events, Circles, Volunteering) and the "ways to belong" tiles. **But** "Venues & spaces" and "Clubs" lead to gated pages when venues are off (PUB-09). | hero, `Home.tsx:885-888` |
| How users can search | Clear on desktop; on mobile the search collapses to one "What would you like to do?" button — good. Desktop also shows the header search, so there are two search boxes (PUB-26). | `public-home-1440.png` |
| What they can book or join | Shown only from the "near you" section down (screen 3+ on mobile). | sweep |
| Why trust the platform | Weak. No verification/refund/safety statement near the top; footer Help/Safety links hit a sign-in wall (PUB-07); legal pages unfinished (PUB-01/02). | – |
| Next action | Search is clear. The page then runs 9.3 screens (390) / 6.5 (1440) of editorial sections (intro statement, ways to belong, near you, community, outside, host, closing band). | sweep `screens` |

**Verdict:** Home is not "overly promotional" at the top — the hero is practical. It becomes promotional further down: four editorial sections before the host pitch, with only one section of live listings. Recommendation: keep the hero and one editorial statement, bring "near you" listings up to screen 2, merge "community" and "outside" into one photo band, and add a compact trust row (verified hosts, secure checkout, clear cancellation) once the policies are published. Keep the slash eyebrows and big display type.

## 3. Top 20 global UX/UI problems

Each: **what** · **where** · **why it matters** · **change** · **shared component** · **how to verify**.

1. **Results start below the fold on mobile discovery** (PUB-18) — *Where:* `/explore` (category tiles "Community centres / Sports clubs / Activities…" fill screen 1, `public-explore-390.png`), `/games` (first card at ~800px, `public-games-390.png`), `/circles`. *Why:* people come to a list to see the list. *Change:* collapse the search card to one row with a "Filters" sheet; move category tiles below results or turn them into chips; show result count + first card in screen 1. *Component:* `BrowseLayout`, Explore header. *Verify:* at 390×844 the first result card's top < 600px on all discovery routes (Playwright assertion).

2. **Three different discovery search/filter patterns** (PUB-19) — *Where:* Explore (inline search + pills), Activities (boxed search + selects + Search button + activity chips), Programmes/Experiences/Volunteer ("Near:" chip rows + date chips + grid/map toggle), Browse (List/Map + selects). *Why:* relearning on every list; filters look different and behave differently (instant vs. Search button). *Change:* one `DiscoveryHeader` (query, where, when) + `FilterBar` (chips + Filters sheet + sort) with the same URL params. *Component:* new shared component replacing per-page headers in `Explore.tsx`, `Games.tsx`, `ExperienceKindBrowse`, `Programs.tsx`, `Browse.tsx`. *Verify:* visual diff of the five list headers; URL params identical (`q`, `where`, `when`, `sort`).

3. **No-photo state wastes the most valuable space** (PUB-28) — *Where:* activity and programme cards/heroes use a striped pattern with a small icon (`public-explore_q_yoga-1440.png`, `public-programs_demo_prog_yoga-1440.png`, `public-games_adm_demo_game_1-390.png`). *Why:* results look empty and identical; the editorial identity disappears exactly where people decide. *Change:* a typographic no-photo card in brand colours (category eyebrow, big date, activity name in display type on forest/cream), half the height of a photo card. *Component:* `ListingCard` media slot, detail `DetailHero`. *Verify:* screenshot review; card height without a photo ≤ 60% of photo card on list pages.

4. **Imagery doesn't match the listing** (PUB-16) — *Where:* "Cork Pottery Wheel Workshop" shows a gym; "Dublin Five-a-side Football Circle" shows cyclists (`public-experiences_demo_experience_10-390.png`, `public-circles_demo_circle_1-1440.png`). *Why:* documentary imagery is the brand's trust signal; wrong photos read as fake. *Change:* launch content plan — real partner photos or category-matched curated photos; otherwise the no-photo card from #3. *Component:* seed/content, not code. *Verify:* manual content QA list before launch.

5. **My Life doesn't show "the next few days"** (PUB-08) — *Where:* `/my-life` desktop: a ~380px empty main column beside the rail; no "Coming up" though a Circle plan is due Fri 23 Oct; "5 Circles active" vs 3 listed (`resident-my_life-1440.png`). *Why:* My Life is the home for returning users; its promise ("Your next few days, at a glance") isn't met. *Change:* first block = next 3 plans across all six participation types, then needs-attention, then Circles; collapse the grid when a column is empty; put stats ("Your month", "Your rhythm") last. *Component:* `MyBookings.tsx` sections, `NextUpCard`. *Verify:* seeded resident with one plan in each type sees all of them in "Coming up"; no empty grid area at 1024–1920.

6. **Guests are told their session expired** (PUB-05) — *Where:* `/bookings`, `/my-life`, `/receipts/:ref` signed out (`public-bookings-390.png`); the red alert also covers the logo. *Why:* the main "My Life" tab greets every first-time visitor with an error. *Change:* see gap matrix. *Component:* `api/core.ts` 401 handling + `SessionExpiryBanner`. *Verify:* fresh browser context → `/my-life` shows no `role=alert`.

7. **Detail action row has no hierarchy** (PUB-27) — *Where:* every detail page: "Share · Save · Report" as equal outlined buttons above the media; Circle detail repeats Share inside the join card; Experience shows "Photo 1…5" dots plus the same row. *Why:* "Report" carries the same weight as "Save"; the eye goes to the toolbar instead of the title and CTA. *Change:* Save (icon + label) and Share (icon) beside the title; Report in an overflow menu (`ActionMenu`) or as a text link near the footer of the page. *Component:* new `DetailActions`, used by all detail pages. *Verify:* one Share per page; Report not in the first viewport.

8. **Circle page isn't member-first** (PUB-30) — *Where:* `/circles/:id` member view at 390: "You're in the Circle / Message / Leave", Planning and Polls appear after Upcoming plans, Recently together, About, Moments — ~2,300px+ down; 7.3–8.7 screens total (`resident-circles_demo_circle_2-390.png`). *Why:* the things members come back for are hardest to reach. *Change:* on mobile order = status strip (member · role · Chat) → next plan → Planning & Polls → Members → Moments → About; for visitors keep the current "About first" order. Make Planning, Polls, Members and Moments anchor-linked tabs (`?section=`) rather than new routes. *Component:* `CircleDetail.tsx` (`Section` order), `useUrlParam`. *Verify:* member at 390 sees status + next plan in screen 1, planning in screen 2.

9. **Home length and duplicate search** (PUB-26) — *Where:* `/` 9.3 screens (390), 6.5 (1440); header search + hero search at desktop. *Why:* the practical marketplace part is buried under editorial bands. *Change:* see §2. Hide the header search on `/` until the hero search scrolls out. *Component:* `Header.tsx`, `Home.tsx` sections. *Verify:* ≤ 6 screens at 390; one visible search input at load on desktop.

10. **Terminology drift** (PUB-20) — *Where:* "Activities" nav → page says "10 games & sessions nearby"; detail eyebrow "OPEN PLAN"; error "We couldn't load this plan"; "Programmes" nav → "All programs", "PROGRAM", "About this program", "Enroll"; "Save" vs "Add to favourites" (centre page); "Hello Circle" (For Venues, emails) vs "HelloCircle". *Why:* people can't tell if plan/session/activity/game are different products. *Change:* pick canonical user-facing terms (recommend: **Activity** for a hosted one-off, **Session** for one occurrence, **Programme** + **Enrol** in Irish/UK English, **Save/Saved**, **HelloCircle**), then a copy sweep. *Component:* copy only; add to `docs/product-glossary.md`. *Verify:* grep of user-facing strings for "program\b", "Enroll", "plan" (outside Circle planning), "Hello Circle".

11. **Dates are formatted three ways** (PUB-24, PUB-39) — *Where:* "Wed 21 Oct · 10:00" (detail), "2026-10-21 · 10:00" (host profile), "2026-10-18 11:00" (My Life Recently), "TUE, 27 OCT" (cards), greeting and For-Venues dateline in browser time. *Why:* scanning and trust. *Change:* one `formatIrishDateTime` everywhere (already exists in the booking kit). *Component:* shared formatter. *Verify:* no `\d{4}-\d{2}-\d{2}` text in rendered public pages.

12. **"Not found" looks like "try again"** (PUB-14) — *Where:* `/games/<missing>`, `/circles/<missing>` → "We couldn't load this plan." + Try again. *Why:* dead shared links are common; retry is pointless. *Change:* 404 → "This activity has ended or been removed" + 3 similar listings; keep Try again for 5xx/network only. *Component:* `LoadErrorState` gains a `notFound` variant. *Verify:* 404 renders no Try again button.

13. **Empty states with stale or conflicting copy** (PUB-21, 22, 33, 37) — *Where:* Saved ("Tap the heart on a centre or club"), Credit ("isn't available right now"), signed-out My Life (two stacked empty states), `/volunteer` (0 listings, linked from nav). *Why:* an empty page should say what to do next. *Change:* copy fixes; hide switched-off tabs; one signed-out My Life state. *Component:* `EmptyState` usage. *Verify:* checklist screenshot pass.

14. **Unlabelled fields and unnamed controls** (PUB-15) — *Where:* Suggest a place (6 inputs), Household (3), Host application (2), Circle detail (2), Browse selects (2) + 2 unnamed icon buttons, booking inputs on detail pages (1 each). *Why:* WCAG 1.3.1/4.1.2 failures; also blocks voice control. *Change:* use `FieldLabel` + `htmlFor`/`useId` per `components/form.tsx`; `aria-label` on icon buttons. *Verify:* sweep `inputsUnlabelled == 0`, `unnamed == []`.

15. **Heading levels skip** (PUB-29) — *Where:* h1→h3 on `/programs`, `/experiences`, `/adventures`, `/browse/*`, centre/club detail; h1→h4 on host profile. *Why:* screen-reader heading navigation. *Change:* list pages need an (optionally visually-hidden) h2 "Results"; card titles stay h3. *Component:* `BrowseLayout`, `SectionHeader`. *Verify:* sweep `skips == []`.

16. **Account rows clip on phones** (PUB-23) — *Where:* `/profile` email row at 390 ("Not verifi…", "Resend verification e…"). *Why:* verification status unreadable. *Change:* stack label above value below 480px. *Component:* Profile settings row. *Verify:* no clipped text at 390 (element `scrollWidth > clientWidth` check).

17. **Page-level buttons that aren't the task** — *Where:* Explore's first button is "Compare places" (a centres-only tool that dead-ends while venues are gated, PUB-09); My Life's header row is "Find a booking · Sign out · Edit profile" (`resident-my_life-1440.png`). *Why:* the first actions on a page should be its main job. *Change:* move Compare into the centres list; move Sign out to the account menu only; "Find a booking" only for guests. *Component:* page headers. *Verify:* review of first-viewport buttons per page.

18. **Programme sessions appear as separate results** (PUB-17) — *Where:* Explore "yoga" shows "Beginners yoga, 6 weeks" twice (Today, Tue 27 Oct) with "View session". *Why:* looks like two products; enrolment is for the whole programme. *Change:* one card: "6-week programme · starts …" with "View programme". *Component:* Explore result grouping. *Verify:* one card per programme in results.

19. **Booking management is scattered** (PUB-12) — *Where:* My Life rows link to the listing page (experience/programme/activity), venue/club bookings are inline cards, receipts are a separate page. *Why:* "What did I book, when can I cancel, where is my receipt?" needs three places. *Change:* a booking record page (status, date, people, policy + deadline, receipt, cancel, contact, add to calendar) using the workspace `RecordView`/`DetailParts` pattern adapted to consumer styling. *Verify:* each My Life row opens a record whose H1 is the booking.

20. **Trust surfaces are thin** (PUB-01, 07, 38, 36) — *Where:* public Help/Safety need sign-in; Privacy shows placeholders; host profile is 1.9 screens with no bio or rating summary; provider profile shows demo copy. *Why:* a marketplace asks strangers to pay strangers; trust is the conversion lever. *Change:* public `/help` and `/safety`; profile template with verification, rating, hosted count, bio, upcoming; a trust row on detail pages (Verified host · cancellation summary · secure payment). *Component:* `PublicProfile` template, `TrustRow`. *Verify:* signed-out visitor reaches safety info in one click from any footer.

## 4. Typography
- Two families, used consistently: Bricolage Grotesque (display) and Figtree (body) from `packages/design-tokens/src/index.ts:10-11`. Good.
- **No type scale.** Pages use **23 distinct inline `fontSize` values** (11 → 40 px) across ~1,900 inline `style={{}}` blocks in `client/src/pages/*.tsx`; the most common body sizes are 13, 14, 12.5 and 13.5 px. Secondary text at 12–12.5 px is small for a consumer product on phones. *Change:* define 6–7 steps (12 / 14 / 16 / 20 / 26 / 34 / clamp display) as tokens and migrate per template, starting with detail pages.
- Display headings are strong and on-brand; the ALL-CAPS eyebrows ("OPEN PLAN", "PROGRAM", "EXPERIENCE") are legible but sometimes say the wrong thing (see #10).

## 5. Colour
- Home defines its own token set (`--hx-cream/forest/orange…` in `pages/homeEditorial.css`, ~2,100 lines, with its own dark-mode block) parallel to `theme.ts`. The values match closely today but will drift. *Change:* map `--hx-*` to the shared tokens.
- CTA colours differ by page: Home search = orange-red; detail join buttons = green; booking-kit Continue = orange with dark text; programme Enrol = green. Green is the established primary (`feedback_design_system_direction` memory), orange is the accent. *Change:* one rule — primary action green, orange for editorial highlights and the Home hero search only — and document it.
- Status colours are clear ("10 spots left" amber pill, "Verified Host" green), but amber-on-image pills rely on colour alone in places; keep the text.

## 6. Images
- No broken images, all have `alt`. Gallery dots ("Photo 1…5") are labelled.
- Aspect ratios are consistent per template (16:9 detail media, ~3:2 cards).
- Main issues are content (#4) and the no-photo state (#3). Check that card images are served at card size (not audited for bytes here — local dev).

## 7. Interaction design
- **Buttons:** consistent pill buttons; some page-level text buttons are raw `<button style>` (e.g. My Life "View all") instead of `Button`/`LinkButton`.
- **Filters/sort:** sort is a select on Explore and Activities but labels repeat "Sort: …" for every option in the DOM; filters open in different surfaces per page (#2).
- **Dialogs:** the onboarding Terms gate is a proper modal with focus management; it blocks every page until accepted (expected for legacy accounts).
- **Date pickers:** "Pick a date" exists on discovery lists; booking date/slot is `DateSlotPicker`.
- **Feedback states:** toasts and `ConfirmDialog` with async progress are used for cancel/leave.

## 8. Mobile
- Navigation, tab bar, sticky join bars: good.
- Touch targets: the sweep found 1–11 sub-24px interactive elements per page, mostly on detail pages (inline "View profile", "Get directions", gallery dots). Raise inline links in cards/rows to 24px minimum (WCAG 2.5.8).
- Checkout: booking kit has a fixed submit bar and the cookie banner steps aside on checkout screens (`CookieNotice.tsx` R3A rule). Good.
- Long pages: Home 9.3, Help guide Explore 11, provider profile 8.9 (390) / 9.0 (768), Circle detail 8.7 screens.

## 9. Page-template structures (Phase 4)
| Template | Current structure | Fit for purpose? | Recommendation |
|---|---|---|---|
| Activity (`GameDetail`) | media → title/price → host → location → about → join card | Yes; host near top is right for peer-hosted activities | Trust row; no-photo card; DetailActions |
| Experience (`ExperienceDetail`) | gallery → title/price → meeting point → departures → about → reviews; inline booking | Yes | Hide or label undated listings (PUB-13) |
| Programme (`ProgramDetail`) | media → title/price → sessions → about → reviews; enrol popup | Mostly; needs "starts / already started" clarity | Session list as the hero fact; late-join copy once decided |
| Venue (`CentreDetail`) | gallery → facts → rooms → facilities → hours → reviews; "Check availability" | Yes — appropriately different (rooms/hours/capacity) | Room cards link straight into step 2 with that room |
| Club (`ClubDetail`) | gallery → age groups/trial → included → reviews; Register / passes | Yes | – |
| Circle (`CircleDetail`) | hero → stats → plans → about → moments → planning/polls → members | Visitor-first; weak for members | Member-first order (#8) |

The four are appropriately different; they already share `PhotoGallery`, `Reviews`, `CtaBand`, `mobile-join-bar` and the sticky aside. Duplicated pieces worth extracting: the Share/Save/Report row (6 copies), the join/book rail card shell (6 copies), the "Not found / couldn't load" block (6 copies), and the price/spots header.
