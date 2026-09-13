# Phase 1 — Application Discovery & Inventory

> Reverse-engineered from the running codebase, branch `v6-0`, 2026-09-09. Every claim is cited to a file the discovery pass actually read.

## Detected architecture

- **Monorepo, npm workspaces:** `client/` (React 18 + Vite + TS, no CSS framework — hand-rolled design tokens), `server/` (Express + TS, MySQL via a hand-rolled async shim over `mysql2/promise`), `apps/mobile/` (Expo/React Native + expo-router), `packages/types` and `packages/design-tokens` shared between client and mobile only (server keeps its own hand-synced type mirror).
- **Single-origin deploy:** the Express server serves the built client itself; CORS is `origin:true` (reflects any origin — fine same-origin, flagged in [Document 20](20-gap-analysis.md)).
- **No real foreign keys anywhere** — every relationship, including every polymorphic `listing_type`/`listing_id` pair, is enforced in application code only.
- **No message queue, no WebSocket layer.** The one chat feature that exists is deliberately polling-based.

## Detected user types

Four independent identity mechanisms coexist with no shared table: `req.user` (password vendor/admin), `req.resident` (magic-link, the real "member" identity), `req.guestEmail` (verified email only, no resident row yet), and the anonymous `X-Client-Id` header (no auth at all — still the primary ownership key for a guest booking). Full detail in [Document 03](03-users-roles-permissions.md).

## Detected modules

Discovery/Explore, Browse, Circles, Games, Programs, Passes, Experiences & Adventures (one table, two browse skins), Bookings (room hire), Registrations (club sign-up), Rooms, Reviews, Favourites, Follows, Household, Notifications, Chat, Waitlist, Participation Intent / Make-It-Happen, Place Suggestions, Local-SEO landing pages, Vendor workspace (Listings/Programs/Operations/Insights/Experiences/Org), Admin console, Auth (two separate systems), Onboarding, Payments/Checkout.

## Detected routes / screens

30 server routers mounted under `/api/*` in `server/src/index.ts`, comprising 250+ individual endpoints. 50+ client routes in `App.tsx`. 30+ Expo-router screens in `apps/mobile/src/app/**`. Full inventories in [Document 04](04-module-feature-catalogue.md) and [Document 05](05-ia-screen-inventory.md).

## Detected core entities

36 tables found in `server/src/db/index.ts`. The five parallel participation tables (`bookings`, `registrations`, `program_enrollments`, `game_participants`, `circle_members`) are confirmed genuinely distinct in shape, not duplicative — see [Document 11](11-data-domain-model.md).

## Detected major workflows

Discover → Book a room; Discover → Register for a club; Discover/Create → Join or host a Game; Discover → Enroll in a Program; Purchase & redeem a Pass; Create/Join a Circle (open, approval, or invite-gated); Vendor signup → admin approval → listing management; Org owner → invite staff → scoped RBAC; Payment → Stripe Checkout → webhook confirmation; Cancellation (status-only, no automated refund anywhere in the codebase).

## Detected APIs / services

Stripe (Checkout + webhooks, test-mode keys), Firebase Admin SDK (push notifications, mobile only), nodemailer/SMTP (console-log fallback when unset), Google Fonts (client asset only). No AI/LLM backend was found behind `/ask` or `/discover` in this pass — flagged as unconfirmed rather than assumed.

## Detected roles / permissions

vendor (org owner vs. invited staff, five `platform_role` values), admin (single flat role, no sub-tiers), resident (no role field at all — a pure identity), circle organiser and game host (both derived from a foreign-key relationship, not a persisted role). Full matrix in [Document 03](03-users-roles-permissions.md).

## Detected incomplete / disconnected functionality

- Program enrollments have **no cancellation route anywhere** in `programs.ts` — a resident cannot self-cancel a paid program enrollment.
- Games' `visibility` field (`public`/`circle`/`invite`) is stored at creation but **not enforced by any join-path query** — an "invite-only" game is, today, joinable by anyone who finds its id.
- No refund automation exists anywhere in the payments path — cancellation only ever flips a status column; refunds are explicitly off-platform by convention.
- A pass credit is not restored when a pass-funded registration is later cancelled.
- Two independent five-tab bottom-navigation implementations exist for the same IA concept — one CSS-breakpoint-gated on the web client, one native in `apps/mobile`.

Full, evidence-cited gap list in [Document 20](20-gap-analysis.md).

---

**Discovery method:** 7 parallel research passes covered server routes/API, DB schema/entities, client IA/screens, auth/RBAC, payments/notifications/messaging, participation-core (circles/games/programs/passes/bookings/rooms/reviews), and the mobile app. Each is cited by file path throughout this suite rather than asserted from memory.

**Suite index:** [01](01-product-overview.md) · [02](02-scope-capability-map.md) · [03](03-users-roles-permissions.md) · [04](04-module-feature-catalogue.md) · [05](05-ia-screen-inventory.md) · [06](06-user-journeys.md) · [07](07-user-flows.md) · [08](08-use-case-library.md) · [09](09-user-stories.md) · [10](10-business-rules.md) · [11](11-data-domain-model.md) · [12](12-status-state-model.md) · [13](13-search-discovery.md) · [14](14-booking-transaction-model.md) · [15](15-circle-community-model.md) · [16](16-host-vendor-operations.md) · [17](17-messaging-notifications.md) · [18](18-admin-moderation.md) · [19](19-edge-cases.md) · [20](20-gap-analysis.md) · [21](21-traceability-matrix.md) · [22](22-health-implementation-audit.md) · [23](23-consolidated-prd.md) · [24](24-future-roadmap.md)
