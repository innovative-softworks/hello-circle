# HC-QA-061 — Experience editor shows wrong price/duration (NaN or defaults) for saved listings

Severity: P2. Category: FUNCTIONAL. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /vendor/experiences/:id (resumed draft wizard and post-publish settings view)
- **Actor:** Vendor
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Create an experience: price €25, duration 180 min, meeting point, itinerary; save each step.
2. Reopen the draft later (or open it after submitting for review).

- **Expected:** The editor shows the saved values.
- **Actual:** Resumed wizard review shows '€NaN/person · cap 8 · min' and blank meeting point; settings view shows '€0.00/person · cap 8 · 120 min' (form defaults) while the DB holds 2500 cents / 180 min. Untouched fields were NOT overwritten in repro (the PUT omits undefined fields; capacity-only edit kept 2500/180), so this is a display/confusion defect — but a vendor who 'corrects' the apparently wrong price will save whatever they type. React logs controlled→uncontrolled and NaN-attribute warnings.
- **Evidence:** server/src/routes/vendorExperiences.ts:96-101 GET returns SELECT * (snake_case: price_cents, duration_minutes, meeting_point); components/ExperienceCreationWizard.tsx:135-160 hydrates camelCase (e.priceCents, e.durationMinutes, e.meetingPoint); DB check after resave unchanged; screenshots exp2-step-6.png, exp-submitted.
- **Root cause (if known):** Response shape mismatch between the vendor GET and the client type (only single-word fields like area/county survive).
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** `GET /api/vendor/experiences/:id` returned the raw snake_case row while the editor reads camelCase, so price/duration/meeting point hydrated as undefined (€NaN, defaults). The update route also accepted negative/fractional values.
- **Fix:** Vendor GET returns a camelCase mapping (raw columns kept for compatibility); create/update validate priceCents (integer ≥ 0), durationMinutes and capacity (integers ≥ 1) and reject with 400 without touching stored data; settings-editor price/duration/payment inputs labelled. (`routes/vendorExperiences.ts`, `components/VendorExperiences.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-061` FAIL before (API snake_case) → PASS (editor shows €12.50 · 180 min, no NaN, stored values unchanged after walk-through). `-EDIT`: decimal edit 25 → 12.5 persists 1250, reload shows it, legitimate 0 shows €0.00, invalid -500/12.5/-10/0 → 400 with stored data unchanged. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** —
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
