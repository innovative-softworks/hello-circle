# Trust & Retention — remaining gaps and next (retention) batch

## Blockers and gaps left from batch 1

| Gap | Why it's open | Needs |
|---|---|---|
| Identity / organiser identity checks | No provider, access policy or retention policy | Owner: choose provider + retention period; then enable in `CHECK_AVAILABILITY` |
| "Who greets newcomers" field | No column; `HostGamePage.tsx` was mid-edit in another session | `games.newcomer_note` + host form input; WhatToExpect already shows "Not provided" |
| What to expect on experience/programme/venue pages | Session pages only (experiences keep `BookingPrep.tsx`) | Reuse `WhatToExpect` with per-type fact builders |
| Programme-session attendance correction from booking page | Corrections exist server-side (`program_session`), no resident UI per session | Add a button per missed session in `ProgrammeJourneyView` |
| Circle member notification settings | No per-member level; would need wiring into every Circle fan-out | Column + settings UI + filter in each Circle notify path |
| Group members reviewing a group booking | Only the booking holder can; other seats have no identity | Per-seat invites linking a seat to a resident |
| Partner/host review of past self-reported Sessions | Self-check-in and host check-in share `checked_in_at` for history before today | Nothing — new host check-ins go to `attendance`; old ones remain self_reported |
| Admin UI visual QA | Dev admin has two-step sign-in; not bypassed | Owner/QA run with an MFA code |
| Blocking enforcement beyond chat | Out of batch | — |

## Next retention batch (no duplication of what exists)

| Item | Existing | Gap |
|---|---|---|
| My Life: Your next plan | My Life 3.0 (`myLife.ts`, Pulse) shows upcoming items | Bring meeting instructions + prep + status + help into the next-plan card (reuse `WhatToExpect`/`AfterYourVisit`) |
| Go again: next available session | `programs` nextSession, `game_series`, `otherDates` on games | After an attended visit, link the next open date of the same series/listing on the booking page |
| Follow a host or recurring series | `follows` (vendor/host/centre) | Add `followed_type='series'` (games.series_id) + notification on new date |
| Relevant joined-Circle plans | Circles 3.0 plans in My Life | Filter by member availability (existing `circle_availability`) |
| Availability / spot alerts | `spotAlerts.ts`, `notify_me_subscriptions`, My Life alerts | None new; surface on the After your visit block |
| Saved weekly time, distance, budget | `residents.availability`, `search_radius_km`, `pref_budget` (CSV) | Structured weekly-time shape; CSV is a known gap |
| Post-attendance feedback invitations | `activity_feedback` + `PostActivityFeedback.tsx` | Send the invite only after attendance is recorded; link to the review form |
| Notification frequency & privacy | `/me/notification-prefs`, `/me/privacy-prefs` | Per-category frequency (digest) |
| Meetup "did you feel welcome" | `activity_feedback.welcoming` (legacy), tags | Surface as private host feedback only, never a public score |
| Circle polls → confirmed plans | Polls, `circle_plan_interest`, `POST /api/games` with `planId` | Keep: a vote or interest never books; add an organiser "turn into a plan" step from a closed poll |
