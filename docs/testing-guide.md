# Hello Circle — Manual Testing Guide

A hands-on walkthrough for testing every role in the app yourself, including the HelloCircle Manage layer
(workspace switching, Host MVP, Circle Organiser MVP, the Venue Manager surfaces). Pairs with
`docs/roles-and-flows.md`, which explains *what* each role can do and *why* — this doc is just the *how do I
click through it myself* reference.

## Before you start

```bash
npm run dev          # API on :3001 + client on :5173 (root script)
```

Requires a running MySQL/MariaDB with `hello_circle_dev` already created and seeded — see the root
`CLAUDE.md` for first-run setup. To reset back to a clean demo state at any point:

```bash
npm run reset-demo --workspace server
```

All test accounts below already exist in the seeded demo data — you don't need to create anything to start
testing.

---

## Test accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@hellocircle.ie` | `changeme123` | Seeded on first run; override via `HELLO_CIRCLE_ADMIN_EMAIL`/`_PASSWORD` |
| Vendor (linked) | `testvendor-formpage@hellocircle.ie` | `TestPassword123!` | Owns "Test Community Centre" + several other test listings. **Linked** to the resident below — see "The fast path" |
| Resident (linked, host + organiser) | `aoife.byrne.1@hellocircle-demo.ie` | *(passwordless — magic link only)* | Hosts several Games; organises "Dublin Five-a-side Football Circle" |

Residents never have a password — see §2 below for the real magic-link flow, or use the shortcut in the next
section to skip it entirely for this session's testing.

### The fast path — one login, every surface

Because the vendor and resident accounts above are already linked (via the real linking flow — see
`docs/roles-and-flows.md` §7), you can reach **every** role except Admin from a single login:

1. Go to `/login`, sign in as the vendor (`testvendor-formpage@hellocircle.ie` / `TestPassword123!`).
2. You land on `/vendor` — the Venue Manager dashboard. Open the account menu here and you'll only see
   **Personal** (plus the usual My Life/Vendor dashboard/Log out) — the Activities/Circle entries below only
   appear once you're actually viewing as the resident, not from the vendor's own menu.
