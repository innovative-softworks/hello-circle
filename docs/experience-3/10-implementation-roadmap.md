# Experience 3.0 — 10 Implementation roadmap (as executed, 2026-10-23)

Owner answers: D1 rough travel estimate · D2 proposer owns, partner linked · D3 Passport private · D4 alerts for
experience departures only.

| Phase | Brief | Done here |
|---|---|---|
| 0 Audit | inventory, gaps, decisions | `01-current-state-audit.md`; D1–D4 answered |
| 1 Foundation | shared controls, states | one switch catalogue (`circleFeatures.ts`), admin card grouped by programme, `durationKnown` on the shared activity list, reused Circle 2.0 layout classes |
| 2 Customer value | Smart Match, Free Time, Go Solo, alerts, Coming Up | Smart Match refine, duration fix, Going solo, Surprise me, collections, spot alerts (Coming Up already existed) |
| 3 Community | Pulse, Make It Happen, Join Together, onboarding, repeat | already built (Circle 2.0, invitations, rehost) — not rebuilt |
| 4 Personal | Passport, Saved Plans, Programme Journey, Volunteering, prep | Passport, saved day plans, programme journey, Get ready; volunteering shown in the Passport (no hours) |
| 5 Coordination | Free Time Match, Plan My Day, collaboration, weather | Plan My Day, Circle-to-Circle; weather not built (no data source) |
| 6 Partner intelligence | host/vendor insights, quality, admin analytics | existing features kept; no new dashboards |
| 7 Verification | regression, security, a11y, responsive | see `11-qa-and-test-results.md` |

Suggested switch-on order for staging: Get ready → Programme journey → Find something for me + Going solo →
Collections → Spot alerts → Activity Passport → Plan My Day → Circle-to-Circle.
