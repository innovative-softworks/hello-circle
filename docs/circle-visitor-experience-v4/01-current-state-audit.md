# 01 — Current-state audit (Circle Experience 4.0)

Date: 2026-10-24. Branch: `feature/circles-and-experience-3` (uncommitted).

## What a visitor got before this work

| | Open Circle | Approval / invite Circle (non-member) |
|---|---|---|
| Page | The member Home layout without the planner: banner, Next up, Recently together, About our community, contextual join band, venue Moments, More happening near you | A short teaser: back link, cover (if any — but non-open covers are members-only, so usually blank), name, about, one-line meta, the join card |
| API | `canViewCircleFull()` = true: members list, upcoming, plan ideas, **polls**, recent activity, moments, activity stats all public | Every sub-resource 403; `GET /:id` returns an allow-list teaser (approval adds member count + organiser) |
| Never public | Memories (D4), chat, Pulse wishes, free time | same |

Screenshots: `screenshots/01-before-open-signed-out-desktop.png`, `02-before-approval-non-member-desktop.png`, `03-before-open-signed-out-phone.png`.

## Reused as-is
- Join state machine and dialogs: `CircleJoinCard` (open join confirm, approval request with up to three questions + note, pending with withdraw, invite accept, D5 restriction, closed).
- Sign-in intent: `signInHref()` → `returnTo` (same-origin guard).
- Welcome after joining: `CircleWelcomePanel` (`circles.first_time_friendly`, once, `circle_members.welcomed_at`).
- Server analytics: `circle_viewed`, `circle_joined`, `circle_join_requested` (`analytics.ts`).
- Client analytics: `trackEvent()` (dataLayer, consent-gated).
- Visibility: `circleOwnGames()` + `filterViewable()` (private/members-only activities never leave the server for a visitor).
- Feature switches: `circleFeatures.ts` catalogue, `GET /api/config`, admin Settings.

## Missing (built here)
- A visitor page that explains and welcomes (identity + one Join action above the fold, highlights, what happens, upcoming, people, first time, community preview, closing CTA).
- One visitor-safe data call that also works for approval Circles.
- Honest "Coming on your own?" at Circle level (organiser field + activity-majority fallback).
- "A new Circle is taking shape" state, and an organiser setup checklist.
- Join intent continuing through sign-in (`?join=1`).
- Visitor tab set (Overview · Activities · About).

## Unchanged on purpose
- All member and organiser functionality; the member Home is untouched.
- Server visibility rules (`canViewCircleFull`, cover access, memories D4).
- Join, request, approval and restriction rules.
