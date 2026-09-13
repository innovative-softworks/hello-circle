# Document 17 — Messaging & Notification Model

Two parallel notification systems, one real (if deliberately simple) chat feature.

## Notification trigger map

| Trigger | Recipient | Channel(s) | Configurable? |
|---|---|---|---|
| New booking/registration | Guest + vendor + all admins | In-app (vendor/admin) + email (all three) | No |
| Booking/registration cancellation | Guest + vendor + all admins | In-app + email | No |
| Game becomes full | Game host | In-app + push | No |
| Waitlist offer available/claimed | Resident | In-app + push | **Yes** (`waitlistOffers` pref) |
| Intent match found | Resident | In-app + push | **Yes** (`intentMatches` pref) |
| Circle activity (6 distinct triggers) | Resident(s) | In-app + push | No |
| Followed vendor/host/centre update | Following residents | In-app + push | Via `notification_level` on the follow itself |
| Admin-initiated notify | Target resident | In-app + push | No |
| Search alert match | Resident | In-app + push | No (existence of the alert is the opt-in) |
| Payment failure/expiry | **No resident-facing notification found** | — | — |

> Only 2 of 9 `notifyResident` kinds currently have a real opt-out. A guest whose payment fails or expires gets a silent DB status flip with nothing telling them — flagged in [Doc 20](20-gap-analysis.md).

## Channels

- **Email** — nodemailer, templates centralized in `notificationTemplates.ts` with a hardcoded fallback if a template is missing; falls back to `console.log` when SMTP is unset, and never blocks the triggering action either way.
- **Push** — Firebase Admin SDK, native mobile only (no web push). Sends to every registered device token for a resident; auto-prunes tokens Firebase reports as unregistered/invalid. Deep-links via a listing-type-to-path map; the "intent" kind has no detail route, so its push opens the app with no specific destination.
- **In-app** — the same `notifications` table serves vendor/admin (via `recipient_id`) and resident (via `resident_id`) audiences, read through parallel routes in `vendor.ts` and `residents.ts`.

## Chat — real, scoped, and deliberately not real-time

`server/src/routes/chat.ts` is a genuine, persisted "Participation Chat," not a stub — but it is explicitly polling-based: an in-code comment states no WebSocket/real-time layer exists anywhere in this stack, and current traffic doesn't justify one. Client polls `GET /:scopeType/:scopeId/messages?after=<lastId>`.

| | |
|---|---|
| **Game chat** | Time-windowed: opens 24h before the game starts, archives 6h after its estimated end. A cancelled game blocks new posts but keeps history readable. |
| **Circle chat** | No time window — persistent for as long as the membership lasts. |

Access is derived live from `game_participants`/`circle_members` — leaving revokes it immediately, nothing is duplicated. A `blocked_residents` mutual-block filter applies at read time (a hardening pass added after the initial build, per an in-code comment). Max message length 2000 characters; no attachments; no read-receipts or unread counters server-side (only an `after`-id polling cursor). **Not open messaging** — no vendor↔guest DM, no arbitrary resident-to-resident chat; strictly scoped to a shared game or circle. Both the web client and the mobile app have their own `ChatPanel` component consuming this same endpoint, genuinely wired end-to-end on both platforms.

---
[← Host & Vendor Operating Model](16-host-vendor-operations.md) · [Next: Admin & Moderation →](18-admin-moderation.md)
