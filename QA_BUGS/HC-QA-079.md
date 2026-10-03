# HC-QA-079 — Activity detail polish: stale avatar after leaving, duplicate description, copy and badge issues

Severity: P3. Category: UX. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /games/:id, /games
- **Actor:** Resident
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Join then leave a session; read the detail page.

- **Expected:** Who's-going reflects the leave; no duplicated content; grammatical copy.
- **Actual:** After leaving, the leaver's avatar stays in 'Who's going' until reload (count updates). Description shown twice (hero + 'About this plan'). 'Tell HelloCircle when you'd like to five-a-side football.' (noun labels break the sentence) and the interest prompt still shows after joining. On /games cards the 'Coming soon' badge is clipped by the favourite heart.
- **Evidence:** user4.mjs/user5.mjs output; games-list.png.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
