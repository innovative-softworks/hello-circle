# HelloCircle — Operating decisions D-01 to D-11

_2026-10-14. Decision preparation only. **Nothing here is approved or implemented.** Each decision is **PROPOSED**
(a concrete recommendation is ready to accept or amend) or **NEEDS INPUT** (a business, legal or accounting answer is
needed first). A status changes to APPROVED only when the owner says so explicitly.

**Revision 2 (2026-10-14):** the recommendations below now follow the owner's review comments on D-01, D-02, D-05,
D-06, D-07, D-09, D-10 and D-11 and on the permissions rollout. They are still recommendations: **nothing is
approved** until an approval statement is accepted.

**Revision 3 (2026-10-14):** tightened D-02 (default-deny; no diagnostic or rollback mode can widen access), D-04
part A (today's pricing becomes a compatibility version marked commercially unapproved; approving the architecture
doesn't open paid checkout), D-10 (deadline cases: starts soon, already started, no start, rescheduled; expiry never
refunds), D-10/D-11 (refund preconditions: re-verified association and provider state, prior partial refunds,
disputes, concurrency) and D-09 (assumptions beside every figure; all figures illustrative).

**Approval (2026-10-15): D-10 and D-11 are APPROVED for local implementation** (paid orders under review, review
deadlines, automatic refunds for cases 4/4b, "Recheck with Stripe"), with the owner's boundaries recorded in each
section's implementation record. Pricing, VAT, fees, deposits, cancellation terms, Pro/rewards and the other proposed
decisions are unchanged.

**Approval (2026-10-15): D-01 and D-08 are APPROVED for local implementation** (organisation suspension and staff
access management), with the owner's boundaries recorded under each section.

**Approval (2026-10-14): D-02 and D-03 are APPROVED for local implementation**, with the owner's boundaries
(recorded under each section). Every other decision keeps its status below. Implementation and verification are
tracked separately from approval: approved ≠ implemented ≠ verified ≠ deployed. Nothing is committed or deployed.

"Current behaviour" was verified against the code on this date; file references are given so it can be re-checked.
A passing test of today's behaviour is not treated as approval of that behaviour. Delivery order, affected modules
and rollback are in `hellocircle-operating-implementation-plan.md`._

---

## 1. Executive decision table

| ID | Recommendation | Status | What we need from you | Launch impact |
|---|---|---|---|---|
| **D-01** Suspended partners | Suspend the **organisation**: hide its offerings and refuse new sales of every kind across the whole organisation (whoever created the listing); keep existing customers' bookings and support; no blanket cancel/refund; give the partner a restricted read-only view of existing obligations plus a support route; reinstate each listing to its own previous status | **APPROVED (local, 2026-10-15)** · implemented locally · **verified locally** (2026-10-15, `hellocircle-d01-d08-validation.md`) · not deployed | — (late payments: D-10, implemented) | Blocks public and paid launch |
| **D-02** Admin permissions | Named, explicit permissions, **denied by default** (an unknown or undeclared permission is refused); listing and queue moderation assigned to **Support** at first; **partner suspension, reinstatement and destructive actions stay with Super**; policy and trust to **legal**, money to **finance**. No diagnostic or rollback mode can widen access. A moderator role can be added later by reassigning permissions | **APPROVED (local)** · implemented locally · **verified locally** (unit + real-stack QA, 2026-10-15) · not deployed | — | Must be settled before a second admin account exists |
| **D-03** Reasons | Required reason **category** + partner-visible **explanation** + optional **internal note** on listing rejection and partner suspension; shown to the partner with a correction/appeal route | **APPROVED (local)** as product policy · implemented locally · **verified locally** (unit + real-stack QA and browser, 2026-10-15) · not deployed | Legal review of wording remains advisable; no legal requirement is claimed | Recommended before public launch |
| **D-04** Pricing | Part A (architecture): one versioned server-side pricing source for all paid types, stored breakdowns, per-type rollout; today's values become a **compatibility version marked commercially unapproved**, and production paid checkout stays refused while the effective version is unapproved. Part B (money and tax): your decision with an accountant | A: PROPOSED · B: NEEDS INPUT | VAT treatment, fee payer and basis, deposit, cancellation/refund terms | Blocks paid launch (approving A does **not** open it) |
| **D-05** Approved-listing edits | Operational, low-risk and **price** changes go live immediately for future bookings (validated, audited; existing bookings keep their agreed price); **material** content changes go to a pending revision while the approved version stays public | PROPOSED | — (approval) | Recommended before public launch |
| **D-06** Staff claims | Only the organisation **owner** submits claims; managers may prepare drafts; **one active claim per organisation per listing** (an organisation can claim many different venues); competing organisations' claims on the same listing are separate records decided together | PROPOSED | — | Low |
| **D-07** Residents | Admin **suspension** (reasoned, appealable, existing bookings honoured); resident-chosen **deactivation** (reversible, existing behaviour kept) and **"Delete account"** (identity confirmation, obligations check, no mandatory waiting period, personal data removed or anonymised, financial records kept) | NEEDS INPUT | Legal confirmation of the retention list **before** deletion is built | Deletion blocks public launch |
| **D-08** Staff changes | Owner changes an accepted member's role, removes a member, cancels invites; takes effect on the next request | **APPROVED (local, 2026-10-15)** · implemented locally · **verified locally** (2026-10-15, `hellocircle-d01-d08-validation.md`) · not deployed | — | Before onboarding multi-staff partners |
| **D-09** Fee model, Pro, rewards | Keep Pro and partner points **disabled**. Choose a fee model only after reviewing the A/B/C definitions and worked calculations in §D-09 | NEEDS INPUT | Model choice after review (with D-04 part B) | Only if Pro is part of launch |
| **D-10** Paid order under review | No blanket hold. A verified, correctly-associated payment under review keeps its place only until an **explicit, stored deadline** derived from the offering's start time; if that deadline is already past (starts soon, already started), **no hold** and immediate escalation; rescheduling can only shorten it; review expiry releases the place but **never refunds by itself**; automatic refunds only under the exact preconditions in §D-10 | **APPROVED (local, 2026-10-15)** · implemented locally · **verified locally** (clean full `qa:stripe` 51/51) · not deployed | — (24 h / 2 h approved) | Before paid launch |
| **D-11** External refund close-out | Finance-only, audited **"Recheck with Stripe"**: closes a review only when Stripe shows the outcome (e.g. a successful full refund). Never a manual "mark refunded" | **APPROVED (local, 2026-10-15)** · implemented locally · **verified locally** (clean full `qa:stripe` 51/51) · not deployed | — | Before paid launch |

**Dependencies:** D-02 first (it decides who may perform every other action). D-03 extends D-01 and listing
rejection. D-10 and D-11 build on the existing checkout agreement. D-09 depends on D-04. D-05 shares the "listing
version" model with D-03's history.

---

## 2. Cross-cutting rules (apply to every decision)

- **Server enforcement first.** Every rule is a server guard; the UI only reflects it. Hidden buttons are never the
  protection. Direct API calls get 403 (not allowed) or 409 (not allowed in this state), never a silent no-op.
- **Records stay pages, confirmations stay centred dialogs, no side drawers**, cream workspace design, real API data
  and accurate statuses (existing UI completion rules).
- **Audit:** every state change writes `writeAudit()` with actor, action, object, before/after, and the reason where
  one is required. Reasons that partners see are stored separately from internal notes.
- **Concurrency:** state changes are conditional updates (`UPDATE … WHERE status = <expected>`), so the second of two
  simultaneous actions gets 409 and does nothing.
- **Historical data:** existing rows without new data say so ("No reason recorded", "Not recorded"); nothing is
  back-filled with invented values.
- **No dead controls:** a setting or switch is only added when code actually reads it.

---

## D-01 · Suspended partners — APPROVED for local implementation (2026-10-15)

### Behaviour before implementation (verified 2026-10-14)
- An admin can set a partner **user** to `suspended` (`PUT /api/admin/vendors/:id/status`, `routes/admin.ts`). The
  same endpoint also accepts `pending`. It is audited (`vendor.status_changed`) with no reason, and no message goes to
  the partner.
- That user can't log in (`routes/auth.ts`) and gets 403 on every workspace API (`requireVendor` re-reads status on
  every request).
- **Checkout is already refused** (409 "This listing isn't taking bookings right now") for venue bookings, club
  registrations, programmes, experiences and passes **when the listing's `vendor_id` is the suspended user**
  (`vendorSuspended()` in `server/src/bookingIntegrity.ts`).
- **Listings stay visible** in discovery, search, maps and detail pages (`db/queries.ts` filters on listing status
  only).
- **The check is per user, but ownership is per organisation** (`orgVendorIds()`): suspending an owner doesn't stop
  sales of listings created by their staff, the other members keep full workspace access, and suspending one staff
  member blocks only the listings that person created.
- A Stripe Checkout started before the suspension still confirms through the webhook (no suspension check at
  confirmation). Existing bookings are untouched.
- Reinstating sets the user back to `approved`. Listings were never changed, so nothing is republished.
- **Copy defect:** the admin suspend dialog says listings stay "public **and bookable**". "Bookable" is wrong for the
  paths above. Fix this in implementation item 0 regardless of the decision.

### Problem and who is affected
Customers can still find, and sometimes buy from, a provider HelloCircle has stopped trusting. Admins can't suspend an
organisation as a whole. Partners get no explanation (see D-03).

### Recommended policy
1. **Two separate levers.**
   - **Organisation suspension** is the trust action: it covers every member and every offering the org owns.
   - **Listing suspension** (new status `suspended`, admin-only) stops one offering without touching the account.
   - The existing per-user `suspended` stays for removing one person's access (see D-08), but no longer decides
     whether listings are sellable.
2. **While an organisation is suspended:**
   - all its centres, clubs, programmes, experiences and passes are hidden from discovery, search, maps, sitemap
     and recommendations;
   - direct links show "This listing isn't available at the moment" (HTTP 200 with an unavailable state, no booking
     form);
   - every new checkout is refused (bookings, registrations, enrolments, experience bookings, passes, waitlist claims,
     coupon redemptions);
   - partners can't publish or edit;
   - resident-hosted activities that rely on the org's venue booking keep running, because the booking already
     exists, but no new venue booking can be made.
3. **Existing customers keep:** their booking pages, receipts, cancellation under the published terms, complaints and
   support. **No automatic cancellation or refund.** Upcoming obligations are handled by an explicit admin decision
   per booking (cancel with full refund, or let it go ahead).
