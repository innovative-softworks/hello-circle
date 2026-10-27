# Circles 3.0 — 01 Existing system audit

Date: 2026-10-27 (completed 2026-10-28) · Status: audit done; Phase 1 core built — see 03 and 07.
Builds on `docs/circle-experience-2-audit.md` (2026-10-23), `docs/experience-3/`, `docs/circle-visitor-experience-v4/`.

Verification level for everything below: **code read only** (not yet exercised in a browser or the isolated test DB)
unless stated otherwise. Nothing is marked Complete on code existence alone.

## Headline so far

Circles already have a large, working community layer (join modes, approvals, invitations, organisers, plan ideas
with interest, polls, chat, Pulse, Free Time Match, memories, collaborations, moderation, visitor page, welcome).
The main Circles 3.0 gap is **universal listing integration**:

1. **A Circle plan can only become an Activity (game).** `circle_plans` has free-text title/date/time/location and
   `activity_source_type/id`, set only by the game conversion (`POST /api/games` with `planId`). There is no reference
   from a plan to an Experience, Adventure, Volunteering opportunity, Programme / Programme session or Place.
2. **"Share with a Circle" leaves no record in the Circle.** `POST /api/circles/:id/share` (members only) resolves the
   listing through `getShareData()` (visibility-checked: approved, org active) and sends each member a notification —
   nothing is stored, so shared listings never appear on the Circle page, in Plans, or in My Life.
3. **Events are not a listing type.** "Events this weekend" is `/explore?when=weekend` (a filter). Circle "Events"
   support must mean dated activities/experiences, not a new event model → needs a product decision.
4. **Places are gated.** Centre/club pages redirect to `/coming-soon` unless `VITE_VENUE_PAGES_PUBLIC=true`;
   place references in plans must not link to gated pages (show venue info only).

## Matrix (partial)

| Feature | Current implementation | Frontend | Backend | Database | Status | Priority | Action |
|---|---|---|---|---|---|---|---|
| Plan ideas (suggest / interest / confirm / decline / cancel) | Free-text plans, "I'm in" interest, organiser confirm/decline with reason, audit | `circle/CirclePlanTogether.tsx`, `CircleMakeItHappen.tsx` | `routes/circles.ts` plan-ideas, `circleExperience.ts` interest | `circle_plans`, `circle_plan_interest` | Partial (activities only) | P0 | **Extend**: listing reference |
| Plan → Activity | Organiser converts confirmed plan; same transaction + guard | `/games/host?circleId&planId` | `games.ts createGameRow` | `games.circle_id/plan_id` | Implemented (verified in CE2 QA) | — | Reuse |
| Plan → Experience / Adventure / Volunteer | None | — | — | — | Missing | P0 | Build (reference, book via original flow) |
| Plan → Programme / session | None | — | — | — | Missing | P0 | Build (programme vs session kept distinct) |
| Plan → Place | Free-text `location_text` only | — | `placeSuggestions.ts` is platform-level | — | Missing | P1 | Build (venue info, no booking claim while gated) |
| Share listing to Circle | Notification only, no persistence | `ShareSheet.tsx` ShareToCirclePane | `circles.ts POST /:id/share`, `sharing.ts getShareData` | none | Partial | P0 | Extend: optionally become a plan suggestion |
| Official Circle on vendor listings | `circle_id` on programs/experiences/clubs (vendor's own org Circles) | `OfficialCircleLink.tsx` on Experience, Programme, Club pages; game page links back | vendor routes | `*.circle_id` | Implemented | — | Reuse |
| Listing page "Plan with my Circle" | None (only Share sheet) | — | — | — | Missing | P1 | Build (secondary to booking CTA) |
| Explore Circle discovery | Circles category + `CircleDiscoveryCard`, search returns circles | `Explore.tsx` | `discover.ts`, search | — | Partial | P1 | Extend ("Explore with others" on listings) |
| My Life Circles | My Circles, Circle cards, upcoming Circle plans this week | `MyBookings.tsx`, `MyLifeCircles.tsx` | `/circles/mine`, my-life | — | Partial (no "interested" plans) | P1 | Extend |
| Circle Home tabs | home, activities, discussions, polls, members, memories, about (URL tab) | `pages/CircleDetail.tsx` | — | — | Implemented | — | Reuse; add Plans type filter |
| Before-join | Visitor page behind `circles.visitor_experience` | `circle/CircleVisitor.tsx` | `GET /:id/visitor` | — | Implemented (CE4 QA) | — | Reuse |
| Reports | `reports` table; Circle and chat message targets | — | `reports.ts`, `reportModeration.ts` | `reports` | Partial (plan not a target — to confirm) | P1 | Verify / extend |
| Admin Circles | Admin nav "Circles" (support.search), categories | `components/admin` | `admin.ts`, `adminCategories.ts` | — | Partial (to audit: suspend/restrict Circle) | P1 | Audit |
| Circle collaboration | Circle-to-Circle shared activities | `CircleCollaborations.tsx` | `circleExperience.ts` collaborations | `circle_collaborations`, `games.partner_circle_id` | Implemented (behind switch) | — | Reuse |

## Not yet audited (next steps)

- Admin Circle suspend/restrict and moderation history; whether `circle_plan` is a report target.
- Notifications for plan changes/reminders and dedupe; preferences per kind.
- Host/Vendor share-to-Circle surfaces; Circle-originated booking attribution (none expected).
- Mobile/responsive and accessibility checks; running the existing Circle tests in the isolated profile.
- Then: `02-unified-circle-plans-architecture.md` (proposal: extend `circle_plans` with a validated
  `listing_type`/`listing_id` reference, no booking/pricing/inventory of its own) and the remaining docs 03–10.

## Product decisions likely needed

1. **Events:** treat "events" as dated activities/experiences (no new event type) — or define an event listing.
2. **Places while venue pages are gated:** allow venue references with info only, no link — or wait.
3. **Share → plan:** should sharing a listing into a Circle also create a visible plan suggestion, or stay a notification?
