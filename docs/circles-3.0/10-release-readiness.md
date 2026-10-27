# Circles 3.0 — 10 Release readiness

## Decision: CONDITIONAL GO for the universal plan reference (Phase 1 core); NO-GO for "Circles 3.0 complete"

**Ready (evidence in 08):** plans can reference every existing listing type, live state, duplicate and visibility
protection, no second listing, Plan with my Circle, share-as-plan, plan reports.

**Conditions before shipping the core:**
1. ~~Owner decisions~~ — taken 2026-10-28: events = dated activities/experiences; venue references without links
   while gated; share-as-plan off by default; no partner promotion into Circles; one plan across two Circles (built);
   no recurring plans ("Suggest again" built).
2. Run the guarded Playwright suites (client unit tests pass, 321/321); fix the full-run-only complaints failure.
3. Browser passes done for experience, adventure, programme and activity; volunteering (no dev listing with dates)
   and venues (pages gated) not exercised in a browser.

**Since built:** My Life "Plans you're in", "Explore with others", provider-cancellation notices, report button on
plan cards, "No dates yet" state.

**Also built:** admin Close Circle / Reopen with reasons (organisers can't undo a HelloCircle closure).

**Also built:** day-before plan reminders; "Planned together" under Circle Home's Next up. Accessibility (0 axe violations) and the 320–1920 sweep pass on every new screen.

**Also built:** one plan shared between two Circles; "Suggest again".

**Not done:** nothing from the brief is left unbuilt except what the owner decided against. Journeys A, G, I, J are covered by existing work or tests;
B–F need the browser passes above; H covered by the cancelled-departure test.

No production data touched; nothing committed, pushed or deployed.