4. **Late payments:** a Checkout session already open when the suspension starts may still succeed. Confirmation
   checks sellability: the payment is recorded, the order is marked paid but `cancelled` (the existing "paid but no
   longer fits → refund required" path), and it is refunded automatically **only when it meets the D-10
   automatic-refund rule** (case 4b). Otherwise — and always until D-10 is implemented — it goes to finance review. The customer is
   told (D-10's late-payment message).
5. **Restricted partner access:** members of a suspended organisation can sign in to a read-only page showing the
   reason (D-03), their upcoming obligations (dates, customer first name, booking reference, payment state) and a
   support route (contact HelloCircle, or appeal via `/complaints`). Nothing else: no exports, messaging, edits,
   payouts settings or new listings.
6. **Organisation-wide, whoever created the listing.** Sellability is decided by the owning organisation, not by the
   `vendor_id` of the member who created the listing (today's per-user gap).
7. **Reinstatement** restores the organisation; each listing returns to the status it had before the suspension
   (stored per listing). Draft, rejected and paused listings stay that way and are never republished.
8. A reason is required (D-03). The partner is notified by email and in the workspace. Admins see the count of
   upcoming bookings before confirming.

### Alternatives
| Option | For | Against |
|---|---|---|
| (a) Status quo: visible, sometimes sellable | No work | Inconsistent; trust risk; per-user gap |
| (b) **Recommended** | Customers protected; obligations visible; reversible | Needs organisation status and discovery filters |
| (c) Suspend and auto-cancel and refund everything | Simplest for customers | Irreversible if the suspension was a mistake; refund costs |

### State transitions
| From | Action (who) | To | Effects |
|---|---|---|---|
| org `active` | Suspend (D-02 role, reason required) | org `suspended` | Each listing's status saved to `status_before_suspension`; offerings hidden; checkout refused; partner notified |
| org `suspended` | Reinstate (same role, reason required) | org `active` | Listings restored to their saved status; partner notified |
| listing `approved`/`paused` | Suspend listing (admin) | listing `suspended` | Hidden; no new sales; existing bookings kept |
| listing `suspended` | Reinstate listing | its previous status | — |

### UI, API and data
- **Data:**
  - `organisations.status ENUM('active','suspended')` (default `active`), `status_reason_id`, `status_changed_at`;
  - `status_before_suspension` on `centres`, `clubs`, `experiences` and `programs`;
  - a listing status value `suspended`.
- **Shared server helper:** `offeringSellable(listing)` checks the listing status, the owning organisation's status
  and the creating user's status. Used by every checkout route, by webhook confirmation and by the waitlist-offer
  claim. Public reads join `organisations` and exclude suspended orgs.
- **API:**
  - `PUT /api/admin/organisations/:id/status {status, reasonCategory, explanation, internalNote}`
  - `PUT /api/admin/listings/:type/:id/suspension`
  - `GET /api/vendor/obligations`: read-only, allowed while suspended
- **UI:**
  - Admin organisation record page with Suspend/Reinstate; the confirmation shows the upcoming-booking count.
  - Listing record with Suspend listing.
  - Partner suspended screen with the reason (D-03) and the obligations list.
  - Public unavailable state.

### Acceptance tests
- After an org suspension: every listing type is absent from list, search and map APIs and from the sitemap; detail
  returns the unavailable state; checkout for all six paid types and for waitlist claims returns 409; partner edit,
  publish and pause return 403.
- Suspending the owner org blocks listings created by staff (the case that passes today).
- A session completed after suspension → order `paid` + `cancelled`, capacity not consumed, customer told. Before
  D-10 ships: a finance review item and **no** refund. After D-10: exactly one automatic refund when all five D-10
  preconditions hold, otherwise a finance item.
- Existing bookings: the customer can view, cancel under the published terms and download the receipt.
- Reinstating restores `approved`, `paused`, `draft` and `rejected` listings exactly as they were; nothing previously
  rejected becomes public.
- Two admins suspending at once → one transition, one audit entry, one notification.
- A suspended member calling partner APIs directly → 403, except `GET /vendor/obligations` and the account/support
  routes it needs.
- `GET /vendor/obligations` never returns customer email, phone or anything beyond what the page shows.

### Dependencies and launch impact
Needs D-02 (who may suspend) and D-03 (reason). **Blocks public and paid launch.**

### Implementation record (2026-10-15, local, uncommitted)

**Boundaries set at approval:** Super-only; reuse D-03 reasons and history; block new sales of all
organisation-owned supply whoever created it, through one shared server check; hide from discovery with an accurate
unavailable state on direct links; **never overwrite listing statuses to hide them**; reinstatement must not publish
drafts, rejected or paused listings; keep existing bookings and customer access; no automatic cancellation or refund;
read-only obligations scoped to existing role permissions plus a support route; no extra customer or financial data;
late payments into the existing finance review; no D-10 refunds/deadlines/capacity policy; no automatic conversion
of individual suspensions.

**Status:** implemented · **verified locally on the final code** (2026-10-15; `hellocircle-d01-d08-validation.md`) · not deployed.

**Ownership (authoritative relationship).** A centre, club, experience or programme is owned by the organisation of
the member in its `vendor_id` (`listing.vendor_id → users.org_id`); a pass belongs to its club. This is the relation
every partner workspace permission already uses (`orgVendorIds()`), and D-08 keeps it true when a member leaves
(their listings move to the owner; the creator is kept in `created_by_user_id`). `centres.org_id` / `clubs.org_id`
are a separate, experimental admin-assigned link (e.g. a council) and are **not** ownership. Listings with no
`vendor_id` (seeded or unclaimed) or whose member has no organisation belong to no organisation: an organisation
suspension can't affect them; their own listing status still applies.

**What is enforced** (`server/src/orgStatus.ts`, `orgSql.ts`, `orgSuspension.ts`):
- `organisations.status` (`active` | `suspended`), `status_changed_at`, `status_decision_id`. Suspend/reinstate:
  `PUT /api/admin/organisations/:id/status` (permission `orgs.suspend`, Super only); suspension needs a D-03 reason
  category and explanation (+ optional internal note); reinstatement takes an optional message (D-03's rule — the
  D-01 draft said "reason required"; the approved D-03 rule was kept). Decisions in `moderation_decisions`
  (`org.suspended` / `org.reinstated`); audit `organisation.suspended` / `organisation.reinstated`; every member is
  notified in the workspace and by email. Idempotent under the organisation row lock (a repeat changes nothing).
- **Sales:** one shared check — `offeringSellable()` before pricing and `assertSellable(tx, vendorId)` inside each
  sale's own transaction, which takes a shared lock on the organisation row — on venue bookings (incl. Make It Happen
  and Open Booking, which use the same function), club registrations (paid, free, trial and pass-credit), programme
  enrolments, experience bookings and pass purchases. A suspension (exclusive lock on the same row) and a sale
  serialise: a sale either commits before the suspension (an existing booking, kept) or is refused (409). Coupon
  redemption and waitlist claims happen inside these paths; waitlist **offers** for a suspended organisation's club
  are not sent (the queue is kept).
- **Discovery:** every public read of organisation-owned supply excludes suspended organisations — lists, search,
  map, discover feeds, provider pages and "similar providers", follows, favourites, sharing payloads, link previews,
  the sitemap, next steps, activity summaries, intent matching, programme and club-session schedules. **Listing
  statuses are never changed**, so reinstatement restores exactly what was live; drafts, rejected and paused listings
  stay as they were.
- **Direct links:** centre, club, experience, programme and provider detail return `200 { unavailable: true, name,
  message }` — no prices, sessions or booking options; the page says "This listing isn't available at the moment".
- **Checkouts in flight:** after a suspension, open checkout sessions on the organisation's pending orders are expired
  (best effort). A payment that completes anyway is checked at confirmation under the same lock: it is **not
  confirmed**, the order stays as it was (pending — not marked unpaid, not cancelled), an audit row
  `<type>.held_org_suspended` is written and the provider event is **parked for finance review** (Finance → Payment
  events, reason "Organisation suspended …") with its session id, payment intent, amount and currency. The customer's
  status page shows "needs a check". Finance can replay it after reinstatement (it then confirms normally, with the
  usual capacity re-check), or refund it at the provider. The order's own state and the provider payment are kept apart: the order stays `pending`;
  the provider payment is recorded as verified-paid in the parked event and in the hold audit row (agreed session,
  amount, currency). Capacity follows the existing rule: a pending order holds its place only for its 30-minute hold,
  then the place can be sold; a replay re-checks capacity and, if the place is gone, the order becomes paid +
  cancelled ("refund required"). Holding a place during review is part of D-10.
- **Members:** sessions carry the organisation status on every request. While suspended every partner API returns
  403 `{orgSuspended: true}` except `GET /api/vendor/obligations`; uploads, media, listing chat and staff management
  are refused too; joining the organisation through a pending invite is refused (409). The workspace shows a
  read-only page: the reason (category + explanation, never the internal note), the organisation's upcoming
  obligations and links to contact HelloCircle or ask for the decision to be looked at again (`/complaints`).
  Detail follows existing access: the owner, managers and finance (who see bookings today) get date, listing, type,
  customer **first name**, reference and payment state; other roles get the schedule summary (date, listing, count).
  No emails, phone numbers or amounts.
- **Customers** keep their booking pages, receipts and the existing cancellation/reschedule self-service; nothing is
  cancelled or refunded automatically.
- **Other organisations** and members of other organisations are unaffected.

**Kept from before:** the per-user rule — a listing whose member account is individually suspended isn't sellable —
still applies alongside the organisation rule; an individual suspension still doesn't hide listings (that's the
organisation lever) and, as before, doesn't stop a checkout already open from confirming.

**Migration:** every existing organisation is `active` (column default). **No individual suspension is converted** —
there's no rule that can tell "this person is suspended" from "this business is suspended". Before deploying, review
individually suspended partners and decide case by case (read-only):
`SELECT u.id, u.email, u.org_id, u.invited_staff FROM users u WHERE u.role = 'vendor' AND u.status = 'suspended';`

**Not built (outside this approval):** listing-level suspension (a single offering), automatic refunds or deadlines
for late payments (D-10), closing a review after an external refund (D-11), an environment switch to disable the
check (consistent with D-02: no relaxing switch; rollback = reinstate the organisation, or redeploy).

**Dependencies:** a payment parked by a suspension stays in Finance review until someone replays or refunds it —
D-10 (automatic refund rule) and D-11 (recheck after an external refund) are the follow-ups.

> **Approval statement:** "Approve D-01: organisation-level suspension that hides the organisation's offerings and
> refuses all new sales regardless of which member created them, keeps existing bookings with no blanket cancellation
> or refund, refunds late payments only under the D-10 automatic-refund rule, gives the partner a restricted read-only
> view of existing obligations and a support route, and reinstates each listing to its previous status."

---

## D-02 · Admin action permissions — APPROVED for local implementation (2026-10-14)

### Current behaviour (verified)
Admin sub-roles: `super`, `finance`, `support`, `legal` (`users.admin_role`; null is treated as super). Guards
(`requireAdminRole` in `routes/admin.ts`):
- **finance:** `/commerce`, `/finance` and `/coupons`
- **legal:** `/help` and `/policies`
- **support:** `/complaints`
- **legal or support:** `/traders`
- **super only:** admin role management

**Every other admin route is open to every admin role**, including:
- approving, rejecting, editing and deleting listings;
- suspending and approving partners;
- deciding claims, host applications and place suggestions;
- reports and reviews;
- organisations and their feature flags;
- staff platform roles and provider tiers;
- notification templates and demand notifications;
- market and recommendation settings;
- the maps, uploads and Cloudinary switches (`routes/adminMedia.ts`);
- audit and support search.

Changing your own role and demoting the last super admin are already blocked. There is no endpoint to create or
remove an admin. The admin navigation already shows locked items (`adminNav.ts`).

### Problem
Any admin, whatever their role, can take any moderation or platform action. Least privilege isn't enforced.

### Recommended matrix
V = view · A = act (create/edit/approve/reject/decide) · — = no access. Every A writes an audit entry; **R** = a
reason is required.

| Area · action | Super | Finance | Support | Legal |
|---|---|---|---|---|
| **Listings:** view | V | V | V | V |
| Listings: approve, reject (R), suspend listing (R), reinstate listing (R) | A | — | A | — |
| Listings: edit content as admin | A | — | A | — |
| Listings: delete (R) | A | — | — | — |
| Listings: feature/unfeature | A | — | A | — |
| **Partners:** view | V | V | V | V |
| Partners: approve account | A | — | A | — |
| **Partners/organisations: suspend or reinstate (R)** | A | — | V | V |
| Partners: provider tier | A | — | — | — |
| Partners: staff platform role (R) | A | — | — | — |
| Organisations: create, assign listings | A | — | — | — |
| Organisations: feature flags | A | — | — | — |
| **Claims, host applications, place suggestions:** decide | A | — | A | V |
| **Reports:** view | V | — | V | V |
| Reports: dismiss, action | A | — | A | A |
| Reports: suspend content (R) — hides the item; reversible | A | — | A | A |
| **Reviews:** hide, unhide (R) | A | — | A | A |
| **Complaints and appeals:** handle | A | — | A | A |
| **Traders (KYBC):** view, verify | A | — | V | A |
| **Policies and field help:** publish | A | — | — | A |
| **Notification templates:** edit (R) | A | — | — | A |
| **Demand notifications:** send | A | — | A | — |
| **Refunds, settlements, transfers, debts, disputes, credits, rewards, webhooks:** view and act (R) | A | A | V (refunds and payment state only, for support) | — |
| **Commercial rules:** draft, publish (publish = super after finance review, existing two-step) | A | A | — | — |
| **Coupons** | A | A | — | — |
| **Commerce switches** | A | A (financial switches only) | — | — |
| **Maps, uploads, Cloudinary switches; market config; recommendation weights** | A | — | — | — |
| **Media editorial** | A | — | A | — |
| **Admin roles:** assign | A | — | — | — |
| **Audit log, support search:** view | V | V | V | V |

- **Explicit permissions, assigned to roles.** Each row is a named permission (e.g. `listings.moderate`,
  `queues.decide`, `partners.suspend`, `listings.delete`). The role table assigns them: Support gets the moderation
  permissions at first. A later "moderator" role is just a new row in the assignment table — no route changes.
- **Super only:** partner/organisation suspension and reinstatement, and every destructive action (listing delete,
  coupon delete, template delete, editorial delete, organisation flags and tiers, platform switches, admin roles).
- **Powers removed today:**
  - finance and legal lose listing and partner moderation, organisations and flags, tiers, platform roles,
    templates (finance only) and demand notifications;
  - support loses partner suspension/reinstatement, deletes, tiers, flags, templates, platform switches and financial
    actions;
  - legal gains nothing new except templates.
- **Second approver:** only where it already exists (commercial rule publication). No others are proposed;
  organisation suspension is reversible and audited.
- **Self-escalation:** keep "can't change own role" and "can't demote the last super". Add: "can't create admins
  through the API" (stays seed or script only) until a separate decision.

### Implementation
- **One permission table** in code, `ADMIN_PERMISSIONS: Record<Permission, AdminRole[]>`, used by
  `requireAdminPermission(permission)` on every admin route and exported to the client nav so it shows exactly the
  same locks.
- **Default deny.** `requireAdminPermission` refuses (403) any permission that isn't in the table, any role that isn't
  a known role, and a missing role. There is no wildcard and no "allow if unlisted". The router itself also ends in a
  deny: a route without an explicit permission check can't be reached (a test enumerates every mounted admin route and
  fails if one has no declared permission).
