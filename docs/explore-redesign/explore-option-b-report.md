# Explore — Option B: audit, changes, Phase 2 plan

Local, 2026-10-28. Dev data only (`hello_circle_dev`). Nothing committed, pushed or deployed.
Screenshots: `screenshots/before-1440.png` (owner's screenshot) and `screenshots/after-*.png`.

## 1. Audit of what existed

| Area | What was there | Verdict |
|---|---|---|
| Page | `client/src/pages/Explore.tsx` (~1,100 lines). Two modes: Discovery (type tiles + feed rows) and Results (a query, category, date or filter is set). | Kept both modes. |
| Search | Text box, debounced into `?q=`, recent/popular panel, clear button. `GET /api/search?q&categorySlug&subcategorySlug` (server-side). | Kept as is. |
| Categories | `useCategoryFilter` + `CategoryChips` (`components/categories/`), `?category=&sub=`, counts from `GET /api/categories`. Wrapped onto two lines, with a second chip row for types. | Reused the hook; chips replaced by dropdowns. |
| Quick chips | "Needs people" set a flag; "Free / Outdoors / Social / Sports" only appended a word to the search text, could not be turned off, and doubled up on categories. | Removed. |
| Result types | Third chip row ("All (9)", count style different from categories). Client-side narrowing of one search response. | Now the Show menu. |
| Filters | Side drawer holding only "Needs people" (also a quick chip and a sort option). Badge counted the category, which wasn't in it. | Now a dropdown with real filters. |
| Sort | Native `<select>`, client-side: recommended / soonest / needs people / price. Price sort counted an unknown price as €0. | Dropdown; unknown prices sort last; "needs people" sort retired (it's a filter). |
| When | Anytime / Tonight / This weekend. "Tonight" filtered the same as Today. `when=today` handled in code but not offered. Feed only carried today + weekend. | Real windows, see §2. |
| Dropdown | `components/FilterDropdown.tsx`, used by Explore, Browse and others. No Escape, no focus return, panels could open off-screen. | Extended, backward compatible. |
| Prices | Cards and filters treated any missing price as "Free". | Fixed per listing kind, see §4. |
| Errors | A failed search kept the old results or showed "nothing matched"; a failed feed became an empty list. | Error state with retry. |
| Loading | Skeleton cards already used. | Kept; header now says "Looking…" while the feed loads too. |

## 2. What changed (final, owner decisions 2026-10-28)

**Layout:** headline "Find something worth doing.", supporting line, search + Where (placeholder unchanged — it names only what's searchable), then one toolbar of the same `FilterDropdown`s:

- **Desktop / tablet:** Category · Type · When · Show · Filters · Sort.
- **Phones (≤560px):** Category · When · Filters · Sort on **one line that scrolls sideways**; its menus open as floating panels so the row can't clip them. **Type and Show move inside Filters** (labelled groups), and once chosen they appear as removable chips ("Hiking ×", "Circles ×").

Details:
- **Category:** every category, biggest first, with counts; the label becomes the chosen name. **Type:** that category's subcategories with counts, only when there's a choice; changing category resets it.
- **When:** Anytime, Today, Tonight (17:00+), Tomorrow, This weekend, This week (today + 6). `client/src/exploreFilters.ts`, tested.
- **Show:** All, Activities & games, Adventures, Experiences, Volunteering, Programmes, Circles, Places & clubs — only types with results; a chosen one stays listed so it can be undone.
- **Filters:** Needs people, Free, Coming alone welcome (`games.solo_friendly`). Badge counts what's inside (on phones that includes Type/Show).
- **Sort:** Recommended, Soonest, Price: low to high (unknown prices last). Labels read "Type", "Show", "Sort" until something is picked.
- **Chips:** only for values hidden inside a menu, plus **Reset all**.
- **Results header:** "N things to explore" + a line saying what's applied; screen-reader announcement on every change.
- **Category word:** a listing without an assigned category takes a subcategory named in its title ("Community Badminton Night" → BADMINTON, "Sea Swim Social" → SWIMMING), else its Circle's category, else its kind ("ACTIVITY"). Display only; filters still use assigned categories. On dev, 4 of 49 this-week activities still fall back to "ACTIVITY".
- **Empty after filtering:** "Nothing matches those filters just yet." with a button per filter to undo it, similar categories, Clear all. **Load failure:** error + Try again, never an empty list.
- **Section titles below the results:** 20px → 28–42px (and the "N things to explore" heading), Explore only.
- **Corners / pills:** unchanged — current approved tokens kept, no global design-system change.

**URL:** `?category= &sub= &when= &rtype= &free= &needsPeople= &solo= &sort= &q= &county= &radiusKm=`; `1` written, `true` accepted; an old `sort=needs-people` falls back to Recommended.

## 3. Components and files

| File | Change |
|---|---|
| `components/FilterDropdown.tsx` | Optional `align`, `closeOnSelect`, `floating`; Escape closes and returns focus; `aria-expanded`/`aria-haspopup`; options `aria-pressed`; panel kept inside the screen. Existing callers unchanged. |
| `components/categories/CategoryChips.tsx` | New `CategoryDropdown`, `CategoryTypeDropdown`. `CategoryChips` unchanged. |
| `components/BoldResultCards.tsx` | New: `boldWord()`, `ExperienceBoldCard`, `ProgrammeBoldCard`, `CircleBoldCard` (reusable on other pages). |
| `exploreFilters.ts` (+ test) | `matchesWhen`, `priceState`. |
| `pages/Explore.tsx` | Toolbar, phone layout, filters, header, empty/error states, bold results. |
| `components/DiscoverRow.tsx`, `components/FeatureCard.tsx` | Unknown price shows nothing; section-title size via `--section-title-size`. |
| `index.css` | Phone toolbar scroll rule. |
| `server/src/categoryLabels.ts` (new), `routes/search.ts`, `routes/discover.ts`, `packages/types` | `category` on search/feed results; feed adds `week`; ranking "free" bonus uses the strict price rule. |

No schema, booking, payment, auth or permission changes; visibility rules unchanged.

## 4. Price states — Free never means "price missing"

Only a stated price of **0** is free. A missing price is **unknown** for every listing kind — including games whose host left the optional price blank (88 of 105 dev games), and club sessions (a club price of 0 arrives as null). Unknown prices show no price on the card, never "Free", and are excluded from the Free filter. Circles stay under Free (membership is never paid); places are hidden while Free is on.
Verified on dev data: the 7-day feed has 11 priced at 0, 19 with no price, 25 paid — `?free=1` returns exactly 11, all labelled "Free".

Worth deciding later: the host form saves a blank price as null, so most free games now show no price. Saving a blank as 0 (or asking "Free / Paid") would make them explicit.

## 5. Backend limits (not built, not exposed)

- **Pick a date, time of day, price bands:** activities exist only for the next 7 days in the feed; search has its own window. Needs a dated query on `/api/search` or `/api/discover`.
- **Nearest sort:** activities carry lat/lng, but the visitor's position isn't known without asking. Needs a location-permission flow.
- **Recently added:** only games carry `createdAt` today.
- **Events:** no separate listing type exists, so it isn't offered.
- **Grid/list/map toggle:** a map exists (`/api/discover/map`) for centres/clubs/experiences only, not activities. Not wired in.
- **Placeholder copy:** the brief's "Search activities, places, people…" wasn't used. Places are hidden while venue pages aren't public, and people aren't searchable. Kept "Activities, Circles, adventures…".
- **Design system (decided 2026-10-28):** keep the current tokens (12px buttons, pill controls).

## 6. Tests

- Client: typecheck clean; **331 / 331** Vitest (10 new: When windows, price states).
- Server: typecheck clean. The Docker-isolated server suite was not run here.
- Browser (Playwright, :5173, dev data) — no page errors anywhere:
  - Desktop 1440: Category → Type → When → Sort; Back/Forward restore each step; Show + filters + chip removal + Reset all; Tomorrow / This week; shared link with `true` values and a retired sort; filtered-empty state; forced search failure → error + retry.
  - Strict Free: `?free=1` = exactly the price-0 listings.
  - Phone 375: toolbar is one line (35px high), every menu opens fully visible and above the page, picking from a floating menu works, Escape returns focus to its button, Type/Show chips remove correctly.
  - Widths 1440 / 1024 / 768 / 375: 4 / 3 / 2 / 1 columns, no sideways page scroll.
  - Bold cards: every result card on Explore is bold (9/9 Outdoors, 52/52 This week, 5/5 for "yoga").

## 7. Phase 2 — plan only (needs approval)

| Feature | Benefit | Existing support | Needed | Complexity | Privacy / risk |
|---|---|---|---|---|---|
| Pick a date | Plan ahead | Dated activities, 7-day feed | `from/to` on `/api/discover` or `/api/search`; a calendar in the When menu | M | None |
| Time of day | Fit around work/school | `time` on every activity | Client filter on the 7-day set; server param for longer ranges | S | None |
| Price bands (Free / under €10 / under €20) | Budget | `priceCents`; search already parses "under €20" | `maxPrice` param; same price rule as §4 | S | Never treat unknown as cheap |
| Beginner friendly | Confidence to start | `listing_attributes`: beginner_friendly, no_experience, first_timers_welcome | Return attributes with search results; `attrs=` param | M | None |
| Family friendly / accessible / small group | Right fit | Same attributes | Same | M | Accessibility claims are the host's, label them as such |
| Going solo (wider) | Coming alone | `games.solo_friendly` (built), `come_alone` attribute, `circles.solo_welcome` | Extend beyond games | S–M | None |
| Location & distance | Nearby | County + radius in Where; confirmed lat/lng | Optional browser location → "Nearest" sort | M | Ask first, never store precise location, never put it in the URL |
| Personalised picks | Relevance | `scoreFit` / `matchReasons` / "For Me" | Surface fit reasons on Explore cards | S | Signed-in only; explain "why" |
| Surprise me | Serendipity | `?mood=surprise` endpoint exists | Put it in the Filters menu or the empty state | S | None |
| Saved searches / alerts | Come back when something appears | `createSearchAlert` (county + keywords) | Store category/type/when/filters; email or in-app delivery | M | Opt-in, unsubscribe, rate limits |

Suggested order: time of day + price bands → beginner/family/solo attributes → date picker → location → alerts.
