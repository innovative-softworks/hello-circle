# Circle Experience 2.0 — Phase 0 audit

Date: 2026-10-23 · Branch: `feature/workspace-detail-pages` (working tree, uncommitted) · Scope: read-only audit of
every Circle surface before any Circle Experience 2.0 change.

Sources read: `CLAUDE.md`; `server/src/routes/circles.ts` (all 1,754 lines), `circleHelpers.ts`, `makeItHappen.ts`,
`chat.ts`, `participationIntents.ts`, the Circle tables and migrations in `server/src/db/index.ts`, the `planId`
conversion in `routes/games.ts`, `notifications.ts`, `media.ts`, `adminPermissions.ts`, `commerce/catalog.ts`,
`routes/config.ts`, `privacyRequests.ts`; client `StartCirclePage.tsx`, `CircleDetail.tsx`, `ManageCircle.tsx`,
`Circles.tsx`, the 20 `components/Circle*.tsx` files; the test setup in `server/TESTING.md` and `tests/integration/`.

**Headline:** most of the brief's *structure* already exists. Circles have three join modes, approval questions,
invitations, co-organisers, plan ideas that convert into activities through the normal activity flow, date polls,
persistent Circle chat, announcements, mutes, reports and an organiser workspace. What's missing is the
*coordination layer* the brief is really about: Circle Pulse, Free Time Match, interest counts on plans,
member-contributed memories, a welcome step, and a Circle Home that leads with "what's next" instead of one long
page. Those are the parts to build. The rest is redesign and gap-filling.

---

## 1. Existing Circle functionality