- Direct URL or API without permission → 403 `{ error: "Not included in your admin role" }`; the page shows the
  existing "Not included in your admin role" state.
- **Migration:** current admins keep their role value. A null `admin_role` stays super (existing backfill; the
  backfill becomes explicit so no row is left null). Before deploying, the owner sees the list of admins and their
  roles.
- **Rollout:** enforced from the first deploy after approval. There is **no** switch, environment variable or "log-only"
  mode that relaxes enforcement.
- **Diagnostics never bypass enforcement.** An optional *shadow* check may evaluate a **proposed** permission table
  side by side and log where it would differ (`admin.permission_shadow_diff`), but every request is decided by the
  enforced table only. Turning the shadow check on or off changes no decision.
- **Rollback is narrow and explicit.** Undoing a change means deploying the previous version of the permission table
  (a reviewed code change, recorded in the audit/change log). It restores exactly the rows that changed. There is no
  global "restore old behaviour" path that would bring back the pre-D-02 broad powers. In an emergency, a super admin
  already holds every permission; no wider access is needed.

### Acceptance tests
- For every row and role: allowed → 2xx and an audit entry; denied → 403 and **no DB change** (scoped snapshot,
  existing authorization fixture).
- **Default deny:** a request checked against a permission name that isn't in the table → 403; an admin with an
  unknown or empty role value → 403 on every non-super action.
- **Coverage:** a test lists every route mounted under `/api/admin` and fails if any lacks a declared permission.
- **Shadow mode can't widen:** with the shadow check enabled and a proposed table that grants more, every denied
  request is still 403 and the database is unchanged; only a `admin.permission_shadow_diff` audit row is added.
- **No relaxing switch:** no setting of any `ADMIN_RBAC_*` environment variable turns a 403 into a 2xx (test runs the
  denied matrix under each value).
- **Rollback:** reverting one permission row restores only that row; every other denial in the matrix is unchanged.
- Nav visibility matches the server table (generated from the same source).
- Self-role change → 403. Demoting the last super → 409.

### Implementation record (2026-10-14, local, uncommitted)

**Boundaries set at approval:** deny by default; no diagnostic comparison mode in this phase; no environment
variable or switch restoring broad permissions; rollback keeps deny-by-default; 401 without a session, 403 for an
authenticated user lacking permission; unresolved sensitive actions stay Super-only.

**Status:** implemented · **verified locally on the final code** (2026-10-15, after an owner-approved QA environment
recovery): unit suites, `validation-d02`, `qa:auth`, `qa:authorization`, `qa:security-gate`, `qa:validation`,
`qa:product` — results in `hellocircle-d02-d03-validation.md` · not deployed.

**What is enforced** (`server/src/adminPermissions.ts`, the single table; the client mirrors it via
`GET /api/admin/permissions`):

| Permission | Super | Finance | Support | Legal |
|---|---|---|---|---|
| workspace.view, audit.view, support.search, insights.view, decisions.view, partners.view, listings.view, orgs.view | ✓ | ✓ | ✓ | ✓ |
| decisions.internal_notes.view, queues.view, reviews.view, reports.view, traders.view | ✓ | — | ✓ | ✓ |
| reviews.moderate (hide/unhide), reports.moderate, complaints.handle | ✓ | — | ✓ | ✓ |
| partners.approve, listings.moderate, listings.edit, listings.feature, queues.decide, demand.notify, media.view, media.editorial | ✓ | — | ✓ | — |
| traders.verify, policies.manage, help.edit, templates.view, templates.edit | ✓ | — | — | ✓ |
| finance.operate, commerce.operate, coupons.manage | ✓ | ✓ | — | — |
| finance.payment_state.view (refund list, payment lookup — read only) | ✓ | ✓ | ✓ | — |
| admins.manage, partners.suspend (suspend, reinstate, back to pending), partners.platform_role, partners.tier, listings.delete, orgs.manage, templates.delete, media.delete, coupons.delete, platform.settings, commerce.governance_switches | ✓ | — | — | — |

- Every route under `/api/admin` (140+, including the mounted finance, commerce, policies, complaints, traders, help
  and media routers) and the admin review-hide route declares exactly one permission as its first handler; a
  route-inventory test fails otherwise. An unknown permission name throws at startup.
- An admin with an empty or unknown role gets 403 everywhere (including `/api/admin/permissions`); the workspace
  shows "Your admin account has no role".
