# Circle Experience 2.0 — implementation report

Date: 2026-10-23 · Branch: `feature/workspace-detail-pages` (working tree only — **nothing committed, pushed or
deployed**) · Audit and owner decisions: `docs/circle-experience-2-audit.md` · Screenshots: `docs/circle-experience-2/`.

## 1. Executive summary

All seven phases are built locally and tested. The Circle page is now a tabbed Circle Home that leads with what's
next. Circle Pulse, Free Time Match, Make it happen (interest on plans), First-Time Friendly and Circle Memories each
sit behind their own switch, **all off by default**. Start a Circle is a sectioned 70/30 form with a live preview.
Organisers get a "Pulse & proposals" tab and a Removed members list. Bookings, payments, Stripe and the
plan → activity conversion path are unchanged.

Owner decisions applied: **D1** the section is called "Make it happen", each item is still a "plan" (separate from the
paused `/make-it-happen` room-booking page). **D2** current tokens kept (16px cards, 4px buttons, pill chips, Inter
body, Bricolage headings). **D4** memories are members-only in every join mode. **D5** removal blocks rejoining until an
organiser lifts it. Defaults taken: D3 Pulse has its own table, D6 no buddy system, D7 no hard delete, D8 no
invitation expiry.

## 2. Feature status

| Feature | Status |
|---|---|
| Feature switches (`circles.*`, admin card, `/api/config`) | Implemented and tested |
| Start a Circle redesign (5 sections, live preview, inline + server errors, local draft, double-submit guard) | Implemented and tested |
| Edit Circle (organiser Settings) | Existing, unchanged |
| Circle Home (tabs: Home, Activities, Discussions, Polls, Members, Memories; visitor / member views) | Implemented and tested |
| Membership states (open, approval, invite, requested, invited, closed, **removed/restricted**) | Implemented and tested |
| D5 restriction (remove → blocked; organiser lifts; audited) | Implemented and tested |
| Circle Pulse | Implemented and tested |
| Free Time Match | Implemented and tested |
| Make it happen (interest, group size, ready-for-review, decline with reason, conversion notice) | Implemented and tested |
| First-Time Friendly (welcome step, "what to expect" guide, first-time-friendly marker on cards) | Implemented and tested |
| Welcome buddy | **Not implemented** (D6, needs safeguarding rules) |
| Circle Memories (photo with consent / reflection, members-only delivery, remove, report, admin moderation) | Implemented and tested |
| Organiser workspace: Pulse & proposals tab, Removed members, pending-requests / proposals stats | Implemented and tested |
| Co-organiser access to Manage (bug fix, see §9) | Implemented, not covered by an automated test |
| Polls: optional time per option | Implemented, verified in the browser only |
| Discussions tab | Implemented (read-only preview of the existing Circle chat; the chat itself is unchanged) |
| Hard delete / archive | Not implemented (D7); Close stays the only lever |
| Invitation expiry | Not implemented (D8) |

## 3. Existing functionality reused

`circle_plans` state machine and the transactional conversion in `games.ts` (`createGameRow` flips the plan with a
409 guard), `canViewCircleFull` visibility, `isOrganiser`/`isMember`, `notifyResident` + its once-per-plan guard,
`writeAudit`, `reports` + `reportModeration.ts`, the media pipeline (new protected entity type), `app_settings` /
`getSetting`, `platform.settings` admin permission, `ChatModal`, `CircleJoinCard`, `CircleHero`, `CirclePlanCard`,
`CircleAboutCard`/`CircleMembersCard`/`CircleCommunityGrid`, `CategoryPicker`/`TagPicker`, `SingleImageUpload`,
`form.tsx` (FieldLabel, useFormErrors, FormErrorSummary, useFormDraft, DraftBanner), `SectionTabs`/`TabPanel`, `Modal`,
`ConfirmDialog`, `useUrlTab`, `participationVocab` day:slot tokens, `irelandTime`/`irelandDate`.

## 4. Screens

Redesigned: Start a Circle (+ success state), Circle Home (all six tabs, visitor and member views, restricted teaser),
organiser Manage Circle (new tab, Members additions, header stats), admin Settings (Circle features card), admin report
case page (memory reports). New dialogs (centred, no side drawers): Pulse add/update, Add a memory, Decline suggestion,
Remove member (now with reason).

