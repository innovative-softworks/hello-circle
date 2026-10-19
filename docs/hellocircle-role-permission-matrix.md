# HelloCircle role and permission matrix

_Local build on `feature/commerce-engine`, 2026-10-16, updated 2026-10-17 (final QA pass), uncommitted. The server is the enforcement point in every row;
the UI only hides what the server would refuse._

## 1. Who is who

| Identity | How they sign in | Workspace |
|---|---|---|
| Resident | Magic link / password / Google (`req.resident`) | Consumer site; **Host workspace** `/manage` (activities, circles, reservations) |
| Partner owner | Password (`req.user`, role `vendor`, not invited staff) | **Partner workspace** `/vendor` — unrestricted inside their organisation |
| Partner staff | Invited into an organisation, one `platform_role` | Partner workspace, narrowed by role (§3) |
| Admin | Password + **two-step code (OG-07)**, `admin_role` super / finance / support / legal | **Admin workspace** `/admin` (§2) |

A person who is both a partner and a resident links the two accounts (HelloCircle Manage) and **switches explicitly**
between workspaces (DEC-03, OG-01). A linked partner-only session opening `/manage` sees "Switch to your personal account"
instead of being redirected or locked out.

## 2. Admin permissions (server `ADMIN_PERMISSIONS`, deny by default)

S = super, F = finance, U = support, L = legal. ⚑ = needs a two-step code from the last 30 minutes (step-up, OG-07).

| Permission | S | F | U | L | Used by |
|---|---|---|---|---|---|
| workspace.view, audit.view, support.search, insights.view, decisions.view | ✓ | ✓ | ✓ | ✓ | Overview, audit log, Support, **Operations directories (People, Orders, Activities, Circles, Hosts)** |
| decisions.internal_notes.view | ✓ | | ✓ | ✓ | Internal moderation notes |
| admins.manage ⚑ | ✓ | | | | **Admin invitations (OG-06), MFA reset**, roles |
| partners.view / orgs.view / listings.view | ✓ | ✓ | ✓ | ✓ | Vendors, Organisations, listings |
| partners.approve, listings.moderate, listings.edit, listings.feature, queues.decide, demand.notify | ✓ | | ✓ | | Approvals, queues |
| partners.suspend ⚑, partners.platform_role, partners.tier, orgs.manage, orgs.suspend ⚑, listings.delete ⚑ | ✓ | | | | Suspensions, roles, destructive |
| queues.view, reviews.view/moderate, reports.view/moderate, complaints.handle, traders.view | ✓ | | ✓ | ✓ | Trust & safety; **type-specific report actions (OG-03)** |
| traders.verify, policies.manage, help.edit, templates.view/edit | ✓ | | | ✓ | Legal tools |
| templates.delete ⚑, media.delete ⚑, coupons.delete ⚑, commerce.governance_switches ⚑ | ✓ | | | | Destructive / governance |
| media.view, media.editorial | ✓ | | ✓ | | Media |
| platform.settings ⚑ | ✓ | | | | Settings, **Maps switch (OG-31)** |
| finance.operate ⚑, commerce.operate ⚑, coupons.manage | ✓ | ✓ | | | Finance, commercial rules |
| finance.payment_state.view | ✓ | ✓ | ✓ | | **Exceptions inbox (OG-05/15)**, read-only payments |
| **activities.moderate ⚑** (new) | ✓ | | ✓ | | Cancel a harmful activity (OG-14) |
| **orders.cancel ⚑** (new) | ✓ | ✓ | ✓ | | Cancel an order on the provider's behalf, propose a new time (OG-10) |
| **privacy.requests** (new) | ✓ | | | ✓ | **Privacy requests + consent lookup (OG-29/31)** |
| **residents.restrict** (new) | ✓ | | ✓ | | Reserved for OG-08; **no route uses it yet** (D-07 open) |

Enforcement evidence: `adminPermissions.test.ts` walks every admin router and fails if a route declares no permission;
`qa:validation` batch `validation-d02` and `qa:authorization` exercise refusals against the real stack.

## 3. Partner staff roles (server `requirePlatformRole`, owners unrestricted)

