# Document 18 — Admin & Moderation Model

One flat admin role, one 84KB console, no sub-tiers — every admin can do everything below.

## Admin capability matrix

| Domain | Capability |
|---|---|
| Vendors | Approve/reject signup, approve/reject host applications, suspend |
| Listings | Pending queue, full list, per-type status (centre/club/experience), featured toggle, direct edit+delete override (bypasses the vendor's own CRUD) |
| Claims | Approve/reject a vendor's claim on an unclaimed listing |
| Reviews | Unhide (soft-hide is the only moderation action; no hard delete, no editing) |
| Reports | Case queue, per-case status update (pending/dismissed/actioned/suspended), admin notes separate from status |
| Organisations | CRUD, reassign a centre/club to a different org, feature flags |
| RBAC | Assign `platform_role`, assign `provider_tier` |
| Coupons | Full CRUD |
| Notification templates | CRUD (a real, editable template system, not hardcoded copy) |
| Analytics | Demand, liquidity/marketplace-health, referrals, funnel, activity overview, place-suggestion review queue |
| Market config | Market-category configuration |
| Support | Cross-entity search tool |
| Audit log | Read-only history of admin actions |

## Moderation mechanics worth noting

- A `suspended` report status is not just a label — it triggers a real cascade (auto-closing a circle, auto-hiding a review) rather than requiring a second manual action.
- Review moderation (unhide) lives in `admin.ts` while review creation/deletion lives in `reviews.ts` — a minor split across two files, not a functional gap, but a moderator has to know to look in two places.
- Every write in the org sub-router (`org.ts`) writes an audit row via `writeAudit(...)` — the audit log is genuinely populated, not decorative.
- What used to be a separate "Platform Admin" surface/router has been fully folded into this one console — confirmed no drift from that consolidation.

---
[← Messaging & Notifications](17-messaging-notifications.md) · [Next: Edge Cases →](19-edge-cases.md)
