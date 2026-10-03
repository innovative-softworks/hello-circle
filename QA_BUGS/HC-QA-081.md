# HC-QA-081 — Vendor/admin polish: approval drill-down, €0 live listing, session/departure controls, free-text county

Severity: P3. Category: UX. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /admin, /vendor, /vendor/programs/:id, /vendor/experiences/:id
- **Actor:** Vendor, Admin
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Approve a vendor as admin; set up programs/experiences as vendor.

- **Expected:** Clear next actions; no misleading listing data; vendors can correct schedule mistakes from the row.
- **Actual:** Admin listing Approve is disabled with 'Approve the vendor account first' but offers no link; vendor approval is behind Vendors → View. New centre is 'Live' with 'Capacity 0 · from €0/hr'. Program session rows show only Check-in/Attendance; experience departure rows only date/time + Chat (no booked/capacity, no visible edit/cancel). Experience County is free text while other forms use a county select. Overview has an 8-step checklist and My centre a different 3-step one.
- **Evidence:** admin2/admin3 outputs; vendor-tab-Mycentre.png; vend8/vend16 outputs.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
