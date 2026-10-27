# 08 — Implementation report

## Server
- `server/src/circleFeatures.ts` — new switch `circles.visitor_experience` (default off).
- `server/src/db/index.ts` — `ensureColumn("circles", "solo_welcome", TINYINT(1) NULL)`.
- `server/src/routes/circles.ts` — `GET /:id/visitor` (visitor-safe data, see 05); `POST /` and `PUT /:id` accept `soloWelcome`; `toCircleJson` returns `soloWelcome`.
- Tests: `routes/circleExperience.test.ts` "Circle Experience 4.0 — visitor page data" (switch off → 404; open: upcoming + counts, no names; approval: titles but no cover/counts; invite: teaser; organiser-only solo setting).

## Client
- `components/circle/CircleVisitor.tsx` — new visitor page sections.
- `components/CircleJoinCard.tsx` — `bare`, `autoJoin`, `joinSignal`; signed-out join keeps intent (`?join=1`); click analytics.
- `pages/CircleDetail.tsx` — visitor mode, visitor data fetch, tabs (Overview · Activities · About), phone join bar, join analytics, organiser setup checklist.
- `pages/ManageCircle.tsx` — "Do people often come on their own?" (Don't say / Yes / No).
- `api/circleExperience.ts` `fetchCircleVisitor`; `api/resident.ts` `soloWelcome`; `packages/types` `CircleVisitorView`, `Circle.soloWelcome`, switch key; `circleFeatures.ts` default.
- Styles: `cv-*` in `components/circle/circleExperience.css`.
- Browser spec: `tests/integration/specs/circle-visitor-4.spec.ts` (batch `product-circle-visitor-4`).

## Dev data
`hello_circle_dev` has the switch on. Mock Circles for every state (`ce2-mock-sutton-sea-dippers` approval with a pending request from `ce2-out`; `ce2-mock-clontarf-book-swap` new and empty) are in the scratchpad `ce2-mock.sql` (re-runnable, `ce2-mock-` ids).

## Not built (by decision)
- Public highlights from member memories (decision 1; would need contributor consent — a new privacy feature).
- A separate invite-only visitor experience (decision 5).
