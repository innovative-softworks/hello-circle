# Workspace information architecture: target vs existing

_2026-10-16. This compares the brief's target structure with the working tree. Status per module:_
- **Exists**: the job is covered, possibly under another name or merged into another page.
- **Partial**: some of the listed sub-pages are missing or weak.
- **Missing**: nothing covers it.

_Sub-page notes use these terms:_
- **Add**: recommended now.
- **Defer**: worth doing, but not now.
- **Decision**: needs owner input.
- **Don't**: not recommended, with the reason given.

Rule applied: reuse and consolidate first. A target sub-page that duplicates an existing one is mapped to that page,
not rebuilt.

**Totals: 46 modules. 22 Exist, 24 Partial, 0 Missing.** Every target module has some home today. The gaps are
specific sub-pages, listed below.

---

## A. Super Admin (`/admin`): 7 Exist, 10 Partial

| # | Target module | Status | Where it lives today | Gaps → recommendation |
|---|---|---|---|---|
| 1 | Overview | Exists | `overview`: queue, attention strip, totals, activity | Revenue and platform health appear only as totals. **Defer** a revenue card (read-only, from the existing ledger endpoints) until the ledger switch is on. |
| 2 | Users | Partial | Support → `record=person:<email>` (one person across all order tables); Settings → Admin roles | **Add** a browsable People directory over `supportLookup.ts` (WA-08). User suspension is **Decision** (D-07). |
| 3 | Vendors | Exists | `vendors` (+ record), `organisations` (+ record, D-01 suspension), `claims`; subscriptions in Plans & credit; performance in Insights | Documents → **Don't** (no document store; trader self-certification + Stripe KYC cover verification; storing ID documents adds GDPR scope). Per-vendor revenue appears via Finance partner balances, linked from the vendor record. |
| 4 | Hosts | Partial | `hostApplications` (+ `record=host:<residentId>`); host earnings inside Finance | **Add** a Hosts directory (residents who have hosted), reusing the host record page. Restrictions → **Decision** (D-07). |
| 5 | Listings | Exists | `listings` (all types incl. experiences), `pending`, reports in Reviews & reports, categories in Settings → Market categories, quality = review checks (`listingReview.ts`) | none |
| 6 | Bookings | Partial | Support search and order record (all six order types); Finance → order record, refunds, disputes, payment reviews | **Add** a browsable read-only "Orders" list (filters: type, status, date, partner) over `supportLookup.ts`. No-shows and changes are visible per order, not as reports (**Defer**). |
| 7 | Payments & Finance | Exists | `finance`: overview + ledger, payment reviews, disputes, events, refunds, settlements, transfers, bank payouts, debts | Tax/VAT reports → **Decision** (D-04: the VAT model is not approved). |
| 8 | Commercial | Exists | `commerce` (rules, switches, history), `coupons` (+ usage), `plansCredit` (credits, rewards, plans, promotions, simulator) | none |
| 9 | Circles & Communities | Partial | Support search finds Circles; reports against Circles in Reviews & reports | **Add** a Circles directory (read-only: status, organiser, members, reports), linking to the existing report case. |
| 10 | Trust & Safety | Exists | Reviews & reports (case page, decisions D-03), Policies & trust → complaints & appeals, trader verification; audit | Resident suspension → **Decision** (D-07). Fraud and risk flags → **Don't** now (no data source; payment reviews already cover the money side). |
| 11 | Support | Partial | Support console; complaints & appeals | Tickets → **Don't** build a ticket system (new system and recurring cost; complaints + email cover it). **Decision** DEC-09. |
| 12 | Marketing & Content | Partial | Featured toggle on listings; Media editorial library; Market categories; notification templates | Homepage, banners, collections, SEO → **Defer** (P3; would need a content model). |
| 13 | Analytics & Reports | Partial | Insights (health, demand, funnel, referrals) | Exports → **Defer** (P3). |
| 14 | Notifications | Partial | Notification templates | Delivery history → **Defer** (needs a new table; P3). |
| 15 | Platform Settings | Exists | Settings (status, roles, help, market, weights); Commercial switches; per-organisation flags; Media switches | **Add** the Maps toggle UI (the API exists; WA-13, P3). Currency is fixed EUR (Ireland only), so **Don't** add a setting. |
| 16 | Legal & Compliance | Partial | Policies & trust (documents, company details), Audit log | GDPR requests and consent records → **Decision** (D-07; residents already have self-serve export and deactivate). A read-only consent-record lookup inside the person record is a small **Add** once D-07 is decided. |
| 17 | Team & Access | Partial | Settings → Admin roles (list, change role; last super can't be demoted) | **Add** admin invitations → **Decision** DEC-02. Access logs = the audit log filtered by actor (exists). |

## B. Partner (`/vendor`): 8 Exist, 7 Partial

| # | Target module | Status | Where it lives today | Gaps → recommendation |
|---|---|---|---|---|
| 1 | Dashboard | Exists | Overview (attention queue, KPIs, coming up) | Occupancy appears only in Org → Insights; **Defer** surfacing it on Overview. |
| 2 | My Business | Exists | Org → Settings (profile, logo, policies), Trader details, public profile `/provider/:id` | Business documents → **Don't** (see A3). Several locations = several centres (supported). |
| 3 | Venues & Facilities | Exists | Listings + centre editor; rooms (courts, pitches, halls are rooms); amenities, photos, accessibility | Venue-specific policies are organisation-level today (Org policies); fine. |
| 4 | Experiences | Exists | Experiences tab + editor: departures, capacity, bookings, attendance | none |
| 5 | Availability | Partial | Centre editor hours, blocked times; Calendar "Block time"; club recurring sessions | Per-room opening hours don't exist (known gap in CLAUDE.md) → **Defer**. Restyle these editor sections (WA-09). |
| 6 | Bookings | Partial | Bookings (hall + club) + record; experience bookings and programme enrolments in their own tabs; check-in screens | **Add** a read-only "All orders" view (DEC-04, WA-06). |
| 7 | Pricing | Partial | Room rate, club price, deposits, programme and experience price; Offers; org cancellation cutoff | Peak/off-peak and packages → **Decision/Don't now** (new pricing rules = financial change). |
| 8 | Customers | Partial | Org → Participants | **Add**: promote it to its own nav item "Customers" (no backend change; WA-11). |
| 9 | Earnings | Exists | Earnings: balance, payout account, payouts, transactions, CSV, venue splits | none |
| 10 | Subscriptions & Rewards | Exists | Earnings → Plan & rewards; `/vendor/pro`, `/vendor/rewards` (switch-gated) | none |
| 11 | Promotions | Partial | Offers (partner-funded coupons) | Campaigns and featured listings are admin decisions → keep them admin-side (**Don't** add a partner self-serve feature switch without a commercial decision). |
| 12 | Reviews | Exists | Reviews (All / Needs a reply, reply popup) | none |
| 13 | Team | Exists | Org → Staff & roles (invite, change role, remove: D-08) | none |
| 14 | Reports | Partial | Org → Insights, bookings CSV, Demand | **Defer** more exports (P3). |
| 15 | Support & Settings | Partial | Help guide pages; account settings in Org → Settings (password change via `PUT /auth/password`, Google sign-in, linked account, deactivate) | Staff can't find "Account & security" because it's nested under Organisation. **Add** a direct link from the account menu. Support tickets → **Don't** (DEC-09). |

## C. Host (`/manage`): 7 Exist, 7 Partial

| # | Target module | Status | Where it lives today | Gaps → recommendation |
|---|---|---|---|---|
| 1 | Dashboard | Exists | Overview (attention, coming up) | Fix the silent join-request failure (WA-03). |
| 2 | Host Profile | Partial | Public `/host/:id`; host application and profile in resident `/profile`; Reviews tab | **Add** a "Profile" entry in the host nav that links to the existing profile sections (no new page). |
| 3 | Activities | Exists | Activities (upcoming, past, drafts) + record; create/edit `/games/host` | Restyle the create/edit page into the workspace (WA-09). |
| 4 | Venue Booking | Partial | Search and booking reuse the consumer pages (`/explore`, `/book/:centreId`); the activity form's venue picker | **Add** a "Venue reservations" list in the host workspace from `GET /games/host/venue-bookings` (WA-10). Don't duplicate venue search. |
| 5 | Calendar | Exists | Calendar (list/month); reschedule = edit; cancel in record | none |
| 6 | Participants | Exists | Activity record: participants, waitlist, check-in, attendance, updates | none |
| 7 | Circles | Exists | Circles tab + `/manage/circles/:id` (plans, members, invites, join requests, polls) | Move the Circle manage page into the workspace shell (WA-09). |
| 8 | Tickets & Bookings | Partial | One price per activity; per-participant refund in record | Ticket types → **Don't now** (pricing model change). |
| 9 | Pricing | Partial | Price, capacity, min participants; cost sharing = Open Booking (switch off) | Cancellation policy is platform-level; fine. |
| 10 | Earnings | Partial | Earnings, payouts, trader details, split proposals | Venue cost vs ticket revenue are separate orders and never netted on one screen. **Add** an informational "venue cost for this activity" line in the activity record (read-only, from the linked `booking_ref`). It must not touch money calculations. |
| 11 | Subscriptions & Rewards | Exists | Plan & rewards, `/manage/pro`, `/manage/rewards` | none |
| 12 | Communications | Partial | Activity updates (templates), activity and Circle chat (`/chats`) | **Defer** a host Messages tab (four messaging mechanisms need a design pass first). |
| 13 | Reviews & Insights | Exists | Reviews, Insights (turnout, repeat attendance) | none |
| 14 | Support & Settings | Partial | Resident profile settings, help guide | Same as B15: link "Account & security" from the host nav. |

## D. Navigation structure (recommended, minimal change)

Keep every existing `?tab=` key so deep links still work. Proposed additions:
- **Admin:**
  - "People", "Orders" and "Circles" under a group named "Directory", or as tabs inside Support. **Recommended:
    tabs inside Support**, because they reuse its record pages and add no sidebar items.
  - "Admin invitations" as part of Settings → Admin roles (if DEC-02 is approved).
- **Partner:** "Customers" (promoted from Org → Participants; the old link redirects). "All orders" as the first
  tab inside Bookings, with Hall and Club kept as tabs.
- **Host:** "Reservations" under Hosting. "Profile" as a link entry.
- **No new sidebar groups** beyond these, and no nested menus deeper than sidebar → tab → record.
