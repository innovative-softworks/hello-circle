# HelloCircle — UX / UI Validation

_2026-10-14 · isolated QA environment (real React app + real Express + disposable MySQL) · companion to
`docs/hellocircle-validation-matrix.md` and `docs/hellocircle-validation-results.md`._

**Reference used for the workspace design.** No image references were attached to the request, so the approved cream
workspace was taken from the implemented admin redesign (`client/src/components/admin/admin.css`, its spec comment
"2026-10-14 spec", and the screenshots in `docs/admin-redesign-2026-10-14/`), which match the brief exactly: cream
`#F7F4EC`, white panels, forest `#172019`, secondary `#5B635C`, accent `#FF4B24`, borders `#E5E1D8`, 0–2px corners,
Bricolage Grotesque headings, Inter body, light strip, grouped navigation, compact footer.

**Screenshots** are written by the `qa:validation` suite to `.qa-data/<run>/evidence/validation/` and the final set is
copied to **`docs/validation-2026-10-14/`** (QA personas only, no real data):
`partner-overview-{desktop,tablet,mobile}.png`, `partner-overview-mobile-sections.png`, `partner-earnings.png`,
`host-overview-{desktop,tablet,mobile}.png`, `host-overview-mobile-sections.png`,
`admin-overview-{desktop,tablet,mobile}.png`, `admin-overview-mobile-sections.png`, `partner-rejected-listing.png`,
`admin-finance-load-error.png`, `my-life-partial-failure.png`, `rewards-signed-out-mobile.png`. Earlier suites leave
their own evidence under `evidence/` and `evidence/stage5f/`.

Status key: **PASS / FAIL / FIXED** (was failing, fixed and re-verified) **/ OPEN** (found, not fixed) **/ BLOCKED /
NOT TESTED**. Verification: **B** browser (real stack), **I** browser with one endpoint failure injected (UI
verification only), **C** code inspection, **T** automated test.

## 1. Workspace visual system

| Surface | Before | After | Status | Evidence |
|---|---|---|---|---|
| Admin `/admin` | Cream workspace (uncommitted redesign) | Unchanged | PASS | B — VAL-UX-WORKSPACES, 3 viewports |
| Partner `/vendor` | Older `ManageShell`: rounded cards, green accent, greeting banner, marketing footer, tab not in URL | `WorkspaceShell`: strip "Partner workspace · role · business · email", **View public profile**; grouped Lucide nav (Run / Listings / Business / Organisation) with unread count; breadcrumbs + page summary; compact footer; older tab content squared via scoped CSS | FIXED | B — screenshots at 1440/820/390 |
| Host `/manage` | Older `ManageShell` + greeting banner | `WorkspaceShell`: "Host workspace · Host · name · email · Verified Host", **View host profile**; groups Hosting / Community / Results; "Host a session" as the page action | FIXED | B |
| Circle organiser `/manage/circles/:id` | Older shell; "Overview" nav item jumped silently to `/manage` | Same shell; group "This Circle" (Plans / Members / Settings) plus an explicit "Back to Host workspace"; breadcrumbs Host workspace › Circles › name | FIXED | C, tsc |
| Profile `/profile` | `ManageShell` | Unchanged look (consumer account page, deliberately not given workspace styling) — only URL sync added | PASS (by design) | C |
| Partner listing editors `/vendor/centres|clubs|experiences|programs/:id` | Older consumer-style page (rounded pills, green buttons, marketing footer) | **Not migrated** to the workspace shell | OPEN | B — `partner-rejected-listing.png` |
| Workspace icons | Mixed custom icons | Lucide outline icons, 18px / 1.9 stroke, matching admin | FIXED | B |
| Marketing footer on workspaces | Shown on `/vendor`, `/manage` | Hidden there (compact workspace footer instead), as on `/admin` | FIXED | B — footer.adm-footer count = 1 |

## 2. Navigation, deep links and history