3. Click **Personal** — switches into the linked resident session, no re-login, lands you on `/bookings`.
4. Open the account menu again (now from the resident side). You'll see the full set:
   - **Vendor dashboard** (or the business name) — switches straight back, no re-login either.
   - **Activities** — jumps to `/manage/activities` (this resident's hosted Games).
   - **Manage Dublin Five-a-side Football Circle** — jumps to `/manage/circles/:id` for the Circle this
     resident organises.

(A bug was found and fixed here during testing: switching to Personal used to leave the header's own `user`
state stale, so Activities/Manage-Circle would never appear afterward — not even after a hard reload — since
the vendor session cookie stays valid on purpose so you can switch back. Fixed by keying the workspace-entry
fetch off "is this resident the one linked to my own vendor account" rather than "is there no vendor session
at all.")

This is the quickest way to sanity-check the whole cross-identity layer in one sitting. The step-by-step
sections below still walk through each surface on its own, in case you want to test a role in isolation or
via the "real" flow (e.g. an actual magic-link sign-in) rather than the switcher.

---

## 1. Guest (no account at all)

The transactional core works with zero login — this is the baseline to check first since everything else
builds on it.

1. Open an incognito/private window (so no `X-Client-Id` or cookies carry over from other testing) and go to
   `/`.
2. Browse `Explore → Community centres`, open any centre, click **Book**, pick a room/date/time, fill in your
   name/email/phone, and complete the booking (cash-pay rooms confirm immediately; card-pay rooms go through
   Stripe test checkout if `STRIPE_SECRET_KEY` is configured, otherwise checkout returns a 503 and nothing
   else breaks).
3. Go to `/bookings` — your booking should show up, scoped purely by the anonymous client id `localStorage`
   just generated for you (no login happened).
4. Repeat for a club: `Explore → Sports clubs → [a club] → Register`.
5. Try to leave a review on a centre/club you have **not** booked — it should be blocked. Leave one on a
   centre/club you **did** just book — it should succeed and appear on the listing immediately.

## 2. Resident (magic-link sign-in)

1. Go to `/signin`, enter any email (a brand-new one, or an existing demo resident's).
2. Click "Email me a link." **Without SMTP configured** (the dev default), the email isn't actually sent —
   instead, check the terminal running `npm run dev`'s server process for a line starting `[email:dev]`,
   which prints the full link text including the token.
3. Paste that link's URL into the browser (or copy the token into `/signin/email-link?token=...`) to
   complete sign-in.
4. Once signed in, check: `/bookings` (your participation history), adding a household member, favouriting a
   centre, and the notification bell in the header (empty for a brand-new resident — that's expected).

If you used one of the seeded demo emails (e.g. `aoife.byrne.1@hellocircle-demo.ie`) instead of a fresh one,
you'll land on an account with real seeded history — useful for testing "existing resident" states rather
than "brand new" ones.

## 3. Host (a resident who hosts Games)

Using the resident from the fast path (`aoife.byrne.1@hellocircle-demo.ie`, reached via **Personal** from the
vendor login, or via your own magic-link resident):

1. **Create a game**: from anywhere, use the header's `+` (Create) menu → "Start a game" (lands on `/games`,
   with a "Host a game" button there), or go to `/games/host` directly. Fill in the two-step form (Basics,
   then Details) and submit — you land on the new game's own detail page.
2. **Manage it**: go to `/manage/activities` (via the account menu's **Activities** entry, or directly). You
   should see every game you host, split into Upcoming and Past & cancelled.
3. On a live row, try each action:
   - **Edit** → opens `/games/host/:id` pre-filled with the game's current details. Change the date/time and
     save — if anyone else has joined, they should get a notification (check their own notification bell, or
     the `notifications` table directly).
   - **Participants** → opens a drawer listing everyone joined, with a **Remove** button per person (not
     shown for yourself). Removing someone frees their spot and notifies them.
   - **Post update** → posts a short announcement, notifying every joined participant.
   - **Cancel** → confirms, then cancels the game and notifies everyone joined.
4. Confirm the game's own public page (`/games/:id`) still has its original Cancel button / "post an update"
   box too — those weren't removed, just supplemented by the Manage page.

## 4. Circle Organiser

Using the same resident (organiser of "Dublin Five-a-side Football Circle" in the seeded data):

1. Go to `/manage/circles/:id` — either via the account menu's **Manage {circle name}** entry, or by opening
   the Circle's public page (`/circles/dublin-five-a-side-football-circle`) and clicking **Manage Circle** →
   **Manage circle**.
2. **Plans tab**: click **+ Create a plan** — this opens the same host-a-game wizard as above, pre-filled
   with the Circle's activity and tagged to this Circle. Submit it, and confirm it now appears back on this
   Plans tab (with full Edit/Participants/Post update/Cancel actions, same as a Host's own Activities list).
3. Go to `/manage/activities` (as the same resident) and confirm that same plan appears there too, now with
   a green **"Part of Dublin Five-a-side Football Circle"** badge that links straight back to the Circle's
   Manage page — this is what distinguishes a Circle's own Plan from an unrelated solo hosted game in that
   flat list.
4. **Members tab**: try inviting someone (search by name, or use "Have a Resident ID instead?" if the person
   hasn't opted into name-search) and removing an existing member (not shown for the organiser row itself).
   Both actions send a real in-app notification to the affected resident.
5. **Settings tab**: edit the Circle's name/about/venue/etc. and save — confirm it persists on the public
   Circle page too, and that *no* notification fires for a settings-only change (unlike a Game's date/time
   edit above). Try the "Close this Circle" danger-zone action on a **disposable test Circle** (create one
   first via `/circles` → "Start a Circle" if you don't want to close the seeded demo one) — every other
   member should get notified.

## 5. Vendor (Venue Manager)

Sign in as `testvendor-formpage@hellocircle.ie` / `TestPassword123!` (or switch to **Vendor dashboard** from
the resident account menu).

1. **Overview** tab — KPIs (listings, bookings, views, unread messages).
2. **Listings** — edit an existing centre/club, or start a new one; check Rooms management on a centre (add
   a room, and confirm you can't deactivate the last active room).
3. **Programs** / **Schedule** — create a multi-session program, check its sessions show up on the Schedule
   tab's List/Calendar toggle.
4. **Bookings & registrations** — this is where Phase 2 of HelloCircle Manage landed:
   - Toggle between **List** and **Calendar** view for Hall bookings — Calendar shows a month grid with dots
     on booking days; click a day to see that day's bookings.
   - Click any booking row (either view) to open the **Booking Detail drawer** — room, duration, event type,
     guest count, notes, price, payment status. Try **Cancel booking** on a test booking (status flips to
     cancelled, no Stripe refund is issued — matches the off-platform-refund convention everywhere else in
     this app).
5. **Messages** — send a targeted message to everyone who's booked/registered on one listing; check the
   Messages inbox for new-booking notifications.
6. **Demand** — zero-result search signals scoped to your own county/listing type.
7. **Organisation** — as the org owner, invite a staff member by email with a specific platform role
   (`centre_manager`, `finance`, etc.), set org-wide cancellation/booking-window policy, and check the
   Payments/Insights/Participants sub-tabs. Note the sidebar/page title now read "HelloCircle Manage" rather
   than "Vendor dashboard" (a cosmetic Phase 2 rename — the `/vendor` URL itself is unchanged).

## 6. Admin

Sign in as `admin@hellocircle.ie` / `changeme123`.

1. Open the sidebar (burger icon, top left) — Admin's tabs are reached this way, not via a `?tab=` URL param
   the way Vendor's are, so navigating directly to `/admin?tab=vendors` will just show Overview; use the
   sidebar instead.
2. **Pending approval** — approve or reject a newly-signed-up vendor/listing (sign up a brand-new vendor
   account yourself first at `/vendor/signup` to have something pending to act on).
3. **Vendors** — suspend/reinstate a vendor account.
4. **All listings** — full CRUD on any centre/club platform-wide, including ones you didn't create.
5. **Claims** — approve/reject a vendor's request to take over an unclaimed seeded listing.
6. **Organisations** — reassign a listing's owning org, set a vendor's platform role/provider tier, toggle
   per-org feature flags.
7. **Demand** — same signal as the vendor's own Demand tab, but platform-wide instead of one org's.
8. **Audit** — the append-only trail of moderation/org-management actions, including
   `manage.linked_resident`/`manage.switched_workspace` entries if you exercised the cross-identity flow
   above.
9. **Coupons**, **Reviews**, **Support** — create a discount code, hide/unhide a review, look up a
   booking/registration/user by ref or email.

---

## Notes on what you'll observe

- **Refunds are never processed by any Cancel action anywhere in the app** (guest, host, organiser, or
  vendor) — every one is a status-only flip. This is intentional, not a bug; refunds are handled off-platform
  everywhere in this codebase.
- **Admin's tab switching lives in its sidebar, not the URL** — unlike the Vendor dashboard, which does
  support `/vendor?tab=bookings`-style deep links.
- **A resident can organise more than one Circle** with no in-app picker between them yet — you switch via
  the header's account menu (one "Manage {name}" entry per Circle), not from inside `/manage` itself.
- If something you expected to see doesn't notify/persist/appear, check the server process's own terminal
  output first — most background actions (email sends, notification failures) log there rather than failing
  loudly in the UI, by design (a failed notification must never fail the action that triggered it).
