# HelloCircle — Batch 2: Implementation Results

**Date:** 2026-10-22 · **Branch:** `feature/workspace-detail-pages` (uncommitted; nothing committed, pushed or deployed). Builds on Batch 1 (also uncommitted).

## What you approved (2026-10-22)
- **Yes:** Explore and the lists · cards, no-photo cards and states · Booking details (`/bookings/:kind/:ref`) — all six booking types · keep the `BrowseLayout` desktop filter sidebar · Booking details in the payment-confirmation look.
- **No layout changes:** Circle (visitor/member), Activity, Programme, Venue detail pages, Home.
- **Approach:** build from components that already exist rather than new ones. Also: review how pages animate while loading.

## How it was built from existing components
| Approved item | Existing component reused | New code |
|---|---|---|
| Cards + no-photo cards | `ListingCard` (already "the one card shape" behind every card adapter) and its `Photo` placeholder | Two props on `ListingCard`: `noPhoto` (typographic default, `"icon"` keeps the old look — used by Home) and `rowOnPhone`; plus `fallbackKind`/`fallbackLine` for the block's text. No new card component. |
| Lists header | `BrowseLayout` (Programmes, Experiences, Adventures, Volunteer), `Games.tsx`, `Explore.tsx`; existing sidebar, Drawer/Modal filters, sort, map, skeleton/empty/error states | Search field + area/when pickers in one wrapping row; chips scroll sideways on phones; no redundant "Search" button; compact results toolbar. `BrowseConfig.kindLabel` (optional). |
| Explore | Existing type chips (with counts), Filters dialog, sort | One grid instead of headed groups; toolbar reordered; one card per programme; category tiles scroll sideways on phones. |
| Booking details | Booking kit (`BookingSurface`, `ConfirmationPanel`, `ListingSummary`, `PolicySummary`, `BkButton`), `ConfirmDialog`, existing `fetchMy…` endpoints and cancel/leave calls, calendar downloads, receipts page | `pages/BookingDetailPage.tsx`, `pages/bookingDetailModel.ts` (status → wording), one route, one title pattern. No server change. |
| Links to it | Payment confirmation "View booking"; My Life rows | Confirmation links now open the booking page; experience/programme rows open it; venue/club rows get "Details · ref" (not for bookings found by email lookup). |

No server, schema, Stripe, pricing, booking-rule or permission change. Venue/club pages stay gated (`VITE_VENUE_PAGES_PUBLIC` unchanged).

## Booking details — behaviour
- Kinds: `booking`, `registration`, `program`, `experience`, `game` (activity id), `pass` (pass id).
- Ownership: the page only shows a booking found in the caller's own "my …" list (resident session or this browser's guest id). Anyone else's ref, an unknown ref or an unknown kind shows "We couldn't find that booking" (with Sign in for visitors).
- Status wording from existing fields only: You're booked · Confirming your payment · Payment didn't go through · Cancelled · Cancelled — refund on its way · Cancelled and refunded · Completed. Pending/failed payments are never called booked (unit-tested).
- Actions shown only when they apply: Add to calendar (venue, experience, activity — upcoming and confirmed), view the listing, View receipt (signed-in, paid online), Cancel/Leave (server `canCancel` / upcoming joined activity) through `ConfirmDialog`; cancellation terms via `PolicySummary` from the server's deadline.
- Guest bookings found with reference + email (My Life lookup) keep their existing inline row; the page can't load them (no client id match), so no Details link is shown for them.

## Loading behaviour and animations (your follow-ups)
**First pass (measured):** on a production build, 390px phone, 4× CPU throttle and 4G-like network, pages showed a spinner flash, then three stacked fades (route fade 0.32s, page `fadeUp` 0.3–0.35s with a slide, card fade 0.45s); 20 pages set the slide inline, so reduced-motion settings were ignored. CLS was 0.

**Your decision:** no transition animations — skeleton loading is enough. Now removed:
- Card → detail **image morph** (View Transitions): `sharedElementTransition.ts` and its CSS deleted; `CardLink` is a plain link.
- **Route fade** on every page change (`.route-enter` in `App.tsx`): removed.
- **Page entrance** (`.fade-panel`, which the 20 inline slides now use) and **card fade-in** (`.card-surface`): `animation: none`.
- **Cover slow-zoom on scroll** (`useScrollZoom.ts`): deleted.
- The full-screen photo viewer opens without a fade.

Kept: skeleton shimmer while content loads; the page spinner only after 250ms; hover effects; Home's own scroll reveals (Home unchanged as requested).

## One cover for every detail page (your follow-up)
The existing `PhotoGallery` is now the single cover on Activity, Experience/Adventure, Programme, Venue, Club and Provider pages: the same 16:9 frame (capped at 460px), with the page's existing date/spots pills on top. Several photos slide (swipe on touch, arrows, dots, "1 / N" counter; tap or the counter opens the full-screen viewer). One photo: the same frame, no controls. No photo: the existing placeholder and icon. Loading: skeleton shimmer, no fade. This replaces the venue/club/provider mosaic and Experience's separate dot selector. The Circle cover keeps its own title-over-image design (not changed).

## Page width and side padding (your follow-up)
- **One container for the header and every page:** `maxWidth` is now **1560px** (was 1440) in the web client's `theme.ts` (a local export, so the shared design-token package and the mobile app are unchanged), with matching CSS variables `--page-max` and `--page-gutter` in `index.css`.
- **One gutter:** 24px on desktop and 16px from 860px down — the same breakpoint the header already used (pages used to switch at 640px, so on tablets they sat 8px inside the logo).
- **Pages that bypassed the token now use it:** Experience and Programme detail (were 1280px — content sat 80px inside the header), Activity, Circle and My Life (hard-coded 1440), the CTA band, Home/Circles' `.hx-wrap` and gutter (Home's hero text sat 24px inside the logo), the For Venues / Become a host sections, and the footer's phone padding. One double padding on For Venues removed.
- **Check:** every container with the page width compared against the header row's content edges on 20 pages at 390/768/1024/1440/1920 — 0 mismatches, no sideways scrolling. Narrow reading pages (policies, help guide, host profile, booking details) keep their centred reading column by design.

## First result position on a 390px phone
| Page | Before the header changes | After |
|---|---|---|
| Activities | 881px | 456px |
| Explore (search) | 642px | 475px |
| Explore (browse) | category tiles first | 544px |
| Programmes | 606px | 457px |
| Experiences | 684px | 457px |
| Adventures | not measured | 500px |

## Tests (fresh, this session)
See the final summary in the conversation for the full regression run. New tests: `ListingCard.test.tsx` (5), `bookingDetailModel.test.ts` (4), `PhotoGallery.test.tsx` (3), browser spec `product-public-batch2.spec.ts` (3: lists/no-photo/first-result; no entrance animations + 16:9 cover; booking page incl. leave + not-found for others) — added to `qa:product`.

## Screenshots
`docs/hellocircle-batch2-visuals/implemented/` (dev read-only) and the QA-persona shots `b2-*` copied from the isolated QA run.

## Not done / still open
- Wording such as "View program", "programmes listing", "games & sessions" is unchanged (terminology decision D-B2-5 / PUB-20).
- A guest booking reached only by reference + email can't open the details page.
- Payment-review cases (`paymentReview`) aren't exposed by the "my …" lists, so the page shows those as "Confirming your payment" (never as booked); the payment result page still shows the full review wording.
- Detail-page layouts, Circle pages, Home: unchanged as requested.
