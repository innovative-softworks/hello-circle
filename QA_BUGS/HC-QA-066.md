# HC-QA-066 — Mouse-only click targets across the app (40 instances)

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** My Life activity rows, vendor Bookings rows, Explore follow feed, photo gallery, footer logo, provider profile, admin and others
- **Actor:** Keyboard / screen-reader users (resident, vendor)
- **Viewport / browser:** All; Chromium

**Steps**

1. Using only Tab/Enter, try to open an activity from My Life, or a booking's details from Vendor → Bookings.

- **Expected:** Every clickable item is a link or button reachable by keyboard.
- **Actual:** 40 elements use <div|span|li onClick> without role/tabIndex/key handler (static scan of 16 files). Key journeys affected: My Life activity rows (GameRow) and vendor booking-detail rows have no focusable element inside.
- **Evidence:** pages/MyBookings.tsx:295; components/VendorBookings.tsx:589; pages/Explore.tsx:37; components/PhotoGallery.tsx:42; components/Footer.tsx:68; full list from scratch scan (Footer 6, MyBookings 6, AdminDashboard 6, VendorBookings 4, ui.tsx 4, PhotoGallery 3, ProviderProfile 2, …). HC-QA-052 is the most severe instance.
- **Root cause (if known):** Pattern repeated despite the ui.tsx keyboard helper.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** My Life rows and vendor booking rows were `<div onClick>` with no focusable element.
- **Fix:** My Life activity/Circle rows are real `<Link>`s (experience/programme row headers too); vendor booking rows: compact row is a `<button>`, table and mobile cards expose a named `<button>` ("Open booking for …") opening the same detail; mouse behaviour unchanged; full-activity toggle gained `aria-expanded`. (`pages/MyBookings.tsx`, `components/VendorBookings.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-066` FAIL before ("row reachable by Tab as a link", re-established against the pre-fix rows after correcting the test to expand Full activity first) → PASS (Tab reaches named links with visible focus, Enter opens). `-VENDOR` (desktop table + mobile card): native tabbable named button, visible focus, Enter opens the booking dialog. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Remaining `div onClick` instances outside these surfaces (footer logo, photo gallery, admin, provider profile) are left for HC-QA-066 follow-up — not in this checkpoint's confirmed list.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
