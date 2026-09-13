# Document 01 — HelloCircle Product Overview

What the platform is trying to become, the practical problem it solves, and where it actually sits between discovery, booking, and community — as built, not as pitched.

## Product vision

The implementation points at one destination: become the place a household in Ireland opens when deciding what to do with a free evening or weekend — not a single-purpose booking widget, but the layer that turns "we should do something" into a recurring habit. The evidence is structural, not aspirational: **Circles** exist purely to sustain participation past a single transaction (no payment, no end date, just membership + a rhythm of Games); **Make-It-Happen** and **Open Booking** exist specifically to solve "there's no one to play with yet" rather than "I can't find a court"; and the **five parallel participant tables** (rather than one generic "signup" table) reflect a product that grew to cover very different shapes of commitment — a one-off room hire, a season-long club registration, a recurring circle — rather than forcing them into one mold.

## Product mission

Two distinct frictions are visibly being engineered against in the codebase:

- **Fragmented local supply.** Centres, clubs, ad-hoc games, multi-week programs, and one-off experiences/adventures are unified under one browse/search surface (`discover.ts`'s shared `scoreActivities()`, `queries.ts`'s `listScheduledActivities()`) instead of living as separate silos.
- **The "not enough people" coordination failure.** `min_participants` + `confirmation_deadline` on Games and Bookings, plus the dedicated Make-It-Happen intent-capture flow and `participation_intents` table, exist specifically to let demand accumulate before a session is confirmed — a problem generic booking engines don't solve.

## Product positioning

The build deliberately straddles three categories rather than committing to one:

| Category | Evidence |
|---|---|
| **Booking engine** | Room/hall hire with real overlap-checked, row-locked availability (`bookings.ts`) — Mindbody/Resy-shaped, but only one of five participation paths, not the whole product. |
| **Community layer** | Circles are unpaid, persistent, membership-only groups with no feed — closer to a shared-interest roster than a social network, deliberately thin (no posts, just plans + polls + chat). |
| **Local marketplace** | Vendor org accounts, RBAC staff, Stripe-mediated payments, admin moderation queue — a real two-sided marketplace with approval gates, not just a directory. |

The unifying layer is **MyLife** (`MyBookings.tsx`, 9 parallel API calls aggregating all five participation tables plus intents and follows) — confirmation that the product treats "one person's whole local life" as the real unit, even though the underlying data model hasn't been unified to match (see [Document 11](11-data-domain-model.md)).

## Core value proposition, by actor

| Actor | Value, as actually built |
|---|---|
| Resident / consumer | One search surface across venues, clubs, ad-hoc games, programs, and experiences, with a personalization layer (interest + county + familiar-co-participant scoring) that gets sharper the more they book, plus a single MyLife hub for everything they've committed to. |
| Circle member | A durable home for a recurring activity that isn't tied to any one venue or payment — join once, see every upcoming plan, vote in scheduling polls, chat with the group. |
| Organiser / host (resident) | Zero-friction path to host: any verified resident can create a Game or a Circle without ever becoming a Vendor — host-side tools (manage participants, post updates, cancel) exist without a business account. |
| Vendor | One signup creates both the business account and its first draft listing in a single transaction; approved vendors get room/hours/blocks management, a bookings/registrations ops queue, CSV exports, and — for larger operations — staff seats with scoped RBAC. |
| Venue / facility operator | Per-room capacity, rate, and payment-method control (not just one number per centre), with a hard guarantee (409 error) against ever leaving a centre with zero bookable rooms. |
| Community organisation | Not a distinct actor type in the code — a club/centre listing plus an org account covers this case; no separate "non-profit" or "association" entity exists. |
| Administrator | One console (`AdminDashboard.tsx`, 84KB — the single largest page in the client) covering moderation, vendor approval, RBAC assignment, coupons, org reassignment, and platform-health analytics — folded from what was once a separate Platform Admin surface. |

---
[← Discovery Summary](00-discovery-summary.md) · [Next: Scope & Capability Map →](02-scope-capability-map.md)
