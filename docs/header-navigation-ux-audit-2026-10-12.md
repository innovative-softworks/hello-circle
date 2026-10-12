# HelloCircle — Header & Navigation UX/UI Audit

**Date:** 2026-10-12 · **Branch:** `feature/commerce-engine` (working tree, uncommitted) · **Scope:** audit only. No code, database, commerce or deploy changes were made.

**How to read the evidence labels**

| Label | Meaning |
|---|---|
| **[Live]** | Verified in a running dev build (`localhost:5173` against `hello_circle_dev`) with headless Playwright. |
| **[Code]** | Verified by reading the source. The file and line are given. Not exercised live. |
| **[Rec]** | A recommendation, not a finding. |

**Test setup.** `VITE_LAUNCH_MODE=public`, `VITE_VENUE_PAGES_PUBLIC` unset, so venue pages are hidden. The Make It Happen switch was off in the dev data, so its Start item did not show.
- **Desktop widths:** 1024, 1280, 1440 and 1920.
- **Mobile widths:** 320×568, 375, 390 and 428 (×844), and 768×1024.
- **Roles tested live:** a signed-out guest, and the seeded dev admin (`admin@hellocircle.ie`).
- **Roles read from code only:** resident, Circle member, organiser, host, vendor owner and vendor staff. A resident session needs a magic-link email, and the audit rules forbid database writes to fake one.

---

## A. Executive summary

**Current state.**
- **Desktop:** one large component, `Header.tsx` (1,289 lines), renders everything: the desktop bar, the Explore mega menu, the Start mega menu, the notifications panel, the account menu, the workspace switcher and the mobile hamburger drawer.
- **Mobile (≤860px):** a second, separate system, `MobileTabBar.tsx`, renders a five-tab bottom bar (Home, Explore, Start, Circles, My Life). Its Explore and Start tabs open their own sheets.
- **Navigation lists:** none is shared. Explore and Start items are written out by hand in the header, the tab-bar sheets, the footer and the Home categories, so they have drifted apart.

The foundations are sound:
- The header sticks to the top.
- Escape closes menus and returns focus to the button that opened them.
- Clicking outside closes them.
- Mobile sheets are proper modals with a focus trap.
- Header search already reuses the main search page (`/explore?focus=1`) instead of a second engine.
- Role-gated destinations are enforced on the server.

**Major problems.**
1. **Search leads to dead ends while venues are hidden (P0) [Live].** Searching "hall" on Explore shows a "Places & Clubs (12)" group. Every card opens `/coming-soon`.
2. **The Explore mega menu runs off-screen at 1024px (P1) [Live].** It is a fixed 900px wide and anchored to its button, so its right edge is at 1141px on a 1024px screen. With venue pages public it becomes 1,180px wide and would also clip at 1280px [Code].
3. **Navigation isn't made of links (P1) [Live/Code].**
   - The logo is a `<div onClick>`, so the keyboard can't reach it at any width.
   - Every header and menu destination is a `<button>` that calls `navigate()`. Nothing in the header can be opened in a new tab or cmd-clicked, and screen readers and crawlers don't see them as links.
4. **On phones, the header loses its signed-in tools (P1) [Live/Code].** At ≤860px it shows only the logo and the hamburger. The bell, chats, unread badges and avatar disappear. Notifications become a plain text link in the drawer, and that link goes to the wrong page.
5. **Notification links go to the wrong places (P1) [Code/Live].**
   - Resident notifications all open `/bookings`, but the real inbox is `/profile?tab=inbox`.
   - The vendor bell's badge counts pending or rejected *listings*, but the bell opens the *messages* tab.
   - The admin "Notifications" bell is really a pending-listings shortcut [Live].
6. **Two menus compete on mobile (P1) [Live].** The bottom bar has Explore and Start sheets. The hamburger has Search, Free Time Mode, the theme toggle and account links. Search exists only in the hamburger, and the Explore sheet has no "Explore everything" or search entry, so the main `/explore` page can't be reached from the Explore tab.
7. **The account menu doesn't fit the person (P1/P2) [Code/Live].**
   - A signed-in resident sees a hamburger icon, not their avatar.
   - The button is labelled just "Menu".
   - There is no Profile or Settings item.
   - Admins are offered "My Life", a resident-only page [Live].

**Overall recommendation [Rec].** Don't redesign the header. Evolve it in place:
- **One shared navigation config** used by the header, the tab-bar sheets and the footer.
- **Real links** throughout.
- **On mobile, the bottom bar is the main navigation.** The header keeps a slim set of tools (search, bell, avatar), and the hamburger becomes a small "account & more" sheet.
- **A smaller Explore menu** (a dropdown, not a full-width mega menu) that never overflows.
- **One search entry point** feeding the existing `/explore` search.
- **Fix the P0 and notification routing first**, since they are cheap and visible.

The reference order (Logo | Explore | Circles | How it works | For venues | Location | Search | Saved | Notifications | Profile | Start) fits mostly. Two parts don't yet:
- **Location** has no shared state to drive it.
- **"How it works"** has no route.

Both are listed in §I as decisions for you.

---

