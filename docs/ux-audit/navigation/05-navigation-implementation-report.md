# 05 — Navigation Implementation Report

Uncommitted. No route, API, permission or data change.

## Files changed

| File | Change |
|---|---|
| `client/src/navigation/navConfig.ts` | Explore regrouped: `EXPLORE_THINGS` (5) and new `EXPLORE_LEARN` (Programmes, Volunteer). Removed `EXPLORE_FEATURED`, Circles and "Become a host" from Explore. "All activities" → "Explore everything". Programmes icon → GraduationCap. New `START_GROUPS` (3 intent groups); `START_ITEMS` is derived from it, so the order is now activity, Make It Happen, Circle, host, venue. |
| `client/src/components/Header.tsx` | Explore panel built from groups with one featured tile; photo tile removed. Start panel shows group labels (`role="group"`). |
| `client/src/components/MobileTabBar.tsx` | Explore sheet adds the "Learn & give back" group; Start sheet shows the groups. |
| `client/src/components/header/header.css` | New column templates; tablet layout (titles-only "Things to do", slim featured row). |
| `client/src/navigation/navConfig.test.ts` | Expectations updated for the new groups. |

**Reused:**
- `navConfig` (one source for desktop and phone)
- `NavIcon`
- `hc-mega-row`, `hc-mega-tile`
- `Drawer`/`Modal`
- `accountItemKeys`

Nothing new added as a dependency.

## Deferred (needs a decision or backend work)

1. Programmes and Circles in `/api/search` (backend change).
2. Category level in navigation and lists (category schema approval).
3. Renaming the "My Life" tab to "You" (product).
4. A venue path while venues are gated, e.g. "Venues — launching soon" (launch decision).

## Update — final Explore design (owner reference, 2026-10-22)

The Explore menu is now a page-width panel under the header, starting at the logo, built to the owner's reference design (`components/Header.tsx`, `header/header.css` "Explore mega menu").
- **Three link columns, separated by thin rules:**
  - Things to do: Explore everything, Activities & games, Adventures, Experiences, Events this weekend.
  - Learn & give back + Places.
  - Start & host: Create an activity, Start a Circle, Become a host, List your venue (Make It Happen when switched on).
- **Each row:** orange icon, title, one line, chevron.
- **Photo card:** "This weekend — Find your next adventure", with an orange "See what's on" button.
- **Tinted footer:** "Not sure what to do? Try Free Time Mode", plus "Showing results near {county}" for residents with a home county ("Change" → profile).
- **Places while venues are gated:** Community centres and Sports clubs show a **"Soon"** badge and go to the existing `/coming-soon` page (owner request; never the gated routes). The same applies in the phone Explore sheet.
- **Below 1240px** the photo card hides; **below 1040px** descriptions hide.
- The Start dropdown and phone sheets are kept. The search bar is unchanged: the reference's location picker isn't built (no header location setting exists).

**Also:** Home hero headline set to 6rem on tablet and desktop (phones keep their own size).

**Verified:** client tests 302, build, `qa:check` 97, `qa:lifecycle` + `qa:product` 132 passed (1 skipped by design), no overflow at 1024/1440/1920. Test updated: the phone sheet link is now "Activities & games".
