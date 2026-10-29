# 16 · Phase F: field registry

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`. Not committed, not pushed, not deployed.
**Builds on:** Phase 2 registration questions (doc 12) and the D-A4 remediation (doc 15). It reuses the same tables; nothing parallel was created.

## 1. What existed
- Phase 2 per-listing questions with 5 types (text, number, date, select, checkbox).
- Versioning and answer snapshots; door visibility; booking or attendee scope.
- Special-category refusal (strengthened in D-A4).

## 2. What was built
`server/src/fieldRegistry.ts` defines four field classes:

| Class | What it is | Who controls it |
|---|---|---|
| **A. Platform-locked** | booking reference, payment status, price/VAT/fees, capacity, ownership, contact name/email/phone, attendee name, adult/child, guardian | HelloCircle only. A custom question can't repeat them (reserved labels such as "Email address", "Phone number" or "Price" are refused) |
| **B. Admin-configurable** | ready-made fields that collect contact or personal data: emergency contact, date of birth (children), photo consent | **off** until an admin switches them on |
| **C. Vendor-configurable** | ready-made fields: experience level, T-shirt size, transport, equipment, food preference (never allergies), name on badge | on by default; an admin can switch each off. The partner adds them as they are (HelloCircle's wording), setting only required, door visibility, export and editability |
| **D. Vendor custom** | the partner's own question | approved types only, under platform policy |

**Approved types:**
- the Phase 2 five, plus **long text, email, phone, multi-select, radio** and **information only** (no answer);
- an admin can disallow any type except short text.

**Field properties (all stored per question):**
- stable key, label, hint, "why we ask", placeholder, pre-filled answer;
- required; min/max (numbers); shortest/longest answer (text); choices;
- booking or attendee scope, and who answers (all / adults / children);
- **visibility:** organiser always, door only when ticked, frozen in the answer snapshot;
- **editability:** "until start" or **"can't be changed after booking"**, enforced on the server;
- **data classification:** general, logistics, food preference, contact, personal. Email and phone answers are forced to *contact*;
- **retention** per class (admin);
- **export:** the partner ticks a question AND the admin allows that class;
- **version:** the question set's version plus each answer's frozen snapshot.

**Sensitive-data restrictions (every class):**
- special category stays refused while its switch is locked. The wording check covers the label, hint, why-we-ask, placeholder and every choice (D-A4);
- **financial and identity data are always refused:** card, bank, IBAN, password, PIN, PPS number, passport, licence number and similar;
- information-only items can never be required, shown at the door or exported.

**Admin field policy:**
- a single row in `field_policies`, edited in admin **Settings → Registration fields**;
- covers which ready-made fields are on, which custom types are allowed, and per class the retention period and whether answers can be exported;
- versioned (409 when stale) and **audited** (`fields.policy_changed`, with before, after and reason).

**Retention:**
- answers past each class's retention period are **counted and shown** to admins;
- **nothing is deleted automatically**, pending the owner's retention decision (Phase 2 gap 3).

**Export:**
- `GET /api/vendor/experiences/:id/attendees.csv` is limited to roster roles (finance, communications and analysts get 403);
- one row per person, containing only exportable answers in exportable classes;
- never contact details or special categories; spreadsheet formulas are neutralised;
- every export is audited (`experience.attendees_exported`, with row count and question keys).

## 3. Database (additive, idempotent)
- New `registration_questions` columns, all nullable or defaulted: `field_key`, `placeholder`, `default_value`, `min_length`, `max_length`, `editability`, `exportable`.
- New `field_policies (id, version, policy_json, updated_by, updated_at)`.
- **Widened:** `registration_questions.input_type` and `registration_answers.input_type_snapshot`, VARCHAR(10) → VARCHAR(20), so "multi_select" fits. It's an idempotent check-then-alter; existing values are kept. This bug was found by the Phase F tests.

## 4. APIs
- **Partner:** `GET /api/vendor/experiences/:id/questions` adds `library`, `allowedTypes` and `classes`. `PUT …/questions` validates against the registry and the policy (error codes `reserved_field`, `forbidden_field`, `special_category`, `type_not_allowed`, `field_not_available`).
- **Admin:** `GET /api/admin/fields` (any admin); `PUT /api/admin/fields/policy` (`policies.manage` = Super or Legal).
- **Export:** `GET /api/vendor/experiences/:id/attendees.csv` (roster roles).
- **Resident:** answers support the new types; locked answers keep their first value; public questions carry placeholder, default, length limits and editability (never the export flag or class).

## 5. Screens
- `config-07-admin-field-policy.png`: Registration fields policy.
- `config-08-partner-fields.png`: a ready-made T-shirt field and the partner's own multi-select, after an identity question was refused.
- `config-09-guest-fields.png`: the guest form with the new inputs and "Why we ask".

## 6. Permissions
- policy: read by any admin, changed only with `policies.manage`;
- question sets: the two manager roles;
- export: roster roles;
- answers: the booker only (locked answers can't change);
- door: only door-visible answers.

## 7. Tests
- **`fieldRegistry.test.ts` (8):**
  - reserved, forbidden and special refusals (including a placeholder);
  - library wording and admin-only fields; types, rules and classes;
  - new answer types validated on the server;
  - policy validation, permissions, staleness and audit;
  - the builder sees only allowed fields and types;
  - **export filtering**, roster-only, audited, formula-safe;
  - **locked editability**.
- **Browser batch `booking-config-fields`:** admin policy (restored afterwards) → partner builds ready-made + own fields, an identity question is refused → guest answers multi-select → My Life shows "Morning, Afternoon" → the export contains only the exportable question. **Passes.**
- **Regression:**
  - server suite **141 files, 1,305 passed, 0 failed** (23 live-provider skips);
  - client 349 passed;
  - batches config-capabilities, config-categories, booking-event-options, booking-club and validation-categories-b pass;
  - booking-event-attendees: **one failure caused by this phase** (my own rename of "Add a question" to "Add your own question"), fixed in the spec; re-run 4/4.

## 8. Preserved
- Phase 2 questions and answers (existing rows read with the new properties defaulted);
- door, My Life and the attendee list (answers now also carry a readable `display` form);
- checkout and payment.

## 9. Outstanding
- Retention deletion needs the owner's decision.
- Only experiences and events use registration questions; other listing types keep their fixed forms (the club form minus the medical field).
- "Admin-configurable" covers library availability and policy. Changing platform consent wording or making booking-contact fields required isn't built: it would change existing checkout behaviour.
