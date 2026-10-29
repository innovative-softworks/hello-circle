# 14 · Configuration framework: Phases B–D (capabilities, admin configuration, dynamic navigation)

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`, worktree `../hello-circle-participation-p1`. **Not committed, not pushed, not deployed.**
**Audit and decisions:** [13-config-framework-phase-a-audit.md](13-config-framework-phase-a-audit.md).

Each phase below follows the brief's 10-point report.

---

## Phase B: Capability registry

**1. What existed:**
- The per-organisation `feature_flags` table (opt-out: no row = on) with 3 keys (`programs`, `experiences`, `open_booking`).
- These gated creation only, plus Open Booking.
- Admin flag routes (`orgs.view` / `orgs.manage`), audited.
- Platform switches (`FEATURE_SWITCHES`, commerce switches).

**2. What was built:**
- `server/src/capabilities.ts` is a code registry of 13 capabilities. Each has a key, label, description, group (listing / operations / commercial), status, dependencies, operating roles, platform switch, limits and "what happens when off".
- **Listing capabilities:** venues, clubs, programs, experiences, events (needs experiences), volunteering (needs experiences).
- **Operations capabilities:** registration_options, attendees, registration_questions (needs attendees), checkin, open_booking (needs venues).
- **Commercial:** external_payments and donations are registered as **unavailable** and can't be switched on.
- **Resolver:** platform switch → organisation setting → dependencies → effective.
- **Templates:** 7 (community centre, sports club, event organiser, training provider, experience provider, community association, custom).
- **Limits:** questions per listing (platform max 12) and check-in assignments per listing (max 50).

**3. Files and database:**
- New `capabilities.ts`, `capabilities.test.ts`.
- Changed: `participation/schema.ts`, `routes/{admin,org,vendorListings,vendorPrograms,vendorExperiences,vendorAttendees,vendorDoor,experiences}.ts`.
- **Database (additive, idempotent):**
  - `org_capability_limits (org_id, limit_key, value)`;
  - `organisations.template VARCHAR(40) NULL`;
  - `organisations.config_version INT NOT NULL DEFAULT 0`.
- On/off state **reuses `feature_flags`**: no new flag table, and the 3 old keys are unchanged.
- No FKs (decision D-A1).

**4. APIs:**
- `GET /api/admin/organisations/:id/capabilities` (`orgs.view`): registry, templates, states, usage counts, template, version.
- `POST …/capabilities/preview` (`orgs.view`): validates and returns the resulting states plus the impact of what's switched off. Nothing is saved.
- `PUT …/capabilities` (`orgs.manage`):
  - body is `{template?, enabled?, limits?, configVersion, reason?}`;
  - 409 on a stale version or a broken dependency;
  - stores only real changes;
  - one `org.capabilities_changed` audit row with before and after effective states, the change and the reason.
- `GET /api/vendor/org` now includes `capabilities` (effective).
- The existing `GET/PUT /organisations/:id/flags[/:key]` still work on the same table.

**5. UI:** none in Phase B (see C and D).

**6. Enforcement (server):** a refusal is a 403 `{ capabilityOff: key }`.

| Capability | Where |
|---|---|
| venues / clubs | `POST /api/vendor/centres`, `POST /api/vendor/clubs` |
| programs | `POST /api/vendor/programs` (replaces the flag check, same meaning) |
| experiences, events, volunteering | `POST /api/vendor/experiences`; `PUT` when switching a listing **into** event or volunteer |
| registration_options | `PUT /api/vendor/experiences/:id/options` |
| registration_questions | `PUT …/questions` (+ the organisation's question limit); public booking and answer edits ask questions only when on |
| attendees | public booking asks who is coming only when on |
| checkin | `POST …/checkin-staff` (+ assignment limit); every `/api/vendor/door/*` request for that listing's organisation |

**Precedence:** the platform switch overrides the organisation; existing role groups and ownership still apply after it; nothing opens `PAID_CHECKOUT`, VAT or refund rules.

**7. Tests (`capabilities.test.ts`, 11 tests, real admin and partner routers):**
- defaults (opt-out); platform and dependency precedence; limit caps;
- unknown, unavailable and dependency refusals; every template valid;
- **test 1:** two organisations configured differently;
- **test 17:** audit row with reason; stale version 409;
- Support can read and preview but not save; a partner can't use admin routes;
- **test 4:** a switched-off module refused through the API (venues, clubs, door, question limit) while the other organisation is unaffected;
- **test 7:** after removing experiences and events, the existing event stays public and bookable, its booking stays readable, the listing is still editable, and new listings are refused;
- **test 18:** a suspended organisation is refused before any capability is considered;
- the old flag routes write the same state.

**8. What was preserved:**
- with no rows, every organisation resolves exactly as before (all on);
- the 3 old flag keys and routes;
- checkout, pricing, webhooks and capacity are untouched.

**9. Known limitations:**
- the commercial capabilities are placeholders until PD-3 and PD-4;
- `paid_registrations` is not a capability: paid sales stay governed by the existing commercial gates;
- "one user in several organisations" isn't supported by the model (D-A2).

**10. Next:** Phase C.

---

## Phase C: Admin organisation configuration

**1. What existed:** a 70/30 organisation record page (members, listings, feature flags, decisions, activity, suspension).

**2. What was built:** the **Capabilities** section replaces the 3-checkbox flags section on the same record page, in the admin shell with no drawer (`components/admin/OrgCapabilities.tsx`):
- **Starting template** picker with its description. Picking one only fills the form; nothing is saved yet.
- Capabilities grouped as Listings / Operations / Commercial. Each shows its description, how much is in use, its limits, and badges: *Off for everyone: <platform switch>*, *Needs <dependency>*, *Needs a platform decision*, *In use*.
- **Review changes** calls the server preview, which shows:
  - **Switching off:** each item, how many already exist, and what happens (nothing is deleted);
  - **Partner workspace after this change:** the owner's resulting navigation;
  - dependency errors.
- Optional reason, **Save capabilities**, Back to editing, Discard changes.
- Read-only for admins without `orgs.manage`.
- Activity (audit) on the same page now has labels for capability, question, check-in and answer actions.

**3. Files:**
- new `client/src/components/admin/OrgCapabilities.tsx`;
- changed `AdminMisc.tsx` (the superseded `OrgFlags` was removed), `AdminOrganisationRecord.tsx`, `auditFormat.ts`, `api/admin.ts`, `packages/types`.

**4. APIs:** Phase B admin routes.

**5. Screens:** `phase2-screenshots/config-01-admin-review.png`, `config-02-admin-saved.png`.

**6. Permissions:** read and preview `orgs.view` (all admin roles); save `orgs.manage` (Super). Enforced on the server; the UI only hides controls.

**7. Tests:** browser batch **`config-capabilities`** (guarded QA, isolated):
- Super applies Event organiser to a synthetic organisation, reviews the impact, enters a reason and saves;
- the stored rows are exactly what the template switched off;
- the audit row has the reason and template;
- the partner check is in Phase D.

**8. What was preserved:**
- organisation suspension, members, decisions and activity are unchanged;
- the old flag API works.

**9. Known limitations:**
- the brief's other admin sections (allowed categories, forms and fields, payments policy) belong to Phases E–G;
- Staff & Permissions are visible through the existing Members list and the partner's own staff page.

**10. Next:** Phase D.

---

## Phase D: Dynamic vendor navigation

**1. What existed:** partner navigation filtered by role (`vendorTabAccess.ts`); the "Add experience" / "Add programme" buttons disabled by the old flags.

**2. What was built:**
- `VENDOR_TAB_CAPABILITIES` + `vendorTabAvailable()` = role **and** capability. Listings needs venues or clubs; Programmes needs programs; Experiences needs experiences; Check-in needs checkin.
- `useOrgCapabilities()` reads the effective map once per session. When it's unknown, filtering falls back to roles only, so it never shows more than roles allow.
- Used by `PartnerWorkspace` and `VendorDashboard`.
- "Add centre" / "Add club" hide for switched-off types.
- The experience wizard hides "Volunteer opportunity" and "Community event" when the organisation doesn't have them.
- Existing routes and deep links are unchanged; a hidden tab's `?tab=` link falls back to Overview, as for roles.

**3. Files:** new `client/src/orgCapabilities.ts`; changed `vendorTabAccess.ts` (+ test), `PartnerWorkspace.tsx`, `VendorDashboard.tsx`, `ExperienceCreationWizard.tsx`.

**4. APIs:** `GET /api/vendor/org` `capabilities`.

**5. Screens:** `config-03-partner-nav.png` (event organiser: no Listings, no Programmes).

**6. Permissions:** capabilities only narrow what a role shows. A unit test proves a finance member never gains Experiences from a capability.

**7. Tests:**
- unit: `vendorTabAccess.test.ts` (+1);
- browser: in `config-capabilities` the partner sees Experiences but not Listings or Programmes, `POST /api/vendor/centres` → 403 `capabilityOff: venues`, and `/api/vendor/org` reports the same map.

**8. What was preserved:** role filtering (all existing tab tests pass); Check-in-only staff still see only Check-in.

**9. Known limitations:** the Overview page still shows the generic "Approved centres / clubs" counters for an organisation without venues. That's cosmetic and left for Phase K (operations pages).

**10. Next recommended phase:** **E, category integration.** Organisation category eligibility, suggested form per category and moderation policy, built by extending `taxonomy_categories` and the existing Categories tool. It needs no new taxonomy and no blocking decision. Phase F (field registry) needs D-A4, the built-in club `medical` field, first (see doc 13).

---

## Test results (final code: Phase 2 + Phases B–D)
| Check | Result |
|---|---|
| Type-check (server, client, QA harness) and production build | pass |
| Server suite (disposable MySQL) | **138 files, 1,284 passed, 0 failed, 23 skipped** (live provider tests, off by design). One earlier full run had a transient socket drop in `bookingUxPhase5.test.ts`; it passed alone, together with the new files, and in the clean full re-run |
| New `capabilities.test.ts` | 11 / 11 |
| Client unit | 45 files, **348 passed** |
| QA harness self-tests | 100 passed |
| New browser batch `config-capabilities` | **1 / 1** (admin template, review, reason, save; partner navigation and API) |
| Guarded regression: **every batch of every suite except Stripe TEST**, each run on its own (auth, authorization, lifecycle, booking, product, revenue, validation, trust) | **145 batches: 331 passed, 17 failed, 3 skipped**. The 17 failures are **exactly** the 17 stale specs that fail identically on the untouched base `f22294f` (report 10 §5). Skips are the known REM-046 split and PERF-P13. **No new failure.** Stripe TEST wasn't re-run: no payment, checkout or webhook code changed |

## Brief §22 test list → status
| # | Test | Status |
|---|---|---|
| 1 | Two vendors with different configurations | ✓ `capabilities.test` + `config-capabilities` |
| 2 | One user in several organisations | **Not supported by the model** (D-A2): `users.org_id` is single. The resident ⇄ partner context switch is the existing Manage bridge |
| 3 | Different staff permissions in one organisation | ✓ Phase 2 (`participation2.test` #3–#5) + existing staff specs |
| 4 | Disabled module through the API | ✓ |
| 5 | Unauthorised category | Phase E |
| 6 | Existing listing after category deactivation | Phase E |
| 7 | Existing booking after capability removal | ✓ |
| 8 | Form changes after registration | ✓ Phase 2 #11 (questions); full forms in Phase G |
| 9 | Invalid or malicious field submissions | ✓ Phase 2 (types, ranges, choices, unknown keys dropped, special-category refusal); field registry in Phase F |
| 10 | Cross-organisation attendee access | ✓ Phase 2 #2 |
| 11 | Revoked check-in staff | ✓ Phase 2 #5 |
| 12 | Duplicate QR check-in | ✓ Phase 2 #7–#8 |
| 13 | Partial attendee arrival | ✓ Phase 2 #8 + browser |
| 14 | Legacy booking compatibility | ✓ Phase 2 #9 |
| 15 | Existing payment, VAT and capacity logic | ✓ full server suite + revenue/booking QA unchanged |
| 16 | Mobile and desktop | ✓ Phase 2 browser batch; admin configuration is desktop-first (admin shell) |
| 17 | Admin configuration audit history | ✓ |
| 18 | Suspended organisation | ✓ |