| Check | Result | Status | Evidence |
|---|---|---|---|
| Admin tabs in URL, Back/Forward/refresh | Support → Audit log → Back → Forward → refresh keeps tab | PASS | B — VAL-UX-WORKSPACES |
| Partner tabs in URL | Previously read `?tab=` on first load only (Back left the dashboard). Now `useUrlTab`: Bookings → Earnings → Back → Forward → refresh | FIXED | B, T (`useUrlTab.test.ts`) |
| Host tabs in URL | Same fix: Calendar → Earnings round trip | FIXED | B |
| Circle organiser tabs in URL | Same hook (`?tab=plans|members|settings`) | FIXED | C |
| Profile sections in URL | Section changes now push history | FIXED | C |
| Unknown / hostile `?tab=` value | Falls back to the default tab | PASS | T |
| Hidden tab for invited staff via `?tab=` | Falls back to Overview with an explanatory toast (`vendorTabAccess`) | PASS | C, existing tests |
| Titles on direct load, client nav, Back/Forward, 404 | Unchanged | PASS | T — HC-QA-065 (lifecycle/product suites) |
| Partner nav label "My listing"/"Listings" | Singular when one listing — kept | PASS | B |

## 3. Data states (loading · empty · no results · failed · restricted · success)

| Page / area | Finding | Status | Evidence |
|---|---|---|---|
| `/circles` | **Regression from the Circles redesign**: when the list request failed, the "All of Ireland" tile still showed **"0 Circles · Browse"** (and the filter sheet "Show 0 Circles"). Counts now appear only after the aggregate request succeeds | FIXED | T — HC-QA-063 /circles was FAIL in baseline |
| Admin Finance (13 sections) | Every list load (refunds, disputes, payment events, settlements, transfers, debts, credits/subscriptions, rewards, coupon usage, bank payouts, plans, roles, field help) rendered a failed request as "Nothing here." / "No refunds yet". Now each shows an alert with **Try again**, keeps prior rows, and suppresses its empty copy; role-restricted Roles (401/403) still hides | FIXED | I — `admin-finance-load-error.png` |
| My Life `/my-life` | 10 sources swallowed failures into empty lists, and 3 core sources had no `catch` at all — one failure left the skeleton up forever. Now: alert "Some of your activity couldn't load…" with retry; empty state suppressed; 401/403 for guests is not counted as a failure | FIXED | I — `my-life-partial-failure.png` |
| Host overview | Upcoming-activities request had no `catch` (stuck / unhandled rejection) | FIXED | C |
| Partner overview / listings | Listings and stats failures were silent (could show "My listing" with nothing) | FIXED — error banner with retry | C |
| Listing editors (centre, club, experience) | A failed load left a permanent spinner | FIXED — error with retry + back link | C |
| Circle organiser page | "Only the organiser…" and network failure looked alike | FIXED — restricted vs failed distinguished | C |
| Signed-out `/vendor/pro`, `/manage/pro`, `/vendor/rewards`, `/manage/rewards` | Showed "Couldn't load the plan" (a 401 shown as a failure) | FIXED — "Sign in to see your plan / reward history" with the right sign-in link | B — VAL-UX-RESTRICTED |
| Admin restricted tools | Lock + "Not included in your admin role" | PASS | C, admin redesign evidence |
| Games list failure / timeout | Error with retry, not "0 results" | PASS | T — HC-QA-063 |
| Header mega-menu | Loads a third-party photo from `images.unsplash.com` (a third-party request on every page with the header open) | OPEN (low) — review against the consent/privacy approach | C |
| ~60 other `.catch(() => set…([]))` sites | Optional enrichments (suggestions, related items, badges) — failure hides a secondary panel | OPEN (low) — see results doc | C |

## 4. Consumer, vendor/host and admin UX principles

