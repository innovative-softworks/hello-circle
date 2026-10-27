# Circles 3.0 — 03 Feature gap matrix

Status after this pass. "Verified" = exercised by an automated test in the isolated profile and/or a browser run on
`hello_circle_dev` (test data removed afterwards). "Code only" = read, not exercised.

| ID | Feature | Before | After | Verification | Priority left |
|---|---|---|---|---|---|
| C3-01 | Plan references a listing (all types) | Missing (activities only, via conversion) | Built: game, experience/adventure/volunteer (+departure), programme (+session), centre/club | 14 server tests; browser (experience) | — |
| C3-02 | Live listing state on plans | Missing | Built: availability, places left, my booked/waitlisted | tests (booked, cancelled) | — |
| C3-03 | Duplicate protection | n/a | One open plan per Circle+listing+session, race-safe | concurrency test | — |
| C3-04 | Plan never becomes a second listing | n/a | Conversion refused for listing plans | test | — |
| C3-05 | Listing-aware CTA on plan cards | Missing | Join activity / Book adventure / Book experience / Volunteer / Enrol in programme / View place | browser | — |
| C3-06 | Plans type filter | Missing | Kind chips shown only for kinds present | browser | — |
| C3-07 | "Plan with my Circle" on listing pages | Missing | Secondary labelled icon on activity, experience/adventure/volunteer, programme booking boxes | browser (experience) | P2: venue pages (gated) |
| C3-08 | Share → also add to plans | Notification only | Opt-in checkbox; reuses an open plan | tests | — |
| C3-09 | Report a plan | Missing | `circle_plan` report target, admin Remove plan (reason required, members told) | test | — |
| C3-10 | Events | No event type | Treated as dated activities/experiences (owner agreed 2026-10-28) | — | — |
| C3-11 | Places while venue pages gated | — | Venue info, no link, "doesn't book a room" note (owner agreed) | test | — |
| C3-12 | My Life "plans I'm in" | Partial (Circle plans this week) | Built: "Plans you're in", one row per listing across Circles, labelled Booked / Interested · booking required / no dates yet / Cancelled | 2 server tests; browser 1280/390 | — |
| C3-13 | Explore "Explore with others" on listings | Partial (Circles category) | Built on activity, experience/adventure/volunteer, programme pages: real Circles sharing the listing's category; heading names the matched level, "Local" only for a county match | browser (hiking, pottery, yoga) | — |
| C3-14 | Notifications: "listing cancelled" to interested members | Partial (suggest/confirm/cancel) | Built: activity cancel, experience departure cancel/listing delete, programme session cancel/archive → interested members + organisers, once per plan | test | — |
| C3-14b | Day-before plan reminders | Missing | Built: interested members, says booked / not booked yet, once per plan, none for cancelled listings | test | — |
| C3-15 | Host/vendor promote to Circles | Official Circle links exist | **Not built by decision** (owner 2026-10-28): partners reach only Circles they belong to or their official Circle | — | — |
| C3-16b | Report button on plan cards | Missing | Built (not on your own plan) | typecheck | — |
| C3-16 | Admin: restrict/suspend a Circle | Close via report only; admin planning view | Built: admin Close Circle / Reopen (reports.moderate, reason, organisers told, audited); organisers can't reopen a HelloCircle closure; admin plan list shows the listing type | 2 admin tests + 2 route tests | — |
| C3-17 | One plan across two Circles | Circle-to-Circle for activities | Built: organiser shares an open plan, partner organiser agrees, one plan record in both Circles, interest counted across both, home Circle decides, suggester's name never shown to the partner, withdraw un-shares | 10 tests; browser | — |
| C3-18 | Recurring plans | — | **Not built by decision** (routines and repeating activities own "every Saturday"); "Suggest again" on past or quiet plans instead | test | — |

Before-join (visitor page, CX 4.0), after-join (Circle Home tabs, welcome, Pulse, Free Time Match, Make it happen,
memories, polls, chat) already existed and are reused unchanged.