- **Migration change:** the pre-roles backfill (`NULL admin_role → super`) used to run on every boot, which would
  have quietly made a role-less admin super after any restart. It now runs **once per database** (marker
  `migration.admin_role_backfill` in `app_settings`), promotes exactly the admin rows with no role at that first run
  (the admins who had full access before roles existed) and writes one `admin.role_backfilled` system audit row per
  account. **Every legacy admin keeps Super access until a super admin explicitly reassigns them.** New admin
  accounts are created with an explicit `super` role. Pre-/post-deploy runbook (schema check first; a column-free
  inventory where `admin_role` doesn't exist yet): `hellocircle-d02-d03-validation.md` §3.
- The old `requireAdminRole`/`hasAdminRole` guards were removed; nothing defaults a missing role to super
  (audit labels record `null`).
- Last-super protection now locks every super row in id order before the target, so two concurrent demotions
  serialise (one 200, one 409) instead of deadlocking.

**Ambiguities kept Super-only (need an owner decision to widen):**
1. *Commerce switches — "finance: financial switches only".* The matrix doesn't list them. Three are not financial
   and are Super-only: `commerce.require_second_approver` (two-person control over rule changes — finance turning it
   off would weaken a check on its own work), `commerce.paid_games_require_verified_host` (trust rule) and
   `commerce.open_booking` (launch gate with an open pricing P0). All other commerce switches stay with finance.
2. *Coupon archive.* The only coupon "delete" is `DELETE /api/admin/coupons/:id`, which archives. The cross-cutting
   rule makes coupon delete Super-only, while the coupon row gives finance "A". Kept Super-only; finance can still
   create, pause and resume.
3. *Notification template reset* (`DELETE …/notification-templates/:key`, back to the default text) — treated as
   template delete, Super-only.
4. *Market categories and recommendation weights* — reading stays open to every role (`insights.view`), changing is
   `platform.settings` (Super), as in the matrix.

- Image uploads (`POST /api/uploads`): an admin needs `listings.edit` or `media.editorial` (super, support); any
  other role, an empty or unknown role is refused before a file is written. The account self-service routes that
  also use `requireVendorOrAdmin` (change own password, link own Google account, deactivate own account) are not
  admin powers and stay available to any signed-in account.
- Partner status changes are conditional on the status the permission check saw, so a support approval can't
  reinstate an account a super admin suspended in the same moment (409 instead).

**Deliberately not done:** no diagnostic/shadow comparison mode; no admin-creation API; "R" (reason required) is not
enforced on platform role, tier, delete or template changes in this phase (D-03 covers rejection and suspension
only).

**Rollback (keeps deny-by-default).** Rollback means redeploying an earlier, reviewed version of the
`ADMIN_PERMISSIONS` table (or individual rows). There is no switch back to the old behaviour. The exact powers a
full rollback to pre-D-02 *behaviour* would restore — and which this implementation removed — are:
- **finance:** listing approve/reject/edit/feature/delete; partner approve, suspend, reinstate; claims, host
  applications and suggestions; reports and reviews; complaints; organisations and flags; provider tiers and staff
  platform roles; notification templates; demand notifications; media library; maps/uploads/Cloudinary switches,
  market config and recommendation weights; the three governance commerce switches.
- **support:** partner suspend/reinstate/back-to-pending; listing delete; organisations and flags; tiers and platform
  roles; templates (view and edit); maps/uploads/Cloudinary switches, market config, recommendation weights; finance
  tool beyond the read-only refund and payment views; commerce and coupons.
- **legal:** listing approve/reject/edit/feature/delete; partner approve, suspend, reinstate; queue decisions;
  organisations and flags; tiers and platform roles; demand notifications; media library; platform switches, market
  config and weights. (Legal *gained* complaints handling and template edit.)
- **an admin with no role:** previously treated as super; now nothing.
- **a signed-in partner on admin routes:** previously 401, now 403 (authenticated but not permitted).
Each item above is a row in the table; restoring one is a one-line reviewed change, never a global mode.

> **Approval statement:** "Approve D-02: named admin permissions as in the matrix, denied by default; listing and
> queue moderation assigned to Support; partner suspension, reinstatement and all destructive actions Super-only;
> enforced server-side from deployment; diagnostics may compare a proposed table but never change a decision, and
> rollback means redeploying the previous table, never a broad-access mode."

---

## D-03 · Rejection and suspension reasons — APPROVED for local implementation as product policy (2026-10-14)

### Current behaviour (verified)
- Listing rejection and partner suspension store **no reason** and send **no message** to the partner. Listing
  approval only notifies followers; partner account approval sends an email.
- Moderation reports store an optional internal `statement_of_reasons` that nobody outside the admin sees.
- The partner sees "Not approved yet — changes needed" and can resubmit.

### Legal context (verify with counsel; not legal advice)
The EU Digital Services Act (Reg. 2022/2065) Art. 17 requires **hosting service providers** to give a clear,
specific **statement of reasons** when they restrict content or suspend an account. It sits in Chapter III,
Section 2, which applies regardless of company size. The micro/small-enterprise exemption (Art. 19) covers
**Section 3** (Art. 20–28, e.g. the internal complaint system). **Needs legal input:** whether partner listings make
HelloCircle a hosting service for this purpose, and the required content of a statement (facts relied on, legal
or terms ground, redress options). The recommendation below is a good product practice either way.

### Recommended policy
| Action | Reason category (required) | Explanation shown to the partner (required) | Internal note (optional) |
|---|---|---|---|
| Reject listing | Incomplete details · Misleading or inaccurate · Not an eligible activity · Safety concern · Duplicate · Other | yes, min 20 chars | yes |
| Suspend listing / organisation | Terms breach · Safety concern · Payment/fraud risk · Legal request · Verification failed · Other | yes | yes |
| Reject claim / host application / suggestion | same short list | yes (shown to the submitter where they can see status) | yes |
| Reinstate | — | optional message | yes |

- **Partner sees:** the category and explanation on the listing editor (rejected) or the suspended screen, with "What
  you can do": edit and resubmit (rejection), or contact or appeal through `/complaints` (kind `appeal`).
- **Notification:** an email and a workspace notification with the same text. Delivery failures are logged and
  retried by the existing email path; the decision never depends on delivery.
- **Internal notes:** visible to super, support and legal (D-02); never in partner APIs, emails or exports.
- **Sensitive investigations:** use the category "Legal request" or "Payment/fraud risk" with a neutral explanation;
  details stay in the internal note.
- **History:** every decision is a row in `moderation_decisions` (object, action, category, explanation, internal
  note, actor, time). The latest one is shown to the partner; all are shown to admins. Rows are never edited; a
  correction is a new decision.
- **Existing records:** "No reason recorded" (never invented).

### Data and API
New table `moderation_decisions`. Admin decision endpoints take `{reasonCategory, explanation, internalNote}` (400 if
they're missing where required). Partner endpoints return `{latestDecision: {category, explanation, decidedAt}}`
without the note.

### Acceptance tests
- Reject without a category or explanation → 400, nothing changes.
- The partner listing API includes the explanation and **never** the internal note (asserted on the JSON).
- Email and notification text matches the stored explanation.
- An old rejected listing shows "No reason recorded".
- A second decision adds a row; the earlier one stays unchanged.

### Implementation record (2026-10-14, local, uncommitted)

**Boundaries set at approval:** implemented as approved product policy, without claiming any particular legal
requirement applies; never manufacture reasons for old decisions; apply reasons to existing actions without
changing their lifecycle; use existing notification infrastructure (tests deliver to the isolated QA sink only).

**Status:** implemented · **verified locally on the final code** (2026-10-15): unit suites, `validation-d03-api`,
`validation-d03-ui` and the full suites listed in `hellocircle-d02-d03-validation.md` · not deployed.

- **Table** `moderation_decisions` (append-only; no back-fill): object type/id, action, previous/new state, reason
  category, explanation (shown to the affected person), internal note (admins with
  `decisions.internal_notes.view` only), actor, time.
- **Reasons required** (category + explanation of 20–2,000 characters; note up to 4,000): listing rejection
  (centre, club, experience — single and bulk), partner suspension, claim rejection, host-application decline,
  place-suggestion rejection. Reinstatement takes an optional message. Approvals record a decision without a reason.
  Missing or invalid reason → 400 and nothing changes.
- **Lifecycle unchanged**, with tightenings that only stop double decisions: claim rejection is a conditional update
  (`AND status='pending'`, already-decided → 409, as approval already did); a place suggestion is decided in one
  locked transaction (second concurrent decision → 409, as a sequential one already was); an identical repeat of a
  listing decision (same status, same reason) is a no-op 200 with no second decision or notice, while a different
  reason on the same status is recorded as a correction.
- **Who sees what:**
  - Partner — listing editor (`GET /api/vendor/decisions/:type/:id`, owner-checked); suspended workspace screen
    (`GET /api/auth/account-decision`); sign-in page (the 403 for a suspended account includes the decision only
    after the password or Google check). Workspace notification + email.
  - Resident applicant — Profile → Hosting (`hostDecision` on `/api/residents/me`); notification + email.
  - Place-suggestion submitter — their suggestions list (`decision` per row); an in-app notification if they were
    signed in (anonymous suggestions: list only). No email (submissions have no verified address).
  - Admins — "Decisions" history on listing, partner, claim, host-application and suggestion record pages.
  - The internal note is never in a partner/applicant API, notification or email (asserted in tests).
- **Older decisions** show "No reason was recorded for this decision" — nothing is invented.
- **Next steps** text points to `/contact` and `/complaints`; no new appeal workflow was built, and an appeal raised
  through `/complaints` is not yet linked to the decision id.
- **Delivery:** the workspace notice and the email are independent (one failing never blocks the other or the
  decision); failures are logged.

**Limitations:** no vendor-facing claims list (claim decisions reach the partner by notification and email only);
anonymous suggestion decisions are visible only on the device that submitted them.

> **Approval statement:** "Approve D-03: required category and partner-visible explanation, plus an optional internal
> note, on rejection and suspension, shown with an edit or appeal route — wording to be checked against legal advice on
> DSA Art. 17."

---

## D-04 · Pricing and published rules — NEEDS INPUT (money and tax)

### Current pricing path (verified)
| Offering | Code path | Price basis | VAT | Customer fee | Deposit | Discounts / credits | Refunds |
|---|---|---|---|---|---|---|---|
| Venue booking | `routes/bookings.ts` → `computePricing()` | room rate × hours | +23% on top | +5% of pre-VAT amount, no VAT on fee | €100 on online payment (`DEPOSIT_CENTS`) | coupons; customer credits where on | Customer cancel: no automatic refund (off-platform); partner cancel: full automatic refund; admin: full or partial |
| Club registration | `routes/registrations.ts` | club price | +23% | +5% | none | coupons | as above |
| Programme enrolment | `routes/programs.ts` | programme price | +23% | +5% | none | coupons | as above |
| Experience booking | `routes/experiences.ts` | price × party | legacy +23%, or rules engine when `commerce.engine_v2` and `commerce.engine_v2_experience` are on | +5% (engine v1 = 500 bps) | none | coupons, credits | as above |
| Paid hosted activity (Game) | `routes/games.ts` | per-player price | +23% | +5% | none | coupons | as above |
| Pass (club credits pack) | `routes/passes.ts` | club price × credits | +23% | +5% | none | none | no in-app pass refunds |

- **Fixed values in code:** `VAT_RATE = 0.23` and `PLATFORM_FEE_RATE = 0.05` (`server/src/pricing.ts`),
  `DEPOSIT_CENTS = €100` (`bookings.ts`). The same constants are mirrored in `client/src/api/public.ts`.
- **Published rules actually consumed:**
  - `pricing` (experience checkout, only with both engine switches on; settlement allocation uses its
    `successFeeBps`, which is 0 in v1);
  - `rewards`, `plan_*` (Pro and rewards, off);
  - `payment_costs` (fee estimates).
- **Not consumed by checkout:** the `cancellation`, `checkout` and `plan_rules` keys.
- **Fee basis today:** HelloCircle's revenue is the 5% customer fee; partners receive their listed price
  (success fee 0%). The 9% and 7% plan fees appear only in the simulator and the Pro comparison.
- **VAT assumption:** prices are treated as **excluding** VAT and 23% is added for every type, regardless of whether
  the partner is VAT-registered. It is marked `provisional_pending_irish_tax_review` in the catalogue.

### A. Architecture (can be specified now) — PROPOSED
1. **One pricing source:** `priceOrder(type, offering, inputs, at)` reads the **published rule version effective at
   `at`** for that offering type and returns the full breakdown. Every checkout route and the client quote call use
   it; client constants are deleted (display uses server quotes).
2. **Explicit coverage:** each rule version lists the offering types it applies to. A type without coverage refuses
   paid checkout (fail closed) instead of falling back silently.
3. **Effective dates:** versions have `effective_from` / `effective_to`; publishing creates a new version and never
   edits one.
4. **Stored breakdown per order:** rule version id and hash, subtotal, discount, credit, VAT basis and amount,
   customer fee, deposit, partner amount, platform amount, currency. Already partly in `orders` and the allocation
   snapshot; extend to all types. Receipts, refunds and settlement read the stored breakdown, never recompute.
5. **Compatibility version, marked unapproved.** Today's code values (23% VAT added, 5% customer fee, €100 venue
   deposit, 0% success fee) are published as the first rule version, `legacy-compat-v1`, with
   `commercial_status = 'unapproved'`. The admin rule card, the stored order breakdown and finance exports all show
   that status. It exists so the new engine can reproduce today's prices exactly. It is **not** an approval of those
   values.
6. **Backward compatibility:** existing orders keep their legacy breakdown. Back-fill `orders` rows from the legacy
   columns (`commerce/backfill.ts` exists) with `rule_version = 'legacy-v0'` (historical, never re-priced).
7. **Paid checkout stays gated.** In production, paid checkout requires both the existing release gate
   (`PAID_CHECKOUT=open`, `commerce/releaseGates.ts`) **and** an effective rule version for that offering type with
   `commercial_status = 'approved'`. With only the compatibility version in force, production paid checkout is refused
   (fail closed). Development, QA and test keep working on the compatibility version so behaviour can be verified.
8. **Migration:** per type behind `commerce.engine_v2_<type>`. Run in shadow mode (compute both, log differences)
   for a set period. Switch over one type at a time.
9. **Rollback:** turn the type's switch off; new orders use legacy pricing; existing orders keep whichever breakdown
   they were sold with.
10. The Stripe amount equals the stored total (the checkout agreement already enforces this).
11. **Marking a version commercially approved** is a separate, audited action (super admin, after the owner's part B
    approval is recorded), and it only applies to a newly published version — never retroactively to an existing one.

**Acceptance tests (part A):**
- With `legacy-compat-v1` in force, every type's engine price equals today's legacy price, to the cent (shadow
  comparison, then switched).
- In a production-profile test with `PAID_CHECKOUT=open` and only the compatibility version → paid checkout refused
  with "Paid bookings aren't open yet"; free and cash orders still work.
- The stored breakdown records the version id and its `commercial_status`; receipts and refunds read it and never
  recompute.
- A type with no covering version refuses paid checkout (fail closed).
- Publishing a new version never alters an earlier one or any existing order.

### B. Monetary and tax policy (needs your decision with an accountant)
1. Are partner prices **VAT-inclusive or exclusive**, and how is VAT handled for partners who aren't VAT-registered?
2. Is HelloCircle acting as **agent** (commission) or **principal** (reseller) for VAT purposes? Which party
   invoices the customer?
3. **Fee model:** customer fee (rate, VAT on it?), partner success fee (rate, minimum, basis), or both.
4. **Deposit:** amount, which offerings, refund conditions and timing.
5. **Cancellation and refund terms:** platform default vs partner-set; refund percentages by notice period; whether
   the customer fee is refundable.
6. **Who bears payment-processing costs.** For reference, Stripe Ireland lists standard EEA cards at 1.5% + €0.25,
   and Connect (platform sets pricing) at €2 per monthly active account plus 0.25% + €0.10 per payout. These were the
   public figures on 2026-10-14; confirm against the Stripe Dashboard.
7. Invoice/receipt requirements (VAT invoice vs payment receipt).

> Part A can be approved and built **without** approving today's VAT rate, fees or deposit: the current values
> become a compatibility version explicitly marked *commercially unapproved*. **Approving part A does not authorise a
> paid launch** and approves no VAT treatment, fee or deposit; production paid checkout stays refused until a part-B
> version is approved and published.
>
> **Approval statement (architecture only):** "Approve D-04 part A: one versioned server pricing source with stored
> breakdowns, today's values as a compatibility version marked commercially unapproved, per-type rollout with shadow
> comparison, legacy orders unchanged, and production paid checkout refused until a commercially approved version is
> published. This approves no VAT treatment, fee, deposit or paid launch."

---

## D-05 · Edits to approved listings — PROPOSED

### Current behaviour (verified)
Partner edits to an approved listing (`PUT /vendor/centres|clubs|experiences/:id`, rooms, hours and blocks
sub-resources) go live **immediately**, with no review; they're audited (e.g. `centre.updated`). Pause and resume
are immediate. Rejected listings resubmit to `pending`.

### Field classification (from the actual editors)
| Class | Fields | Rule | Why |
|---|---|---|---|
| **Operational** | open/closed (`is_open`), opening hours, `centre_hours`, room blocks, sessions and departures, capacity reductions, pause/resume | Immediate | Needed for safe operation; reducing availability protects customers |
| **Low-risk** | contact phone, managed-by, map link, amenities, accessibility notes, equipment and logistics texts | Immediate, logged, visible in admin history | Corrections, low abuse potential |
| **Price** | room rate, club/programme price, experience price, game price (up or down) | **Immediate for future bookings.** Server validation: a whole number of cents, not negative, within the existing per-type maximum; audited with old and new value (`listing.price_changed`) and shown in the admin listing history | Pricing is the partner's commercial decision; every order stores the price it was sold at, so existing bookings can't change |
| **Material** | name, description/blurb, category/sport/kind, cover and gallery photos, area/county/location, room names, capacity increases, payment method (cash ↔ online), age range, guardian/safeguarding text | Saved as a **pending revision**; the approved version stays public until an admin approves | What customers rely on when choosing; abuse potential |

### Lifecycle
- One open revision per listing. The partner sees "Changes waiting for review" with the field list and can edit or
  withdraw the revision. Public APIs only ever read the approved columns.
- The admin revision page shows a field-by-field comparison (old → new) with Approve or Reject (reason per D-03).
  Rejected → the revision is closed, the public listing is unchanged, the partner sees the reason.
- **Existing bookings keep the price and terms they were sold with** (stored breakdown, D-04). Revisions and price
  changes never change existing orders. A Checkout session opened before a price change still charges the agreed
  amount (the checkout agreement records it), so a mid-checkout change can't alter what the customer pays.
- **Emergency closure** (operational) is immediate. Affected upcoming bookings follow the existing partner-cancel flow
  (full refund) where the partner cancels them.
- **Notifications** only when customers are affected: cancellations, or a venue/time change on an existing booking
  (not possible through edits; it requires a reschedule).
- **Concurrency:** the revision stores the approved version's `row_version`. Approval fails with 409 if the live
  listing changed underneath (the admin re-reviews).

### Data and API
- New table `listing_revisions` (listing type and id, base row_version, changed fields JSON, status
  pending|approved|rejected|withdrawn, decision reference).
- The partner PUT splits the request: operational and low-risk fields are written immediately; material fields go
  into the revision.
- Admin endpoints: list, compare, approve, reject.

### Acceptance tests
- A material field edit leaves the public API unchanged until approval.
- A low-risk edit is public immediately.
- A price change (up or down) is public immediately, writes `listing.price_changed`, and an existing booking's
  receipt and refund still use the old price.
- A negative, fractional-cent or above-maximum price → 400, nothing changes.
- A Checkout session opened before a price change confirms at the agreed amount.
- Two pending edits merge into one revision.
- Approving after the live row changed → 409.
- Existing bookings keep their stored price after an approved increase.
- The public API never returns revision values (asserted on every field of the public JSON).

> **Approval statement:** "Approve D-05: operational, low-risk and price changes go live immediately for future
> bookings (validated and audited; existing bookings keep their agreed price); material content edits wait for review
> while the approved version stays public."

---

## D-06 · Staff listing claims — PROPOSED

### Current behaviour (verified)
`POST /api/vendor/claims` (`routes/vendorListings.ts`): any member of any staff role can claim an unowned centre or
club.
- Duplicates are prevented **per user, not per organisation**.
- There is no withdraw endpoint.
- Competing claims from different organisations can all be pending at once.
- Approval sets the listing's `vendor_id` to the **claiming user**, requires that user's account to be approved, and
  refuses if someone else claimed the listing first.

### Recommended policy
- **Owner submits.** Only the organisation owner can submit a claim.
- **Managers prepare.** `centre_manager` (centres) and `facility_manager` (clubs) can create a **draft** claim; the
  owner sees "Claim drafted by <name>" and submits or discards it. Other roles can only view.
- **One active claim per organisation per listing.** "Active" = draft or pending. An organisation can have active
  claims on as many *different* listings as it likes (e.g. a business claiming three venues files three claims). It
  can't have two active claims on the *same* listing.
- **Competing organisations** on the same listing each have their own claim record. The admin claim page shows the
  others alongside; approving one closes the others for that listing only, with reason "Another organisation's claim
  was approved". Other claims those organisations have on other listings are unaffected.
- **Withdraw.** The owner can withdraw a pending claim (new endpoint).
- **Approval** assigns the listing to the organisation, recorded as `vendor_id` = the owner user. The audit entry
  records the submitter and any drafter.
- **Existing pending claims filed by staff:** left pending and shown to the owner as "Submitted by <name> before the
  owner-only rule". The admin decides as normal.
- **Evidence requirements:** none added. A proof field (e.g. document upload) would be a separate proposal.

### Acceptance tests
- Staff submit → 403. Staff in a manager role create a draft → 201. The owner submits the draft → 201.
- A second active claim from the same organisation on the same listing → 409; the same organisation claiming a
  different listing → 201.
- Owner withdraw → 200, and admin decide after that → 409.
- Approving one of two competing claims closes the other atomically; the losing organisation's claims on other
  listings stay pending.
- Direct API calls by each staff role match the matrix (authorization fixture).

> **Approval statement:** "Approve D-06: owner-only claim submission, manager drafts, one active claim per
> organisation per listing (any number of different listings), owner withdrawal, and competing organisations' claims on
> the same listing resolved together."

---

## D-07 · Resident suspension and account deletion — NEEDS INPUT (legal)

### Current behaviour (verified)
- **No admin suspension of residents.** Moderation can hide reviews and close Circles.
- Residents can "deactivate" (`deactivated_at`); it's soft and reverses on the next sign-in.
- **No account deletion.** A data export exists (`GET /api/residents/me/export`).
- Residents can be linked to a partner account (`users.resident_id`).

### Suspension — recommended
- **Scope:** can't sign in to the resident side, join, book, message, post reviews, host or organise.
- **Existing paid bookings stay valid**, and the resident can still receive refunds and see receipts through a
  limited "account suspended" page. This works by allowing a session with a `restricted` flag.
- **Hosted activities and Circles:**
  - upcoming activities they host are **paused for new joins**, and an admin chooses per item: cancel (refunds by
    the existing flow) or hand over to a co-host;
  - Circles they organise get a "new organiser needed" state; members are told organising is paused.
- **Linked partner account:** **not** suspended automatically. Cross-suspension is a separate, explicit admin action.
- Reason required (D-03 categories). Appeal via `/complaints` (kind `appeal`). Reinstatement restores access; paused
  items stay paused until the resident resumes them.

### Deactivation — keep (existing)
"Deactivate account" stays as it is today: reversible, hides the profile, and signing in again restores it. Profile
shows it as a separate, clearly-labelled option next to "Delete account".

### Deletion — recommended
1. **Request:** "Delete account" in Profile, confirmed with a fresh magic link (identity) and an explicit confirmation
   that lists what will be removed, what must be kept, and any blockers.
2. **Blockers** (deletion waits):
   - upcoming paid bookings: the resident cancels them or they complete first;
   - open refunds or disputes;
   - negative balances;
   - Circles organised alone: hand over or close;
   - an owned partner organisation: transfer or close it first.
3. **No mandatory waiting period.** Once confirmed and unblocked, deletion runs straight away (as a job, so failures
   retry). The magic-link confirmation is the safeguard against accidental or hostile deletion; someone unsure can
   deactivate instead. A delay would only be added later if a concrete reason emerges (e.g. fraud investigations).
4. **Execution (a job with retries and status):**
   - **Delete:** profile, avatar and media (R2/Cloudinary objects too), favourites, household members, preferences,
     sessions, push tokens, device IDs, analytics identifiers, messages' author identity (replaced by "Deleted
     member").
   - **Anonymise but keep:** bookings, payments, refunds and receipts. Name and email are replaced; amounts, dates
     and references are kept.
   - **Stripe:** keep payment references (Stripe retains its own records under its own obligations); no customer
     object deletion unless legal advises.
5. **Status:** requested → executing → completed / failed (with retry). The resident gets a completion
   email to the address before anonymisation. An admin can see the status but never the deleted content.

### Legal inputs (needed **before deletion is built**)
- GDPR Art. 17 (right to erasure) allows keeping data needed for a legal obligation (Art. 17(3)(b)).
- Irish Revenue guidance says business records must be kept for **six years** (revenue.ie, VAT and business
  records). Counsel should confirm which booking and payment fields that covers, and whether HelloCircle or the
  partner is the record-keeper for each order.
- Complaint and appeal records, safety reports, and data from suspended accounts: retention to be defined by legal.
  None is invented here.

### Acceptance tests
- A suspended resident: sign-in gives the restricted page; join, book, message and review → 403; refunds still
  arrive; receipts are visible.
- Deletion is blocked while an upcoming paid booking exists (409 with the blocker list).
- After execution:
  - the resident row has no personal data;
  - bookings still reconcile financially;
  - media objects are gone (provider calls are mocked in tests and checked in a provider-test run);
  - re-running the job is a no-op;
  - a failed media delete leaves status `failed` with a retry.
- The linked partner account is unaffected by resident suspension.

> **Approval statement:** "Approve D-07 in principle: admin resident suspension (bookings honoured, hosting paused,
> linked partner untouched); reversible deactivation kept; 'Delete account' with magic-link confirmation, blockers, no
> mandatory waiting period and anonymised financial records — deletion built only after legal confirms the retention
> list."

