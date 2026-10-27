# Circles 3.0 — 06 API and database changes

## Database (additive, `initSchema()`)

`circle_plans`: `listing_type VARCHAR(20) NULL`, `listing_id VARCHAR(191) NULL`, `listing_session_id VARCHAR(191) NULL`,
index `idx_circle_plans_listing (circle_id, listing_type, listing_id)`. No backfill. No foreign keys (convention);
integrity is checked in `circlePlanListings.ts`.

## API

| Route | Change |
|---|---|
| `POST /api/circles/:id/plan-ideas` | Optional `listing: { type, id, sessionId? }`. Title/date default from the listing. Errors: 400 bad reference, 403 not a member, 404 listing not visible, 409 finished/cancelled, 409 private activity outside its Circle, 409 `{ error, planId }` already suggested |
| `GET /api/circles/:id/plan-ideas` (+ `/:planId`, and every plan response) | Adds `listing: CirclePlanListing \| null`, resolved live for the viewer |
| `POST /api/circles/:id/share` | Optional `addAsPlan: true` → response `planId` (new or the existing open plan) |
| `POST /api/games` with `planId` | 409 when the plan references an activity/experience/programme |
| `POST /api/reports` | New `targetType: "circle_plan"`; admin action "Remove plan" (reason required) |

`CirclePlanListing`: `{ type, kind, id, sessionId, title, imageUrl, date, time, where, priceCents, href,
availability, spotsLeft, myState, bookingNote, restricted }` — see `packages/types`.

## Client

`components/circle/CirclePlanListing.tsx` (plan card block + CTA), `components/circle/PlanWithCircle.tsx`
(listing-page dialog), Plans kind filter in `CirclePlanTogether.tsx`, share-sheet checkbox, admin report case for
`circle_plan`.
