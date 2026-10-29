# 15 · D-A4 medical-field remediation and Phase E (categories)

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2` (worktree `../hello-circle-participation-p1`). Not committed, not pushed, not deployed.
**Approved decisions applied:** D-A1 (no FKs; integrity in code and tests), D-A2 (single organisation per user; nothing new assumes more), D-A3, D-A4, D-A5.

---

## Part 1: D-A4, free-text medical information (done first)

### What I found
- **Where it came from:** club registration had a free-text box, "Anything the coach should know? — Allergies, conditions or medication… Only the club sees this." (`RegistrationFlow.tsx`). It was stored in `registrations.medical`.
- **No server code reads the column:** no API, export, notification, partner screen, admin screen or resident export returns it.
- So the promise "only the club sees this" was wrong in both directions: nobody sees it, yet health data was being collected and kept.

### What changed
| Change | Where |
|---|---|
| The box is removed. People are told to speak to the club directly about health needs: "HelloCircle doesn't collect health information." | `client/src/pages/RegistrationFlow.tsx` |
| The server **never stores** a `medical` value. Anything an older cached client sends is dropped, and the booking still succeeds | `server/src/routes/registrations.ts` |
| **Existing values are kept untouched:** no automatic deletion, and the column is kept. They're still read by nothing, pending the privacy and retention review | — |
| Dynamic fields can't be used instead: the special-category check now covers the hint, the "why we ask" text and **every choice**, not only the label. Health wording is extended (insulin, EpiPen, inhaler, seizure, anaphylaxis, symptoms, prescription, therapy) | `server/src/participation/questions.ts` |

### Tests (`privacyMedical.test.ts`, 4)
- a registration that still sends a note books, and the note isn't stored;
- an existing note is preserved;
- a source scan proves no server code reads the column or stores `body.medical`;
- six bypass attempts are refused (wording, hint, purpose, a select choice, a checkbox label, the health category), while "T-shirt size" passes.

### For the privacy review (owner and legal)
- **Count existing notes** on each database (run by someone authorised; I didn't touch staging or production): `SELECT COUNT(*) FROM registrations WHERE medical <> ''`. The worktree's own dev database has none.
- **Decide** retention or erasure for those values, and whether a lawful-basis-backed health field should ever return. If it does, use the locked special-category mechanism.
- **Legal text to update (not changed by me):** the privacy policy (`client/src/pages/PrivacyPolicy.tsx` and the policy draft in `server/src/policy/drafts.ts`) still says registrations include "any medical information you choose to share". It now over-states what's collected. Please have it updated through the policy workflow.

---

## Part 2: Phase E, categories

### 1. What existed
- The taxonomy (`taxonomy_categories`, `listing_taxonomy`, aliases) with listing-type applicability (`families`), active, discoverable and featured flags, SEO, `row_version`, archive and merge.
- Server validation of the family; inactive categories kept on existing listings.
- Partner category changes go through **one** route (`PUT /api/vendor/classification/:type/:id`). The partner picker uses the shared `/api/categories/options`.

### 2. What was built (no new taxonomy, no new ids)
| Brief item | Implementation |
|---|---|
| 1. Applicability to listing types | **Existing** `families`, unchanged; the new organisation filter is applied on top of it |
| 2. Organisation eligibility | `organisations.category_mode` = `all` (default, today's behaviour) or `restricted`, plus `org_category_access` rows. Admin edits it in **Allowed categories** on the organisation record page, with a template preset (D-A5) |
| 3. Subcategory restrictions | Access rows naming specific subcategories (no `*`) narrow that category in either mode; the partner must then choose one of them |
| 4. Suggested form template | `taxonomy_categories.suggested_form`, one of 7 form types (event, activity, programme, club, experience, venue, volunteer registration). Phase G gives each a template |
| 5. Moderation policy | `taxonomy_categories.moderation_policy`: `standard`; `review_required` (a partner moving a **live** listing into it sets `listing_taxonomy.needs_review`, which appears in the new **Category moves to review** queue in admin Categories, where Super accepts it or re-categorises; nothing is unpublished, D-A3); `eligible_only` (organisations need an explicit grant) |
| 6. Dynamic filtering in partner forms | The classification read and `/api/categories/options?scope=partner` return only what the organisation may choose; the picker requires a subcategory where the organisation is narrowed. Residents and hosts never send `scope`, so their pickers are unchanged |
| 7. Server-side validation | `assertOrgMayAssign()` in the classification route, checked **only when the category changes** |
| 8. Compatibility | Existing assignments, Explore, search, category pages and listing cards are untouched. A listing keeps a category its organisation (or the platform) no longer offers, and saves unchanged |

**Integrity (D-A1):** the admin integrity check (`/api/admin/categories/integrity`) now also reports organisation grants that point at a missing organisation, a missing category or the wrong parent, and unknown suggested forms. Admin writes validate every id.

### 3. Database (additive, idempotent)
- `taxonomy_categories.moderation_policy VARCHAR(20) NOT NULL DEFAULT 'standard'`
- `taxonomy_categories.suggested_form VARCHAR(40) NULL`
- `listing_taxonomy.needs_review TINYINT NOT NULL DEFAULT 0` (an admin assignment clears it)
- `organisations.category_mode VARCHAR(12) NOT NULL DEFAULT 'all'`
- `org_category_access (org_id, category_id, subcategory_id DEFAULT '*')`, primary key on all three

### 4. APIs
- **Admin categories:** `GET /api/admin/categories` adds `moderationPolicies` and `formTypes`; `POST`/`PUT /api/admin/categories[/:id]` accept `moderationPolicy` and `suggestedForm` (validated, audited as before).
- **Review queue:** `GET /api/admin/categories/review` (`taxonomy.view`); `POST /api/admin/categories/review/:type/:id/accept` (`taxonomy.manage`, audited `taxonomy.assignment_accepted`).
- **Organisation eligibility:** `GET /api/admin/organisations/:id/categories` (`orgs.view`); `PUT` (`orgs.manage`, shared `config_version` 409, audited `org.categories_changed` with reason).
- **Partner:** `GET/PUT /api/vendor/classification/:type/:id` filter and enforce; `GET /api/categories/options?scope=partner`.
- **Templates:** each now carries suggested categories (a preset only, never an authorisation rule, D-A5).

### 5. Screens
`phase2-screenshots/`:
- `config-04-admin-allowed-categories.png`: restricted to Culture, faith & celebrations → Faith gatherings; the review shows "Culture & heritage (1 listings keep it)";
- `config-05-admin-category-governance.png`: category editor, Governance section;
- `config-06-partner-picker.png`: the partner picker offers only Faith gatherings.

### 6. Permissions
- reading organisation eligibility needs `orgs.view`; changing it needs `orgs.manage`;
- category review rule and form need `taxonomy.manage`;
- accepting a review needs `taxonomy.manage`, while any admin can read the queue;
- partners are limited by organisation, as server-side checks.

### 7. Tests
- **`categoryPolicy.test.ts` (9):**
  - rules for all / restricted / subcategory / eligible-only;
  - grant validation; the picker filter;
  - admin permissions, versioning and audit;
  - **#5 unauthorised category refused** (including another organisation's approved-only one until granted);
  - the shared picker filters only on `scope=partner`;
  - **#6 legacy listing** keeps its category after narrowing and after deactivation;
  - review_required flags only live listings and never unpublishes, and Super accepts;
  - policy and form validation;
  - integrity issues reported.
- **Browser batch `booking-config-categories`:** admin UI → partner API and picker → legacy listing. Passes.
- **Regression:**
  - server suite **140 files, 1,297 passed, 0 failed** (23 live-provider skips);
  - client 348 passed;
  - category browser batches: CAT-ADMIN, CAT-HOST, CAT-VENDOR, CAT-VENDOR-RETRY and CAT-REVIEW pass;
  - booking-club, booking-event-attendees and booking-event-options pass;
  - **CAT-PUBLIC and B2-LISTS fail, as on the untouched base `f22294f`** (known baseline, report 10).
- **Real failures found and fixed while validating:**
  - The two configuration batches were named outside the QA reporter's allowed evidence prefixes, so their evidence wasn't saved even when they passed. Renamed to `booking-config-*`.
  - The capabilities browser test clicked an ambiguous "Review changes" button once the categories section existed. **Both buttons were renamed** ("Review capability changes", "Review category changes") so they have distinct accessible names.

### 8. What was preserved
- Hosts' and residents' pickers; public discovery; existing listing categories; admin listing assignment (still unrestricted by organisation, and clears review flags).

### 9. Outstanding
- `review_required` flags only partner moves of **live** listings. New listings already go through admin approval on publish.
- The suggested form is stored and validated; Phase G uses it.
- Brief §8's "vendors suggest a category for admin review" is still the existing alias needs-review flow. There's no new suggestion form (not required for E).
