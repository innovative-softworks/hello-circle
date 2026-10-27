# Circles 3.1 — 04 Permissions (all server-enforced)

| Action | Visitor | Member | Organiser | Partner (linked account) | Admin |
|---|---|---|---|---|---|
| See links | open Circles: approved, public listings only | approved + own pending | all incl. pending | — | `reports.view` (Circle record) |
| Link a listing | — | yes → **pending** | yes → approved | — | — |
| Approve / decline | — | — | yes (403 otherwise) | — | — |
| Remove a link | — | own links | any | — | `reports.moderate`, reason |
| Create activity for the Circle | — | `shareToCircleId` → pending link (403 if not a member; nothing created) | `circleId` → Circle's own activity (existing) | — | — |
| Create adventure / experience / volunteering / programme for the Circle | — | — | only with a linked, approved partner account; the Circle must be organised by someone in that org (existing `linkableCircles`) | existing roles (centre/facility manager) and admin approval unchanged | — |

Circle membership never grants partner rights; a link never changes owner, price, capacity, visibility or bookings.
Private activities can only be linked to their own Circle. Approval/invite Circles: links are members-only (403).
