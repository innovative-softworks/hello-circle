# HC-QA-059 — Vendor centre is shown as 'Live' but the public cannot open it (venue launch gate)

Severity: P2. Category: UX. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /vendor (Overview + My centre), public /centres/:id, footer links
- **Actor:** Vendor, public
- **Viewport / browser:** 1280; Chromium; VITE_LAUNCH_MODE=public

**Steps**

1. Approve a vendor's centre.
2. Vendor opens My centre → 'View live listing'.
3. Anonymous visitor opens /centres/:id or footer 'Community centres' / 'Sports clubs' / 'Clubs'.

- **Expected:** Vendor-facing status matches what the public can see; footer links lead somewhere useful.
- **Actual:** Vendor sees 'Live', 'Listing live to the public — done' and 'View live listing', but /centres/:id, /clubs/:id, /browse/centres and /browse/clubs redirect to /coming-soon. Footer links to those pages are dead ends.
- **Evidence:** client/src/App.tsx:161-170 isVenueGatedPath; Playwright: /centres/db3ae9db-… → /coming-soon; vendor dashboard text 'Listing live to the public — done'.
- **Root cause (if known):** Venue gate is a launch configuration (documented in QA_PRODUCT_GAPS.md as config), but vendor messaging and navigation ignore it. Needs a product decision on what vendors are told while venues are gated.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 12 remediation

- **Fix:** one explicit switch, `VITE_VENUE_PAGES_PUBLIC` (client) / `VENUE_PAGES_PUBLIC` (server), default gated.
  - While gated, an approved centre/club shows **"Not publicly visible"** with "Venue pages aren't publicly available yet…". This applies to the single-listing card, both table layouts, the overview tiles ("Approved · not public yet") and the performance tile.
  - "View live listing" and "Share" are hidden.
  - The listing's publication state is unchanged.
  - Header, footer and menu links to venue browse pages lead to the designed coming-soon page with a waitlist, kept as an honest destination.
- **Regression:** `product-p12-b.spec.ts` HC-QA-059 checks the vendor listings view, that the status is unchanged in the DB, and that the public page is still gated. It fails before and passes after.
