# Document 15 — Circle & Community Model

Circles are the platform's one genuinely unpaid, persistent social structure — deliberately thin (no feed, just membership, plans, polls, and chat).

## What a Circle is

A persistent, recurring-participation group anchored to an activity label, not a venue — "upcoming plans" are real Games either explicitly linked via `games.circle_id` or matched by `activity_label`. There is no native Circle "event" type; activities always exist as Games.

## Join modes

| Mode | Behavior |
|---|---|
| `open` | Instant `INSERT IGNORE circle_members` — no organiser action |
| `approval` | Files a `circle_invites` row (`initiated_by='resident'`), organiser notified, organiser responds |
| `invite` | Self-join refused (403) unless an organiser already sent a pending invite; accepting one always succeeds regardless of mode |

## Organiser powers and limits

Exactly one organiser per circle, fixed at creation, **never promoted or transferred** by any route found. `isOrganiser()` gates edit, close, invite, remove-member, respond-to-join-request, and close-poll. The organiser cannot remove themselves or another organiser (query explicitly filters to `role='member'`) — meaning a circle can never lose or hand off its sole organiser through the product itself.

## Scheduling polls

`circle_polls`/`circle_poll_options`/`circle_poll_votes` — a genuine multi-select availability poll (composite PK `poll_id, option_id, resident_id`, so a member can vote for several options). The organiser closes the poll; any "recommended option" shown is computed client-side from the vote counts, never persisted.

## Circle chat

Real, persistent (no time window, unlike Game chat which opens 24h before and archives 6h after). Membership is derived live from `circle_members` — leaving immediately revokes read/write access, nothing is duplicated into the chat table. A `blocked_residents` mutual-block filter is applied at read time (added, per an in-code comment, as a post-launch hardening pass rather than at initial build).

## What a Circle deliberately lacks

- No capacity or waitlist concept on the Circle itself (only its linked Games have those)
- No payment — Circles are always free; `circle_members` has no `payment_status` column
- No feed/posts — "recent activity" is Game/plan activity, not user-authored posts
- No co-organiser or ownership-transfer mechanism
- "Who can join"/"circle values" are free-text display fields only, not enforced by the join logic

---
[← Booking & Transaction Model](14-booking-transaction-model.md) · [Next: Host & Vendor Operating Model →](16-host-vendor-operations.md)
