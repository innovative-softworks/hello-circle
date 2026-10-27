# Experience 3.0 — 01 Current-state audit

Date: 2026-10-23 · Working tree on `feature/workspace-detail-pages` (uncommitted, includes the same-day Circle
Experience 2.0 build) · Read: `CLAUDE.md`, `docs/hellocircle-full-product-audit.md`,
`docs/hellocircle-product-context.md`, `docs/admin-and-vendor-reference.md`, `docs/circle-experience-2-*.md`, and the
code named in each row below.

**Headline.** HelloCircle already has most of the brief's surfaces. Earlier programmes built Free Time Mode, For You,
the discovery map, person-to-person invitations, waitlists, Notify me, rehost ("Do it again"), host and vendor demand
opportunities, search alerts, routines, the My Life hub and (today) Circle Experience 2.0. Nothing below gets rebuilt.
The real gaps are a small, specific set: an **Activity Passport**, **Plan My Day**, **Go Solo** as a discovery mode,
**Smart Match** inputs (when/budget/solo) on top of Free Time Mode, **Surprise me**, **collections and occasions** from
host-set attributes, **adventure preparation for the booked customer**, a **programme journey**, **spot alerts beyond
games and clubs**, **Circle-to-Circle collaboration**, and an **honest-duration fix** in Free Time Mode.

Legend: **Done** = already implemented · **Partial** · **Missing** · **Blocked** (existing business rule) ·
**Decision** (needs a product call).

## Module 01 — Explore

| # | Feature | Status | Today | Gap / plan | Regression risk |
|---|---|---|---|---|---|
| 1 | Smart Activity Match ("Find something for me") | **Partial** | `GET /discover/for-you` sections from opted-in profile (interests, availability, home, radius, goals) with `matchReasons` + `fitLabel` (`personalization.ts`, rule-based, weights in `app_settings`). `/free-time` wizard: duration → distance → mood | No *ask-me-now* inputs for **when** (day/part of day), **budget**, **alone or with others**. Plan: add them as optional steps to Free Time Mode's results (one shared endpoint), no new ranking engine | Low — additive query params |
| 2 | Free Time Mode | **Done**, with a **bug** | `pages/FreeTimeMode.tsx`, `GET /discover/free-time` | Filters "fits your time" on `ASSUMED_DURATION_MINUTES` for games/club sessions/experience sessions even though `games.duration_minutes` and `experiences.duration_minutes` exist. Plan: real durations where stored; items with no duration are **not** claimed to fit — shown separately as "duration not given" | Medium — changes which items appear; existing tests on `/free-time` |
| 3 | Surprise Me | **Partial** | Free Time "Surprise me" mood = no mood filter, top 3 | Plan: one real suggestion at a time from the same eligible pool, "Show another" without repeats in the session, then view/save/join through existing flows | Low |
| 4 | Discovery Map | **Done** | `GET /discover/map` bounds + filters, `DiscoveryMap.tsx` clustering, "Search this area", approved-only, no invented coordinates (`locationSource`) | None. Not touched | — |

## Module 02 — Activities

| # | Feature | Status | Today | Gap / plan | Risk |
|---|---|---|---|---|---|
| 5 | Join Together | **Done** | `routes/invitations.ts`: per-invitee rows, secure token link `/i/:token`, pending/accepted/declined/expired (30 days)/revoked, `/mine`, `/sent`, invite picker, no seat reserved | None beyond an "Invitations" entry in My Life (exists as needs-attention items). Not rebuilt | — |
| 6 | Go Solo, Feel Welcome | **Partial** | Host-selected `listing_attributes` (`come_alone`, `first_timers_welcome`, `beginner_friendly`, `host_introduces`), `games.solo_friendly`, For You "Come-alone friendly" section, game detail first-timer count + meeting instructions, Circle 2.0 guide | No "I'm going solo" discovery mode. Plan: a solo filter on Free Time/Smart Match results using **only** those host-set attributes; never inferred; no public solo label | Low |
| 7 | Spot Alerts | **Partial** | `waitlist.ts` for **games and clubs** (offers with hold windows), `notifyMe.ts` for coming-soon games | No alert for **experience departures** or **programmes**. Plan: alert-only subscription (no hold) for experience sessions; eligibility re-checked before sending; once-only; expiry at session start. Programmes: **Decision** (see D4) | Medium — touches capacity-change hooks |
| 8 | Repeat Sessions | **Done** | `rehost.ts` `rehostHref()` "Do it again"/"Host again", Circle "Do it again", vendor duplicate | Copies supported fields only; date/time/price reviewed on the form; participants never copied. Not rebuilt | — |