| Principle | Finding | Status |
|---|---|---|
| Rejected listing explains restriction and next step | Dashboard said "needs changes before it can go live" but nothing let the vendor resubmit (server refused). Editors now show **"Not approved yet — changes needed"** with **Resubmit for review** (disabled while there are unsaved edits); pending listings show "Waiting for HelloCircle review" | FIXED (B, T) |
| Rejection reason shown to vendor | No reason is captured by admin or stored | OPEN — business decision (results §6) |
| Suspended partner screen | Said "Contact the site admin" with no way to do so; now explains what's unavailable and links **Contact HelloCircle** | FIXED (C) |
| Commercial controls state where they take effect | Rule cards described the rule but not that most checkouts ignore it. Each card now shows **"Where this takes effect"**; `checkout`, `cancellation` and `plan_rules` say **"Not applied yet"** (in danger colour); `pricing` says experience-checkout-only and names the fixed legacy model | FIXED (T — `catalog.test.ts`) |
| Activity descriptions readable (audit log) | New audit actions added server-side now have readable headlines (`auditFormat.ts`) | FIXED (C) |
| Proposed/disabled capabilities not presented as available | Pro/rewards show "isn't available" while off; Earnings says transfers aren't switched on; Open Booking hidden | PASS (B, revenue suites) |
| Overview prioritises work | Partner overview: setup checklist → needs attention → schedule → figures | PASS (B) |
| Setup checklist reflects real state | QA vendor shows "Admin review ✓" while "Listing draft created" is unticked (persona has no listing) — ordering/derivation reads oddly | OPEN (low) |
| Stat tiles | "Community centres 0 · Approved · not public yet" — status caption under a zero count | OPEN (low) |
| Cookie consent at phone width | **Regression**: the compact banner (2026-10-12) no longer named the optional purposes before offering choices. Now names **Analytics** and **advertising** in the first layer while staying compact | FIXED (T — REV-PUBLIC-COOKIES-mobile was FAIL in baseline) |
| Checkout shows the real amount; cancellation consequences before confirming | Quote = server = Stripe amount; paid cancel says refund pending | PASS (T — Stripe and booking suites) |

## 5. Accessibility and responsiveness

| Check | Result | Status | Evidence |
|---|---|---|---|
| No page-level horizontal overflow at 1440/820/390 (partner, host, admin) | None | PASS | B |
| Navigation reachable on tablet/phone | "Sections" button opens a modal sheet | PASS | B |
| Sheet: dialog role, Escape closes, focus returns to trigger | Yes | PASS | B |
| One H1 per workspace page | Yes (page header) | PASS | B; HC-QA-083-* (product suite) |
| Heading order in workspaces | Sidebar group labels were `<h2>` ahead of the page `<h1>` ("first heading is h2") in admin, partner and host shells — now plain labelled text (`aria-labelledby` grouping kept) | FIXED | T — HC-QA-083-RESIDENT / -BUSINESS |
| Heading levels on `/games` | Shared `ListingCard` titles were `h3` straight under the page `h1` (from the redesign) — card takes a `headingLevel`; `/games` uses `h2` | FIXED | T — HC-QA-083-PUBLIC |
| `prefers-reduced-motion` | `.fade-panel` (most pages) and `.slide-in-left` / `.slide-in-right` (Sections sheet, drawers) ignored it. Added to the reduced-motion list | FIXED | B (captures before/after) |
| Skip link, labels, focus traps, keyboard rows | — | PASS | T — product-a11y-*, HC-QA-066/067/068/069/070/088 |
| Text-based status | Unread count has hidden "new" text; review notice uses `role="status"`; failures use `role="alert"` | PASS | C |
| Touch targets in workspace nav | 40px rows (admin.css) | PASS | C |
| Map/list consistency | Mapbox disabled in QA | BLOCKED | — |

## 6. Remaining UX work (not done here)

1. Move the partner listing/programme/experience editors into the workspace shell (they still use consumer styling and
   the marketing footer).
2. Replace the scoped "square any inline radius" CSS with real workspace primitives in the older tab components
   (`ManageCard`, `ui.tsx` buttons are still green/rounded inside the workspace).
3. Review the ~60 remaining silent catches on secondary panels and decide which deserve an inline error.
4. Setup-checklist derivation and zero-count captions on the partner overview.
5. Decide whether rejection reasons are shown to partners (needs a reason captured at rejection — business decision).
