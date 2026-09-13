# Document 24 — Future Product Roadmap

Category D only — new capability that would extend the product, clearly separated from Document 20's gaps in *existing* flows. Grounded in the real seams this audit found, not invented from scratch.

## Unify the five participation tables
A real, deliberate, multi-week migration — not a refactor. Would let MyLife's current UI-layer unification become a true data-layer one, simplifying every future cross-cutting feature (analytics, reminders, unified cancellation).

## Real-time chat
The current polling-based chat is a deliberate, documented choice given today's traffic. If usage grows, a WebSocket layer would remove the polling latency without changing the scoping model.

## Structured resident preferences
`interests`/`availability`/`goals` are comma-joined TEXT today. Structuring them would unlock richer personalization than the current keyword-match bonus.

## Per-room opening hours
Every room in a centre currently shares one window. A per-room override would matter once centres with meaningfully different room types (e.g. a gym hall vs. a meeting room) become common.

## Shared-store rate limiting
The in-memory limiter resets on restart and won't survive a multi-instance deploy — a natural next step once the platform scales past one process.

## Vendor-facing review replies
Reviews currently have no vendor-response field — a common expectation once review volume grows past what admin moderation alone can contextualize.

## Tiered/bundle pricing for Passes
Explicitly out of scope in the current pass implementation ("out of scope for this scaffolding," per an in-code comment) — a natural extension once single flat-rate passes prove the concept.

## Mobile parity for Vendor/Admin/Passes
The mobile app currently has no vendor dashboard, no admin console, and no Passes screen — a deliberate initial scope choice (mobile phases so far targeted the resident/host side) rather than an oversight, per the discovery pass.

---
[← Consolidated PRD](23-consolidated-prd.md) · [Back to Discovery Summary](00-discovery-summary.md)