## B. Component inventory

### B1. Header and navigation components

| Element | File | Used where | Current behaviour | Depends on | Responsive behaviour | Sign-in needed | Role visibility | Known issues |
|---|---|---|---|---|---|---|---|---|
| Header shell (sticky) | `client/src/components/Header.tsx:447-470` | `App.tsx` (global) | `position: sticky; top: 0; z-index: 50`, blur background, safe-area top padding | ThemeContext, AuthContext, GuestContext, MyStuffContext, DashboardNavContext | 69px tall at every width [Live]; stays at top after scrolling [Live] | – | all | One component of about 1,289 lines with inline styles. |
| Logo | `Header.tsx:497-502`, `BrandLogo` | Header | `<div onClick={go("/")}>` | – | 183×36 at every width [Live] | – | all | **Keyboard can't reach it**, it isn't a link, and it carries `aria-current` on a div [Live]. |
| Desktop nav (Explore, Circles, My Life, Start) | `Header.tsx:503-697` | Header, `.desktop-nav` | Buttons calling `navigate()` | react-router | Hidden at ≤860px (`index.css:772-775`) | – | all, including signed out | Buttons, not links. "My Life" is shown to guests. |
| Explore mega menu | `Header.tsx:504-619`, `megaMenuStyle` at `:367-382` | Header | 3 columns (4 when venues are public): Things to do, [Places], Featured, plus an image tile | `VENUE_PAGES_PUBLIC` | Fixed 900 or 1,180px wide, `left: 0` from its button. **Clipped at 1024px [Live]** | – | all | Off-screen; outside photo from Unsplash; "Become a host" (a create action) inside Explore; Adventures and Experiences share an icon. |
| Start menu | `Header.tsx:634-696` | Header | Host an activity, Start a Circle, [Make It Happen], [Book a place], Suggest a place | `useOpenBookingOpen`, `VENUE_PAGES_PUBLIC` | 320px panel, fits at all widths [Live] | Pages ask guests to sign in | all | Its active state is visual only (no `aria-current`). |
| Theme toggle | `Header.tsx:699-707` | Header | Light/dark switch | ThemeContext | Visible ≥861px | – | all | Takes a prime header slot. |
| Search button | `Header.tsx:708-716` | Header | Goes to `/explore?focus=1`, which focuses the Explore input [Live] | `/explore` | ≥861px; on mobile it's in the hamburger only | – | all | It, not Explore, is highlighted on `/explore` [Live]. |
| Free Time Mode | `Header.tsx:717-725` | Header | Goes to `/free-time` | – | Hidden from 861–1024px (`.hide-tablet`) [Live] | – | all | Icon-only lightbulb; its meaning isn't obvious. |
| Business bell | `Header.tsx:733-764` | Header | Navigates straight away (no panel): admin → `/admin?tab=pending`, vendor → `/vendor?tab=messages` [Live: admin] | `fetchAdminPendingListings` / `fetchVendorListings` | ≥861px | vendor/admin | vendor/admin without a resident session | Badge counts listings, not messages; labelled "Notifications". |
| Chats | `Header.tsx:766-798` | Header | Goes to `/chats`; unread badge; refreshes every 60s and on every page change | `fetchChatInbox` | ≥861px; mobile drawer text link | resident or vendor-only session | resident, vendor | Refetches on every page change. |
| Resident bell and panel | `Header.tsx:800-881` | Header | Panel of the last 20 notifications (8 shown); clicking one marks it read and **always goes to `/bookings`** | `fetchResidentNotificationsPage`, `markResidentNotificationRead` | ≥861px only | resident | resident | Wrong destination; no "See all" link to `/profile?tab=inbox`. |
| Account menu | `Header.tsx:883-1103` | Header | Guest: My Life, Sign in, Join, For venues. Resident: My Life, Saved, Chats, workspaces, Sign out, For venues. Vendor/admin: My Life, dashboard, Personal switch, Log out | `fetchManageWorkspaces`, `fetchMyGames({hostedOnly})`, `switchWorkspace` | ≥861px | – | role-dependent | Button labelled "Menu"; avatar shown only for vendor/admin; no Profile/Settings; admin sees "My Life" [Live]; "Log out" vs "Sign out". |
| Workspace switcher | `Header.tsx:965-1021`, `switchToVendor`/`switchToResident` `:122-155` | Account menu and mobile drawer | Personal ⇄ linked vendor; "Manage hosting"; "Manage {Circle}" for each organised Circle | `/api/manage/*` | both | resident or linked vendor | linked accounts, hosts, organisers | One row per organised Circle, so the list can grow without limit. |
| Dashboard burger | `Header.tsx:471-496`, `DashboardNavContext.tsx` | Vendor/Admin/Manage dashboards | Opens the dashboard side menu | `useDashboardNav` | Hidden ≥1025px (rail shown) and ≤860px (moved into the hamburger) | vendor/admin/host | dashboards | Works as designed [Live: admin at 1024px]. |
| Mobile hamburger and drawer | `Header.tsx:1106-1272` | Header ≤860px | An inline panel under the header (not a dialog): [Manage], "Not sure yet?" (Search, Free Time Mode), "You" (Chats, Notifications, theme), auth | as above | Opens 418px tall for a guest; fits at 320×568 [Live]; no scroll lock, no `role` | – | role-dependent | Notifications link goes to `/bookings`; no Saved or Profile; repeats things the tab bar does; can grow past the screen for organisers of many Circles [Code]. |
| Bottom tab bar | `client/src/components/MobileTabBar.tsx` | `App.tsx` (global) | Home → `/home`, Explore (sheet), Start (sheet), Circles, My Life (badge) | `Drawer` (ui.tsx), MyStuffContext | Shown ≤860px; 48px-tall targets, 62–152px wide [Live] | – | all | Explore sheet has no "Explore everything" or Search [Live]; no Become a host anywhere on mobile. |
| Explore and Start sheets | `MobileTabBar.tsx:144-209` | Tab bar | Modal sheets | `Drawer` | `aria-modal="true"`, focus trapped, Escape closes, focus returns to the tab [Live] | – | all | Items repeat the header's own list by hand. |
| Bottom spacing sync | `components/BottomChromeSync.tsx`, `index.css:34-44` | App | Sets `--bottom-chrome` / `--bottom-nav` so content clears the tab bar | – | ≤860px | – | – | – |
| Cookie banner | `components/CookieNotice.tsx` | App | Fixed banner (`z-index: 260`); pads the body so the footer stays visible | – | At 320×568 it takes 199px (35%) of the screen [Live]; sits 16px above the tab bar, no overlap [Live] | – | all | Sits above open header menus (z 260 vs 60); no overlap seen at tested sizes. |
| Footer nav | `components/Footer.tsx:27-77` | App | A separate hand-written link list | `VENUE_PAGES_PUBLIC` | – | – | all | A third copy of the Explore list; "This weekend" goes somewhere different from Home's "Events" (see §D). |
| Homepage hero search | `pages/Home.tsx` (hero) | Home | Text + when + county; routes to `/explore` or `/games` | `recentSearches.ts` | – | – | all | **Keep as it is** (your instruction). |
| Explore search | `pages/Explore.tsx:540-640` | `/explore` | Search box; the address (`?q=`) holds the search; recent and popular suggestions | `search()` → `GET /api/search` | – | – | all | See P0-1. |