| Action | centre_manager | facility_manager | finance | communications | read_only_analyst |
|---|---|---|---|---|---|
| Centres, rooms, hours (centre_manager); clubs and programmes (facility_manager); experiences and departures incl. **OG-19** edit/move (either) | ✓ | ✓ | | | |
| **Block time with booking review (OG-04)** | ✓ | | | | |
| Cancel / resend hall bookings; **propose a new time (OG-11)** | ✓ | | | | |
| Cancel / resend club registrations; club waitlist offers | | ✓ | | | |
| Refunds | | | ✓ | | |
| **All orders (OG-13)**, hall bookings, club registrations, a booking's proposed changes — list and record, **server-gated (Option A)** | ✓ | ✓ | ✓ | ✗ 403 | ✗ 403 |
| **Listing rosters** — experience bookings, programme enrolments, club participants and waitlist (names, emails, phones, children's names), **server-gated (Option A)** | ✓ | ✓ | ✗ 403 | ✗ 403 | ✗ 403 |
| **Customers + contact details (OG-20)**, insights participant list | ✓ | ✓ | ✓ | ✓ | ✗ 403 |
| Bookings CSV export | ✗ 403 | ✗ 403 | ✓ with name + email | ✗ 403 | ✓ **without** name and email |
| Overview "today" bookings | time, guests, venue + booker name | same | same | same | time, guests, venue — **no name** |
| Earnings, payments, **monthly statement (OG-25)** | | | ✓ | | (earnings read, demand) |
| Messages, review replies, **complaint responses (OG-17)** | | | | ✓ | |
| Complaints about the organisation (read) | all staff | | | | |

**Option A (owner decision, implemented 2026-10-17).** Customer personal data is limited to the roles that serve the
customer. Owners are unrestricted, and every route keeps its organisation scope. The role sets live in one place
(`server/src/routes/vendorHelpers.ts`: `ORDER_ROLES`, `ROSTER_ROLES`, `CUSTOMER_ROLES`) and match the partner tabs
(`client/src/vendorTabAccess.ts`). The UI hides what the server refuses:
- **Customers page:** a booking shows as plain text for staff without the Bookings tab.
- **Org page:** "Export bookings CSV" is offered only to finance and the analyst.

**Evidence:**
- **Unit test:** `vendorPiiRoles.test.ts`, 13/13 (every role × every gated route, the CSV columns, the Overview name mask).
- **Real stack:** `PII-ROLES` covers 11 endpoints × 6 roles, the CSV and Overview for each role, and another
  organisation on each endpoint.
- **Browser:** `PII-UI` opens records directly by URL as the analyst, communications and finance roles.
- **Residual edge:** in-app booking notifications go to the user who created the listing. Only managers can create
  listings, but a creator later moved to another role still receives them (with the booker's details). Changing
  notification routing was left out of scope.

## 4. Host (resident) rules

| Action | Who |
|---|---|
| Edit / move / cancel an activity, **booking settings and join approval (OG-27)**, approve/decline requests | The activity's host only |
| **Series view, cancel remaining dates, apply edits to later dates (OG-26)** | The series' host only |
| Activity money (recorded amounts, OG-28), reservations (OG-16) | The host only (own bookings) |
| **Circle moderation view, announcements, hide messages, mute members (OG-18)** | Circle organisers only; organisers can't be muted; reporters are never named |
| Ask to join / withdraw a request | Any resident who can see the activity |
| Accept / decline a venue's proposed time (OG-11) | Whoever holds the emailed single-use link |
| Privacy requests (OG-29) | The resident, for their own account |

## 5. Cross-organisation and cross-account isolation (verified 2026-10-17)

Executed against the real stack (`validation-og-isolation`, `validation-og13-orders`, `validation-og19-departures`,
`validation-og01-switch`, `validation-og15-24-admin`, plus the 83-test `qa:authorization` suite). Each refused write was followed
by a database check that nothing changed.

| Attempt | Result |
|---|---|
| Another organisation opens this organisation's customer record | 404 |
| …lists or proposes a time change on, or cancels, its hall booking | 404 / 404 / 404 |
| …previews, creates or lists time blocks on its venue | 403 / 403 / 403 |
| …edits its experience departure, moves its experience booking | 403 / 403–404 |
| …reads its orders (`/vendor/orders`), monthly statement (JSON and CSV) | its own rows only; the other organisation's refs never appear |
| …opens its booking record by URL in the browser | "doesn't exist or was removed", no details |
| Another resident changes booking settings, lists/approves join requests, moves or cancels the host's activity | 403 each |
| …cancels the rest of the host's series | 403 |
| A Circle member / outsider opens moderation; a member posts an announcement | 403 / 403 / 403 (the organiser: 200) |
| A partner session on a host route | 401 |
| Another resident lists privacy requests | never sees someone else's |
| A partner / a resident reads the admin privacy queue | 403 / 401 |
| Admin Exceptions inbox: legal admin, partner, signed out | 403, 403, 401 (super and support: 200) |
| Unlinked partner switches to a personal account; signed-out switch | 404; 404 / 401 |

