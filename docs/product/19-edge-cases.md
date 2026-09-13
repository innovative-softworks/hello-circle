# Document 19 — Edge Cases & Exception Handling

Where the audit couldn't confirm handling one way or the other, that's stated as unconfirmed rather than assumed.

| Edge case | Handling | Evidence |
|---|---|---|
| Room becomes unavailable during checkout | **Handled** | Row-locked (`FOR UPDATE`) transaction on the specific room |
| Game becomes full during checkout | **Handled** | Row-locked transaction + waitlist offer as the fallback path |
| Program/room-hire style "event cancelled" | **Handled (Games)** | Host cancel → all joined participants notified; no persisted "event" entity exists outside Games/Program Sessions |
| Vendor suspended | **Unknown** | `users.status='suspended'` exists; whether it cascades to immediately hide that vendor's live listings was not confirmed in this pass |
| User leaves a Circle | **Handled** | `DELETE circle_members`, also clears any of their own pending join request |
| Circle deleted | **Partial** | No hard delete exists — only `status='closed'`, and no re-open route either |
| Duplicate booking (same slot, same person) | **Partial** | The room-level overlap check prevents two different bookings on the same slot regardless of who books; no separate "you already booked this" dedup was found |
| Payment failure | **Partial** | Server-side status handling is solid (idempotent webhook); no resident-facing notification of the failure was found |
| Refund failure/handling | **Not automated** | No refund code path exists at all — see [Doc 14](14-booking-transaction-model.md) |
| Capacity reached | **Handled** | 409 + real waitlist with time-limited offers (games, registrations) |
| Account deleted | **Unknown** | No account-deletion route was found or traced in this pass for either identity system |
| Host removes their own listing (Game) | **Handled** | Host-only cancel; capacity can't shrink below current joined count on edit |
| User already joined (Game/Circle) | **Handled** | Composite unique keys (`game_participants(game_id,resident_id)`) and `INSERT IGNORE` for open circles prevent duplicates |
| Duplicate review | **Unknown** | No unique constraint on `(listing_type, listing_id, client_id)` was confirmed for the `reviews` table in this pass — flagged rather than assumed absent or present |
| Location unavailable / ungeocoded | **Partial** | Centre/club `lat/lng` are a county-centroid + hash-offset approximation, not real geocoding — a documented, deliberate shortcut, not a failure mode |
| Expired pass used at redemption | **Handled** | Row-locked check includes `expires_at` before consuming a credit |
| Pass-funded registration cancelled | **Not handled** | Credit is not restored — confirmed gap, see [Doc 20](20-gap-analysis.md) |
| Program enrollment needs cancelling | **Not handled** | No route exists at all |
| Invite-only Game joined by a non-invitee | **Not handled** | `visibility` stored but not enforced by the join query |

---
[← Admin & Moderation](18-admin-moderation.md) · [Next: Gap Analysis →](20-gap-analysis.md)