---

## D-08 · Staff role changes and removal — APPROVED for local implementation (2026-10-15)

### Behaviour before implementation (verified 2026-10-14)
- **Owner can:** invite staff and revoke **pending** invites (`routes/org.ts`).
- **Owner can't:** change an accepted member's role or remove a member.
- **Admins** can change a staff `platform_role` (`PUT /api/admin/vendors/:id/platform-role`, audited, no reason).
- A user belongs to **one** organisation.
- Sessions re-read the user on every request (`userFromToken`), so role and status changes apply immediately.

### Recommended policy
- **Owner can:**
  - change an accepted member's role (`centre_manager`, `facility_manager`, `finance`, `communications`,
    `read_only_analyst`);
  - remove a member;
  - cancel a pending invite;
  - see one Staff page listing each member's role, a plain description of what it allows, invited/joined dates and
    last active.
- **Removal:**
  - the member's `org_id` is cleared and their partner sessions are deleted;
  - their account remains (they may join another org or be a resident);
  - listings, bookings, audit and chat history keep their original attribution;
  - listings they created stay with the organisation. Their `vendor_id` moves to the owner so `vendorSuspended`-style
    per-user checks can't orphan them.
- **Owner protection:** the owner can't remove or demote themselves. Ownership transfer is a separate admin-assisted
  action (not in scope).