Screenshots in `docs/circle-experience-2/`: `start-1440`, `start-filled-1440`, `start-created-1440`,
`start-empty-submit`, `home-new-1440` (welcome), `home-member-1440`, `home-member-390`, `home-visitor-1440`,
`pulse-dialog`, `memories-view-b`, `manage-ideas`, `manage-members`, `plans-workspace-390`, `removed-member-390`.

## 5. New components and files

Server: `circleFeatures.ts`, `circlePlanning.ts` (+ `.test.ts`), `routes/circleExperience.ts` (+ `.test.ts`).
Client: `circleFeatures.ts`, `api/circleExperience.ts`, `components/circle/` — `circleExperience.css`,
`circleTime.ts` (+ test), `CircleFirstTime.tsx`, `CirclePulseSection.tsx`, `CircleFreeTimeSection.tsx`,
`CircleMakeItHappen.tsx`, `CirclePollsPanel.tsx`, `CircleConversations.tsx`, `CircleMemoriesPanel.tsx`,
`ManageCircleExtras.tsx`. Tests: `tests/integration/specs/circle-experience-2.spec.ts` (registered in the product suite).

## 6. Database changes (additive, in `initSchema()`)

New tables: `circle_restrictions`, `circle_pulses`, `circle_pulse_notices`, `circle_availability`,
`circle_plan_interest`, `circle_memories`. New columns: `circle_members.welcomed_at` (one-time backfill marks existing
members welcomed, guarded by `migration.circle_welcomed_backfill`), `circle_plans.target_size / expires_at /
source_pulse_key / ready_notified_at / decline_reason`. Unique keys stop duplicates (one Pulse per member per interest
per week; one availability row per member per week; one "I'm in" per member per plan). No foreign keys, matching the
project convention (relationships are checked in the routes). No down-migration, as everywhere else.

## 7. API changes

New (`/api/circles`, resident session, member check on the server, 404 while the switch is off):
`GET|POST /:id/pulse`, `DELETE /:id/pulse/:pulseId`, `GET /:id/free-time`, `PUT|DELETE /:id/free-time/:weekStart`,
`POST|DELETE /:id/plan-ideas/:planId/interest`, `POST /:id/welcome/dismiss`, `GET /:id/first-time`,
`GET|POST /:id/memories`, `DELETE /:id/memories/:memoryId`, `GET /:id/restrictions`,
`POST /:id/restrictions/:residentId/lift` (no switch — D5 is a safety rule).
Media: entity type `circle-memory`; `GET /api/media/circles/:id/memories/:memoryId` and
`GET /api/media/circles/:id/memory-file?file=` (members only; never another Circle's file).
Admin: `GET /api/admin/config/circle-features`, `PUT /api/admin/config/circle-features/:key` (`platform.settings`,
audited). `GET /api/config` gains `circleFeatures`.
Extended (additive fields only): `GET /:id/membership` (+ `restricted`, `welcomed`, `firstCircleActivity`),
`GET /:id` (+ `activitiesTogether`), `GET /:id/upcoming` (+ `imageUrl`, `soloFriendly`, `experienceRequired`),
plan-idea JSON (+ interest fields, only while Make it happen is on), plan-idea create/patch (+ `targetSize`,
`sourcePulseKey`), plan cancel (+ optional `reason`), member remove (+ optional `reason`). Reports accept
`circle_memory`.

## 8. Permission changes

None to roles. Every new mutation checks membership (organiser where stated) on the server; nothing new is public.
Behaviour changes: **removal now restricts** (D5); confirming a plan is now conditional (two organisers can't both
confirm) and audited; an organiser declining someone else's suggestion is audited; removing a member is audited.

## 9. Bugs fixed along the way

1. Start a Circle showed **no error when creation failed** (unhandled rejection) — now an error summary.
2. **Co-organisers were locked out of Manage Circle**: the page checked `myRole`, which `GET /circles/:id` never sends,
   so only the creator got in. It now asks the membership endpoint (the server still checks every action).
3. Visitors saw an empty "Moments from this Circle" heading when no venue was linked — hidden now.

## 10. Privacy and safety rules as built

Pulse totals show from 2 people; Free Time Match only claims a match from 3; a lone wish shows "Only you so far" to its
owner and nothing to anyone else; notes go to organisers without names; nobody's slots, availability or name are
returned. Availability is per Circle, per week, opt-in by saving, deleted on "Stop sharing", and expires with the week
(Ireland time, DST-safe). Leaving or being removed deletes that person's Pulse, availability and open "I'm in"s.
Memories: only people who took part in that Circle activity (last 180 days) can add; a photo needs the "everyone
pictured is happy" confirmation; photos are only ever served through the members-only route (local private file or a
5-minute signed R2 URL); contributor or organiser can remove; anyone can report; admins can remove from the report case
(reason required). Notifications: organisers once per interest per week, once per plan when ready for review,
participants once per activity for memories, interested members get "It's happening" instead of the usual new-plan
notice (still one each). Rate limits on all new writes (60 per 15 min), 5 active Pulse wishes per member per Circle,
10 memories a day.

