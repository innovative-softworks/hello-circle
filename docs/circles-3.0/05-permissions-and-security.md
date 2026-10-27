# Circles 3.0 — 05 Permissions and security

| Action | Visitor | Member | Organiser | Admin |
|---|---|---|---|---|
| See plans (and their listings) | Open Circles only (existing `canViewCircleFull`) | Yes | Yes | Admin planning view (`reports.view`) |
| Suggest a listing as a plan | No (403) | Yes, if they can see the listing | Yes | — |
| Share → also add to plans | No | Yes (same rules) | Yes | — |
| Confirm / decline / cancel | No | Own idea only (cancel) | Yes | Remove (`reports.moderate`, reason) |
| Convert to activity | No | No | Free-text/venue plans only | — |
| Report a plan | Anyone signed in (reports route) | Yes | Yes | Acts on it |

## Leak checks (all tested)

- Another Circle's private activity: suggesting it returns 404 with no title in the body.
- Unpublished (`pending`) and suspended-organisation listings: 404 to suggest; an existing plan reads
  `unavailable` with no details once a listing is unpublished or its organisation suspended.
- A plan's listing is resolved **for the viewer**, so a member who can't see a private activity never gets its
  details through a plan.
- Venue links are withheld while venue pages are gated (no route to a coming-soon page).
- Booking state is read only for the viewer's own rows; no member list or who-booked data is exposed.

## Unchanged

Authentication, Circle membership/role checks, game visibility, org suspension (`orgActiveSql`), payment and
booking rules. No new roles. Audit: existing `circle.plan_confirmed/declined/removed` entries cover plan moderation.