- **Stale screens:** each change sends the member's `row_version`; a mismatch → 409 "This member changed — refresh".
- **Notifications:** an email to the member on role change or removal. Audit `org.staff_role_changed` and
  `org.staff_removed`. Reason optional (internal).
- **Admin platform-role changes** remain for support, but require a reason (D-02).

### Acceptance tests
- After a role change, the member's next request is limited to the new role (direct API call).
- After removal, the member's old session cookie gets 401/403 on every partner API.
- Re-using a removed member's invite link → 410.
- The owner removing themselves → 403.
- Two owners' tabs changing the same member → one 200, one 409.
- Listings the member created remain editable by the owner and stay sellable.

### Implementation record (2026-10-15, local, uncommitted)

**Boundaries set at approval:** owners change an accepted member's role and remove members; invitations and
pending-invite cancellation unchanged; effective on the next request; removal revokes that organisation only; no
self-escalation, cross-organisation changes or ownership changes; no ownership transfer; keep attribution, records and
audit; safe against stale screens and concurrent requests; organisation-suspension restrictions apply; record actor,
membership and previous/new role or membership state.

**Status:** implemented · **verified locally on the final code** (2026-10-15; `hellocircle-d01-d08-validation.md`) · not deployed.

- `PUT /api/vendor/org/staff/:id {platformRole, rowVersion}` and `DELETE /api/vendor/org/staff/:id {rowVersion}` —
  owner only (invited staff get 403). The target must be an accepted member of the owner's own organisation; another
  organisation's member is indistinguishable from an unknown id (404); the owner can't target themselves (403) or the
  owner row; fields other than the role (e.g. `invitedStaff`, `orgId`) are ignored, so ownership can't change.
- **Stale screens and concurrency:** `users.row_version` (also bumped by an admin platform-role change). Both requests
  lock the owner row, then the member row, and compare the version: a stale page or the slower of two concurrent
  requests gets 409 "This member changed … refresh".
- **Next request:** sessions re-read the user every request, so a new role applies to the member's existing session
  immediately.
- **Removal** (one transaction): the member's `org_id` and `platform_role` are cleared; their partner sessions are
  deleted (a resident/magic-link session is a separate identity and stays); their listings (centres, clubs,
  experiences, programmes) move to the owner with the creator kept in `created_by_user_id`; their coupons move to the
  owner (otherwise they'd stop validating for the organisation's listings); bookings, messages, decisions and audit
  history are untouched. A removed member who signs in again has an account but no partner workspace (403
  `removedFromOrg`), and can't use uploads, media or listing chat. A pending listing claim by a removed member can't
  be approved (409).
- **Creation can't race a removal:** each partner creation (centre, club, their duplicates, experience, programme,
  coupon) re-reads the creator's membership inside its transaction under a shared lock on their user row; removal
  holds the exclusive lock, so a creation either commits first and is moved to the owner, or is refused (403).
  Removal changes only the holder columns — coupon terms, usage and limits, and every other listing column, are
  unchanged.
- **Audit:** `org.staff_role_changed` (previous/new role) and `org.staff_removed` (previous membership and role; new
  state "removed"; every moved listing/coupon id and its previous holder). The member is emailed on either change.
- **Suspended organisation:** every staff-management call is refused (it goes through the same partner guard), and
  accepting a pending invite is refused.

**Re-inviting (follow-up 2026-10-15):** a removed member can be invited again with the same email; they rejoin only by
accepting the new invitation with their existing password (same account, audited `org.staff_rejoined`); a new invite
replaces earlier pending ones; any other existing account still gets 409.

**Limitations:** re-using an accepted, replaced or revoked invite link returns the existing 400 "expired or no longer
valid", not the 410 the draft named; one organisation per user, so "removal doesn't log them out of other organisations" only applies
to their separate resident identity; no ownership transfer; the admin platform-role change still has no required
reason (a D-02 follow-up).

> **Approval statement:** "Approve D-08: owner-managed role changes and removal, effective on the next request, with
> attribution kept and the owner protected."

---

## D-09 · Partner fee model, Pro and rewards — NEEDS INPUT

### What is built (verified)
- **Plans** (`commerce/catalog.ts`): Free has a 9% success fee (min €0.75) and no subscription. Pro is €29/month
  with a 7% fee (min €0.50).
- **These fees are not charged anywhere.** Settlement uses the pricing rule's success fee, which is 0%.
- **Pro subscriptions:** Stripe Billing, cancel/keep, payment failure, grace sweep (`commerce/subscriptions.ts`).
  Tested in Stripe test mode.
- **Partner points** (`commerce/rewards.ts`, switch `commerce.circle_credits`):
  - **Earning:** 1 point per €1 of settled value, awarded when a settlement is created, per order, net of refunds.
    Vendor-type settlements don't earn.
  - **Expiry:** lots expire after 18 months.
  - **Reversal:** refunds and lost disputes after settlement reverse points proportionally, and spent points become a
    points debt.
  - **Debt:** blocks redemption, and new awards repay it first.
  - **Redemption:** 10,000 points = one free Pro month (not while already on paid Pro).
  - **Value:** points have no cash value.
- **Customer credits** are separate (`commerce/credits.ts`, switch `commerce.customer_credits`).
- **Hard block:** `PARTNER_FEE_MODEL_STATUS = "proposed"` refuses Pro purchase and redemption outside tests.

**Recommendation now:** keep Pro and partner points **disabled**; leave `PARTNER_FEE_MODEL_STATUS = "proposed"`;
choose a model only after reviewing the definitions and calculations below together with D-04 part B.

### The three models, defined precisely
Let **P** = the partner's listed price for one order (in euro). VAT is **left out** of these definitions on purpose:
whether P includes VAT, and VAT on HelloCircle's own fee, are D-04 part B questions and change every line below.

| | A. Customer fee (what the code does today) | B. Partner success fee (Free / Pro plans) | C. Hybrid |
|---|---|---|---|
| Customer pays | P × (1 + c), c = customer fee rate | P | P × (1 + c′) |
| HelloCircle fee | P × c | max(P × s, minimum), s = success fee rate | P × c′ + max(P × s′, minimum′) |
| Partner receives | P | P − fee | P − max(P × s′, minimum′) |
| Rates seeded today | c = 5% | Free: s = 9%, min €0.75. Pro: s = 7%, min €0.50, + €29/month | none seeded; example below uses c′ = 2.5%, s′ = 4.5%, no minimum |

### Worked examples — ILLUSTRATIVE SCENARIOS, not verified commercial outcomes
**None of the figures below is a verified commercial outcome.** They are arithmetic on stated assumptions. Nothing
has been reconciled against a real Stripe statement, an accountant's VAT treatment, real order volumes or real
refund and dispute rates. They exist only to compare the shape of A, B and C.

**Assumptions that apply to every table below** (each table repeats any it changes):
| # | Assumption | Source / status |
|---|---|---|
| A1 | Rates: A c = 5%; B Free s = 9% (min €0.75); B Pro s = 7% (min €0.50) + €29/month; C c′ = 2.5%, s′ = 4.5%, no minimum | Seeded catalogue values (A, B); C invented for comparison. **None approved** |
| A2 | VAT ignored entirely (no VAT on price, on HelloCircle's fee, or on Stripe's fee) | Simplification; real treatment is D-04 part B |
| A3 | One payment, one standard EEA card; card fee 1.5% + €0.25 of the amount charged | Stripe Ireland public price page, 2026-10-14; **not** HelloCircle's contract |
| A4 | HelloCircle bears the card fee | Assumption (who bears it is D-04 part B) |
| A5 | No refund, no dispute, no coupon or credit, no Connect cost on this order | Simplification |
| A6 | Rounded to the cent; half-cent results may differ by €0.01 | Stripe's rounding not modelled |

**Scenario 1: one order, P = €20.00** (assumptions A1–A6)
| | A (c = 5%) | B Free (9%) | B Pro (7%) | C (2.5% + 4.5%) |
|---|---|---|---|---|
| Customer pays | €21.00 | €20.00 | €20.00 | €20.50 |
| HelloCircle fee | €1.00 | €1.80 | €1.40 | €0.50 + €0.90 = €1.40 |
| Partner receives | €20.00 | €18.20 | €18.60 (Pro subscription €29/month not allocated to this order) | €19.10 |
| Card fee (A3, A4) | €0.57 | €0.55 | €0.55 | €0.56 |
| HelloCircle after card fee | €0.43 | €1.25 | €0.85 | €0.84 |

**Scenario 2: one order, P = €5.00** (assumptions A1–A6; shows where minimum fees apply)
| | A | B Free | B Pro | C |
|---|---|---|---|---|
| Customer pays | €5.25 | €5.00 | €5.00 | €5.13 |
| HelloCircle fee | €0.25 | €0.75 (minimum applies; 9% would be €0.45) | €0.50 (minimum applies; 7% would be €0.35) | €0.13 + €0.23 = €0.36 |
| Partner receives | €5.00 | €4.25 | €4.50 | €4.77 |
| Card fee (A3, A4) | €0.33 | €0.33 | €0.33 | €0.33 |
| HelloCircle after card fee | **−€0.08** | ≈ €0.42 | ≈ €0.17 | ≈ €0.02 |

**Scenario 3: Pro break-even for one partner (model B)**
- *Assumptions:* A1 and A2; every order is above the size where the minimum fee applies (orders above about €8.33 on
  Free and €7.14 on Pro); one partner; no refunds.
- *Result:* Pro saves 9% − 7% = 2% of monthly paid sales, so it covers its €29 only above **€1,450 of paid sales a
  month** (€29 ÷ 0.02). Same formula as `proBreakEvenMinor()` in `commerce/calc.ts`. With many small orders (minimums
  applying) the break-even is different and not shown.

**Scenario 4: Connect cost for one partner in one month**
- *Assumptions:* Stripe Connect public pricing where the platform sets prices (stripe.com/ie/connect/pricing,
  2026-10-14): €2 per monthly active account plus 0.25% + €0.10 per payout; the partner is paid €500 in four weekly
  payouts of €125; no other Connect fees; not HelloCircle's contract.
- *Result:* €2 + 0.25% × €500 + 4 × €0.10 = €2 + €1.25 + €0.40 = **€3.65 that month**.

**Scenario 5: cost of partner points (model B only)**
- *Assumptions:* seeded rule values (1 point per €1 of settled sales, 10,000 points for one Pro month, 18-month
  expiry); every point is eventually redeemed (no expiry or debt); a Pro month costs HelloCircle its €29 list price in
  forgone revenue.
- *Result:* one free month after €10,000 of settled sales ≈ **0.29% of those sales**. If points expire unredeemed, the
  real cost is lower; that rate is unknown.

**Not modelled at all (each needs real data or advice):** VAT on any line; refunds (and whether Stripe returns its
card fee on refund); disputes and Stripe's dispute fee; coupons and customer credits; non-EEA or premium cards; payout
failures; HelloCircle's own operating costs.

### If model B (or C) is chosen later — rules for enabling Pro and points
- **Earning:** only on settled orders, net of refunds (existing).
- **Self-dealing:** no points on orders where the customer's email or resident account belongs to a member of the
  partner organisation (new control; card fingerprint matching is a possible later addition).
