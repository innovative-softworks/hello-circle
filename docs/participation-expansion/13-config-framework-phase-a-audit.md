# 13 · Configuration & Participation Framework: Phase A codebase audit

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2` (worktree `../hello-circle-participation-p1`). This tree has Phase 1 committed (`cc2def1`) and Phase 2 built but uncommitted (reports 11–12).
**Method:** read-only inspection of code and schema. Every identifier below is copied from source. Roles and permissions are fully in [11-phase2-rbac-audit.md](11-phase2-rbac-audit.md) and are only summarised here.

## 1. Current Admin architecture
- **Shell:**
  - `components/admin/AdminShell.tsx` on `workspace/WorkspaceShell.tsx`;
  - tabs are keys in `adminNav.ts` (`AdminTab`), opened by `/admin?tab=` and record pages by `?record=`;
  - each nav item names the D-02 permissions that open it.
- **Organisations:**
  - `AdminOrganisationRecord.tsx` is a 70/30 record page with: Owner, Upcoming obligations and Details (aside); Members, Listings, **Feature flags**, Decisions and Activity (main);
  - suspend and reinstate (D-01, Super only).
  - Server: `routes/admin.ts` organisations CRUD, `GET/PUT /organisations/:id/flags[/:key]` (`orgs.view` / `orgs.manage`), audited `org.flag_changed`.
- **Categories:** `AdminCategories.tsx` (1,021 lines) over `taxonomy.ts`. It covers create/edit/archive, aliases, the needs-review queue, integrity issues and `row_version` concurrency. Permissions are `taxonomy.view` / `taxonomy.manage`.
- **Platform switches:**
  - `circleFeatures.ts` `FEATURE_SWITCHES` (`circles.*`, `experience.*`, `mylife.*`, `participation.*`), stored in `app_settings`;
  - edited in admin Settings (`platform.settings`), with locked switches (`partial_cancel`, `special_category_questions`);
  - commerce switches are separate (`commerce.*`, `commerceSwitch()`).
- **Other tools reused as they are:**
  - permissions: `adminPermissions.ts` (deny-by-default, a test walks every route);
  - audit log `audit.ts` (`writeAudit`);
  - moderation decisions;
  - payment reviews (D-10/D-11);
  - finance;
  - privacy requests (manual erasure);
  - verification checks;
  - queues: listings, claims, host applications, place suggestions.

## 2. Current Vendor architecture
- **Shell and navigation:**
  - `workspace/PartnerWorkspace.tsx` (`VENDOR_TABS`) is shared by `/vendor` (`VendorDashboard.tsx`) and the editors `/vendor/{centres,clubs,programs,experiences}/:id`;
  - `vendorTabAccess.ts` filters tabs by `platform_role`;
  - `/vendor/door*` (Phase 2).
- **Organisation:** `/api/vendor/org` (`routes/org.ts`) returns the profile, policies, staff, invites and **read-only flags**. The owner manages staff (D-08 `rowVersion`).
- **Listing types a partner creates:**
  - `centres` (rooms);
  - `clubs` (club sessions);
  - `programs` (on a centre or club);
  - `experiences`, with `kind` = adventure | experience | volunteer | event.
  - Games and Circles belong to residents and hosts, not partners.
- **Gates on listing creation today:** `orgFeatureFlags(vendorId)` gates only `programs` and `experiences` **at creation** (`vendorPrograms.ts:71`, `vendorExperiences.ts:211`). The client only disables the "Add" button. `open_booking` gates Open Booking in `bookings.ts:215`.
- **Operations:**
  - bookings, registrations, orders, refunds (finance), customers, messages, reviews, coupons, earnings and statements, demand, calendar;
  - Phase 1 Registration (options); Phase 2 Questions, Attendees and Door.

## 3. Roles and permissions (summary of doc 11)
| Context | Identifiers | Enforcement |
|---|---|---|
| Admin | `admin_role`: super, finance, support, legal; 50+ keys in `ADMIN_PERMISSIONS` | `requireAdminPermission` / `ensureAdminCan` (deny by default) |
| Partner member | `platform_role`: centre_manager, facility_manager, finance, communications, read_only_analyst, **checkin_staff** (Phase 2); owner = `!invited_staff` | `hasPlatformRole`, `requirePlatformRole`, `assertPlatformRole`; groups `ORDER_ROLES`, `ROSTER_ROLES`, `CUSTOMER_ROLES`, `EXPERIENCE_ROLES` |
| Partner scope | `req.vendorIds` (organisation members); `listing_staff_assignments` (Phase 2, check-in) | ownership helpers per router |
| Organisation state | `organisations.status` (D-01); removed staff (D-08) | `requireVendor` |
| Resident / host | `req.resident`; `residents.host_status`; `games.host_resident_id`; `circle_members.role` organiser \| member | per route |
| Multiple contexts | one `users` row ↔ at most one resident (`users.resident_id`, Manage bridge); **one user = one organisation** (`users.org_id`) | `routes/manage.ts` switch |

**Finding:** "a user belonging to multiple organisations" (brief §11, test 2) **isn't supported by the data model**. `users.org_id` is a single column. Changing that would be an identity migration, which is out of scope. Test 2 is therefore read as "two separate accounts, one per organisation" plus the resident ⇄ partner switch.

## 4. Category system and listing mappings
- **Tables:**
  - `taxonomy_categories`: id, parent_id, name, slug, description, `families` (CSV), icon, image_url, sort_order, active, discoverable, featured, archived_at, SEO fields, `row_version`;
  - `taxonomy_aliases`;
  - `listing_taxonomy` (listing_type, listing_id → category_id, subcategory_id);
  - discovery tags.
- **Families** (= which listing types may use a category): activity, experience, volunteer, programme, circle, club, venue. `familyOf(type, kind)` maps a listing to its family; events use the `experience` family.
- **Seed:** 22 categories including **Culture, faith & celebrations** (Phase 1). Validation is server-side: `validateAssignment`, `checkListingCategoryBody`, `applyListingCategory`. The partner picker is `pickerOptions(family)`.
- **Public discovery:** `listPublicCategories`, `publicCounts`, `taxonomyFilter`; Explore menu frozen (owner).

**Category gaps against the brief:**
- **organisation eligibility** (none);
- **suggested form template** (none);
- **moderation policy per category** (none);
- **vendor category suggestion:** partial. Unmatched labels go to the needs-review alias queue. There's no explicit "suggest a category" action.

## 5. Forms and fields inventory
| Form | Fields (source) | Notes |
|---|---|---|
| Partner signup | email, name, vendorType (`community` \| `sports`), businessName, address, county, mobile, landline, description (`routes/auth.ts`) | `vendorType` is the only organisation-type concept today |
| Centre / room / club / programme / experience editors | fixed columns per table; experience: kind, safety, eligibility, weather, itinerary … | `form.tsx` conventions (FieldLabel, error summary) |
| Hall booking (`BookingFlow`) | room, date, slot, name, email, phone, purpose | fixed |
| **Club registration** | child_first/last, **dob**, guardian first/last, email, phone, **address**, emergency contact name/phone/relationship, **`medical` (free text)**, consent, trial, waiver version, registrant_type | **`medical` is health data (special category) collected as a fixed platform field before any policy mechanism.** This needs an owner decision (§9 D-A4) |
| Programme enrolment | participant_name, participant_dob, email, phone | fixed |
| Experience booking | participantName, email, phone, party size or options, seat names, min-age declaration, safety and terms acknowledgements; **Phase 2:** attendees (adult/child, guardian) and organiser questions | Phase 2 questions = first configurable fields |
| Game join / host form | resident fields; activity label free text | host-owned |
| Participation attributes / what-to-expect | `vendorParticipation.ts` | vendor-editable listing fields |
| Phase 2 `registration_questions` | key, scope booking/attendee, type text/number/date/select/checkbox, label, help, **purpose**, required, choices, min/max, appliesTo, doorVisible, category, version | per listing, versioned, special categories refused |

**There's no shared field registry and no form template.** Every form is hand-built per page. The Phase 2 question set is the only configurable form.

## 6. Participation and booking architecture
- **Order tables** (each has its own payment and capacity logic): `bookings`, `registrations`, `program_enrollments`, `game_participants`, `circle_members`, plus `experience_bookings` and `passes`. They are kept separate on purpose; unifying them is a separate migration (CLAUDE.md).
- **Shared layer keyed on (source_type, source_ref):**
  - `order_acknowledgements`, `attendance`, `commerce_*`, `checkout_agreements`, `payment_reviews`;
  - Phase 1: `order_lines`, `offering_options`;
  - Phase 2: `booking_attendees`, `registration_answers`, `attendee_checkins`;
  - listing-scoped: `registration_questions`, `listing_staff_assignments`.
  - New capabilities extend this layer instead of the order tables.
- **Commerce:**
  - `checkoutService.createCheckoutSession` + checkout agreement;
  - legacy `pricing.ts` or the commerce engine (`commerce.engine_v2*`);
  - webhook settlement and D-10 reviews;
  - `PAID_CHECKOUT` gate;
  - VAT and fee server-side.
  - None of this is touched by this framework.

## 7. Reusable components and APIs
- **Server:**
  - registries: `FEATURE_SWITCHES` and `featureOn` (platform), `feature_flags` with `orgFeatureFlags*` (organisation);
  - permissions: `hasPlatformRole` / `requirePlatformRole`, `requireAdminPermission`;
  - audit: `writeAudit`;
  - categories: `validateAssignment` / `pickerOptions`;
  - Phase 2 modules: questions, attendees, check-in.
- **Client:**
  - shells: `WorkspaceShell`, `PartnerWorkspace`, `AdminShell`;
  - record pages: `RecordView` (70/30), `DetailSection`, `DetailFacts`, `DetailStats`, `ContextSection`;
  - forms: `form.tsx` (`useFormErrors`, `FieldLabel`, `FormErrorSummary`);
  - dialogs and states: `ConfirmDialog`, `LoadErrorState`, `Switch`;
  - Phase 2 `QuestionsEditor` (the base for the form builder).

## 8. Feature matrix
| Feature (brief) | Exists | Partial | Missing | Reuse strategy | Files affected |
|---|---|---|---|---|---|
| Platform capability switches | ✓ | | | keep `FEATURE_SWITCHES` as the platform layer | `circleFeatures.ts` |
| Organisation capabilities | | ✓ (3 flags, creation-only gates) | registry, dependencies, limits | **extend `feature_flags`**: the same table and the 3 keys keep their meaning | `db/queries.ts`, new `capabilities.ts`, `routes/admin.ts`, `routes/org.ts` |
| Vendor templates | | | ✓ | defaults applied as capability rows; `vendorType` stays | new |
| Admin organisation configuration | | ✓ (record page, flags section) | capabilities UI, nav preview | extend `AdminOrganisationRecord` | client admin |
| Dynamic vendor navigation | | ✓ (role filter) | capability filter | extend `vendorTabVisible` / `VENDOR_TABS` | client |
| Categories | ✓ | ✓ | organisation eligibility, form template, moderation policy | extend `taxonomy_categories` and the admin tool; **no second taxonomy** | `taxonomy.ts`, `AdminCategories.tsx` |
| Field registry | | ✓ (Phase 2 question types, special-category refusal) | registry, classification, retention, export policy | generalise from `participation/questions.ts` | new |
| Visual form builder | | ✓ (Phase 2 `QuestionsEditor`) | sections, conditional fields, preview, draft/publish, templates | extend Phase 2 | new |
| Roles and permissions | ✓ | | multiple organisations per user (model) | no new RBAC | — |
| Attendees | ✓ (Phase 2, experiences) | | other listing types | `booking_attendees` is keyed on source_type | — |
| Registration questions | ✓ (Phase 2) | | form-template link | — | — |
| Check-in / door | ✓ (Phase 2) | | other listing types | — | — |
| Volunteers module | | ✓ (`kind='volunteer'` listings) | volunteer rota and roles | later phase | — |
| My Life | ✓ (Phase 2 "Who's coming") | | | — | — |
| Payments and commercial | ✓ (gates) | | external payments, donations, family checkout: **not to be enabled** | unchanged | — |

## 9. Risks, compatibility and decisions needed
**Architecture risks:**
- **R1:** two capability layers already exist (platform switches, organisation flags). Adding a third store would duplicate them, so Phase B reuses both.
- **R2:** organisation flags are opt-out (a missing row means on). New capabilities must keep that for existing organisations, or live partners would lose modules overnight.
- **R3:** client-only gating (the "Add experience" button). Every capability must be enforced in the API.
- **R4:** the brief asks for **foreign keys**. The schema has none anywhere (CLAUDE.md) and the shim's migrations aren't FK-aware. **Recommend keeping the convention** (decision D-A1).

**Backward compatibility:**
- the 3 existing flag keys and both flag routes keep working;
- existing listings and bookings keep selling and stay readable when a capability is switched off (only new creation and the module's operational actions are refused);
- no listing, booking or attendee data is ever deleted by configuration.

**Decisions for the owner:**
| # | Decision | Recommendation / impact |
|---|---|---|
| D-A1 | Foreign keys | Keep the no-FK convention; enforce relationships in code as today |
| D-A2 | Multiple organisations per user | Out of scope; needs an identity migration (`users.org_id` → memberships) |
| D-A3 | What switching off a listing capability does to live listings | **Built as recommended:** stops new listings of that kind (and switching a listing into it); existing listings stay editable and keep selling until the admin acts (suspension or listing moderation). Operational capabilities (questions, check-in) refuse their management actions; recorded data stays readable. Alternative: hide live listings, which is a bigger change |
| D-A4 | Club registration's built-in `medical` field (health data) | Needs a policy decision: keep with a stated lawful basis, make it optional, or move it into the locked special-category mechanism |
| D-A5 | Organisation types | `vendorType` today is only community \| sports; templates are new defaults, not a stored type, unless you want an `organisations.template` column (recommended, informational only) |

## 10. Proposed architecture (layers → where they live)
1. **Platform capabilities:** `FEATURE_SWITCHES` (+ commerce switches).
2. **Organisation capabilities:** new code registry `server/src/capabilities.ts` with key, label, group, dependencies, applicable templates, operating roles, platform switch, default, limits and safe-off behaviour. State lives in the existing `feature_flags` table.
3. **Templates:** a code registry of default capability sets; applied by admin; recorded as `organisations.template`.
4. **Categories:** extend `taxonomy_categories` (organisation eligibility table, suggested form, moderation policy).
5. **Field registry:** code registry of locked, admin, vendor and custom field kinds; built from Phase 2 question types plus classification, retention and export.
6. **Form templates:** the Phase 2 question sets become versioned forms with sections and templates.
7. **Registration workflows:** existing booking flows plus Phase 2 attendees and answers.
8. **Roles:** unchanged (doc 11).
9. **Commercial:** unchanged gates.
10. **Audit:** `writeAudit` on every configuration change.

**Precedence (enforced in `capabilities.ts` `effectiveCapability`):**
- a platform switch off → off for everyone;
- otherwise the organisation capability decides;
- then the existing role check;
- then ownership and scope.
- A capability never widens a role or skips a commercial gate.

## 11. Phase B plan (capability registry)
1. **`capabilities.ts` registry:**
   - listing: venues, clubs, programs, experiences, events, volunteering;
   - operational: attendees, registration_questions, checkin, open_booking;
   - commercial: paid_registrations (informational; it never opens `PAID_CHECKOUT`).
   - Keys `programs`, `experiences` and `open_booking` are kept verbatim.
2. **Resolver:** `orgCapabilities(orgId)` and `effectiveCapabilities()`. Opt-out defaults keep every existing organisation as it is today. Dependency checks on save (e.g. events → experiences; registration_questions → attendees).
3. **Server enforcement:** creation of centres, clubs, programs, experiences and events; attendees, questions and staff-assignment routes; the door API. A refusal is a 403 `{ capabilityOff: key }`. Existing records stay readable and sellable (D-A3).
4. **Admin API:**
   - `GET /api/admin/organisations/:id/capabilities` (`orgs.view`): registry, states, dependencies, platform availability;
   - `PUT …` (`orgs.manage`): batch change, dependency validation, one audit row with before and after.
5. **Partner API:** `GET /api/vendor/org` adds `capabilities` (effective).
6. **Tests:**
   - two organisations with different configurations;
   - a switched-off module reached through the API;
   - an existing booking after the capability is removed;
   - dependencies;
   - audit history;
   - a suspended organisation.