| Brief stage / screen | What exists today | Where | Verdict |
|---|---|---|---|
| A1–4 Landing, listing, search, filters | `/circles`: search + location, one row of multi-select dropdowns (Category, Type, Interest, Meeting time, Show), Near me, Sort; keyset-paged API with `q`, `county`, `activity`, taxonomy filters | `pages/Circles.tsx`, `GET /api/circles` | **Keep** (redesigned 2026-10-23) |
| A5 Public detail | `/circles/:id` (slug or id): hero, stats bar, "From this Circle" plans, "Recently together", About, "You might also like" (clearly labelled nearby), Moments, Planning (members), sticky right rail | `pages/CircleDetail.tsx` | **Redesign** into Circle Home |
| A6 Empty results | Empty and filtered-zero states | `Circles.tsx` | Keep |
| A7 Private/unavailable | Strict server allow-list teaser for approval/invite Circles (`toCircleTeaserJson`), 403 on every member-only sub-resource, not-found and load-error states | `circles.ts`, `CircleDetail.tsx` | Keep; restyle |
| B8–9 Start / create | `/circles/start`: one card, two-column fields, "+ Add more detail" disclosure, Create button | `pages/StartCirclePage.tsx` | **Redesign** (70/30 + preview) |
| B10 Live preview | None | — | **New** |
| B11 Review | None (single-page form; a review step isn't needed) | — | Skip, per brief §4 "single page for straightforward forms" |
| B12 Success | "Your Circle is live" with cover upload, Invite people, Create first plan, Share, View | `StartCirclePage.tsx` | Keep; restyle |
| B13 Edit | Organiser Settings tab | `ManageCircle.tsx` `SettingsTab` | Keep; small label fixes |
| B14 Media | One cover image (`circles.image_url`), protected signed URL for non-open Circles | `media.ts` `circle-cover` | Keep |
| C15–16 Join / request | Open = instant; approval = request with optional note + up to 3 organiser questions; idempotent while pending | `POST /:id/join` | Keep |
| C17 Pending | `requested` state, withdraw request (confirm dialog) | `CircleJoinCard`, `DELETE /:id/join` | Keep |
| C18–19 Approved / declined | Organiser responds; resident gets an in-app notification; conditional update so two organisers can't both act (409) | `POST /:id/join-requests/:id/respond` | Keep; add on-page state |
| C20–21 Invitation | Organiser invites a resident by id; invitee inbox `GET /invitations/mine`; accept/decline; organiser can revoke; revoke-vs-accept race handled | `circles.ts` | Keep |
| C22 Leave | Leave Circle; last organiser blocked (409) until they promote someone | `DELETE /:id/join` | Keep |
| C23 Removed / restricted | Organiser removes a member (notified). **No restriction:** a removed member can rejoin an open Circle straight away | `POST /:id/members/:id/remove` | **Gap → decision D5** |
| D24 Circle Home | One long scrolling page, no tabs | `CircleDetail.tsx` | **Redesign** |
| D25 Upcoming activities | Real `games.circle_id` plans, viewer-filtered by `canViewGame`; nearby label matches kept separate | `GET /:id/upcoming` | Keep |
| D26 Activity details | Game detail page (meeting instructions, equipment, experience required, solo friendly, first-timer count, accessibility, icebreaker) | `pages/GameDetail.tsx` | Keep; surface first-time guidance |
| D27 Discussions | Persistent Circle chat (polling), unread counts, report, organiser hide, mute | `routes/chat.ts`, `ChatModal.tsx` | Keep; show inline in a tab |
| D28 Polls | Date-option polls, multi-select votes, organiser closes, "Create activity from this" via plan idea | `circles.ts` polls | Keep |
| D29 Members | Preview + full list, organiser view shows mutes; mutual-block filtered | `GET /:id/members` | Keep |
| D30 Announcements | Organiser announcement → chat + notification, audited | `POST /:id/announcements` | Keep; show on Home |
| D31 Memories | "Moments" = the linked **venue's** gallery photos, not member content | `GET /:id/moments` | **New** (member memories) |
| D32 Circle Pulse | None | — | **New** |
| E33 Submit interest | Platform-wide `participation_intents` ("I want badminton in Dublin") feeds demand dashboards and vendor/host opportunities. Not Circle-scoped | `participationIntents.ts` | Different thing — see §8 |
| E34 Free Time Match | Profile-level `residents.availability` (`day:slot` tokens) used only for recommendation fit. Nothing Circle-scoped, nothing shared | `participationVocab.ts`, `personalization.ts` | **New** (Circle-scoped, opt-in) |
| E35–37 Suggested plan / proposal / plan details | `circle_plans` ("plan ideas"): any member suggests title/note/date/time/place; members notified | `circles.ts` plan-ideas | **Extend** (interest + lifecycle) |
| E38 Organiser review | Organiser confirms (`idea → confirmed`) or cancels; creator can edit/cancel while `idea` | `circles.ts` | Extend |
| E39 Create activity from proposal | Organiser opens `/games/host?circleId&planId`; `createGameRow` flips the plan to `activity_created` **in the same transaction**, guarded so a second conversion fails (409). Goes through every normal activity rule (paid → verified host, venue booking check, visibility derived from join mode, lifecycle) | `games.ts` | **Keep — this is exactly the brief's rule** |
| E40 Activity confirmation | Members notified once per plan when it becomes bookable (`notifyCircleMembersOfPlan`) | `games.ts` | Keep; also notify interested members |
| F41 Organiser overview | `/manage/circles/:id` workspace header stats (Members, Next plan, This month, Status) | `ManageCircle.tsx` | Extend (pending requests, proposals) |
| F42–44 Directory, requests, invitations | Members tab: filterable member table, join requests card (answers shown next to questions), pending invitations + revoke, promote/demote/remove/mute | `ManageCircle.tsx` | Keep |
| F45 Activity management | Plans tab: official plans with participants modal, edit, post update, cancel | `ManageCircle.tsx` | Keep |
| F46 Settings | Name, activity, area, county, about, what we do, who can join, values, cover, join mode, join questions, category, tags, close Circle | `ManageCircle.tsx` | Keep; add feature settings |
| F47–48 Moderation, safety | Moderation tab: announcements, reported messages (never who reported), hidden messages, mutes, history; Circle report to platform moderators | `ManageCircle.tsx`, `CircleModerationTab.tsx` | Keep; add memories |
| F49 Archive/close | `status = closed`: drops off browse, read-only for members, blocks joins/plans/polls/invites/conversions | `PUT /:id/status` | Keep |
| F50 Delete | No hard delete anywhere | — | **Don't add** (see §10, D-07) |

## 2. Current UX/UI problems

1. **Circle Home has no hierarchy.** Eleven stacked sections plus a five-card sticky rail. "What's next" competes
   with About, Moments, nearby recommendations and Planning; members have to scroll past marketing-style content to
   reach planning, which is the reason they came back.
2. **Planning is buried and members-only content is mixed with visitor content.** The same page serves a visitor
   deciding to join and a member coming back; the page doesn't change shape for either.
3. **Plan ideas have no interest signal.** A suggestion gets no "I'm in" — the organiser can't tell whether 1 or 12
   people want it, so the confirm step is a guess.
4. **Polls only take dates** (no time choices in the UI, though the API supports `time`).
5. **"Moments" are venue photos**, so they say nothing about the Circle itself, and show nothing for a Circle with
   no venue.
6. **No welcome after joining.** Joining an open Circle just re-renders the page; nothing says what to do next.
7. **Create form:** no preview; essential and optional fields aren't grouped; cover can only be added after
   creation; **a failed create shows no error** (`handleCreate` has `try/finally` with no `catch`, so a 400 — e.g.
   an invalid category — is an unhandled rejection with the button just re-enabling); labels "Area"/"County" have no
   required marking or help; no field-level validation.
8. **Discussions open in a modal**, so the Circle's main conversation is never visible on the Circle page itself.
9. **Mobile:** the sticky join bar duplicates the rail card; the 4-column plan grid collapses to one long list.
10. Circle settings labels not linked to inputs (from the 2026-10-23 form inventory).

## 3. Database tables and relationships

No foreign keys anywhere in the schema (project convention — relationships are enforced in application code; see
CLAUDE.md). All IDs are `VARCHAR(191)` UUIDs except auto-increment members/options.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `circles` | The Circle | `status` active/closed, `join_mode` open/approval/invite, `join_questions` JSON, `slug`, `image_url`, `what_we_do`, `who_can_join`, `circle_values`, `centre_id`, `created_by_resident_id` |
| `circle_members` | Membership | `UNIQUE(circle_id, resident_id)`, `role` member/organiser (multiple organisers allowed), `muted_until`, `muted_by` |
| `circle_invites` | Invites **and** join requests | `UNIQUE(circle_id, resident_id)`, `initiated_by` organiser/resident, `status` pending/accepted/declined/revoked, `note`, `answers`. **No expiry column** |
| `circle_polls`, `circle_poll_options`, `circle_poll_votes` | Date polls | votes PK `(poll_id, option_id, resident_id)`; `plan_id` optional link |
| `circle_plans` | Plan ideas | `status` idea/confirmed/activity_created/cancelled (`completed` derived); `activity_source_type/id` → the game |
| `games.circle_id` / `games.plan_id` | Official Circle activities | set only by an organiser |
| `programs/experiences/clubs.circle_id` | Official Circle for vendor listings | only Circles organised by the vendor's own org |
| `chat_messages` (`scope_type='circle'`), `chat_reads` | Circle discussion | hidden/hidden_by/reason for moderation |
| `listing_categories` / tags (taxonomy) | Circle category + tags | `taxonomy.ts` family `circle` |
| `reports` | Circle + chat message reports | polymorphic target |
| `audit_log` | Mute/unmute, announcement, invite revoke | `writeAudit()` |
| `notifications` (`resident_id`, `kind='circle'`) | In-app resident notifications | |
| `participation_intents` | Platform demand (not Circle) | `UNIQUE(client_id, activity_label, county)` |
| `residents.availability`, `.interests` | Profile preferences (CSV) | |

## 4. API contracts (all under `/api/circles`, resident cookie session)

Public/visibility-checked: `GET /` · `GET /:id` (full or teaser) · `GET /:id/members` · `/upcoming` · `/plan-ideas`
· `/plan-ideas/:planId` · `/recent-activity` · `/moments` · `/activity` · `/polls`.
Resident: `GET /mine` · `/suggestions` · `/:id/membership` · `/invitations/mine`.
Member mutations: `POST /:id/join` · `DELETE /:id/join` · `POST /:id/plan-ideas` · `PATCH /:id/plan-ideas/:planId`
(creator while idea, or organiser) · `POST /:id/plan-ideas/:planId/cancel` (same rule) · `POST /:id/polls` ·
`POST /:id/polls/:pollId/options/:optionId/vote` · `POST /:id/share` · `POST /invitations/:id/respond`.
Organiser: `GET /:id/plans` · `/join-requests` · `POST /join-requests/:id/respond` · `PUT /:id` · `PUT /:id/status`
· `POST /:id/members/:rid/{remove,promote,demote,mute,unmute}` · `POST /:id/invite` · `GET /:id/invitations` ·
`POST /:id/invitations/:id/revoke` · `POST /:id/polls/:pollId/close` · `POST /:id/plan-ideas/:planId/confirm` ·
`GET /:id/moderation` · `POST /:id/announcements`.
Elsewhere: `POST /api/games` with `circleId`/`planId` (organiser-only conversion) · `/api/chat/circle/:id/*`.

Client wrappers live in `client/src/api/resident.ts` / `public.ts`; types in `packages/types` via `client/src/types.ts`.

## 5. Permission rules (server-enforced today)

- **Read:** an open Circle's content is public; an approval/invite Circle's content is member-only
  (`canViewCircleFull`), with a strict allow-listed teaser for everyone else. Cover URLs for non-open Circles are
  never returned raw — only through the protected signed endpoint, which re-checks membership.
- **Member:** suggest plans, create polls, vote, chat, share into the Circle. Polls/votes resolve the poll *through*
  the authorised Circle (no cross-Circle id pairing, HC-QA-013).
- **Organiser** (`circle_members.role = 'organiser'`, any number): everything in the organiser list above. Can't be
  muted or removed by another organiser through `remove` (only `role='member'` rows are removable). A Circle can never
  reach zero organisers.
- **Closed Circle:** no joins, approvals, invites, plans, polls, conversions, announcements.
- **Activity conversion:** organiser only, plan must be `confirmed` and belong to the Circle, normal game rules apply
  (paid needs a verified host unless the admin switch is off; venue booking check; visibility follows join mode).
- **Platform admins** moderate Circles through reports (`reports.moderate`); no admin Circle-edit route.
- There are **no** delegated Circle roles beyond member/organiser. The brief's "existing delegated Circle roles, if
  supported" → not supported; none will be invented.

## 6. Reusable components and infrastructure

`ui.tsx` (Button, LinkButton, Card, StatusBadge, EmptyState, ConfirmDialog, Modal, LoadErrorState),
`components/form.tsx` (FieldLabel, RequiredNote, useFormErrors, FieldError, FormErrorSummary, useUnsavedChangesGuard),
`CategoryPicker`/`TagPicker`, `SingleImageUpload` + media pipeline (R2/local AVIF, protected entity types),
`ChatModal` (chat thread), `ShareButton`, `useSavedState`, `ConfirmProvider`, `ActionMenu`, `WorkspaceShell` +
`useUrlTab`, `IntentCaptureForm`, `participationVocab` (day:slot tokens, both sides), `irelandTime.ts`
(DST-aware), `notifyResident()` with per-kind prefs, `writeAudit()`, `rateLimit.ts`, `reports`, `logEvent()`,
`app_settings` + `getSetting()` (5-second cache) + `GET /api/config`, admin `platform.settings` permission.

## 7. Missing capabilities

1. Circle Pulse (Circle-scoped "I'd like to do X on Y") with aggregate counts and expiry.
2. Free Time Match (opt-in, Circle-scoped, per-week availability; aggregate overlap).
3. Interest on plan ideas ("I'm in" / withdraw), interest counts, a *ready for review* signal, expiry of stale ideas,
   notifying interested members on conversion.
4. Member-contributed Circle Memories tied to a past Circle activity, with consent, removal and reporting.
5. Welcome step after joining + first-time guidance surfaced on Circle Home and on the next activity.
6. Circle Home with tabs (Home / Activities / Discussions / Polls / Members / Memories).
7. Create form with live preview, grouped sections, inline validation, visible errors.
8. Feature flags for the new capabilities (no generic resident feature-flag system exists — only `app_settings`
   keys and the commerce switch catalog).
9. Invitation expiry (no `expires_at` on `circle_invites`) — **not** proposed for this pass (see D-list).
10. Restriction after removal (see D5).

## 8. Proposed implementation approach

**Reuse first.** No new framework, no migration tool; all schema through `initSchema()` + `ensureColumn` / `CREATE
TABLE IF NOT EXISTS`, application-enforced relationships (project convention — the brief's "foreign keys" item is
met with unique keys, indexes and in-code ownership checks, matching every other table).

| Feature | Approach | New schema |
|---|---|---|
| Feature flags | `server/src/circleFeatures.ts`: catalog of `circles.pulse`, `circles.free_time_match`, `circles.make_it_happen`, `circles.first_time_friendly`, `circles.memories`, default **off**; read via `getSetting`; exposed in `GET /api/config` as `circleFeatures`; admin toggle under Settings gated by the existing `platform.settings` permission, audited. Routes return 404 `{error:"Not available"}` when off | `app_settings` rows only |
| Pulse | New `circle_pulses` table (one row per member per interest window). **Not** `participation_intents`: those are keyed per device + county, feed vendor demand dashboards and vendor/host opportunity counts, and notify providers — putting private Circle interest there would leak it into provider-facing aggregates. Interest label limited to the Circle's own activity + its category's subcategories + free text (≤60 chars). Windows from the shared `day:slot` vocabulary scoped to a week. Aggregates only, minimum group threshold | `circle_pulses` |
| Free Time Match | New `circle_availability` (one row per member per Circle per week, `slots` CSV of `day:slot`, `expires_at` = end of that Ireland week). Opt-in by submitting; withdraw deletes. Matching = pure deterministic function over (Pulse interests × availability) in Ireland time, counts only, threshold 3 | `circle_availability` |
| Make It Happen | **Extend `circle_plans`** (no parallel proposals table): add `circle_plan_interest` (member, plan, unique), `expires_at`, `target_size`, `source_pulse_key`; display status *Gathering interest* / *Ready for review* derived from count ≥ target; organiser confirm → existing activity creation flow (unchanged transaction + guard); on conversion notify interested members once; audit organiser confirm/cancel/convert | `circle_plan_interest` + 3 columns |
| First-Time Friendly | Welcome panel after join (client, dismissible, per-membership via `circle_members.welcomed_at`); "First time?" guidance block on Circle Home's next activity using existing game fields (meeting instructions, equipment, experience required, solo friendly, organiser); never claims "your first time" unless `game_participants` history proves it. Buddy system **deferred** (see D6) | `circle_members.welcomed_at` |
| Memories | New `circle_memories` (photo or reflection, optional caption, linked to a past Circle game the contributor joined), new media entity type `circle-memory` (protected, membership re-checked, same as `circle-cover`), contributor consent checkbox, removal by contributor or organiser, reportable, visibility per D4 | `circle_memories` |
| Circle Home | Rebuild `CircleDetail.tsx` as a tabbed hub reusing existing child components; visitor view stays the public pitch; member view leads with Next up → Pulse → Make it happen → Conversations → Memories. URL tab (`?tab=`). Tabs for disabled features are hidden, not empty | — |
| Create/Edit | Rebuild `StartCirclePage.tsx` as 70/30 sectioned form with live preview from real state, visible server errors, double-submit guard, no Save Draft (no draft persistence exists) | — |
| Organiser workspace | Extend `ManageCircle.tsx`: Overview counts (pending requests, active proposals), a "Pulse & proposals" tab, memories in Moderation | — |

## 9. Technical risks

1. **Name collision — "Make It Happen".** `/make-it-happen` already exists: a facility-booking orchestrator (book a
   room + Open Booking cost-sharing), currently **paused** behind `commerce.open_booking` (P0 pricing bug, booking
   audit 2026-10-11). Reusing the name for Circle proposals risks confusion in code, analytics and support. → **D1**.
2. **Privacy of aggregate counts.** In a 3-member Circle, "1 member wants hiking" identifies the person. Mitigation:
   counts shown to others only at ≥ 2 (Pulse) / ≥ 3 (Free Time Match); below that "Be the first" copy; never list who.
3. **Media consent.** Member photos of other people. Mitigation: members-only visibility (D4), contributor confirms
   consent, any member can report, organiser/contributor removal, platform hide via reports.
4. **Erasure (D-07 still open).** New tables hold personal data; nothing is deleted today. They will be listed in the
   report for the future erasure job; leaving a Circle removes the member's Pulse and availability rows immediately.
5. **Notification volume.** Pulse/interest must not notify on every tap. Only threshold crossings (once per window,
   idempotent) and conversions notify.
6. **CircleDetail rewrite regressions.** Existing Playwright specs (`join-visibility`, `invitation-*`,
   `hc-og-*`, `chat-closure`) and `circles.test.ts` assert on this page/API; selectors and behaviours must survive.
7. **Week maths across DST.** Use `irelandTime.ts`; ISO Monday of the Ireland-local week as the key.
8. **Polling load.** Pulse/match are read on page load only — no new polling.

## 10. Required product decisions

Defaults in **bold** are what I'll build if the owner agrees; none changes existing behaviour.

- **D1 Name for Circle proposals.** **Use "Make it happen" as the Circle section title but keep the object a
  "plan"** (the paused `/make-it-happen` page is unlinked from navigation while paused) — or rename to avoid the
  collision entirely (e.g. "Suggested plans").
- **D2 Design tokens.** The brief asks for 2–4px corners, no pills and Bricolage. Owner decisions already in force:
  Bricolage headings + Inter body, 4px buttons, 16px cards, pill chips, orange public CTA. **Keep the owner's
  current tokens** (the brief also says "use HelloCircle's existing branding").
- **D3 Pulse storage.** **New Circle-scoped table**, not `participation_intents` (reason in §8). This departs from
  the Release 6 rule "extend participation_intents, no new request tables", which was about *platform* demand.
- **D4 Memories visibility.** **Members only, in every join mode** (an open Circle's photos of people are not made
  public) — or follow the join mode.
- **D5 Removed members.** Today a removed member can rejoin an open Circle immediately. **Block rejoining after
  removal until an organiser lifts it** (new restriction, audited) — or keep current behaviour.
- **D6 Welcome buddy.** **Defer** (needs safeguarding rules: who can volunteer, vetting, children). Guidance and
  welcome step ship without it.
- **D7 Hard delete of a Circle.** **Not added** — Close stays the only lever until D-07 (deletion/retention) is
  decided.
- **D8 Invitation expiry.** **Not added in this pass** (would change existing invites' behaviour); expired/invalid
  invitations already show "no longer available".

### Owner answers (2026-10-23)

D1 "Make it happen" section, items stay "plans" · D2 keep current tokens · D4 memories members-only always ·
D5 removal blocks rejoining until an organiser lifts it. D3, D6, D7, D8 proceed on the defaults above.

## 11. Phase plan

0 Audit (this doc) → 1 Foundation (flags, Create/Edit redesign, Circle Home tabs, membership states, welcome) →
2 Pulse → 3 First-Time Friendly → 4 Free Time Match → 5 Make It Happen (plan interest) → 6 Memories → 7 Final QA
(server suite in the isolated Docker profile, client tests, browser checks at 375–1920px, security tests).
Results go into `docs/circle-experience-2-implementation-report.md`. Nothing is committed, pushed or deployed.