- **Redemption:** a free Pro month only, not while on paid Pro (existing).
- **Reversals and debt:** existing rules.
- **Renewal and failure:** failed renewal → past_due → grace → Free (existing sweep); cancellation keeps Pro to the end
  of the paid period.
- **Partner-facing explanation:** the /pricing page and Pro page state the model, the break-even and that points have
  no cash value; the rewards history page shows every earn, reversal and redemption (existing).

> **Approval statement:** "Keep Pro and partner points disabled. After reviewing models A, B and C — on the
> understanding that the worked examples are illustrative, not verified outcomes — and with D-04 part B tax advice,
> choose [A / B / C] with rates [ … ]."

---

## D-10 · Paid order under review and capacity — APPROVED for local implementation (2026-10-15)

### Current behaviour (verified)
- A paid Checkout event that doesn't match the **checkout agreement** (same order, same session, agreed amount and
  currency) is parked in Finance → Payment events → *Needs review*. It is never marked paid
  (`payments/checkoutAgreement.ts`).
- A pending order **holds capacity for 30 minutes** (`PENDING_HOLD_MINUTES`, `bookingIntegrity.ts`), then its place
  can be sold again.
- A confirmation after the hold re-checks capacity (`stillFits`). If the order no longer fits, it is marked paid but
  cancelled ("refund required"); no refund is issued automatically today.
- The customer sees "Your payment needs a quick check" (`paymentReview` flag).

### Recommended policy: an explicit, start-time-based deadline (no blanket hold)
For a **verified, correctly-associated payment under review** (case 1 below) the place is held until the **review
deadline**:

> **deadline D = the earlier of (a) parked time + W and (b) the offering's start S − L**
> - **W** = review window, recommended **24 hours**.
> - **L** = lead time before the start, recommended **2 hours** (enough to tell the customer before they travel).
> - All times are UTC instants; S comes from the Ireland wall-clock date/time via `irelandTime.ts`.
> - D is computed **once, when the event parks**, and stored (`review_hold_until`). It is never recomputed upward.

**Timing cases (no hold is ever created with a deadline in the past):**

| Situation at park time | Hold? | What happens immediately |
|---|---|---|
| S − L is after park time + W (start far away) | yes, until park + W | finance notified now |
| S − L is between park time and park + W (start within ~1 day) | yes, until S − L | finance notified now, marked "starts soon" |
| **Starts within L** (park time ≥ S − L, but before S) | **no** | place released; order `review_urgent`; urgent finance alert; customer: "We couldn't confirm your payment in time — our team will contact you about your payment"; never confirmed |
| **Already started** (park time ≥ S) | **no** | same as above, marked "after start"; the order can no longer be fulfilled, so it can never be confirmed |
| **No start time** (club registration, pass) | yes, until park + W | finance notified now |
| Programme / multi-session offering | S = the **first session not yet started** that the order covers; if none is left, treat as "already started" | as the matching row |

**Rescheduling can only shorten a hold, never extend it:**
- A customer can't reschedule an order whose payment is under review (409 "Your payment is still being checked").
- If a partner or host moves the session (or the venue booking a game depends on) while a hold exists, the stored
  deadline becomes **min(stored D, new S − L)**. If that is now in the past, the hold ends immediately and the order
  moves to `review_urgent` with an urgent alert, as in the table.
- Moving a session later never extends D.

