# HelloCircle — remaining decisions

_2026-10-16, updated 2026-10-17 (final QA pass; Option A security decision implemented). What this pass deliberately did **not** decide, what is blocked on each decision, and the safe foundation that
is already in place. Nothing below was silently chosen._

## Open owner / legal decisions

| Decision | What it blocks | What's built safely now | What happens until decided |
|---|---|---|---|
| **D-04 — VAT** | VAT invoices; any VAT figure on statements | OG-25 monthly statement of recorded orders, fees, refunds and payouts, labelled "Not a VAT invoice" | Partners get a statement, not an invoice |
| **D-05 — Listing edit re-approval** | Whether a partner's edit to a live listing goes back to review | Nothing new | Edits behave as today |
| **D-06 — Staff claims** | Whether invited staff can claim listings for an organisation | Nothing new | Claims stay owner-only |
| **D-07 — Resident suspension and deletion** | **OG-08** restrictions (suspend/limit a resident); the deletion half of **OG-29** erasure requests | `resident_restrictions` table, `residents.restrict` permission (unused); privacy request queue records erasure requests and the reply | No route creates a restriction. An erasure request **can't be marked completed** (server 409): the admin sends a reply and it stays open, or declines it; the person sees "In progress · nothing deleted yet" |
| **D-09 — Commercial model, Pro and rewards** | Changes to fees, Pro, rewards | No fee, payout or VAT calculation was changed | Existing rules apply |
| **DEC-14 — Retention periods** (awaiting legal) | Automatic deletion / retention job | None | No retention job runs |

## Approved and applied in this pass

| Decision | Applied as |
|---|---|
| DEC-02 | Super-admin-only invitations, 72-hour single-use links (OG-06) |
| DEC-03 | Explicit switching between linked workspaces (OG-01) |
| DEC-04 | Read-only consolidated All orders (OG-13) |
| DEC-10 | Type-specific moderation with impact shown before acting (OG-03) |
| DEC-11 | Two-step sign-in for every admin role, step-up on sensitive writes (OG-07) |
| DEC-12 | Complaint text and outcome to the subject, never the complainant; one response (OG-17) |
| DEC-13 | Activity series where each date is an ordinary activity under existing payment/cancellation rules (OG-26) |
| DEC-15 | Instant booking kept; request-to-book (OG-30) **not built** |
| DEC-16 | No-shows recorded without penalties (existing attendance; nothing new added) |
| DEC-17 | A venue's time change needs the customer's acceptance (OG-11); a partner moves an experience booking only when the customer asked (OG-19) |

## Smaller choices made inside approved scope (please confirm)

These were needed to build approved items; each is the most conservative option and easy to change.

| Item | Choice | Alternative |
|---|---|---|
| OG-27 | Join approval only on **free** activities (a paid join goes straight to checkout; holding a payment for approval would be a new payment rule) | Approval for paid activities with an authorisation hold — needs a payment-rule decision |
| OG-26 | Series up to 12 weeks / 36 dates; venue activities not repeatable as a series (each date needs its own venue booking) | Longer series; venue series that book every date |
| OG-29 | Privacy requests answered by super or legal admins; one open request per kind per person | Support also sees them |
| OG-25 | Statement month = Ireland calendar month by order creation; payouts by Stripe's creation date | By service date / arrival date |
| OG-20 | Customer contact details for managers, finance and communications staff; not read-only analysts | Analysts too |
| OG-24 | Vendors and All listings now use numbered server pages (20 per page) with the same counts, filters, sorts and record links. "Newest first" keeps the old order where listings without a creation date come first | Cursor paging; dateless listings last |
| OG-29 | An erasure request stays open (never "completed") until deletion exists; a reply on an open request is emailed as an update | Allow "completed" with a disclaimer |

## Found in the final QA pass (2026-10-17) — owner decision needed

| Item | What is true today | Options |
|---|---|---|
| ~~Partner staff reading customer contact details~~ | **Decided 2026-10-17: Option A, implemented.** Order records (All orders, hall bookings, registrations, booking changes) are limited to managers + finance; listing rosters to the two managers; Customers to managers, finance and communications. The read-only analyst sees no customer names or emails (Overview without names, CSV without contact columns). Evidence: see the permission matrix §3 | — |
| Admin MFA key custody | The key is a single env secret; losing it makes stored TOTP secrets unreadable (recovery codes and a super-admin reset still work) | Where the key is stored and who holds the backup (see release readiness) |

## Left open by the Option A change (small, for the owner)

| Item | Today | Options |
|---|---|---|
| Booking notifications to a listing's creator after a role change | In-app and email booking notices go to the user who created the listing (only managers can create listings). If that person is later moved to communications or analyst, they still get them | (a) also route by current role; (b) send to the owner only; (c) keep |
| Bookings CSV for managers | Finance and analyst only (pre-existing); managers get 403 | Add managers, or keep |

