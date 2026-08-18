# Hello Circle — Roles & Flows

> Supersedes the pre-MySQL-migration version of this doc, which described a 3-role, no-accounts-for-guests
> model. That model still exists underneath, but it's one of three parallel identity systems now — see §1.
> This version reflects the codebase as of the `v4-0` branch: residents, households, organisations/RBAC,
> Games, Circles, Programs, and Passes all exist and are live, not just planned.

---

## 1. Identity — three systems, not one

There is no single "logged in user" concept. Three independent identity/session systems coexist, each
populated by its own Express middleware on every request (`attachUser` → `attachGuestEmail` →
`attachResident`, in that order, in `server/src/index.ts`):

| System | Table | Session | Who | Needs account? |
|---|---|---|---|---|
| `req.user` | `users` | `hello_circle_session` cookie, password + bcrypt | Vendor, Admin | Yes |
| `req.resident` | `residents` | `hello_circle_guest_session` cookie, magic-link email | Anyone browsing/participating as themselves | Passwordless — just a verified email |
| anonymous | *(none)* | `X-Client-Id` header, random id in `localStorage` | Anyone booking/registering without signing in at all | No |

A pure guest (no magic-link sign-in ever) still works exactly like the original MVP: browse, book a room,
register for a club, "My bookings" scoped entirely by the anonymous client id. A **resident** is a step up
from that — a verified email (via a magic link, no password) that unlocks household members, favourites,
receipts across every payment path, Games, Circles, and Passes. A resident's bookings/registrations
additionally get `resident_id` set alongside the client id, but the two are not retroactively merged — a
booking made as a pure guest before ever signing in with the same email will not automatically show up under
the resident account afterwards.

**Vendor and Admin are unrelated to residents entirely** — a `users` row, not a `residents` row, with its own
password and session cookie. Nobody is ever both at once through the same account.

---

## 2. Resident / guest flow

- Browse centres/clubs/games/circles/programs, view details, book a room, register for a club, join or host
  a Game, join or create a Circle, enroll in a Program — all guest-accessible, no login required for the
  transactional core (booking/registering/joining).
- **Sign in via magic link** (optional, not required to book): enter an email, get a one-time link, click it
  → verified → a `residents` row is found-or-created for that email (`findOrCreateResident()` in
  `server/src/residents.ts`) and a 30-day session cookie is issued. No password, ever, for this identity.