### B2. Duplicated or inconsistent definitions [Code]

| What | Where it's defined | Problem |
|---|---|---|
| Explore destinations | `Header.tsx:520-616`, `MobileTabBar.tsx:144-182`, `Footer.tsx:31-38`, `Home.tsx:424-431` (`cat`), `Explore.tsx` `ALL_CATEGORIES` | Five hand-written lists. The labels differ ("Activities" vs "Find activities" vs "Sports & games"), and "This weekend" goes to `/games?when=weekend` in two places but `/explore?when=weekend` on Home. |
| Start destinations | `Header.tsx:654-692`, `MobileTabBar.tsx:184-209` | Two copies, kept in sync by hand ("same items as the desktop Start menu"). |
| "Is this page active?" path lists | `Header.tsx:235-238, 508`, `MobileTabBar.tsx:132-133` | `START_PATHS` and the Explore path list are each written twice. |
| Notification badge markup | `Header.tsx:741-762, 775-796, 811-832` | The same inline badge style appears three times. |
| Words for one thing | Header "Start" / MobileTabBar code "Create" / Help guide "start"; "Log out" vs "Sign out"; "Vendor dashboard" vs the business name vs "Vendor account"; "Become a host" means `/become-a-host` (mega menu) **and** `/profile?tab=hosting` (Profile tab) | Inconsistent naming. |

---

## C. Navigation sitemap (as built)

### C1. Audit candidates checked against real routes

The route table is in `client/src/App.tsx`. "Working?" means the destination renders, checked live as a guest unless marked [Code].