**Escalation (each alert sent once, recorded so retries don't repeat it):** on park; at the halfway point to D; at
D. `review_urgent` orders get one urgent alert at park time.

**At the deadline:** the hold ends, the place is released, and the order becomes `review_expired` (still not paid).
**Expiry moves no money and never triggers a refund by itself.** The order stays on finance's list until resolved
through D-11 (or, for cases 4/4b only, the automatic refund rule below, which is evaluated on the payment event, not
on expiry).

### Cases
| Case | Payment | Participation | Capacity | Deadline | Customer sees | Resolution | Automatic refund? |
|---|---|---|---|---|---|---|---|
| 1. Verified, correctly associated, **amount or currency differs** from the agreement | under review | pending | held until the stored deadline (or not at all, per the timing table) | as above | "Your payment needs a quick check" (or the "couldn't confirm in time" message) | Finance decides; any refund is made in the Stripe Dashboard and then reconciled by D-11 recheck. **Never confirmed by override** | **No** — the mismatch itself means something is wrong; a person decides |
| 2. **Association uncertain** (unknown session, missing or contradicting metadata, no agreement and no stored session id) | not linked | none | **never held** | none | nothing (no order matched) | Finance investigates; any refund is made in Stripe and closed via D-11 | **Never** |
| 3. **Still processing / not verified** (`payment_status ≠ paid`, async methods) | pending | pending | normal 30-minute hold; for async methods the hold follows the open session until Stripe's `async_payment_succeeded` / `_failed` | — | "Confirming your payment" | Confirm on success **if** it matches the agreement; release on failure | No |
| 4. **Late but matching payment** (verified, associated, agreed amount and currency) after the hold was released | paid | confirmed **only if** availability is re-checked under lock and the place is still free | re-checked; never re-confirmed without the check | — | "Booked", or "We couldn't keep your place — your refund is on its way" | If the place is gone: paid + cancelled + refund | **Yes**, the full charged amount |
| 4b. Matching payment for a **suspended** organisation (D-01) | paid | cancelled | not consumed | — | "This provider isn't taking bookings — your refund is on its way" | paid + cancelled + refund | **Yes**, the full charged amount |
| 5. **Duplicate or replayed events** | unchanged | unchanged | unchanged | — | unchanged | Stored once; duplicates acknowledged; replay re-verifies (tested) | No |

### Automatic refund rule (exact)
Evaluated only when a **payment event** for case 4 or 4b is processed — never on review expiry, never on a timer,
never from a finance screen. A refund is issued automatically **only if all** of these hold at that moment:
1. **Verified event:** the event is signature-verified **and** the session, PaymentIntent, latest charge, that
   charge's refunds and any dispute are **re-fetched from Stripe** (stored payloads are never trusted).
2. **Verified association:** the checkout agreement (or, for sessions created before agreements existed, the order's
   stored session id) matches this order, and the session metadata agrees.
3. **Expected provider state:** the charge is `succeeded`, in the agreed currency, for the agreed amount; it is not
   disputed (no dispute object in any status); Stripe's `amount_refunded` is **0**.
4. **Recorded state agrees:** HelloCircle has no refund row for this charge (any status) and no open finance review
   for this order.
5. **Can't be fulfilled:** the place was gone when availability was re-checked under lock (case 4), or the
   organisation is suspended (case 4b).

**Concurrency and duplicates:** the order row is locked (`SELECT … FOR UPDATE`) while conditions 3–5 are checked and
the refund row is inserted with status `pending` and a unique idempotency key `auto-refund:<charge id>`; the Stripe
refund call uses the same key. A second delivery, a replay, an out-of-order event or a parallel worker finds the row
(or gets Stripe's idempotent response) and does nothing. If the Stripe call fails, the row stays `pending` with the
error and **becomes a finance review item** — it is not retried blindly with a new key.

It refunds the full amount Stripe reports as charged (equal to the agreed amount by condition 3). **In every other
situation** — any amount or currency mismatch, uncertain association, a prior partial refund, any dispute, a pending
or failed provider state, review expiry — no automatic refund is made; it goes to finance review.

### Never
- Confirm an order because an event is signed, without the agreement check.
- Let an uncertain or unverified event reserve inventory.
- Reconfirm released inventory without re-checking availability under a lock.
- Add an admin override that bypasses payment verification.

### Offering types
- **Time-slot venue bookings:** the slot is held until the deadline (start-based).
- **Seat-based offerings** (programme enrolments, experience seats, game seats): the same rule through
  `occupiesCapacitySql` / `gameSeatSql`.
- **Club registrations and passes:** window W only (no single start).
- **Linked host bookings:** a game seat under review doesn't change the venue booking the game relies on. If a venue
  booking itself is under review, the linked game shows "venue booking not confirmed yet" and can't open new paid
  joins until it is.

### Implementation
- A new indexed column `review_hold_until`, set when case 1 parks. `occupiesCapacitySql` / `gameSeatSql` include
  `review_hold_until > NOW()`.
- A sweep marks expired holds and sends the alerts.
- The case-4/4b refund goes through `refundInApp` with an idempotency key.
- W and L are server settings (env or a commercial rule), defaulting to the approved values. They're only added once
  code reads them.

### Acceptance tests
- Case 1, start 3 days away: the place is held; a competing checkout for the last place gets 409; after W it's free.
- Case 1, start 90 minutes away: no hold, order `review_urgent`, one urgent alert, customer sees the "couldn't confirm
  in time" message.
- Case 1, already started: no hold, `review_urgent`, never confirmable (a later replay can't confirm it).
- Case 1, club registration (no start): held for W exactly.
- Programme with its first session already past: S = next session; with none left → treated as already started.
- Reschedule earlier while held: deadline shrinks to new S − L; if that's past, the hold ends now with one urgent
  alert. Reschedule later: deadline unchanged. Customer reschedule of an under-review order → 409.
- Deadline passes (controlled clock): place released, `review_expired`, one alert, **no refund row, no Stripe call**.
- Alerts: exactly one per escalation point across sweeps, retries and restarts.
- Case 2: never holds, never refunds.
- Case 4: a free place → booked; a full place → paid + cancelled + exactly one refund (a replay adds none).
- Case 4 with an amount differing from the agreement → **no** automatic refund (it's case 1).
- Case 4 where Stripe already shows a partial refund, or a dispute → no automatic refund; finance item created.
- Case 4 with two concurrent deliveries (and with an out-of-order replay) → exactly one refund row and one Stripe
  refund call.
- Stripe refund call fails → refund row `pending` with the error, finance item created, no second attempt with a new
  key.
- Concurrency: a last-place checkout racing a case-1 park gives exactly one success.
- A replay never confirms a mismatch.

> **Approval statement:** "Approve D-10: no blanket hold; a verified, correctly-associated payment under review keeps
> its place until a stored deadline — the earlier of [24] hours after flagging and [2] hours before the start ([24]
> hours where there's no start); no hold and immediate escalation when that deadline is already past; rescheduling can
> only shorten it; review expiry never refunds; automatic refunds only for cases 4 and 4b under all five preconditions
> above, with concurrency protection; uncertain payments never hold or refund."

---

## D-11 · Closing a reviewed payment after an external refund — APPROVED for local implementation (2026-10-15)

### Current behaviour (verified)
- The only action on a parked event is **Replay**, which re-checks the same agreement, so a genuine mismatch can't
  be confirmed (by design).
- A refund made in the Stripe Dashboard sends `charge.refunded`. That event **also parks** ("No payment record…
  needs manual matching") because the order was never marked paid.
- Both events stay in review and the order stays `pending` indefinitely. There is no close-out.

### Recommended workflow: "Recheck with Stripe" (finance, audited, reason required)
1. **Inputs:** the parked event (or the order) and its checkout session.
2. **Server action (reads only — the recheck never creates a refund or moves money):**
   - Claim the event for processing (same atomic `failed/manual_review → processing` claim as Replay), so two finance
     users can't run it at once; the second gets 409.
   - Re-fetch the session, PaymentIntent, latest charge, **all** of that charge's refunds and any dispute **from
     Stripe** (never from stored payloads). A provider error leaves the event unchanged with the error shown; no
     partial writes.
   - Verify that the session belongs to this order (agreement or stored session id), the session metadata agrees, and
     the charge currency matches the agreement.
   - Reconcile refunds: for each Stripe refund not yet recorded, insert it keyed by its provider refund id (unique);
     update the status of ones already recorded; never create one Stripe doesn't show.
   - Compute the totals **from Stripe**: charged amount, sum of `succeeded` refunds, sum of `pending` refunds, dispute
     state.
3. **Outcomes:**

| Stripe shows | Recorded outcome | Order | Capacity | Review |
|---|---|---|---|---|
| Charge refunded in full, refund `succeeded` | refund row (origin `provider`, provider refund id); no payment marked paid; ledger: payment received + refund (net zero) | `payment_status = 'refunded'` (corrected 2026-10-15 — was `failed`), status `cancelled` (not fulfilled, never restored) | released | **closed** (`resolved`) |
| Refund `pending` | refund row `pending` | unchanged | unchanged | stays open; re-check later |
| Refund `failed` / `canceled` | refund row with that status | unchanged | unchanged | stays open |
| Partial refund(s), including earlier ones | one row per provider refund | unchanged | unchanged | stays open (the rest is still unresolved) |
| Full refund reached through several partial refunds, all `succeeded`, no dispute | rows for each | as for a full refund | released | **closed** |
| No refund, charge succeeded | nothing new | unchanged | unchanged | stays open; finance must refund or escalate |
| Dispute exists (any status), even if also refunded | dispute recorded (existing path) | unchanged | unchanged | stays open; dispute flow takes over |
| Association can't be verified | nothing recorded | unchanged | unchanged | stays open; flagged "association unverified" |

**Closure rule:** the review closes only if association is verified, Stripe's succeeded refunds equal the charged
amount, no refund is pending, and no dispute exists. Anything else leaves it open with the reason shown.

- **Idempotent:** keyed by provider refund id. Webhooks that arrive later or out of order find the rows already
  there and do nothing. Running the recheck twice records nothing new.
- **Never** restores a booking when a refund is found, never marks anything paid, never edits the database by hand.
- **Customer:**
  - the confirmation page shows "Payment didn't go through — your refund of €X was issued on <date>";
  - email: the existing refund notification.
- **Audit:** `payment.review_rechecked` with actor, event id, provider ids, outcome, reason and timestamps.

### Data and API
- Event status `resolved`, plus `resolved_at` and `resolution` on `webhook_events`.
- `POST /api/admin/finance/webhooks/:id/recheck {reason}`, finance or super only.
- The payment-event record page gets **Recheck with Stripe** next to Replay.

### Acceptance tests (Stripe test mode)
- **Full refund:** create a mismatched paid session, park it, refund in Stripe, recheck. The event is resolved, the
  order is failed and cancelled, a refund row exists, the ledger balances, and a second recheck is a no-op.
- **Partial refund:** the event stays open. **Two partial refunds summing to the charge:** closes; a third recheck is a
  no-op.
- **Disputed and refunded:** stays open.
- **Two finance users recheck at once:** one runs, the other gets 409; one set of rows.
- **Provider error mid-recheck:** nothing written; event unchanged; error shown.
- **The recheck never calls Stripe's refund-create API** (asserted with a provider spy).
- **Pending refund:** the event stays open, and it resolves after the refund succeeds and the recheck runs again.
- **Webhook before recheck:** one refund row in total.
- **Wrong role:** 403.

> **Approval statement:** "Approve D-11: a finance-only, audited 'Recheck with Stripe' that re-reads the payment and
> refunds from Stripe and closes a review only when the verified financial outcome supports it (e.g. a successful full
> refund); it never marks anything paid, never refunds by itself and never restores the booking."

### Implementation record (D-10 and D-11, 2026-10-15, local, uncommitted)

**Status:** approved for local implementation · implemented locally · **verified locally** (unit, stub QA, browser and Stripe test-mode batches, and one clean uninterrupted `qa:stripe` run on final code, 51/51 — `hellocircle-d10-d11-validation.md` §3) · not deployed. Evidence:
`hellocircle-d10-d11-validation.md`.

**Owner boundaries applied** (approval message of 2026-10-15): record verified receipt durably even when the booking
can't be confirmed; keep provider payment, booking, capacity and review status separate; Finance finds the payment
without the raw event log; no duplicate financial records; never label a charged customer unpaid; no transaction held
across a provider call; uncertain provider answers go to reconciliation, never a blind second refund; no verification
override; recheck reads only and never restores a booking; dedicated pages and centred confirmations.

**What was built:**
- **Payment review record** (`payment_reviews`, `payments/paymentReview.ts`): one per Checkout session that couldn't
  simply confirm — received amount and currency, agreed amount, payment intent, charge, reason, capacity hold
  (`hold_status`, deadline), urgency, automatic-refund state, review status and resolution, recheck history. The
  order row keeps its own status; the review is the finance record of the money.
- **D-10 deadline:** `review_hold_until` on bookings, registrations, programme enrolments, experience bookings and
  activity seats, counted by `occupiesCapacitySql` / `gameSeatSql`. D = min(flagged + W, S − L), stored once (W 24 h,
  L 2 h; `PAYMENT_REVIEW_WINDOW_HOURS` / `PAYMENT_REVIEW_LEAD_HOURS` apply to new reviews only; W = 0 = new reviews hold no place — not a rollback). No hold within L or after the
  start (urgent alert). No start (registrations, passes) → W. Programmes: S = the earliest session not yet started;
  part-way flagged for a person. A hold is only created while the order still fits (never takes back a resold
  place), under the same parent-row lock as checkout.
- **Rescheduling only shortens:** activity date/time edits and new programme sessions apply min(D, new S − L); past →
  the hold ends now with an urgent alert. A customer can't reschedule a booking under review (409).
- **Sweep** (startup + every 5 minutes, restart-safe): halfway and expiry alerts, `hold_status = expired` (place
  released, review stays open, **no refund, no provider call**); automatic refunds left without a provider answer for
  10 minutes become `unknown` (alert, never re-sent).
- **Alerts:** `payment_review_alerts` unique per (review, kind); in-app notifications to finance and super admins in
  the same transaction as the claim; email best-effort.
- **Confirmation re-checks** at the moment of confirmation: organisation status, the order's own cancellation,
  recorded refunds, (for a payment that was held) the provider's refund/dispute state, listing eligibility, start
  time and — once its hold lapsed — capacity. Only `pending` orders settle, so a replay can't resurrect a cancelled or
  refunded order.
- **Automatic refund (cases 4 and 4b only)** — all five preconditions re-proved: provider re-read (session, payment
  intent, charge, every refund, disputes); association; charge succeeded for the agreed amount and currency, nothing
  refunded, no dispute; no refund row for the order and no *other* open review; unfulfillable re-checked under the
  order lock. Refund row (`auto-refund:<charge>`, unique) committed before the provider call; call made outside any
  transaction with the same idempotency key and a timeout (`PAYMENT_REFUND_TIMEOUT_MS`); refused → `failed`;
  no answer → `unknown`; both alert finance and are never retried. Switch `commerce.auto_refund_unfulfillable`
  (default on; off stops new automatic refunds only — in-flight, unknown and completed refunds are still reconciled; containment and rollback: `hellocircle-d10-d11-validation.md` §1a–1b).
- **D-11 Recheck with Stripe** (`POST /api/admin/finance/payment-reviews/:id/recheck`, also from a payment event;
  `finance.operate` = finance or super; reason required; audited `payment.review_rechecked`): atomic claim (second →
  409), provider reads only, refunds recorded by provider id (our own found by their key), statuses updated, closes
  only when association is verified, succeeded refunds = the charge, nothing pending and no dispute. Closing marks
  the order `refunded` + `cancelled` (not restored), releases the place and its coupon hold, resolves its parked
  events and emails the customer once. A provider error writes nothing.
- **UI:** Finance → Payment reviews (list, urgent first) and a review page (money, deadline and booking, Stripe
  references, refunds, events, investigation history, centred "Recheck with Stripe" confirmation). Customer
  confirmation page states: needs a check / couldn't confirm in time / place no longer held / refund on its way /
  refunded on <date> / couldn't keep your place — never "not found" or "not paid" for a received payment.

**Interpretations (where the spec left a choice):**
1. "review_urgent / review_expired" are review states (`urgency`, `hold_status`), not new order statuses — the five
   participation tables keep their status meanings.
2. A D-11 closure sets `payment_status = 'refunded'` (the spec said `failed`), per the boundary "never label a charged
   customer unpaid".
3. Precondition 4 ("no open review") excludes the current case's own review, so a reviewed order isn't permanently
   ineligible; any *other* open review for the order blocks the refund.
4. Case 4b with the refund made: paid + cancelled + refunded. Without it (switch off, or a precondition fails): D-01's
   pending + parked, so reinstatement and redelivery can still confirm after every re-check.
5. Other unfulfillable matches (listing no longer sellable, after the start, programme part-way, order already
   cancelled, a refund or dispute already on the payment): received, paid + cancelled, finance review; no automatic
   refund (not an approved case).
6. Recheck closure checks association (session, metadata, agreement or stored session) and that refunds are in the
   charge's currency; the agreed-currency check applies to automatic refunds, so a currency-mismatch case can still
   be closed once fully refunded.
7. Passes: no place to hold, never activated while held, no automatic refund (pass refunds aren't supported).

**Open (not decided here):** confirming a part-way programme enrolment after a person decides it's eligible has no
path (there is deliberately no override); linked activities on a venue booking under review are not specially
labelled ("venue booking not confirmed yet" in §D-10 *Offering types*).

---

## External configuration (not decisions)

- **Stripe Connect payouts — one manual hosted onboarding (BLOCKED until a person does it).** Automated tests create
  verified test accounts through the API. Stripe's hosted onboarding page shows an hCaptcha, which must not be
  bypassed, so a person completes it once in **test mode**:
  1. Run the app locally against `hello_circle_dev` (never `hello_circle`) or the QA stack with Stripe **test** keys
     (`sk_test_…`). Set `CLIENT_URL` to the URL you browse. Switch on `commerce.connect_v1` in Admin → Commercial
     rules → Switches *in that environment only*.
  2. Sign in as a partner **owner**. Go to Partner workspace → Earnings → **Payouts** section → Payout account →
     **Set up payouts with Stripe**.
  3. Complete Stripe's pages with Stripe's documented test values and solve the hCaptcha yourself.
  4. Check on return:
     - the card shows *Under review* or *Ready*;
     - `connected_accounts.onboarding_returned_at` is set;
     - once transfers are active, *Open Stripe dashboard* works.
  5. Re-run `QA_ONLY_BATCH=stripe-sandbox-connect npm run qa:stripe` and
     `QA_ONLY_BATCH=revenue-partner npm run qa:revenue`.

  Separately, confirm Connect settings in the Stripe Dashboard (Express dashboard, recipient configuration,
  branding) before enabling `commerce.connect_v1` anywhere real.
- **Error reporting:** optionally set `ERROR_REPORT_WEBHOOK_URL`.

## Sources checked for external claims (2026-10-14)
- DSA structure (Art. 17 in Chapter III, Section 2; Art. 19 exemption covers Section 3):
  [interface-eu.org DSA overview](https://interface-eu.org/storage/pdf/dsa_article_overview.pdf),
  [Presencis: DSA Art. 19](https://presencis.com/regulations/dsa/article-19/). Confirm with counsel against the
  Official Journal text.
- Six-year record retention: [Revenue — how long to keep records](https://www.revenue.ie/en/vat/vat-records-invoices-credit-notes/vat-records-to-be-kept/how-long-keep-records.aspx),
  [Revenue — keeping records](https://www.revenue.ie/en/starting-a-business/starting-a-business/keeping-records.aspx).
- Stripe fees: [Stripe Ireland pricing](https://stripe.com/ie/pricing), [Stripe Connect pricing](https://stripe.com/ie/connect/pricing).
