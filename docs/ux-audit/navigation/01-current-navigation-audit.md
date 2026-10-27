# 01 — Current Navigation Audit (2026-10-22)

**Environment:**
- read-only preview on `:5573` (dev API, writes blocked);
- venue pages switched on in that preview so the Places group could be audited (they are hidden in the public build);
- earlier redesign context in `docs/header-navigation-ux-audit-2026-10-12.md`.

## Structure before this change (Verified)

- **Desktop header:** Logo · Explore ▾ · Circles · + Start ▾ · Search field (icon below 1180px) · Saved/Messages/Notifications (signed in) · Account ▾ / Log in · Sign up.
- **Explore** (full-width panel, 422px tall on a 900px screen):
  - **Things to do:** All activities → `/explore` · Activities → `/games` · Adventures · Experiences · Events → `/explore?when=weekend` · Programmes · Volunteer · Circles.
  - **Places:** Community centres, Sports clubs (only when venues are public).
  - **Featured:** This weekend → `/games?when=weekend` · Become a host · Free Time Mode.
  - **Photo tile:** "Discover what's on" → `/explore`.
- **Start:** Create an activity · Start a Circle · Make It Happen (only when the commerce switch is on) · Become a host · List your venue (hidden for vendors).
- **Phone:**
  - **Tab bar:** Home · Explore (sheet) · Start (sheet) · Circles · My Life.
  - **Sheets:** centred full-height dialogs (`Drawer` renders `Modal`), no side drawers.
- **Account menu:** role-based from `navConfig.accountItemKeys()`, with a "Manage" group and the Personal ⇄ business switch.

## Findings

| ID | Finding | Evidence | Severity | Status |
|---|---|---|---|---|
| NAV-01 | "All activities" (→ `/explore`, every type) next to "Activities" (→ `/games`): two labels for different scopes that read as the same thing | screenshot `before-explore-1440.png` | P1 | **Fixed:** "Explore everything" |
| NAV-02 | Circles appears twice (top bar and inside Explore); on phones also as a tab | `navConfig.ts` (before), tab bar | P2 | **Fixed:** removed from Explore |
| NAV-03 | Two "weekend" links with different results: Events → `/explore?when=weekend` (10 results in dev) vs featured "This weekend" → `/games?when=weekend` (3) | link walk | P1 | **Fixed:** one "Events this weekend" |
| NAV-04 | "Become a host" in both Explore (featured) and Start | config | P2 | **Fixed:** Start only |
| NAV-05 | Four promo tiles plus a photo; the photo links to `/explore` a third time; the panel covers 47% of a 900px screen | `before-explore-1440.png` | P2 | **Fixed:** one featured tile, panel 353px |
| NAV-06 | At 1024px the four Explore columns wrap words one per line | `before-explore-1024.png` | P2 | **Fixed:** titles-only grid, slim featured row |
| NAV-07 | Programmes used a "people" icon like Circles | config | P3 | **Fixed:** graduation cap |
| NAV-08 | Start mixes creating something with applying or marketing pages, without grouping | `before-start-1440.png` | P3 | **Fixed:** three intent groups |
| NAV-09 | Header search covers centres, clubs, activities and experiences (`/api/search`); Circles only through a "Search Circles" suggestion; **programmes not searchable** | `HeaderSearch.tsx` header comment; `search.ts:155` | P2 | **Needs backend approval** |
| NAV-10 | No category level in navigation: Explore lists types only; the activities list chips are the most frequent free-text labels | `Games.tsx:562` | P2 | Depends on the category system (approval) |
| NAV-11 | Places is hidden entirely while venues are gated, so the public build has no venue path at all (by design, launch decision) | `EXPLORE_PLACES.visible` | — | Unchanged (launch decision) |
| NAV-12 | The Escape key and outside click close the menus and return focus to the trigger (good) | walk: `esc→focus hc-explore-menu` | — | Verified working |
| NAV-13 | No horizontal overflow at 320/390/768; tab bar present ≤860px | walk | — | Verified |

Every link opened and loaded its page (17 destinations, each with a heading).
