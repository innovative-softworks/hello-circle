# Circles 3.1 — 10 Release readiness

**CONDITIONAL GO.** Create, link and organise from a Circle works for activities, plans and polls end to end, and
linking works for every listing type; tests and build pass (08). Conditions before production:

1. One browser pass of partner create-from-Circle with a real organiser who has a linked partner account (staging).
2. The guarded Playwright suites (`npm run qa:*`) on the release branch.

Known limits (by design): events are activities with dates; places are linked, not created, by members; partner
listings are created only for Circles the partner's organisation organises; links are not bookings or plans.