## 11. Feature switch states

All five `circles.*` switches default **off** in code. In the local `hello_circle_dev` database they are currently
**on**, with `ce2-` demo data ("Howth Hill Walkers", `/circles/ce2-howth-hill-walkers`), so the work can be previewed.
Production and staging are untouched. Turn them off in Admin → Settings → System status → Circle features.

## 12. Test results

| Suite | Result |
|---|---|
| Server, isolated Docker profile (`npm run test --workspace server`) | 122 files, 1,091 passed, 23 skipped (live-provider tests) — includes new `circlePlanning.test.ts` (unit) and `circleExperience.test.ts` (integration: switches, privacy thresholds, cross-Circle access, idempotency, conversion, memories, D5) |
| Client (`vitest`) | 40 files, 321 passed |
| Production build (`npm run build`) | Passes |
| `qa:product` (isolated, real browsers) | 81 passed, 1 skipped by design (perf) — includes the new CX2 browser test and the Circle a/b/c specs |
| `qa:lifecycle` | 52 passed (after the membership-shape spec update; first run failed only on that exact-shape assertion) |
| `qa:validation` | 52 passed, 1 failed, last batch not run. **CAT-PUBLIC fails for a reason outside this work:** it clicks a "Racket sports types" chip row on `/games`, which the earlier, uncommitted Activities filter redesign removed (`Games.tsx` passes `subChips={false}`; subcategories moved into Refine). The runner stops at the first failing batch, so `validation-categories-b` (vendor/admin category tools, no Circle code) didn't run. CAT-HOST (Start a Circle with the category picker) passes. |
| Manual browser checks (dev, email/push/Stripe credentials blanked) | 375, 390, 768, 1024, 1440: no page-level sideways scroll; memory photo refused to outsiders, signed-out visitors and via another Circle |

Specs updated for intended changes: `circles.test.ts` (D5 replaces "rejoin with no cooldown"),
`lifecycle-ui-desktop.spec.ts` (membership radio, "Create first activity"), `product-circles-a.spec.ts` (polls on the
Polls tab), `product-a11y-b.spec.ts` (no "Add more detail" toggle), `lifecycle-circle-membership.spec.ts`
(membership response has new fields), `hc-categories.spec.ts` (role-based name query).

Not run: `qa:stripe`, `qa:revenue`, `qa:booking`, `qa:authorization` (no payment, booking or auth code changed);
1600/1920px screenshots; real R2 upload of a memory photo (only local storage exercised); screen-reader pass.

## 13. Known limitations

- Discussions is a read-only preview of the latest messages; writing still happens in the existing chat popup.
- Pulse "Draft" exists only while the dialog is open; nothing is stored until saved.
- Free Time Match uses Circle membership as the location context; there's no distance matching.
- Removing a memory keeps its record and photo as evidence (like hidden chat messages); erasure waits on D-07.
- New tables hold personal data and aren't covered by an erasure job yet (none exists — D-07).
- `CircleStatsBar`, `CircleHighlightsCard`, `CircleUpcomingSummary` are no longer used by the Circle page (left in place).
- The dev QA API on :3311 and Vite on :5491 are still running from this session.

## 14. Remaining decisions

1. When to switch each feature on in staging (suggested order: First-Time Friendly → Pulse → Make it happen → Free
   Time Match → Memories).
2. D6 welcome buddy — safeguarding rules first.
3. D7/D-07 — deletion and retention for Circles and the new tables.
4. D8 — invitation expiry.
5. Whether Discussions should become an inline chat instead of a preview.

## 15. Release readiness

Ready for owner review locally. Not ready to release until: the owner has reviewed the screens; the switches are
tried in staging one by one; a memory photo upload is checked against real R2 in staging; the commit is made on the
owner's word.