## Module 03 — Circles

| Feature | Status | Notes |
|---|---|---|
| Circle Pulse, Free Time Match, Make It Happen, First-Time Friendly, Circle Memories | **Done** (2026-10-23, behind `circles.*` switches) | `docs/circle-experience-2-implementation-report.md` |
| Shared Plans | **Done** | plan ideas + interest + date polls + organiser conversion |
| Circle-to-Circle Collaboration | **Missing** | Plan: proposal between two organisers, both must approve, the activity stays owned by the proposing Circle and is linked to the partner Circle; no membership/permission/data merge; own switch. **Decision** D2 |

## Module 04 — Adventures

| # | Feature | Status | Today | Gap / plan |
|---|---|---|---|---|
| 9 | Adventure Readiness | **Partial** | Experiences store `meeting_point`, `equipment_provided/required`, `fitness_requirements`, `difficulty`, `safety_info`, `weather_policy`, `transport_info`, `itinerary`, `duration_minutes` and show them on the public detail page | The **booked customer** never gets a preparation view: booking detail (`/bookings/:kind/:ref`) shows none of it. Plan: a "Get ready" section on the booking detail for experience bookings (and games' meeting/equipment), only organiser-entered text, plus calendar (.ics already exists) and directions link when coordinates are confirmed. No generated safety advice |

## Module 05 — Experiences

| # | Feature | Status | Plan |
|---|---|---|---|
| 10 | Occasion Finder | **Missing** | Only with real attributes: "Family day" = `family_friendly`, "Learning something new" = `beginner_friendly`/`no_experience`, "Weekend outing" = date in the coming weekend, "Friends gathering" = `small_group` is **not** the same thing → omitted. "Date activity" has **no supporting data → not offered**. Shown only when an occasion has ≥1 real listing |
| 11 | Experience Collections | **Partial** | Explore has "Happening today"/"This weekend"; For You has Free nearby/Come-alone. Plan: Explore collections "Free", "Under €20", "Beginner-friendly", "Outdoors" (category), "This weekend", each hidden when empty. "Local favourites" has no honest definition (no ratings policy) → not built |
| 12 | Gift Experiences | **Blocked** | Commercial: tax, refunds, transferability, expiry unapproved. Not built |

## Module 06 — Programmes

| # | Feature | Status | Today | Plan |
|---|---|---|---|---|
| 13 | Learning Journey | **Partial** | `programs.ts` returns `sessionsAttended/Missed` from registers; booking detail shows counts | Plan: a session-by-session journey (date, attended / missed / not recorded / upcoming) on the programme booking detail and a compact block in My Life. "Completed" only from a recorded register — a past date with no register shows "Not recorded" |

## Module 07 — Volunteering

| # | Feature | Status | Today | Plan |
|---|---|---|---|---|
| 14 | Cause Match | **Partial** | `/volunteer` page, `experiences.kind='volunteer'`, `cause`, `skills_required`, `min_age`; New-here "Volunteer" section; supply-match alerts | Cause filter exists on the page? — the page lists by cause; no personal cause preference. Plan: no new preference store; Contribution History = verified (host-recorded attendance) volunteering in the Passport. No hours awarded (no organiser-confirmed hours exist) |

## Module 08 — Places & venues

| # | Feature | Status | Notes |
|---|---|---|---|
| 15 | Place Discovery | **Done / Blocked** | Centre detail exists; public venue pages are gated by `VITE_VENUE_PAGES_PUBLIC` (off). Not changed |
| 16 | Saved Places | **Done** | `favourites` (centres/clubs/…), My Life Saved |
| 17 | Availability Requests | **Blocked** | Venue booking is gated; a request flow would represent venue availability that isn't public. Not built |

## Module 09 — My Life

| Section | Status | Today |
|---|---|---|
| A Coming Up | **Done** | `/me/participation` across all five tables, Next up, Coming up |
| B My Circles | **Done** | `MyLifeCircles` |
| C Saved | **Done** | `MyLifeSaved` (+ Following) |
| D Invitations | **Done** | needs-attention items (activity + Circle invites, plan ideas, polls) |
| E My Plans | **Partial** | Plan ideas live in Circles; no personal saved day plans → Plan My Day adds them |
| F Activity Passport | **Missing** | → build (Feature 18) |
| G For You | **Done** | `/discover/for-you` |
| H Preferences | **Done** | Profile → Preferences (interests, goals, availability, radius, first-timer/family prefs, notification prefs, hide-from-familiar, delete prefs) |

## Feature 18 — Activity Passport: **Missing**. Data exists: `deriveAttendanceState()` over the five tables + `attendance` (host check-in, registers, self-reported game attendance), Circle joins, Circle Memories. Plan: private timeline, attended-only, milestones from real firsts, no streaks/rankings, no sharing in V1 (**Decision** D3).

## Feature 19 — Plan My Day: **Missing**. No routing provider in the stack. Plan in **Decision** D1.

## Module 10 — Host

| # | Feature | Status | Today |
|---|---|---|---|
| 20 | Host preparation & attendance | **Done** | `/manage` Activities: participants modal, attendance (self + host no-show), post update, cancel, chat |
| 21 | One-Tap Repeat | **Done** | "Host again"/rehost |
| 22 | Demand Insights | **Done** | `GET /games/opportunities` (verified hosts, aggregate, resident-backed only, ranges) |

## Module 11 — Vendor

| # | Feature | Status | Today |
|---|---|---|---|
| 23 | Opportunity Insights | **Done** | `vendorInsights.ts` opportunities, demand, stats |
| 24 | Repeat customers | **Done** (within PII rules) | Option A staff-role PII limits; customers list |
| 25 | Experience quality | **Partial** | attendance + activity_feedback (rating/tags/comment) exist; no public reviews change. Not extended |

## Module 12 — Admin

| Area | Status | Today |
|---|---|---|
| Experience operations | **Partial** | system status, payment reviews, reports, notification templates; no "experience health" view |
| Trust & safety | **Done** | reports (incl. `circle_memory` since today), media moderation, decisions, audit log |
| Analytics | **Partial** | `analytics_events`, funnel, marketplace health, demand. Plan: new events for the features built here, counted in the existing funnel surfaces; no new personal data |

## Shared notification engine: **Done** — `notifyResident` (in-app + push, per-kind prefs), templates, dedupe patterns. No quiet hours exist; not added.

## Feature flags: `app_settings` switches (commerce catalog, maps, categories, `circles.*`). New `experience.*` keys will follow the `circleFeatures.ts` pattern.

## Things found that break the brief's rules today

1. Free Time Mode's assumed durations (Feature 2) — fix.
2. `/free-time` returns only 3 results and no reasons on the client for "Surprise me" — fine, extended.
3. No other rule violations found in the surfaces audited.

## Required product decisions (answers recorded in 10-implementation-roadmap.md)

- **D1 Plan My Day travel.** No routing service exists. Options: straight-line distance with a stated slow speed and buffer, labelled "rough estimate", and only between items with confirmed coordinates; or no travel estimate (same area only); or defer.
- **D2 Circle-to-Circle collaboration ownership.** The activity is owned by the proposing Circle and shown as "with {partner}" on both; members of the partner Circle see and join it through the normal flow. Or defer.
- **D3 Passport sharing.** Private only in V1, or a shareable summary card.
- **D4 Spot alerts for programmes.** Programmes have whole-programme capacity; an alert on a full programme is plausible but the enrolment rules differ. Experiences only, or both.
- Design tokens: the Circle Experience 2.0 answer (D2 there — keep current tokens) is reused, not re-asked.
