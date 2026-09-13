# Document 22 — Product Health & Implementation Audit

Final classification, evidence-first.

## Production ready
Room booking (real locking, reschedule, feature-flagged Open Booking) · Circle join/organise/poll/chat · Game join/host/waitlist · Payments checkout (shared service, server-computed pricing) · Admin moderation console · Vendor org/staff RBAC · Reviews with real eligibility gating

## Functional but needs improvement
Game visibility control (stored, unenforced) · Notification opt-out (only 2 of 9 kinds) · Vendor staff read-scoping (writes scoped, reads not) · Program per-session capacity (schema present, unused)

## Partially implemented
Program enrollment lifecycle (no cancellation) · Pass lifecycle (no credit restoration, no tiered pricing) · Payment-failure UX (server handles it, resident isn't told)

## UI only
None found in the areas this audit covered — every client page inspected calls a real API; the two "UI-only-looking" candidates (`/search`, `/compare`) are deliberate redirects, not incomplete pages.

## Backend only
`centres.org_id`/`clubs.org_id` isolation scaffolding (present, unused) · per-session waitlist infra exists for clubs overall but not exposed per-session

## Disconnected
Refund capability (mentioned in user-facing copy as "refundable," no automated mechanism behind it anywhere in the code)

## Dead / duplicate
Two independent 5-tab bottom-nav implementations (web CSS-breakpoint vs. native) for the same IA concept

## Missing
Program enrollment cancellation route · resident-facing payment-failure notification · automated refund path · per-room opening hours (documented, deliberate gap)

---
[← Traceability Matrix](21-traceability-matrix.md) · [Next: Consolidated PRD →](23-consolidated-prd.md)
