# HelloCircle — workspace detail-page template

_2026-10-20, branch `feature/workspace-detail-pages`. Local only: not committed, pushed or deployed._

One detail-page layout now serves the Super Admin, Partner and Host workspaces.

- **Main column (70%):** back link, breadcrumbs, the record name as the H1, labelled statuses and actions, then an optional hero, optional tabs, and sections separated by thin rules.
- **Context panel (30%):** a compact, rule-separated panel behind a thin vertical divider. On screens narrower than 1,100px it moves below the main content.

The split applies to the content area beside the workspace sidebar, not the whole window. There are no side drawers. Confirmations stay centred dialogs, and secondary or destructive actions sit in the record's **More actions** menu.

## Building blocks

| Part | Where | What it does |
|---|---|---|
| `RecordView` `aside` prop | `components/workspace/RecordView.tsx` | Turns any record page into the 70/30 layout. Without `aside`, the page renders as before. |
| `DetailSection` | `components/workspace/DetailParts.tsx` | A titled main-column section with an optional contextual action and note. Sections are divided by a rule, not a card. |
| `DetailFacts` | same | Label/value pairs: two columns in the main column, a single compact column (`columns={1}`) in the panel. Empty values are left out, never shown as dashes. |
| `DetailHero` | same | A 220px panoramic image (180px on phones) with Previous/Next, arrow keys and a counter when there are several. With no image it shows a short "No photos" strip, never a stock picture. |
| `DetailTabs`, `DetailTabPanel`, `useDetailTab` | same | WAI-ARIA tabs (arrow keys, Home and End). The tab is kept in the URL as `?rtab=`, and opening or closing a record resets it. |
| `ContextSection`, `ContextActions`, `CopyValue` | same | Panel blocks with a small heading; a list of management actions (only those the viewer may use); an ID with a copy button. |
| CSS | `components/admin/admin.css`, under "detail-page template" | `wd-*` classes. Inside the template, older `SectionLabel` and `Facts` content and `Box` panels take on the same rhythm automatically, so pages could move over without rewriting every section. |

Existing parts were reused rather than duplicated: `OverflowMenu`/`ActionMenu`, `ConfirmDialog`, `AdminModal`, `StatusTag`, `DecisionHistory`, `ObjectActivity` (now takes a `limit`), `SinglePinMap` (the existing click-to-open map, so no map loads until asked) and the `adm-table--stack` responsive tables.

## Pages

### Super Admin

| Page | Status | Notes |
|---|---|---|
| **Listing details** (All listings and Pending approvals) | Done; the reference design | Hero; tabs Overview · Rooms & facilities (centres) · Availability (or Weekly sessions / Upcoming dates) · Pricing · Photos · Description · Activity & decisions. Overview: description, facilities, hours and the 3 most recent activity entries. Panel: review checks and "Skip to next" (pending only); similar listings; partner; location with map; listing details (ID with copy, category, status, featured, created); management (Feature, Assign organisation, View public page). Approve and Reject are in the header; Unpublish and Delete are in More actions. |
| Vendor details | Done | Business details and listings in the main column. Panel: account state, contact, organisation, role and tier, account details. Approve or Reinstate in the header; Change role or tier, Open in Support and Suspend in More actions. |
| Organisation details | Done | Members, listings, feature flags, decisions and activity. Panel: owner, upcoming obligations, details. Suspend moved to More actions. |
| User details | Done (Support person record) | Order totals and orders in the main column. Panel: identity, resident account, partner/admin login. |
| Host details | Done (Support person record) | Admin Hosts opens the same person record. |
| Order details | Done (Support order record) | Booking, Payment (with refunds) and Timeline sections. Panel: customer (email, phone, View customer) and order details. Propose a new time in the header; View in Finance and Cancel on behalf in More actions. |
| Activity details | Done | Schedule & place, participants and activity log. Panel: host, details, reports. Cancel activity moved to More actions. |
| Exception details | Done (Finance records) | Exceptions open the Finance record pages: payment review, refund, dispute, transfer, settlement, payment event and order money. Their side column became the panel, and each record's history moved back to the main column. |
| Claims, Host applications, Place suggestions, Reports, Privacy requests | Done | Same template; the decision buttons stay in the header. |
| Circle details | **Not built** | Admin Circles opens the public Circle page; there is no admin Circle record or read API. Building one needs a new admin endpoint, which is outside this visual change. |

### Partner (Vendor Admin)

| Page | Status | Notes |
|---|---|---|
| Venue/facility, club and experience details | Done (editor pages) | These are the dedicated edit pages. The two-column card grid became one column of rule-separated sections, and the readiness checklist and preview became the context panel (70/30, below the content on narrow screens). Each section still edits in its centred popup. The create wizards (`GuidedFlow`) are unchanged. |
| Programme details | Done | Sessions and enrolments read as sections; the panel keeps status, cover photo and At a glance. |
| Booking details | Done | Panel: guest and timeline. |
| Customer details | Done | Panel: contact and attendance. |
| Staff details | Done | Role description and Change role in the main column; panel: contact and account. Remove from team moved to More actions. |

### Host

