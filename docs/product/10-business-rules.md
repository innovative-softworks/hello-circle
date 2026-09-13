# Document 10 — Business Rules

Answered from implementation only. Where the code doesn't decide something, that's stated as **Business rule not defined** rather than filled in.

| Question | Answer, from code |
|---|---|
| Who can create a Circle? | Any signed-in resident (`requireResident` only — no vendor, no admin approval) |
| Who can create a Game? | Same — any signed-in resident |
| Can anyone become a Host? | Yes, via a cosmetic `host_status` badge (none/pending/verified/rejected) that is never used as an authorization gate — hosting a Game requires no badge at all |
| Who approves circle members? | The circle's single fixed organiser, only when `join_mode='approval'` |
| Can private circles exist? | Yes — `join_mode='invite'` blocks self-join entirely without a pre-existing organiser invite |
| Booking cancellation rules | Guest/resident-owned, must be `payment_status='paid'`, must be outside the org's configurable `cancellationHours` cutoff |
| Registration cancellation rules | Same ownership model, but **no time cutoff** — club registrations aren't tied to one date/time |
| Program enrollment cancellation rules | **Business rule not defined** — no cancellation route exists in `programs.ts` at all |
| Capacity restrictions | Rooms: one slot, one booking. Games/registrations/programs: numeric capacity, row-locked at the check (games; club-session registrations) or accepted-race (club-wide registration count, documented tradeoff) |
| Age restrictions | `games.min_age` exists on the schema; registrations collect `dob`. **Business rule not defined** — no server-side enforcement of either was found; both appear to be display/consent-record fields only |
| Availability rules | Centre-level (or per-day `centre_hours` override) opening hours; no per-room hours yet (documented, deliberate) |
| Payment rules | VAT 23%, platform fee 5%, both computed server-side on the discounted subtotal; deposits (booking only) are untaxed and unfee'd; client-supplied totals are never trusted |
| Refund rules | **Business rule not defined at the system level** — cancellation only ever flips a status column; every refund is handled manually, off-platform, by convention stated in code comments across bookings/registrations/games/vendorOperations |
| Vendor verification | Manual admin approval only (`PUT /vendors/:id/status`); no automated verification |
| Listing publishing | Vendor-initiated `publish` action per listing type, all still subject to admin moderation (pending/approved/rejected/deleted) |
| Moderation | Reports queue with statuses pending/dismissed/actioned/suspended; "suspended" auto-cascades (e.g., closes a circle or hides a review) — a real state-machine side effect, not just a label change |
| Review eligibility | Centre/club/experience: any matching paid transaction, no past-date requirement. Game/host: must have joined a *past* game. Enforced server-side, not just UI-hidden |
| Notification preferences | Only 2 of 9 resident notification kinds (`waitlistOffers`, `intentMatches`) currently have an opt-out; the rest always send |
| Following | Resident-only (no guest fallback, unlike Favourites); `notification_level` per follow controls fan-out volume |
| Authorization for reads vs. writes | Writes are role-scoped per `platform_role`; reads on the same resources are **not** scoped by role at all — see [Doc 03](03-users-roles-permissions.md) |
| Content visibility (Game visibility field) | **Business rule not defined in enforcement** — `public`/`circle`/`invite` is stored but no join-path query currently restricts on it |

---
[← User Stories](09-user-stories.md) · [Next: Data & Domain Model →](11-data-domain-model.md)
