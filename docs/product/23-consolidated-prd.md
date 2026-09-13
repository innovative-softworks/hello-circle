# Document 23 — Consolidated PRD

A rollup, not a repeat — each subsection below links back to its full treatment earlier in the suite rather than restating it.

| Section | Summary |
|---|---|
| 1. Executive summary | HelloCircle unifies venue booking, club registration, ad-hoc games, multi-week programs, one-off experiences, and unpaid Circles under one discovery surface and one personal hub (MyLife), deliberately without forcing them into a single data model. See [Doc 01](01-product-overview.md). |
| 2. Product vision | The default place a household opens to decide what to do, and the layer that turns intent into a sustained habit. [Doc 01](01-product-overview.md). |
| 3. Problem statement | Fragmented local supply + the "not enough people to make it happen" coordination failure. [Doc 01](01-product-overview.md). |
| 4. Product goals | Implicit in the build: reduce friction to host (any resident, zero approval), reduce friction to discover (one ranked feed across 5+ activity types), and keep transactional integrity (row-locking, idempotent webhooks) even under the least glamorous paths. |
| 5-6. Target users & personas | Visitor, Resident, Circle organiser, Game host, Vendor (owner/staff), Admin — see the full matrix in [Doc 03](03-users-roles-permissions.md). |
| 7-8. Product scope & modules | [Doc 02](02-scope-capability-map.md), [Doc 04](04-module-feature-catalogue.md). |
| 9-10. Feature inventory & functional requirements | [Doc 04](04-module-feature-catalogue.md). |
| 11. Business rules | [Doc 10](10-business-rules.md) — including every place the code doesn't decide something, marked as such. |
| 12. Roles & permissions | [Doc 03](03-users-roles-permissions.md) — with the read/write RBAC asymmetry flagged as a real open question. |
| 13-14. Journeys & flows | [Doc 06](06-user-journeys.md), [Doc 07](07-user-flows.md). |
| 15-16. Use cases & user stories | [Doc 08](08-use-case-library.md), [Doc 09](09-user-stories.md). |
| 17-18. IA & screen inventory | [Doc 05](05-ia-screen-inventory.md) — web and mobile, with parity gaps called out. |
| 19-20. Data model & state models | [Doc 11](11-data-domain-model.md), [Doc 12](12-status-state-model.md). |
| 21-22. Notifications & messaging | [Doc 17](17-messaging-notifications.md). |
| 23. Search & discovery | [Doc 13](13-search-discovery.md) — a real weighted ranking function, confirmed by code, not assumed from naming. |
| 24. Booking/transaction model | [Doc 14](14-booking-transaction-model.md) — including the confirmed absence of any refund automation. |
| 25. Host/vendor operations | [Doc 16](16-host-vendor-operations.md). |
| 26. Administration | [Doc 18](18-admin-moderation.md). |
| 27. Edge cases | [Doc 19](19-edge-cases.md). |
| 28-29. Current limitations & product gaps | [Doc 20](20-gap-analysis.md) — 1 critical, 4 high, 3 medium, 4 low, plus 5 carried-over platform gaps. |
| 30. Recommendations | In priority order: (1) add program-enrollment cancellation, (2) enforce Game `visibility`, (3) decide and implement the intended vendor-staff read-scope policy, (4) notify residents on payment failure, (5) wire real Stripe refunds starting with deposits, (6) restore pass credits on cancellation. |
| 31. Future opportunities | See [Document 24](24-future-roadmap.md) — kept strictly separate from the gaps above, since these are new capability, not missing pieces of an existing flow. |

---
[← Health & Implementation Audit](22-health-implementation-audit.md) · [Next: Future Roadmap →](24-future-roadmap.md)