| Page | Status | Notes |
|---|---|---|
| Activity details | Done | Participants, joining settings and money in the main column (cards flattened into sections); panel: details and waitlist. |
| Circle details | Done | The Circle's tabs stay in the sidebar; a context panel (Circle facts, organiser, ID, View public page, Edit details) sits beside every tab. |
| Reservation details | Uses Activity details | A reservation opens its activity's record page; there is no separate reservation page. |
| Participant details | **Not built** | Participants are rows on the activity page, and no participant record or API exists. |

## Data and behaviour

- **One additive server change.** `GET /api/admin/listings/:type/:id/detail` now also returns `location` (`{ lat, lng, source }` or `null`) for the Location panel. It's read-only, needs the same `listings.view` permission, and nothing else changed.
- **No business rules changed.** No financial, booking or moderation rule and no permission was changed. Every action calls the same function as before, with the same permission checks and confirmation dialogs. Actions only appear where the viewer's role allows them.
- **Last updated is not shown.** Listing and vendor rows have no "updated at" column, so the panel shows Created only and doesn't invent a date. Adding one is a schema change for another time.
- **"Manage categories" and "Archive listing" are not shown.** There is no per-listing category tool and no archive state for listings. The existing Unpublish and Delete stay in More actions.
- **Small shared fix.** `statusLabel()` now words unknown statuses the way `StatusTag` does ("Open", not "open").

## QA evidence (2026-10-20)

- Client type check passes; client unit tests pass (281/281); the QA harness type check and unit tests pass (97/97).
- Screenshots on `hello_circle_dev` (throwaway admin; dev sessions for the demo partner and host), at 1440×900 unless noted:
  - **Admin:** listing (live, pending, Rooms tab, 900px tablet and 390px phone), vendor, organisation, order (desktop and phone), person and activity.
  - **Partner:** venue editor (desktop and phone), programme and booking.
  - **Host:** activity and Circle.
  - Every page had no sideways scroll and no console errors.
- Production build (`npm run build`) passes, and the isolated server suite passes (1,027 passed, 23 skipped).
- Real-stack browser suites ran on a fresh disposable QA database. Product 68/68, lifecycle 52/52, authorization 83/83 and booking 38/38 passed.
- Validation first stopped at D03-UI: the listing's decision history had moved to the "Activity & decisions" tab. The spec now opens that tab (`&rtab=activity`). On a second fresh QA database, validation passed 49/49 across every group.
- Browser specs updated for actions now in More actions: `hc-d01-d08-ui` (Suspend organisation, Remove from team) and `hc-d03-ui` (Suspend account).

## Visual and functional review (2026-10-20, second pass)

All 29 record pages were compared with the previous build (806a17f) at 1440, 900 and 390 pixels. The comparison page is published privately at https://claude.ai/artifact/8qXgNbwCGNqBpKsPqE5z3r.

- **Fixed:**
  - Repeated status, name, email, role and date facts were removed (Order, Person, Claim, Staff, Privacy, Organisation, Listing, admin Activity).
  - A partner account now reads "Approved" rather than "Live".
  - The settlement page now says "see Transfers" instead of "see below".
  - Payment review's investigation history moved into the main column.
  - The doubled "Feature flags" heading is gone.
  - A stacked context panel uses two columns on tablets.
  - On phones, facts show as compact rows, spacing is tighter and the map preview is smaller.
- **Checked:**
  - Every page: no console errors and no sideways scroll at any width.
  - The status row is visible on first load at every width.
  - Before and after, every button, link and menu item is still present on all 29 pages (destructive actions are now in More actions).
- **Tests:** validation 49/49, product 68/68, lifecycle 52/52, authorization 83/83, booking 38/38. Client 281/281 and the production build pass.
- **Sample data:** the review added rows labelled `QA-REVIEW` to `hello_circle_dev` only: a claim, a report, a privacy request, a host application, a refund, a dispute, a settlement run with a settlement and a transfer, a payment review, and staff user `qa-review-staff-1`.

## Richer header (owner's pick, 2026-10-20)

From four options, the owner chose the richer header, noting that the photo's position doesn't matter. It is now on every record page.

- **`RecordView` `stats` prop + `DetailStats`:** a strip of up to four key numbers under the header. The header no longer has its own rule, so title, statuses and actions read as one block. Pages without a strip keep a rule under the header, set by CSS `:has()`.
- **Photos in the panel:** `DetailHero variant="panel"` puts the photo at the top of the context panel (listings, Circles).
- **Panel stays in view:** on screens wider than 1,100px, `.wd-aside-inner` sticks below the site header. If the panel is taller than the window, it scrolls on its own.
- **Where the numbers come from:** each page uses data it already loads. The one exception is the admin listing detail response, which gained a read-only `stats` block: visible reviews and their average, upcoming bookings (a club's active registrations) and page views. No money is calculated.
- **Partner editors:** `ListingKeyNumbers` in `workspace/ListingMeta.tsx` reads the partner's listing summary for venues and clubs. Experiences and programmes build their strip from the record itself.
- **Duplicates removed:** facts now shown as key numbers were taken out of sections and panels.
- **Spec change:** `hc-completion-b` now checks the host activity's key numbers ("Going") instead of "Places:" in the status row.
