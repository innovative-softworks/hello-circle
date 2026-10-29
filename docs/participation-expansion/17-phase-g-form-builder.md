# 17 · Phase G: visual form builder

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`. Not committed, not pushed, not deployed.
**Builds on:** Phase 2 question sets (doc 12), the Phase F field registry (doc 16) and the Phase E suggested form (doc 15). Same tables; no parallel form system.

## 1. What existed
- A per-listing question set saved whole under a version, with answer snapshots.
- Phase F: the registry, ready-made fields, approved types and policy.
- Phase E: categories can name a suggested form type.

## 2. What was built (partner Questions tab, now "Registration form")
| Brief item | Implementation |
|---|---|
| Form templates | **7 platform templates**, one per form type (event, activity, programme, club, experience, venue, volunteer), built from ready-made fields; admin-only fields are left out while the field policy has them off. **Organisation templates:** save the current form as a template, duplicate, archive and restore (never deleted). The category's suggested template is listed first, marked "suggested for this category" |
| Sections | Optional section heading per question (with suggestions from the form's own sections); the booking form and preview show a heading where a section starts |
| Adding and editing approved fields | Ready-made fields (registry wording) and own questions in the policy's allowed types, with all Phase F properties |
| Reordering | Up and down; a condition that would point below its question is cleared automatically |
| Required / optional | Per question ("Must be ticked" for tick boxes; information items are never required) |
| Select options | One per line, for pick one / pick several / buttons |
| Validation | Lowest/highest number, shortest/longest text, pre-filled answer, email and phone formats (server-side) |
| Simple conditional visibility | **"Only show when"** an earlier pick-from-a-list or tick-box answer is one of the ticked values. A once-per-booking question can't depend on one person's answer. **The server applies the same rule:** a hidden question is never required and anything sent for it is dropped |
| Preview | Inline (no drawer): the real booking form for a sample adult and child, at **desktop or phone width**; conditions work live |
| Draft and published versions | Partners work on a **draft** (saved on request, never seen by anyone booking, may be incomplete; its problems are listed). **Publish** runs the full registry and policy validation and makes a new version. A draft started before someone else published is refused (409) rather than overwriting. Discard draft |
| Version history | Every published version with question count, date and author; **View**; **Copy into draft** |
| Existing-answer compatibility | Answers keep the question wording and version they were given on; a later version that removes or changes a question doesn't touch them |
| No JSON for users | Everything is form controls; JSON is only the internal draft storage |

## 3. Database (additive, idempotent)
- `registration_questions.section VARCHAR(120) NULL` and `show_if_json TEXT NULL`.
- `registration_form_drafts (listing_type, listing_id, base_version, draft_json, updated_by, updated_at)`, one per listing.
- `registration_form_templates (id, org_id, form_type, name, description, questions_json, status, created_by, …)`. Platform templates live in code.

## 4. APIs (under `/api/vendor`)
- **Read:** `GET experiences/:id/questions` adds `draft` and `suggestedFormType`.
- **Draft:** `PUT experiences/:id/questions/draft` (shape-checked, ≤12 questions, ≤60 KB), `DELETE …/draft`, `POST …/draft/from` `{ templateId | version }`.
- **Publish:** `POST experiences/:id/questions/publish` (full validation, organisation question limit, stale check, audited `experience.questions_published`).
- **History:** `GET experiences/:id/questions/versions` and `…/versions/:version`.
- **Templates:**
  - `GET form-templates`;
  - `POST form-templates` (validated like a publish, audited);
  - `POST form-templates/:id/duplicate`;
  - `POST form-templates/:id/archive` and `…/restore` (platform templates: 403, "duplicate one instead").
- **Unchanged:** the Phase 2 `PUT experiences/:id/questions` direct publish still works.

## 5. Permissions
- **Reading the form, versions and templates:** any member of the organisation (check-in-only staff are excluded by the allow-list).
- **Draft, publish and templates:** the two manager roles (`EXPERIENCE_ROLES`), plus the `participation.attendees` switch and the organisation's `registration_questions` capability with its question limit.
- **Templates are organisation-scoped:** another organisation can't see, apply or archive them.

## 6. Screens
- `config-10-builder-preview-desktop.png`: template draft with sections, the lunch question and the conditional portions question; desktop preview.
- `config-11-builder-preview-phone.png`: the same preview at phone width.
- `config-12-builder-published.png`: after publish; version history; own templates.
- `config-13-guest-conditional-phone.png`: a guest on a phone with the Lunch section; portions shown after "Yes".

## 7. Tests
- **`formBuilder.test.ts` (8):**
  - condition rules (earlier only, choice types only, valid answers, booking-on-person refused);
  - hidden questions are never required and dropped;
  - direct publish and a guest booking;
  - incomplete draft (issues listed, invisible to guests, publish refused until fixed), then publish;
  - #8: the old version's answers keep their wording; history lists both versions; copy back into a draft;
  - a stale draft is refused (409);
  - platform templates follow the policy and come back fully spelled out;
  - organisation templates: save, forbidden field refused, duplicate, archive, isolation between organisations, platform templates can't be archived.
- **Browser batch `booking-config-forms`:**
  - the suggested template fills the draft;
  - the partner adds a radio and a conditional number question in a "Lunch" section;
  - the draft isn't live; preview hides and shows the condition on desktop and phone;
  - publish → version 1; history; save, duplicate and archive templates;
  - a guest on a phone answers with the condition; the answers are stored;
  - version 2 removes the question and the guest's answer stays (version 1). **Passes.**
- **Bugs found and fixed while building G:**
  1. **Phase F:** the ready-made "Food preference" field was refused by the sensitive-wording check because its own hint mentions allergies. Ready-made wording is now exempt (vetted platform text), and a regression test proves every ready-made field passes.
  2. **G:** platform templates held bare field keys and crashed the builder. Ready-made fields are now spelled out from the registry on the server, and the builder tolerates partial rows.
- **Full regression:** see §9.

## 8. Outstanding
- **Vendor onboarding form** (brief form type 8, "under Admin control") isn't built. Partner signup is a separate fixed form, and changing it is outside these phases.
- **Admin-authored platform templates:** platform templates live in code (reviewed with the code). Admins can't edit them in the UI.
- **Only experiences and events** use the builder. Halls, clubs and programmes keep their fixed forms.
- **No drag and drop reordering:** Up/Down buttons are used (keyboard-accessible).
- **Version history only lists versions with at least one question:** a published empty form isn't listed.

## 9. Final regression (all of Phase 2, D-A4 and Phases B–G, final code)
| Check | Result |
|---|---|
| Server suite (disposable MySQL) | **142 files, 1,314 passed, 0 failed**, 23 skipped (live R2/Cloudinary provider tests, off by design) |
| Client unit | 45 files, **349 passed** |
| QA harness self-tests | **100 passed** |
| Type checks and production build | pass |
| Guarded browser QA, **every batch of every suite except Stripe TEST**, each run on its own (isolated QA, offset 10) | **148 batches: 332 passed, 18 failed, 3 skipped** |

### Failures separated
**Known baseline (17).** These fail identically on the untouched base `f22294f` (report 10 §5):
- REAL-AUTH-001, LC-UI-DESKTOP-HOST, LC-UI-TABLET, HC-QA-001-STACK, HC-QA-032;
- BK-UI-DESKTOP, HC-QA-043, HC-QA-066, HC-QA-068, HC-GAP-UI-EXP;
- PUB-05/33, PUB-21/22/23, B2-LISTS;
- COMPLETE-REVIEW-STATE, COMPLETE-SILENT, OG-27-UI, CAT-PUBLIC.

**Intermittent, not caused by this work (1):**
- **What:** `REV-HOST-EARNINGS-mobile`. It failed once in the full run and once in a re-run, then passed in the next re-run, with every other revenue test passing both times.
- **Where it fails:** `revenue-resident.spec.ts:61`, which expects the shared QA host's trader profile to read "individual". That's shared QA data other revenue tests write.
- **Why it isn't ours:** nothing in these phases touches `/manage` earnings or trader details. Recommend isolating that profile in the spec.

**Skips (3):** the known REM-046 split (2) and PERF-P13 (needs a production server).

**Real failures found during these phases, all fixed and covered by tests:**
- the `input_type` column was too short for "multi_select" (F);
- the policy reader crashed on an empty saved policy (F);
- the ready-made "Food preference" field was refused by the sensitive-wording check (F, found in G);
- the builder crashed on template fields given only as keys (G);
- my own UI renames broke three earlier browser specs ("Add a question", "Save questions", an ambiguous "Review changes"); the specs were updated and the two review buttons got distinct accessible names;
- the configuration batch names were rejected by the QA evidence reporter (renamed `booking-config-*`).

**Not re-run:** Stripe TEST mode. No payment, checkout, webhook, pricing or refund code changed in these phases; the attendee and question additions to checkout are covered by the server suite and the browser batches.
