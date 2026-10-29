# Trust & Retention — audit matrix (2026-10-28)

Read against the working tree on `feature/circles-and-experience-3` (uncommitted Explore-redesign work from
another session was present and left alone). Status: **E** existing, **P** partial, **M** missing.

| Feature | E/P/M | Code evidence | Required change | Dependency |
|---|---|---|---|---|
| Host public profile | P | `routes/residents.ts` `GET /:id/host-profile` 404s unless `host_status='verified'`; `pages/HostProfile.tsx` | Resolve for any resident with public hosting history; add hosting-since, activities, area, specific checks, rating distribution, "New to HelloCircle", support route | none |
| Provider (vendor) profile | P | `routes/providers.ts` — `verified: providerTier !== 'standard'` (a commercial/placement tier, incl. `featured`) | Stop deriving "verified" from tier; show only completed checks | verification checks |
| Circle visitor profile | E (behind `circles.visitor_experience`) | `components/circle/CircleVisitor.tsx`, `GET /api/circles/:id/visitor` | Organiser line says "Verified host" — replace with the honest host label | label wording |
| Circle member view | E | feed/plans/polls/intro (`CircleFirstTime.tsx`), leave, report, organiser mute in `CircleDetail.tsx`/`circles.ts` | — | — |
| Circle member notification settings | M | `circle_members` has only organiser `muted_until`; no per-member notify level | New per-member level **and** wiring into every Circle fan-out (not half-built) | next batch |
| Verification: email confirmed | E (data) / M (label) | `residents.email_verified_at`; vendors have no email-confirmation column | Public label for residents only | none |
| Verification: host application | E | `residents.host_status`, `admin.ts /host-applications` (approve/reject + D-03 reason) | It checks a bio + phone + guidelines, not identity: relabel "Host application approved", never "Verified" | none |
| Verification: business details | M | `traders.verify` exists for DSA trader info, not a public check; `provider_tier` is commercial | New check record + admin workflow (pending → more info → approve/reject → revoke/expire), restricted evidence notes, audit | none |
| Verification: identity / organiser identity | M | no provider, process, access policy or retention policy | Keep unavailable with an honest explanation; refuse approval server-side | **owner: provider + retention policy** |
| Attendance / check-in | P | `attendance` (bookings, registrations, experiences, program sessions; vendor/QR/host_manual, present/no_show); games use `game_participants.checked_in_at` (self **or** host, indistinguishable) and self-reported `attended` | Record host check-ins / no-shows for games in `attendance` (`kind='game'`); correction/dispute route | none |
| Reviews | P | `routes/reviews.ts`: eligibility = paid + past booking, **no attendance check, no duplicate prevention, no author edit/delete, no tags**; host self-review not blocked | Occurrence-based eligibility on confirmed attendance, unique per attendee+occurrence, edit/delete, tags, verified-attendance basis, distribution | attendance |
| Host / partner replies | P | vendor reply: centre/club only (`vendorOperations.ts`); host reply: `host` reviews only (`residents.ts`) | Extend vendor reply to experience/programme, host reply to own-game reviews | none |
| Post-activity private feedback | E | `routes/feedback.ts` (`activity_feedback`: would-repeat, rating, tags, comment; no-show blocked) | Keep private; not merged with public reviews | — |
| Reporting | E | `routes/reports.ts`, `reportModeration.ts`, admin queue + case page, D-03 reasons, `SafetyPage.tsx` history | Case reference, safety category (prioritised), reporter resident id, appeal link | none |
| Appeals | E | `routes/complaints.ts` `kind='appeal'` linked to a decided report; different decider enforced | Link from the reporter's report history | none |
| Review moderation reasons | P | hide/unhide audited, no reason stored | Hide/restore with a recorded reason | none |
| Blocking | P | `blocked_residents` + chat filtering | — (out of batch) | — |
| Listing / booking information | P | games: meeting instructions, kit, age, experience, accessibility, cancellation policy, `solo_friendly`; experiences: `BookingPrep.tsx`; missing fields silently omitted | One "What to expect" block with explicit "Not provided" states; newcomer-welcome field | host form edit (HostGamePage is mid-edit in another session) |
| My Life next commitment | E | `myLife.ts`, My Life 3.0 | — (retention batch) | — |
| Following hosts/vendors/centres | E | `routes/follows.ts` (`vendor|host|centre`) | Series follow missing (backlog) | — |
| Availability / spot alerts | E | `spotAlerts.ts`, `notify_me_subscriptions`, My Life alerts | — | — |
| Notification + privacy settings | E | `/me/notification-prefs`, `/me/privacy-prefs` | — | — |
| Audit history | E | `audit_log` + `writeAudit`, `moderation_decisions` | Use for every new action | — |