| Navigation item | Actual route | Component | Visible in nav? | Working? | Issue |
|---|---|---|---|---|---|
| Home | `/` (Home when launch mode is public), `/home` | `Home` | Logo (desktop), Home tab (mobile) | Yes | Logo isn't a link. The tab goes to `/home`, so there are two URLs for one page. |
| Explore | `/explore` (`/search`, `/ask` redirect here) | `Explore` | Mega menu image tile, Search button, mobile drawer "Search" | Yes [Live] | Not in the mobile Explore sheet. The Explore button isn't highlighted on `/explore`. |
| Activities | `/games` | `Games` | Mega menu, mobile sheet, footer | Yes | The address says "games" but the label says "Activities". |
| Circles | `/circles` | `Circles` | Desktop nav, mobile tab, footer | Yes [Live] | – |
| Venues | `/browse/centres`, `/browse/clubs`, `/centres/:id`, `/clubs/:id` | `Browse` etc. | Hidden while `VENUE_PAGES_PUBLIC` is off | Redirects to `/coming-soon` (deliberate) [Live] | **Search still shows venue cards (P0-1).** |
| Experiences | `/experiences`, `/adventures` (+ `/:id`) | `Experiences`, `Adventures` | Mega menu, mobile sheet | Yes | Two items share one icon. |
| Events | **No route** | – | Home "Events" tile → `/explore?when=weekend` | n/a | "Events" isn't a separate thing in the app. Not a broken link, just a label for "this weekend". |
| Volunteering | `/volunteer` | `Volunteer` | Mega menu, mobile sheet | Yes [Code] | – |
| How it works | **No route** | – | – | n/a | Closest pages: `/help-guide` (footer "Full help guide") and `/become-a-host`. Decision D2. |
| My Life | `/bookings` (`/my-life` is an alias) | `MyBookings` | Desktop nav, account menu, mobile tab | Yes | Shown to guests (works off the anonymous client id) and to admins [Live]. |
| My bookings | Inside My Life (`/bookings`) | `MyBookings` | via My Life | Yes | No separate route. |
| My Circles | Inside My Life / Circles | – | – | Not checked | No separate route found. |
| Saved | `/profile?tab=favourites` | `Profile` | Desktop account menu (resident), footer | Yes [Code] | Not on mobile. |
| Notifications | `/profile?tab=inbox` | `Profile` | **Nothing in the nav links here** | Yes [Code] | The bell and drawer go to `/bookings` instead (P1-4). |
| Messages | `/chats` | `Chats` | Header icon, account menu, drawer | Yes [Code] | – |
| Profile | `/profile?tab=account` | `Profile` | Footer only | Yes [Code] | Not in the account menu or the mobile nav. |
| Settings | **No route** | – | – | n/a | Settings are Profile tabs (`preferences`, `privacy`, `payment`, …). |
| Create an activity | `/games/host` | `HostGamePage` | Start menu (desktop and mobile) | Yes; guests see a sign-in prompt; server requires a resident (`games.ts:1418`) | – |
| Start a Circle | `/circles/start` | `StartCirclePage` | Start menu (desktop and mobile) | Yes; guests prompted; server `requireResident` (`circles.ts:957`) | – |
| List your venue | `/for-venues` (→ `/vendor/signup`) | `ForVenues` | Account menu "For venues & organisers", footer | Yes [Code] | Not in the Start menu. Called "List your venue" in the footer but "For venues & organisers" in the menus. |
| Become a host | `/become-a-host`; also `/profile?tab=hosting` | `BecomeAHost`, `Profile` | Desktop mega menu "Featured" tile only | Yes [Code] | **Not reachable from mobile navigation at all.** Shown under Explore, not Start. |
| Host dashboard | `/manage` (`/manage/pro`, `/manage/rewards`, `/manage/circles/:id`) | `ManageHome` | Account menu / drawer "Manage hosting" (if they've hosted or organise) | Yes [Code] | – |
| Vendor dashboard | `/vendor` (`?tab=` overview, listings, messages, bookings, earnings, programs, experiences, schedule, reviews, offers, demand, org) | `VendorDashboard` | Account menu / drawer | Yes [Code] | Shown to *pending* vendors too; the page handles that state. |
| Partner bookings, earnings, offers | `/vendor?tab=bookings` / `earnings` / `offers`; host: `/manage` tabs | – | Dashboard side menu only | Yes [Code] | Fine; these belong in the dashboard, not the header. |
| Plans & billing | `/vendor/pro`, `/manage/pro` (+ `/rewards`) | `VendorProPage`, `HostProPage` | Dashboards only | Yes [Code] | – |
| Admin dashboard | `/admin` | `AdminDashboard` | Account menu "Admin dashboard", drawer | Yes [Live] | The bell is labelled "Notifications" but is the pending-listings shortcut. |

**Broken links:** none. **Dead ends:** venue cards in search (P0-1). **Hidden pages:** Notifications inbox, Profile and Become a host (on mobile) have no nav entry. **Duplicate addresses:** `/` and `/home`; `/bookings` and `/my-life`; `/games` (labelled Activities); `/adventures` alongside `/experiences`.

### C2. Navigation by surface and role [Code; guest and admin also Live]

| Surface | Guest | Resident | Host / organiser | Vendor owner | Vendor staff | Admin |
|---|---|---|---|---|---|---|
| Desktop main nav | Explore, Circles, My Life, Start | same | same | same | same | same |
| Desktop icons | Theme, Search, Free Time, Menu | + Chats, Bell (panel) | same as resident | + Business bell, Chats (vendor-only session) | same as owner | Theme, Search, Free Time, Bell (link), Avatar [Live] |
| Account menu | My Life, Sign in, Join, For venues [Live] | My Life, Saved, Chats, [vendor switch], Sign out, For venues | + Manage hosting, Manage {each Circle} | My Life, Vendor dashboard, [Personal], Log out | same; the dashboard hides tabs by role (`vendorTabAccess.ts`) | My Life, Admin dashboard, Log out [Live] |
| Mobile header | Logo, hamburger [Live] | same (no bell or avatar) | same | same | same | same |
| Mobile drawer | Search, Free Time, theme, Sign in, Join, For venues [Live] | + Chats, Notifications→`/bookings`, Sign out | + Manage section | + Notifications, Vendor dashboard, Log out | same | Notifications (2), Admin dashboard, Log out [Live] |
| Mobile tab bar | Home, Explore, Start, Circles, My Life | same | same | same | same | same |

**Switching between identities [Code].** `switchToVendor` and `switchToResident` (`Header.tsx:122-155`) mint the other session and send you to `/vendor` or `/bookings`. The switcher only appears for genuinely linked accounts (`samePerson`, `:101`). No unauthorised links were found: staff are kept to their permitted tabs on the dashboard (`VendorDashboard.tsx:161-166`, where a `?tab=` they can't see falls back to Overview), and every action is still checked on the server (`requirePlatformRole`). Hiding a menu item is never the only protection here, which is correct.

---

## D. UX findings

### P0 — broken functionality, security or access

- **P0-1 Explore search shows venues while venue pages are hidden. [Live]**
  - **What happens:** `GET /api/search?q=hall` returns 12 centres. Explore shows a "Places & Clubs (12)" filter and a "PLACES & CLUBS" grid. Clicking a card lands on `/coming-soon`.
  - **Code:** `Explore.tsx:479-491` and `:788-795` don't check `VENUE_PAGES_PUBLIC`, even though the same file already uses it to filter the category chips (`:100`).
  - **Affects:** every keyword search that matches a hall, centre or club name.

No security or access problem was found. The navigation shows nothing that the server doesn't also protect.

### P1 — major usability problems

- **P1-1 The Explore mega menu goes off-screen. [Live]**
  - **At 1024px:** the panel spans 241→1141px on a 1024px screen, so the image tile and Featured column are cut off.
  - **With venue pages public:** the width becomes 1,180px (`Header.tsx:372`), clipping at any screen narrower than about 1,425px, which includes 1280 [Code, calculated].
- **P1-2 Logo and nav aren't links. [Live/Code]**
  - The logo isn't in the Tab order at any width.
  - Every header and menu destination is a `<button onClick={navigate}>`, so there's no open-in-new-tab, no link semantics, and no crawlable header links.
  - The footer already uses real `<Link>`s, which shows the pattern exists.
- **P1-3 The mobile header drops its signed-in tools. [Live/Code]**
  - At ≤860px `.desktop-actions` is hidden (`index.css:772-775`).
  - Residents lose the bell and its unread badge, chats, search and their avatar from the header.
  - The only remaining signals are text counts inside the hamburger and the My Life badge.
- **P1-4 Notifications go to the wrong place. [Code; admin Live]**
  - Clicking a resident notification always opens `/bookings` (`Header.tsx:859`), whatever it was about.
  - The real inbox (`/profile?tab=inbox`) isn't linked from any navigation.
  - The mobile "Notifications" link also opens `/bookings` (`:1220`).
  - The vendor badge counts pending or rejected listings (`:223-228`) but the bell opens the messages tab (`:736`) on desktop and the Overview on mobile (`:1235`).
  - The admin bell is a pending-listings shortcut labelled "Notifications" [Live].
- **P1-5 Two mobile navigation systems overlap. [Live]**
  - **Bottom bar:** Explore and Start sheets.
  - **Hamburger:** "Not sure yet?" (Search, Free Time Mode), the theme toggle and account links.
  - **The gap:** the Explore sheet lists Activities, Adventures, Experiences, Programmes and Volunteer, but **not** the main `/explore` page or search. Search is only in the hamburger. Become a host isn't on mobile at all.
- **P1-6 The account menu doesn't adapt to who's signed in. [Code/Live]**
  - The button is labelled "Menu" for everyone.
  - It shows the hamburger icon for signed-in residents (only vendor/admin get an avatar, `:901`).
  - There's no Profile or Settings item for any role.
  - Admins get "My Life" [Live].
- **P1-7 Search can't find Circles. [Code]**
  - `SearchResult` (`packages/types`) and `routes/search.ts` cover centres, clubs, activities and experiences, but not Circles.
  - The header Search button and Explore's search box ("…Circles, adventures and places") suggest Circles are included.
  - Circles can only be searched on `/circles`.

### P2 — consistency improvements

- **P2-1 No shared navigation config.** Five hand-written Explore lists and two Start lists (§B2).
- **P2-2 Highlighting the current page is uneven [Live].**
  - On `/explore` the Search icon is highlighted, not Explore.
  - Explore is highlighted for `/games`, `/experiences` and similar, but not for `/explore` itself.
  - Start's highlight is visual only.
  - The logo carries `aria-current` on a div.
- **P2-3 Naming drift.**
  - Start vs Create.
  - "Log out" vs "Sign out".
  - "List your venue" vs "For venues & organisers".
  - "Become a host" points at two different pages.
  - "Activities" lives at `/games`.
  - "This weekend" goes to `/games?when=weekend` in the mega menu and footer, but Home's "Events" goes to `/explore?when=weekend`.
- **P2-4 Things in the wrong menu.**
  - "Become a host" (a create action) sits in Explore's Featured column.
  - "Book a place" (Start) and "Community centres" (Explore) go to the same page.
  - Guests see "My Life" first in the account menu.
- **P2-5 The header fetches too much [Live/Code].**
  - Pending listings (admin) and vendor listings are re-fetched on **every** page change. Live: 2 calls for 2 in-app navigations.
  - The chat inbox reloads on every page change plus every 60 seconds.
  - Workspaces and hosted games load whenever the resident changes.
  - None of these are cached between pages.
- **P2-6 There's no shared "where am I" location.** Home keeps the chosen area in `sessionStorage`, Explore and Circles keep it in the address, and the resident profile has its own `homeCounty`. A header location selector would need a shared location store first (decision D1).
- **P2-7 The mobile drawer isn't a dialog.** It's an inline panel inside the sticky header, with no role, no scroll lock and no focus trap. It's short today (418px for a guest), but the Manage section adds one row per organised Circle, so a big organiser on a 320×568 phone could have a drawer taller than the screen inside a sticky header.
- **P2-8 The header is too large to change safely.** One 1,289-line component with all styles inline, and badge markup repeated three times.
- **P2-9 The cookie banner takes over small phones [Live].** At 320×568 it covers 199px (35%) of the screen until the visitor chooses. There's no overlap with the tab bar or menus.

### P3 — visual polish

- **P3-1** The Explore mega menu image is an Unsplash URL loaded from outside on every open (`Header.tsx:606`), bypassing the app's image pipeline. It's decorative weight in a navigation menu.
- **P3-2** Adventures and Experiences share an icon (`TreeIconSmall`), in both the header and the mobile sheet.
- **P3-3** The theme toggle and Free Time Mode (icon only) take the first two icon slots. They're secondary to search, notifications and account.
- **P3-4** Desktop nav buttons are 34px tall (the Start button 36px). That's fine for a mouse, but below 44px if a tablet ever shows the desktop nav.
- **P3-5** The dropdowns use 16px rounding and strong shadows (`0 16px 36px`, `0 32px 64px`), heavier than the "minimal borders and shadows" editorial direction.

---

## E. Current vs proposed

| Element | Keep | Improve | Move | Combine | Remove |
|---|---|---|---|---|---|
| Sticky header, 69px tall | ✓ | | | | |
| Logo | ✓ | Make it a real link to `/` | | | |
| Explore menu | The Things-to-do and Places groups | Fit inside the screen; real links; add "Explore everything" and "This weekend" | "Become a host" → Start | | The Unsplash image tile |
| Circles (top level) | ✓ | Real link | | | |
| My Life (top level) | For signed-in residents | | For guests and admins: into the account menu, or hide (D4) | | |
| Start menu | ✓ | Real links; same list as mobile | Add "Become a host" and "List your venue" (D5) | "Book a place" should not repeat Explore's venue item | |
| Search button | ✓ (reuses `/explore`) | Optional compact header input with recent searches | | Should be the one search entry on every surface | Hamburger "Search" once it's in the mobile header |
| Theme toggle | | | Into the account menu | | From the top bar (D6) |
| Free Time Mode | | Label it, or present it as an Explore shortcut | Into the Explore menu | | From the icon row (D6) |
| Business bell vs resident bell | | One bell, one panel, correct destinations, "See all" → inbox | | Business items as a section in the same panel (already partly done) | The bell that only navigates |
| Account menu | ✓ | Avatar for residents; real label; Profile, Saved, Settings (Profile tabs) | | | "My Life" for admins |
| Mobile header | Logo | Add Search and Bell; avatar (or hamburger) for account | | | |
| Mobile hamburger | | Becomes a slim "Account & more" sheet (proper dialog) | | | Duplicated Search |
| Bottom tab bar | ✓ the main mobile navigation | Explore sheet gets "Explore everything" and "Search"; Start gets Become a host | | | |
| Footer | ✓ | Built from the shared config | | | |

---

## F. Proposed navigation architecture [Rec]

### F1. Desktop header (≥1025px; same structure at 861–1024 with fewer icons)

```
[Logo]  Explore ▾  Circles  My Life*   ·········   [⌕ Search…]  Start ▾  🔔  💬  (Avatar ▾)
                                                     guest: [Sign in]  [For venues]
* My Life only when signed in as a resident (D4)
```

- **Order:** Explore → Circles → My Life (discover and participate), then a search field, then **Start** (create) as the strongest call to action next to the account.
- **Compared with the reference:**
  - "How it works" and "For venues" become guest-only text links on the right.
  - "Location" waits for D1.
  - "Saved" moves into the avatar menu, so the icon row doesn't grow (D7).
- **Under 1280px:** the search field collapses to its icon.

### F2. Explore menu — a simple dropdown, not a mega menu

- **Two groups:** Things to do (Activities, Adventures, Experiences, Programmes, Volunteer) and Places (Community centres, Sports clubs, only when venues are public). Then a footer row: **Explore everything →** (`/explore`) and **This weekend →** (one agreed destination, D8).
- **Size:** at most `min(640px, 100vw − 48px)`, flipping to right-aligned if it would overflow. No photography.
- **Behaviour:** click to open (no hover-only), Escape and outside click close (already working), real links inside. Arrow keys are optional; Tab order already works.
- **Mobile:** the existing Explore sheet with the same items from the shared config, plus "Explore everything" and "Search" at the top.

**Why not a mega menu?** There are 5–7 destinations and no category data beyond them. A wide mega menu adds layout risk (P1-1) and a photo download for no extra navigation value.

### F3. Start menu — by role (no verification bypass)

| Item | Guest | Resident | Host / organiser | Vendor | Notes |
|---|---|---|---|---|---|
| Host an activity → `/games/host` | Shown; page asks to sign in (current) | ✓ | ✓ | ✓ only when a linked resident exists | Server `requireResident`. Hosting doesn't need verification (Verified Host is a badge only). |
| Start a Circle → `/circles/start` | Shown; sign-in prompt | ✓ | ✓ | as above | Server `requireResident`. |
| Make It Happen | only when the switch is on | ✓ | ✓ | – | Existing switch. |
| Become a host → `/become-a-host` | ✓ | ✓ unless already verified | hide | – | Moved from Explore (D5). |
| List your venue → `/for-venues` | ✓ | ✓ | ✓ | hide (already a vendor) | D5. |
| Suggest a place → `/suggest-place` | ✓ | ✓ | ✓ | – | |

Keep the server checks as they are. The menu just hides items that make no sense for the role.

### F4. One search entry point

- **One way in:** the header search (desktop field or icon; mobile header icon) routes to `/explore?q=…` (or `?focus=1` if empty), the page that already runs `GET /api/search`, holds the search in the address and stores recent searches (`recentSearches.ts`). **No second search engine.**
- **Suggestions:** reuse `POPULAR_SEARCHES` and `loadRecent()` in the header dropdown. No new endpoint.
- **Circles:** either extend `/api/search` to return Circles (a server change, D9), or show a "Search Circles for '…' →" row that links to `/circles?q=…`.
- **Leave alone:** the Home hero search, which already routes to `/explore` or `/games`.
- **Fix first:** P0-1 (hide venue results while venues are hidden).

### F5. Mobile (≤860px)

```
Header:  [Logo]                         [⌕] [🔔•] [Avatar/☰]
Bottom:  Home · Explore(sheet) · Start(sheet) · Circles · My Life
```

- **The bottom bar stays the main navigation.**
- **The header adds** Search and Bell (resident) with a 44px touch area.
- **The avatar or hamburger** opens an "Account & more" sheet using the same `Drawer` component the tab sheets use, so it gets modal behaviour, a focus trap and Escape. Inside: Profile, Saved, Notifications, Chats, workspace switching, theme, Free Time Mode, help, sign in or out.
- **No item appears in more than one mobile menu.**

---

## G. Implementation roadmap

| Phase | Scope | Complexity | Risk | Depends on | Components affected |
|---|---|---|---|---|---|
| **H1 — Consistency and accessibility** | Fix P0-1 (`VENUE_PAGES_PUBLIC` check on Explore's place results); logo and nav items become `<Link>`s; correct notification destinations and add "See all" → `/profile?tab=inbox`; label the account button; `aria-current` for Explore on `/explore` | S–M | Low (no change to the server or data) | – | `Explore.tsx`, `Header.tsx`, `MobileTabBar.tsx` |
| **H2 — Desktop header** | Shared nav config (`navConfig.ts`) used by the header, tab bar and footer; avatar for residents; account menu rework (Profile, Saved, theme); fewer icons; guest links | M | Medium (touches every page's chrome) | H1; D4, D6, D7 | `Header.tsx` (best split into `HeaderAccountMenu`, `HeaderNotifications`, `HeaderExploreMenu`), `Footer.tsx`, new `navConfig.ts` |
| **H3 — Explore and Start menus** | Replace the mega menu with a dropdown that fits the screen; drop the Unsplash tile; move Become a host and List your venue to Start; role-aware Start items | M | Low–Medium | H2; D5, D8 | `Header.tsx`, `MobileTabBar.tsx` |
| **H4 — Search** | Header search field or icon on desktop and mobile → `/explore`; reuse recent and popular suggestions; Circles handling | M (L if `/api/search` gains Circles) | Medium; a server change only if D9 picks it | H1 (P0-1); D9 | `Header.tsx`, `Explore.tsx`, `recentSearches.ts`, optionally `server/src/routes/search.ts` + `SearchResult` type |
| **H5 — Mobile** | Mobile header icons; turn the hamburger into an "Account & more" `Drawer`; add "Explore everything" and Search to the Explore sheet; Become a host on mobile; remove duplicates | M | Medium (bottom spacing, safe areas, cookie banner) | H2, H3 | `Header.tsx`, `MobileTabBar.tsx`, `index.css` (≤860px rules), `BottomChromeSync.tsx` |
| **H6 — Responsive and regression QA** | Matrix in §H at 320–1920; role sessions; keyboard and screen-reader passes; header request count (P2-5, add caching or skip refetch on page change) | M | Low | H1–H5 | Playwright scripts under `tests/` (the existing `qa:e2e` setup) |

---

## H. Test matrix

| # | Scenario | Roles | Widths | Expected |
|---|---|---|---|---|
| T1 | Every nav item opens its route (desktop menus, mobile sheets, drawer, footer) | all 8 | 1440, 390 | No 404s; no venue links while venues are hidden; no `/coming-soon` dead ends from search |
| T2 | Keyboard Tab order: skip link → logo → nav → search → Start → icons → account | guest, resident | 1280 | The logo can be focused; every item can be reached; visible focus ring |
| T3 | Open each menu with Enter or Space; Escape closes it and returns focus to its button; clicking outside closes it | all | 1024, 1440 | Already passes for Explore and Start [Live]; keep it passing |
| T4 | Explore menu fits on screen | guest | 1024, 1280 (venues on and off), 1440, 1920 | Right edge ≤ screen width − 16px |
| T5 | Current page is highlighted (`aria-current`) | guest | 1440, 390 | `/explore`, `/games`, `/circles`, `/bookings`, `/games/host` highlight the right item |
| T6 | Notifications: badge count, panel, item destination, "See all" | resident, vendor, admin, linked vendor+resident | 1440, 390 | Each item opens its target; the inbox is reachable; one bell |
| T7 | Account menu contents by role | all 8 | 1440, 390 | Matches §C2 / §F3; no My Life for admin; staff see only permitted dashboard tabs |
| T8 | Switching workspaces Personal ⇄ Vendor | linked vendor | 1440, 390 | The other session is created; lands on `/vendor` or `/bookings`; no switch for unlinked accounts |
| T9 | Start items by role; guest → sign-in prompt, then back to the form after sign-in | guest, resident, host, vendor | 1440, 390 | Server still refuses unsigned-in creation (`requireResident`) |
| T10 | Search: header → `/explore?q`; Back keeps the search; recent searches; empty results; Circles query | guest, resident | 1440, 390 | One engine; "Search Circles" route if D9 chooses it |
| T11 | Mobile: tab bar targets ≥44px; safe-area bottom; cookie banner doesn't cover the tab bar or menus | guest | 320×568, 375, 390, 428, 768 | Already passes for targets and banner [Live] |
| T12 | Mobile sheets: `aria-modal`, focus trap, Escape, focus returns | guest | 390 | Already passes [Live]; the new "Account & more" sheet must match |
| T13 | Mobile drawer with many organised Circles | organiser of 6+ Circles | 320×568 | Everything reachable (scrollable sheet) |
| T14 | Reduced motion | guest | 1440, 390 | No menu or sheet animation (`prefers-reduced-motion` rules exist in `index.css`) |
| T15 | Header API requests per in-app navigation | admin, vendor, resident | 1440 | No pending-listings, listings or chat refetch on every page change |
| T16 | Dark mode on every menu | guest, resident | 1440, 390 | Readable contrast |

---

## I. Decisions needing your approval

These can't be settled from the code alone.

| # | Decision | Options | My recommendation |
|---|---|---|---|
| D1 | **Header location selector.** There's no shared location store today (Home: per-tab storage, Explore and Circles: address, resident: profile `homeCounty`). | (a) Leave it out for now; (b) add a shared location store that every page reads | (a) for now. Revisit with (b) as its own piece of work. |
| D2 | **"How it works".** No route exists. | (a) Link to `/help-guide`; (b) a new page; (c) leave it out | (a), guests only. |
| D3 | **Venue results in search while venues are hidden.** | (a) Hide them (match the chips); (b) show them with a "Coming soon" label and no link | (a) |
| D4 | **"My Life" for guests and admins.** | Show to all (current) / residents only / guests too (it shows bookings made without an account) | Residents and guests with bookings on this device; never admins. |
| D5 | **Where "Become a host" and "List your venue" go.** | Explore Featured (current) / Start menu / account menu | The Start menu. |
| D6 | **Theme toggle and Free Time Mode in the top bar.** | Keep / move to the account menu and Explore menu | Move them. |
| D7 | **Saved as a header icon (reference) or a menu item.** | Icon / account menu | Account menu (fewer icons). |
| D8 | **One meaning for "This weekend".** | `/games?when=weekend` / `/explore?when=weekend` | `/explore?when=weekend` (covers experiences too). |
| D9 | **Circles in global search.** | Extend `/api/search` (server and shared type change) / client hand-off to `/circles?q=` | The hand-off first; server later if needed. |
| D10 | **Naming:** "Start" vs "Create"; "Sign out" for every role; "List your venue" vs "For venues & organisers". | – | Keep "Start"; "Sign out" everywhere; "For venues" in menus and "List your venue" as the action label. |
| D11 | **Explore: dropdown or mega menu.** | Simple dropdown (recommended) / keep the mega menu but fit it to the screen | Dropdown. |

---

### Appendix — audit evidence

- **Live runs:** Playwright 1.63 headless Chromium against `localhost:5173` (dev API on `:3001`, `hello_circle_dev`). Screenshots and raw JSON are kept outside the repo, in the session scratchpad.
- **Admin session:** a normal sign-in with the seeded dev admin account. That creates a session row, as any sign-in does. No other data was written.
- **Not exercised live:** resident, Circle member, organiser, host, vendor owner and vendor staff sessions. Those findings are from the code and are marked [Code].
