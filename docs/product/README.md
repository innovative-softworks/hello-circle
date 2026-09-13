# HelloCircle Product Documentation Suite

Reverse-engineered from the running codebase (branch `v6-0`, 2026-09-09) via 7 parallel discovery passes covering server routes/API, DB schema/entities, client IA/screens, auth/RBAC, payments/notifications/messaging, participation-core (circles/games/programs/passes/bookings/rooms/reviews), and the mobile app. Every claim is cited to a file the discovery pass actually read; where the code doesn't answer a question, that's stated explicitly rather than guessed.

A published, navigable HTML version of this same suite (single page, sidebar TOC) exists as the **HelloCircle Atlas** artifact.

## Index

- [00 — Discovery Summary](00-discovery-summary.md)
- [01 — Product Overview](01-product-overview.md)
- [02 — Scope & Capability Map](02-scope-capability-map.md)
- [03 — Users, Roles & Permissions](03-users-roles-permissions.md)
- [04 — Module & Feature Catalogue](04-module-feature-catalogue.md)
- [05 — IA & Screen Inventory](05-ia-screen-inventory.md)
- [06 — User Journeys](06-user-journeys.md)
- [07 — Detailed User Flows](07-user-flows.md)
- [08 — Use Case Library](08-use-case-library.md)
- [09 — User Stories & Acceptance Criteria](09-user-stories.md)
- [10 — Business Rules](10-business-rules.md)
- [11 — Data & Domain Model](11-data-domain-model.md)
- [12 — Status & State Transition Model](12-status-state-model.md)
- [13 — Search & Discovery Model](13-search-discovery.md)
- [14 — Booking & Transaction Model](14-booking-transaction-model.md)
- [15 — Circle & Community Model](15-circle-community-model.md)
- [16 — Host & Vendor Operating Model](16-host-vendor-operations.md)
- [17 — Messaging & Notification Model](17-messaging-notifications.md)
- [18 — Admin & Moderation Model](18-admin-moderation.md)
- [19 — Edge Cases & Exception Handling](19-edge-cases.md)
- [20 — Product Gap Analysis](20-gap-analysis.md)
- [21 — Technical/Product Traceability Matrix](21-traceability-matrix.md)
- [22 — Product Health & Implementation Audit](22-health-implementation-audit.md)
- [23 — Consolidated PRD](23-consolidated-prd.md)
- [24 — Future Product Roadmap](24-future-roadmap.md)

## Headline findings

- **1 critical gap:** program enrollments have no self-cancellation route anywhere in the codebase.
- **5 high-severity gaps:** Game `visibility` (public/circle/invite) is stored but never enforced on join; no refund automation exists anywhere despite deposits being marketed as "refundable"; payment failures generate no resident-facing notification; invited vendor staff can read full org-wide data regardless of their scoped role; pass credits aren't restored when a pass-funded registration is cancelled.
- The five parallel participation tables (bookings/registrations/program_enrollments/game_participants/circle_members) are confirmed **genuinely distinct**, not a duplication to clean up.
- A real, weighted discovery-ranking algorithm exists (recency, fill-rate, personalization, follow-boost) — not a naive sort.
- Host and Vendor are confirmed **materially different actors** — any resident can host a Game or Circle with zero approval; becoming a Vendor requires a full signup + admin review.

Full detail, with file-level citations, in the documents above.
