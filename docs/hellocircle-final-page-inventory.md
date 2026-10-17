# HelloCircle final page inventory (workspaces)

_Local build, 2026-10-16, uncommitted. Covers the three workspaces and the consumer pages this pass touched. "New" and
"Changed" refer to the OG-01…OG-32 pass; everything else is unchanged. All workspace pages share `WorkspaceShell`
(sidebar ≥1025px, full-screen "Sections" menu below), keep tabs/filters in the URL, open records as pages
(`?record=type:id`), use centred dialogs for short forms, 8px radius, and no side drawers._

## Admin workspace — `/admin?tab=…`

| Group | Page (tab) | Status | Notes |
|---|---|---|---|
| Admin | Overview (`overview`) | Unchanged | Queue-first |
| | Pending approvals (`pending`) | Unchanged | |
| | Support (`support`) | Changed | Order record: email customer, **Cancel on behalf** (OG-10), **Propose a new time** (OG-11), activity history |
| Operations | **Exceptions** (`exceptions`) | New (OG-15) | Payment reviews, disputes, refunds due/stuck, failed events, failed payouts, Pro past-due, partner debts |
| | **People** (`people`) | New (OG-14) | Server-paged; filters host / verified host / deactivated |
| | **Orders** (`orders`) | New (OG-14) | All order types, server-paged, filters in URL |
| | **Activities** (`activities`) | New (OG-14) | Record + platform cancel with D-03 reason |
| | **Circles** (`circles`) | New (OG-14) | |
| | **Hosts** (`hosts`) | New (OG-14) | |
| Marketplace | All listings, Vendors | Changed (2026-10-17) | **Numbered server pages (OG-24)**: status-tab counts, type counts, county list, search, every sort, page number in the URL; a record opens by id without loading the list (`/admin/vendors/:id/summary`, `/admin/listings/:type/:id/summary`). Pending approvals still reads the whole pending set (its review flow compares against it) |
| | Claims, Host applications, Place suggestions, Organisations, Insights | Unchanged | |
| Business | Coupons, Commercial rules, Finance, Plans & credit | Changed (OG-23) | Finance/Commerce tables stack on phones |
| Trust & Platform | Reviews & reports (`reviews`) | Changed (OG-03) | Case page is type-aware: hide message / cancel activity / suspend listing, reinstate, show again |
| | Policies & trust (`policies`) | Changed (OG-23) | Tables stack on phones |
| | Audit log (`audit`) | Changed (OG-24) | Server search + paging, no 200 cap |
| | Notification templates, Media | Unchanged | |
| | **Privacy requests** (`privacy`) | New (OG-29/31) | Requests queue + record (reply, complete/decline; **an erasure request can't be completed — "Send reply, keep open" or decline**), Consent lookup |
| | Settings (`settings`) | Changed | Admin roles: **Invitations** + **Two-step sign-in** (OG-06/07); System status: **Maps switch** (OG-31) |
| — | **`/admin-invite`** | New (OG-06) | Accept an admin invitation (72h, single use) |
| — | Two-step set-up / code / step-up | New (OG-07) | Gate before the workspace; step-up dialog with automatic retry |

## Partner workspace — `/vendor?tab=…`

| Page | Status | Notes |
|---|---|---|
| Overview, Calendar | Changed (OG-04) | "Block time" is a two-step dialog: details → review covered bookings → keep or cancel+refund |
| Bookings (`bookings`) | Changed | **All orders** section (`bsec=all`, OG-13, read-only); booking record: **Propose a new time** + history (OG-11) |
| **Customers** (`customers`) | New (OG-20) | Directory + customer record with order history; server-gated to managers/finance/communications |
| Messages | Unchanged | |
| Listings | Changed (OG-04) | Centre editor blocked times use the same review dialog; ranges listed |
| Programmes | Changed (OG-02) | Load errors with retry |
| Experiences | Changed (OG-19) | Departures: repeat weekly, stop-sales hours, **Edit** (capacity/cut-off); bookings: **Move** (customer asked) |
| Earnings | Changed | **Monthly statement** card + CSV (OG-25); failed-payout banner in Payout history (OG-05); tables stack on phones |
| Offers | Changed (OG-02) | |
| Reviews | Changed (OG-17) | **Complaints about you** with one response each |
| Demand | Unchanged | |
| Organisation | Changed | Participants moved to Customers (redirect) |

## Host workspace — `/manage?tab=…` and related

| Page | Status | Notes |
|---|---|---|
| Overview | Changed | "Host a session" opens the form inside the workspace |
| Activities (`activities`) | Changed | Record: **Move with venue booking** (OG-12), **Money for this activity** (OG-28), **Who can join** + **Join requests** (OG-27), **Weekly series** + cancel remaining (OG-26) |
| **Reservations** (`reservations`) | New (OG-16) | Upcoming / past / cancelled venue bookings with the linked activity |
| Calendar, Insights, Earnings, Offers | Changed (OG-02) | Load errors with retry |
| Reviews | Changed (OG-17) | **Complaints about you** |
| Circles → `/manage/circles/:id` | Changed | Members: mute/unmute (OG-18); **Moderation** tab: announcements, reported messages, muted members, removed messages, history |
| `/games/host` and `/games/host/:id` | Changed (OG-22, OG-26) | From the workspace (edit, or `?from=manage`) it renders inside the host shell; create: "Every week" linked series, "On chosen weekdays…"; edit: "Also apply to the later dates" |
| Linked partner-only session on `/manage` | New (OG-01) | "Switch to your personal account" screen |

## Consumer pages touched

| Page | Change |
|---|---|
| `/games/:id` | Report button (OG-32); "Ask to join" / "Request sent" / "Not this time" / "Bookings closed" (OG-27) |
| Centre, club, experience detail | Report button (OG-32) |
| `/booking-change?token=…` | New (OG-11): accept or keep the original time |
| `/profile` → Your data | "Ask us about your data" (OG-29) |
| Chat | Organiser "Remove"; removed messages labelled (OG-18) |

**2026-10-17 (Option A).** Partner pages for staff without customer access: the Customers record shows bookings as text
(no link into Bookings) for staff without the Bookings tab; Org → Insights offers "Export bookings CSV" only to the owner,
finance and the read-only analyst (whose file has no customer names or emails); the experience Bookings section shows
"Couldn't load bookings" to staff without roster access; the Overview's today list omits booker names for the analyst.

