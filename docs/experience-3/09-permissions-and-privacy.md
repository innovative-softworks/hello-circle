# Experience 3.0 — 09 Permissions and privacy

No role changes. One visibility change, approved as D2: a Circle-only activity created from an **accepted**
Circle-to-Circle collaboration is also visible to the partner Circle's members (`canViewPrivateGame`). Nothing else
about either Circle (members, chat, Pulse, memories) is shared.

| Data | Who can see it |
|---|---|
| Passport | only the resident (private, no-store, no share) |
| Programme journey | the booking's owner (client id or resident) |
| Saved plans | only their owner |
| Spot alerts | only their owner; others never learn who is waiting |
| Location for Plan My Day | sent once in the request, not stored |
| Going solo choice | never stored or shown to anyone |
| Collaborations | organisers of the two Circles; audited (proposed/accepted/declined/withdrawn) |

Sensitive attributes are never inferred: solo and occasion filters use only what the host set. Notifications reuse
`notifyResident` (preferences respected; spot alerts use "Waitlist offers"). QA ran with SMTP, push and Stripe
credentials blanked.
