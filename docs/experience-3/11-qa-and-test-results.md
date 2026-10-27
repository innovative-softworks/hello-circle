# Experience 3.0 — 11 QA and test results (2026-10-23, local)

| Suite | Result |
|---|---|
| Server, isolated Docker profile (`npm run test --workspace server`) | 125 files, **1,122 passed**, 23 skipped (live-provider tests). New: `discoveryMatch.test.ts` (9), `dayPlanner.test.ts` (9), `routes/experience3.test.ts` (13: switches, duration fix, Smart Match/solo/surprise, collections, spot alerts incl. once-only and held places, Passport privacy, journey ownership, Plan My Day + saved-plan ownership, Circle-to-Circle approval/visibility/duplicate) |
| Client (`vitest`) | 40 files, **321 passed** |
| Production build (`npm run build`) | Passes (chunk-size warning predates this work) |
| `qa:product` (isolated, real browsers) | **82 passed**, 1 skipped by design (perf) — includes new `experience-3.spec.ts` (EX3) and `circle-experience-2.spec.ts` (CX2) |
| `qa:lifecycle` | **52 passed** |
| `qa:validation` | 52 passed, 1 failed — **CAT-PUBLIC**, caused by the earlier uncommitted Activities filter redesign (`Games.tsx` `subChips={false}`), not this work; the runner stops there, so `validation-categories-b` (vendor/admin category tools) didn't run |
| Responsive (dev, page-level sideways scroll) | No overflow at 375, 390, 768, 1024, 1280, 1600, 1920 on Plan My Day, Passport, adventure detail, Explore, Free Time Mode |
| Manual (dev, `ce2-`/`ce3-` fixtures, email/push/Stripe blanked) | Going solo returns only host-marked listings; collections only non-empty; Passport shows checked-in and self-confirmed items only; journey states from registers; Plan My Day chains two stops with a 30-minute rough estimate and skips the listing without a length |

Security checks covered by tests: switched-off routes 404; non-members/strangers get 403/404 (journey, plans,
collaborations); a session of another experience 404s; duplicate alerts idempotent; concurrent sweeps guarded
(conditional update); only the partner Circle can accept; collaboration activity can't be created twice (409);
saved plan items must be same-day with internal links.

Not run: `qa:stripe`, `qa:revenue`, `qa:booking`, `qa:authorization` (no payment, booking or auth code changed);
screen-reader pass; performance baseline (no new heavy queries beyond the existing `listScheduledActivities`).

Incidents during QA: Docker Desktop stopped mid-session, which wiped the harness's tmpfs QA database; the stale run
was disposed by hand (same steps as `qa:db:reset`) and a fresh isolated run provisioned and seeded. A `pkill` also
stopped two older dev-only QA API processes (ports 3101/3201) left from earlier work in this session.
