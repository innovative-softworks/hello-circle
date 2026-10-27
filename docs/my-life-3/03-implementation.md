# My Life 3.0 — implementation report (2026-10-26)

Owner: "implement all as recommended" (D1 keep look · D2 five tabs · D3 Circle plans now, friends later after spec · D4 server dismissals · D5 opt-in alerts, off by default · D6 `mylife.*` switches on in dev only). Local only: nothing committed, pushed or deployed. Prod DB untouched.

## Built
| Area | What | Files |
|---|---|---|
| Tabs (D2) | For You · My Plans · My Circles · Saved · Passport (Passport needs `mylife.passport_tab` + `experience.activity_passport`). Old `?tab=overview|bookings|routines|following` redirect. Menus point at new keys. | pages/MyBookings.tsx, header/AccountMenuContent.tsx, pages/Profile.tsx |
| Hero | Date, state-based message (next moment / new / back after 3+ weeks / nothing booked), summary. | MyLifeOverview.tsx (MyLifeTitle) |
| What are you up for? | What / when / who → real listings from `/discover/free-time` (moods move, social, chill, learn; solo via `go_solo`), narrowed by date, volunteer kind, outdoor words, places for a group, people already going. `mylife.intent`. | MyLifeEngage.tsx (IntentFinder) |
| Pulse | Needs-attention (payments and waitlist offers critical, never hidden), unread Circle chats (`/chat/mine`), routine matches, new sessions from follows, saved-item availability. Top 3 + See all. Hide = server dismissal. `mylife.pulse`. | MyLifeEngage.tsx (PulseList), MyBookings.tsx |
| Next moments | Photo cards (existing), open the item's own page. | MyLifeOverview.tsx |
| Your Circles | Pulse line (meetups, unread, polls, invitations) + Circle cards. | MyBookings.tsx |
| Made for your week | `/discover/for-you` sections with reasons; "Not for me" dismissal; For Me page `/my-life/for-you`. `mylife.for_you`. | MyLifeEngage.tsx, pages/ForMe.tsx, App.tsx |
| Plan something together | Circle plans (ideas/agreed) + Plan My Day link + saved day plans. Friends outside a Circle: spec only (02-plan-together-spec.md). | MyBookings.tsx |
| Life highlights | Month, different things, active weeks, link to Passport tab. | MyLifeOverview.tsx |
| Right panel | Mini calendar, this week, quick actions, waiting for, saved ideas, following, preferences. | MyLifeEngage.tsx (MiniCalendar) |
| My Plans | Upcoming · Week · Month · Past · Routines (with matching sessions) · Payments & receipts link · same-start-time note (no duration guessing). | MyLifeEngage.tsx (WeekView) |
| My Circles | Pulse line, "Waiting for you" (polls, invites, requests, plans), cards, suggested Circles (`/discover/new-here`), empty state. | MyBookings.tsx |
| Saved | Saved / Hosts & places you follow. | MyBookings.tsx |
| Passport tab | Counts, Firsts, timeline by year from real check-ins. | MyLifeEngage.tsx (PassportTab) |
| New user | Intent + real "On soon near you" + the three steps. | MyBookings.tsx |
| Mobile | DOM order puts next action first (no CSS reordering, keeps focus order). | MyBookings.tsx |
| Analytics | trackEvent (consent-gated GTM): mylife_intent_submitted, mylife_intent_result_opened, mylife_pulse_opened, mylife_suggestion_opened, mylife_item_dismissed. | — |
| Server | `/api/my-life/signals` (read-only), `/api/my-life/dismissals` GET/POST/DELETE; tables `mylife_dismissals`, `mylife_alerts_seen`; 30-min opt-in sweep (in-app only, first run is a baseline, max 3/sweep, routine reminder after 17:00 the day before). New prefs `savedAvailability`, `routineAlerts` (the old `routineReminders` defaulted on, so it is never read). | myLife.ts, myLifeRules.ts(+test), db/index.ts, index.ts, notifications.ts, circleFeatures.ts |
| Settings | Notification settings show the two opt-in switches while `mylife.alerts` is on; the old no-op "Routine reminders" switch is replaced. | NotificationSettingsPage.tsx |
| Seed | `npm run seed-mylife-demo --workspace server -- <email>` adds a routine too; dev only. | scripts/seedMyLifeDemo.ts |

## Tests
- Client: 40 files, 321 tests pass. Server (isolated Docker DB): 126 files, 1141 pass, 23 skipped. New `myLifeRules.test.ts` (6) passes.
- Browser (dev, demo resident): all tabs, For Me, redirects, dismiss persisted, intent search returns real listings; no horizontal overflow at 320/375/430/768/1024/1280/1440/1920; no console errors.
- Accessibility spot check (no axe installed): every button/link named, images have alt, inputs labelled, no duplicate ids, one h1, no heading skips, keyboard reaches all new controls with a visible focus ring.
- Alerts sweep on dev: baseline 0 → new session 1 → repeat 0.

## Not done / blocked
- Plan Together with friends: needs owner answers (02 spec).
- Passport photos/notes, Places section (no place data in Passport entries).
- Booking statuses beyond what the server returns (by design).
- Overlap detection uses exact start times only (durations aren't always known).
- Suggested Circles depend on `/discover/new-here` (empty for many accounts).
- Full axe/WCAG audit and screen-reader run.

## Switches
`mylife.intent`, `mylife.pulse`, `mylife.for_you`, `mylife.passport_tab`, `mylife.alerts`: ON in hello_circle_dev only; default off elsewhere.
