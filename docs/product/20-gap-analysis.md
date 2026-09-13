# Document 20 — Product Gap Analysis

Every gap below was found in the existing implementation by the discovery passes — nothing here is a feature request.

## CRITICAL — workflow cannot function correctly

### Program enrollments cannot be self-cancelled
- **Evidence:** No cancel/refund route exists anywhere in `server/src/routes/programs.ts` — enrollments have a `status` column but nothing in this router ever sets it to `cancelled`.
- **Affected user:** Any resident/guest enrolled in a paid, multi-week program
- **Affected flow:** Program Enrollment (Documents 04, 08)
- **Business impact:** A resident who needs to withdraw has no self-service path — pure support burden, and a real trust problem for a paid, multi-week commitment
- **Recommended resolution:** Add a `POST /programs/:id/enrollments/:ref/cancel` mirroring the existing bookings/registrations cancel pattern (ownership check, status flip, notification)

## HIGH — major UX/business issue

### Game `visibility` is stored but never enforced
- **Evidence:** `games.visibility` ∈ public/circle/invite is set at creation but no join-path query in `games.ts` restricts joining based on it.
- **Affected user:** A host who creates a "circle-only" or "invite-only" game expecting privacy
- **Business impact:** A stated privacy/audience control silently does nothing — anyone who finds the game's id can join a game the host believed was restricted
- **Recommended resolution:** Enforce `visibility` in the join handler: for `circle`, require joiner to be a member of `games.circle_id`; for `invite`, require a matching invite record

### No refund automation anywhere in the payment path
- **Evidence:** Grep for "refund" across `server/src` hits only comments explaining it's off-platform; no Stripe Refunds API call exists
- **Affected flow:** Every cancellation across bookings/registrations/games/vendor-side ops
- **Business impact:** Manual, per-case financial operations at any real transaction volume; deposits are marketed as "refundable" with no automated mechanism behind that promise
- **Recommended resolution:** Wire `stripe.refunds.create()` into the cancellation paths, at least for the deposit portion first

### Payment failure has no resident-facing notification
- **Evidence:** `markFailed()` flips a DB status; no notification call site was found for a failed/expired checkout session
- **Business impact:** A guest whose card is declined or session expires may believe they have a confirmed spot until they check back
- **Recommended resolution:** Add an email/in-app notification on `async_payment_failed`/`expired`, mirroring the existing confirm-path notification pattern

### Invited staff can read full org data regardless of role
- **Evidence:** Every `GET` in the vendor sub-routers is reachable by any org member past `requireVendor`+`attachVendorIds` — writes are role-scoped, reads are not
- **Business impact:** A `read_only_analyst` or `communications` hire can see the same booking/registration/notification data as the owner — a data-exposure risk depending on the org's actual trust model, which the product hasn't stated
- **Recommended resolution:** Decide the intended policy explicitly (this may be fine for `read_only_analyst` by design), then scope reads by role for any staffer not meant to see org-wide operational data

### Pass credit not restored on registration cancellation
- **Evidence:** No `credits_used = credits_used - 1` statement exists anywhere in the codebase
- **Business impact:** A resident loses a paid credit permanently if the resulting registration is later cancelled — a direct financial loss to the customer
- **Recommended resolution:** Restore the credit as part of the registration-cancel transaction when `pass_id` is set

## MEDIUM — product improvement required

### Program per-session capacity field exists but isn't enforced
- **Evidence:** `program_sessions.capacity` is present in the schema/response but the enroll route only checks program-level capacity
- **Business impact:** A program could oversell a specific session even while under its overall cap

### Two independent 5-tab bottom-nav implementations
- **Evidence:** `client/src/components/MobileTabBar.tsx` (CSS-breakpoint-gated on web) and the native Expo-router tab layout in `apps/mobile` implement the same 5-tab IA concept independently
- **Business impact:** Every future nav change (add/remove/reorder a tab) has to be made twice, and the two can silently drift
- **Recommended resolution:** Not urgent to unify given the different rendering targets — but worth a shared spec/config the two read from, rather than two hand-maintained lists

### No session-level waitlist for club sessions
- **Evidence:** Waitlist machinery exists for the club overall; per-session opt-in registrations have no equivalent
- **Note:** Documented in-code as an accepted, deliberate gap — included here for completeness, not as a surprise finding

## LOW — polish/optimization

### RBAC style inconsistency in `vendorExperiences.ts`
- **Evidence:** Uses a role-*group* constant (`EXPERIENCE_ROLES`) where every other vendor sub-router spells out one role per route

### Review moderation split across two files
- **Evidence:** Creation/deletion in `reviews.ts`, unhide in `admin.ts`

### `manage.ts` straddles both identity systems
- **Evidence:** The one router reading both `req.user` and `req.resident` in the same file — every other router picks one system
- **Recommended resolution:** Worth extra care on any future identity-boundary audit; not a bug today

### `centres.org_id`/`clubs.org_id` are unused isolation scaffolding
- **Evidence:** Present in the schema, not yet load-bearing for any query traced in this audit

## Carried-over platform gaps (from CLAUDE.md, confirmed still true)

- No CI, and the Vitest suites are thin — no automated safety net for checkout/cancellation paths beyond a handful of server tests
- In-memory rate limiter resets on process restart and won't survive a multi-instance deploy
- CORS reflects any origin (`origin:true`) — fine for the current same-origin deploy, a real risk if that ever changes
- Resident `interests`/`availability`/`goals` are comma-joined TEXT, not structured — fine for display, not a foundation for real personalization beyond keyword matching
- The five participant tables remain unmerged — a deliberate, accepted tradeoff, not a bug (see [Doc 11](11-data-domain-model.md))

---
[← Edge Cases](19-edge-cases.md) · [Next: Traceability Matrix →](21-traceability-matrix.md)