- Once signed in as a resident, unlocks:
  - **Household members** — add children/dependents (name, DOB, notes) to book/register on their behalf
    from one account, rather than re-entering child details every time.
  - **Favourites** — save a centre/club for later.
  - **Receipts** — one unified view across all four paid participation types (bookings, registrations, game
    joins, passes) via `GET /residents/me/receipts`, since there's no single shared payments table.
  - **Onboarding preferences** (signal-only today) — home county, search radius, interests, availability.
    Skippable at every step; nothing here is ever required to keep using the app, and it doesn't yet drive
    any real personalization (see CLAUDE.md's "Known gaps").
  - **Resident notifications** — booking/registration/game/waitlist updates, in-app + email.
  - **Games** — host an ad-hoc game (free or, for a priced one, via the same Stripe checkout path everything
    else uses) or join one someone else hosted, subject to capacity (row-locked to prevent overbooking the
    last spot) and an optional waitlist.
  - **Circles** — create or join a persistent group anchored to a recurring activity (e.g. "Sunday
    Runners"). Deliberately not a social feed: no posts/likes, just membership plus upcoming Games that match
    the Circle's activity label and area.
  - **Passes** — pre-purchase a credit pack for a specific club at its per-registration price.
- **Leave a rating + review** on a centre/club — no login needed, but only after actually booking that centre
  or registering for that club (checked server-side, either against the resident id if signed in or the
  `X-Client-Id` header if not). Anyone can still read reviews without having booked. See §6.
- Never sees vendor or admin screens.

---

## 3. Vendor flow

**Sign up / login**
- Vendor registers with email + password, picks "I run a centre" or "I run a club" — this only determines
  their *first* listing's type; it is not a hard boundary. A vendor can go on to manage both a centre and a
  club from the same account (`ListingsTab` in `VendorDashboard.tsx` shows both sections; claiming an
  unclaimed listing of the other type via `POST /vendor/claims` is allowed regardless of the account's
  original type).
- New vendor accounts start `pending` until an admin approves them (prevents randoms from listing fake
  venues). Signup creates the user row **and** a pending draft listing **and** a new 1:1 organisation, all in
  one DB transaction (`routes/auth.ts`) — there's no separate "create your listing" step after approval.

**Organisations, staff, and RBAC** (real and enforced, not just stored)
- Every vendor belongs to an organisation (`org_id`) — created 1:1 at signup, or backfilled 1:1 for any
  vendor that predates this. "Your own listings" means every listing owned by *any* user in your org, not
  just your own user id (`orgVendorIds()`/`attachVendorIds` in `server/src/auth.ts`).
- The org **owner** (the vendor who signed up and was never invited — `invitedStaff = false`) has full,
  unrestricted access to everything the org owns, same as a solo vendor always has.
- The owner can **invite staff** (`routes/org.ts`, `client/src/components/VendorOrg.tsx`) by email, assigning
  one of five platform roles: `centre_manager`, `facility_manager`, `finance`, `communications`,
  `read_only_analyst`. An invited staff member's access is narrowed to only what their assigned role permits
  — e.g. `finance` can view payments/CSV exports but a `centre_manager` cannot, a `facility_manager` can
  manage club sessions but not centre rooms/hours. Check `requirePlatformRole(...)` usage across
  `server/src/routes/*.ts` for the current, real enforcement surface — it has grown past its original pilot
  endpoint and keeps growing, don't assume a specific route is or isn't gated without checking.
- The owner also sets **org-wide policies** (cancellation-hours cutoff, booking-window days) that override
  the platform default for their organisation's own bookings.

**Vendor dashboard** (only sees their own org's listings)
- **Create/edit/delete** a Centre or Club listing (name, area/county, blurb, amenities/includes, pricing,
  capacity/ages, phone, photos).
- **Rooms** (Centre only) — any number of named, independently priced/capacitied rooms per centre; a centre
  always keeps at least one active room.
- **Programs** — a generalized multi-session activity (e.g. an 8-week course), attached to either a centre
  or a club, with its own sessions/instructor/capacity/pricing, separate from one-off room bookings or
  ongoing club registration.
- **Recurring club sessions** — a weekly schedule attached to a club (read/manage only; not yet required by
  the registration checkout itself).
- **View bookings/registrations/program enrollments** made against their own org's listings — contact info,
  date/time, participant count, payment status. No visibility into another org's data.
- **Messages** — a lightweight, targeted message composer to guests who've booked/registered, plus an inbox
  of new-booking/registration notifications.
- **Demand intelligence** — zero-result search queries in their county/category, as a signal for what to add
  next.
- New listings (and status-changing edits) go in as `pending` until admin approves.
- **See reviews** left on their own listings (read-only — can't edit or delete a guest's review, only flag it
  for admin if it's abusive/spam).

**What a vendor can never do**
- See or touch another organisation's listings, bookings, staff, or account (regardless of platform role).
- Approve their own listing.
- Access platform-wide data (all vendors, all bookings, revenue totals) — that's Admin-only.

---

## 4. Admin flow

**Login**
- Admin accounts are seeded/created directly (`admin@hellocircle.ie` by default), separate from vendor
  accounts — there's no public admin signup.

**Admin dashboard** (`AdminDashboard.tsx` / `routes/admin.ts`)
- **Vendor management**: view all vendor accounts, approve/reject new signups, suspend a vendor.
- **Listing moderation**: queue of pending Centres/Clubs awaiting approval; approve, reject with a reason.
- **Full CRUD on everything**: create/edit/delete any Centre or Club, including ones owned by a vendor.
- **Claims**: approve/reject a vendor's request to take ownership of an unclaimed (seeded) listing.
- **Organisations**: create organisations, (re)assign a listing's owning organisation, assign a vendor's
  `platform_role` and provider tier (standard/verified/featured).
- **Coupons**: create/manage discount codes.
- **Reviews**: hide/unhide a review (spam, abuse), across any listing.
- **Moderation reports**: review reports filed against any listing.
- **Demand intelligence** (platform-wide, unlike the vendor-scoped view): every zero-result search, not just
  one org's.
- **Audit log**: a forward-only trail of moderation/org-management actions (`writeAudit()` — best-effort,
  wired into vendor status changes, org/staff changes, and moderation actions so far, not yet everywhere).
- **Support search**: look up a booking/registration/user by ref or email for support purposes.
- Everything a vendor can do, for every organisation's listings, plus the approve/reject/suspend/RBAC actions
  vendors don't get.

**A note on history**: a separate "Platform Admin" page (`/platform-admin`, `pages/PlatformAdmin.tsx`,
`routes/platformAdmin.ts`) used to exist alongside this as its own persona/route for cross-tenant
stats/moderation/audit. It has been **removed** — that functionality was folded directly into
`AdminDashboard.tsx`/`routes/admin.ts` above. There is no third admin-adjacent role; `admin` covers all of it.

---

## 5. Data model, as it actually stands

- `users` — vendor/admin accounts. Gained since the original MVP: `org_id`, `platform_role`, `invited_staff`,
  `provider_tier`.
- `centres`/`clubs` — `vendorId`, `orgId`, `status (pending|approved|rejected)`.
- `rooms` — independently bookable spaces under a centre, checked against the centre's `vendorId` (via
  `orgVendorIds`) for ownership on every write.
- `residents` — passwordless identity, keyed on verified email. Not a `users` row.
- `household_members`, `favourites`, `passes` — all scoped to `residents.id`.
- `games`/`game_participants`, `circles`/`circle_members` — ad-hoc and persistent community participation,
  independent of the booking/registration tables.
- `programs`/`program_sessions`/`program_enrollments` — the generalized multi-session activity model,
  deliberately parallel to (not a migration of) `bookings`/`registrations`.
- `organisations`/`org_invites`/`org_policies` — real multi-tenant scaffolding, actively used (see §3), not
  dormant.
- `notifications` — shared table for both vendor/admin (`recipient_id`) and resident (`resident_id`)
  notifications.
- `reviews` — `id, listingType (centre|club), listingId, clientId, name, rating (1-5), comment, createdAt,
  hidden (bool)`. The rating/review count shown anywhere is **always computed live** from this table
  (`reviewStats()` in `server/src/db/queries.ts`) — never a static stored number.
- Real file upload (`/api/uploads`, Multer, mimetype-derived extension to prevent spoofing) replaced the
  original plain `image: string` hotlinked-stock-photo field.
- **Still no messaging/inbox feature** in the original sense this doc used to describe (guest↔vendor
  back-and-forth) — vendors can send a one-way targeted message to a guest who's booked/registered
  (`routes/vendor.ts` `/messages`), but there's no threaded reply.

---

## 6. Ratings & reviews (verified stay required)

- A guest can leave a star rating (1–5) + comment on a centre or club, but **only after they've actually
  booked that centre or registered for that club** — checked server-side against a real
  `bookings`/`registrations` row, matched by resident id if signed in or `X-Client-Id` if not. Anyone can
  still browse and read reviews without having booked; only *posting* one is gated.
- The rating shown on every card/detail page is fully computed live from real submitted reviews (average +
  count) — listings with zero reviews show "no reviews yet" rather than a fake number.
- Admin can hide/unhide a review (moderation); vendors can flag one for admin but not remove it themselves.

---

## 7. Open questions still unresolved

1. Do vendor **edits** to an already-approved listing need re-approval, or only brand-new listings? (Still
   unresolved — currently no re-approval step exists for edits.)
2. When a vendor is suspended, do their listings disappear immediately, or stay visible with existing
   bookings honored? (Currently: suspension doesn't automatically hide their listings.)
3. Should a pure guest's pre-sign-in bookings/registrations be retroactively linked to a resident account
   once they verify the same email via magic link? (Currently: no, they stay separate — see §1.)
4. The five participant-tracking tables (`bookings`, `registrations`, `program_enrollments`,
   `game_participants`, `circle_members`) are not unified into one Activity/Session/Enrollment shape — see
   CLAUDE.md's "Known gaps." Any real fix here is a deliberate, large migration, not something to attempt as
   a side effect of an unrelated change.
