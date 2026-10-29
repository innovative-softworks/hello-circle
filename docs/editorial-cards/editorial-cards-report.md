# Bold word on listing cards — rollout report

Local, 2026-10-28, dev data (`hello_circle_dev`). Nothing committed, pushed or deployed.
Screenshots: `screenshots/before-*.png` (before), `screenshots/after-*.png` (after), `screenshots/form-*.png` (host form).

## 1. What changed (owner decisions, 2026-10-28)

- **One card, plus the word.** Every listing keeps its normal card (photo with date and action, kicker, title, place, price). The only addition is the listing's category, set large and half see-through across the top of the photo. The separate "bold" feature card is no longer used for results. `components/BoldResultCards.tsx` was removed.
- **Only on search results.** The word appears when the visitor has typed a search, picked a category, or applied a filter. A plain page of listings shows the normal cards. On Explore it appears in results mode only.
- **Pages:** Activities & games (`/games`), Adventures, Experiences, Volunteer, Programmes (the shared `BrowseLayout`), and Explore results (activities, adventures/experiences, programmes). Ask HelloCircle's experience results use the same `ExperienceSearchCard`, so they show it too.
- **Circles are unchanged.** `/circles` is untouched. On Explore, Circle results are back on their original Circle card, with no word.
- **Shared component:** `ListingCard` takes an optional `word` (`components/ListingCard.tsx`, `.lc-word` in `listingCard.css`). Each listing type passes its own word through `cardWord()` (`client/src/cardWord.ts`). Favourites, availability, booking/join actions, navigation and layout are untouched.

## 2. Where the word comes from

In order:
1. **The chosen type**, when the visitor picked one on Explore ("Hiking").
2. **The listing's assigned category:** its subcategory, else the first part of its category ("Outdoors & adventure" → "Outdoors").
3. **The listing's own title**, but only when the existing category matcher finds exactly one live category in it. These are the same alias rules the original backfill trusted, and what the admin review lists as a "Medium — one suggestion". Ambiguous or review-only words never count. For example, "Dublin Rooftop Yoga & Brunch" gets no word from its title, because the title also points at Food & drink.
4. **The listing kind:** Activity, Adventure, Experience, Volunteer or Programme.

This is display only. Nothing is written to the database, and category filters and counts still use assigned categories only (`server/src/categoryLabels.ts`). An earlier draft borrowed a game's Circle category ("Circle Coffee Morning" → CHESS); that was dropped as unreliable.

List endpoints send the label as `categoryLabel`, because programmes already have a free-text `category`. Search and feed results send `category`.

## 3. Free or paid (host activity form)

- `/games/host` (create and edit) now asks **"Is it free or paid?"** with Free / Paid. The price field appears only for Paid and is required there.
- A new activity starts with neither chosen. Continue is refused until one is picked ("Say whether it's free or paid"). Paid with no amount is refused ("Add the price per player, or choose Free").
- Free saves `priceCents: 0`. An older activity saved with no price opens with neither chosen. If someone has already joined, the price stays locked and shows "Not set", and does not block editing.
- **Payment and booking logic are unchanged.** The server already treats 0 and no price the same way (only `price_cents > 0` is paid). The only difference is that 0 now says "Free" on cards.
- On the pages in scope, a card with no stated price shows no price instead of "Free" (Activities grid, Explore results, experience search results).

## 4. Uncategorised listings — audit and admin workflow

The admin workflow already exists: Admin → Categories → **Uncategorised listings → Review**. It does the following:
- Lists every listing without a category, with the matcher's suggestion, confidence and reason.
- "Accept suggestion" (Medium only) opens a confirmation naming exactly what will be assigned.
- "Review…" (Low) and "Choose…" (None) open the category picker.
- Super admins change categories (`taxonomy.manage`); other roles can only Report.
- Every change is audit-logged.
- Nothing is assigned automatically. No changes were needed.

Dev audit (read-only, same logic as that screen):

| Type | Total | Uncategorised | One clear match | Check first | No suggestion |
|---|---|---|---|---|---|
| Games | 105 | 49 | 41 | 1 | 7 |
| Circles | 18 | 5 | 3 | 0 | 2 |
| Clubs | 23 | 2 | 0 | 1 | 1 |
| Centres | 23 | 10 | 0 | 7 | 3 |
| Experiences | 20 | 7 | 3 | 4 | 0 |
| Programmes | 10 | 6 | 4 | 2 | 0 |

Most uncategorised games are seed games created after the one-time backfill. Accepting the 41 clear matches in the review screen would make their word "assigned".

## 5. Files

| File | Change |
|---|---|
| `client/src/components/ListingCard.tsx`, `listingCard.css` | Optional `word` and its style |
| `client/src/cardWord.ts` (+ test) | Word order: chosen type → subcategory → category → kind |
| `client/src/components/BrowseLayout.tsx`, `ExperienceKindBrowse.tsx`, `pages/Programs.tsx` | Word on search results; a chosen category no longer switches cards to the bold feature style |
| `client/src/pages/Games.tsx` | Word on search results; no price shown when none is stated |
| `client/src/pages/Explore.tsx`, `components/DiscoverRow.tsx`, `ExperienceSearchCard.tsx` | Normal cards plus word; original programme/Circle result cards restored |
| `client/src/pages/HostGamePage.tsx` | Free / Paid choice |
| `server/src/categoryLabels.ts` | Assigned category, else one clear title match (existing matcher) |
| `server/src/routes/games.ts`, `experiences.ts`, `programs.ts` | `categoryLabel` on list responses |
| `packages/types/src/index.ts` | `categoryLabel` on Game, Experience, ProgramSummary; `source` on CategoryLabel |

No schema, payment, booking, permission or Circle-card changes.

## 6. Tests

- **Client:** typecheck clean; Vitest 334 / 334 (3 new for `cardWord`).
- **Server:** typecheck clean; Docker-isolated suite **129 files, 1183 passed, 23 skipped, 0 failed**.
- **Browser** (Playwright, :5180 → API :3011, dev data; Volunteer and Programmes use injected sample listings, because dev has none live). At 1440 / 1024 / 768 / 375:
  - Plain pages show no word.
  - Category, filter and typed search show a word on every card.
  - Clearing the search removes the words.
  - No word overflows its photo, and there is no sideways page scroll or page error.
  - Samples covered a long title, a missing photo, no category, "1 spot left", "Fully booked", "No dates yet", Free, and paid with "for 6 sessions".
- **Host form** (dev resident `ce2-org@example.test`): every case in §3 checked. The create request was captured and stopped, so no data was written.
- **Not checked in a browser:** the admin review screen, because the dev admin needs two-step sign-in. That screen is unchanged.

## 7. Open points

- Other pages still show "Free" for a missing price: Home rows, Circle plan cards and the shared `CardPrice`. They were outside this brief; the same rule can be applied there.
- Programme cards still show the free-text programme category as their kicker (e.g. "ARTS"). The word uses the assigned category.
