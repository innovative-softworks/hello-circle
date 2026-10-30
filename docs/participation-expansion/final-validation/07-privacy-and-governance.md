# 07 · Privacy and data governance

**Commit:** web `d22f4a6`. **Environment:** disposable MySQL (server suite) and the isolated QA container (browser batches). No real personal data was used; all people are synthetic `@example.test` personas.
**Production:** not accessed. Nothing here describes production *values*; production counts must be read by an operator with the read-only script in doc 18.

## Control checks

| Requirement | Result | Evidence |
|---|---|---|
| Club medical free-text collection is removed | **PASS** | `server/src/routes/registrations.ts:129` writes `medical: ""` for every registration. The web and app forms have no medical field. |
| Cached legacy clients can't submit medical notes | **PASS** | `privacyMedical.test.ts` → "a registration that still sends a medical note books, but the note is never stored" (disposable DB). |
| Existing medical notes are not exposed | **PASS** | `privacyMedical.test.ts` → "no server code reads the medical column" (source scan over `server/src`). No API, export or report selects it. |
| Existing medical notes are kept (no automatic deletion) | **PASS** | `privacyMedical.test.ts` → "existing notes are kept untouched". |
| Sensitive dynamic questions stay locked | **PASS** | `privacyMedical.test.ts` → wording, hint, purpose and choices checked; browser CFG-FIELDS and P2-PARTNER: a health question is refused; `participation.special_category_questions` returns 409. |
| Registration answers follow visibility policy | **PASS** | CFG-OPERATIONS: finance sees the record and refund, but `answersVisible: false` and no values; check-in-only staff get 403. New probe FINAL-SEC: another organisation gets 404 on the record and 403/404 on answers. CFG-HOST-QUESTIONS: another resident can't read host-question answers. |
| Exports exclude prohibited fields | **PASS** | `vendorReports.test.ts` → "includes exportable answers the policy allows, never contact details"; CFG-FIELDS export rules. Only `general`, `logistics`, `dietary_preference` classes marked exportable by policy are included. |
| Contact details not unnecessarily exposed | **PASS** | Message preview shows first names only (`vendorMessages.test.ts`); reports CSV is counts only; host participant views show first names. |
| Staff (team) notes restricted | **PASS (unit)** | `vendorOrders.test.ts`: managers only; finance 403; other organisation 404; not in exports; audit holds no text. |
| Audit logs record access and changes | **PASS** | Exports (`*.answers_exported`, rows and question keys, no values: checked in FINAL-SEC); answer edits (`*.answers_edited`, keys only); messages (`vendor_message.sent`, counts, no recipients or text). |
| Retention reports work without deleting data | **PASS** | `governance.test.ts`: counts by theme, retention counts, nothing deleted; admin Governance page (`audit.view`). |

## Legal and policy blockers: current status

| # | Item | Status | What's needed |
|---|---|---|---|
| 1 | **Published privacy policy** (`client/src/pages/PrivacyPolicy.tsx`, lines 51 and 60) | **OPEN.** It still says club registrations collect "any medical information relevant…". The product no longer collects it. | Legal review and approved new wording. This validation didn't edit legal text. |
| 2 | **Managed privacy-policy draft** (`server/src/policy/drafts.ts` line 361) | **OPEN.** Same club-registration wording, also not changed. | As above. |
| 3 | **Legacy medical notes** (existing `registrations.medical` values) | **OPEN.** Kept, unread, counted only. | Lawful basis, retention period and an erasure decision (legal). |
| 4 | **Registration-answer retention** | **OPEN.** No period set; counts only; no automatic deletion. | Retention periods per data class (owner and legal). |
| 5 | **Communication consent and preferences** | **OPEN.** Organiser messages are treated as service messages about one's own booking. Reminders honour the resident's "Booking reminders" setting and are switched off. | Approved consent model before enabling reminders. |
| 6 | **Paid booking and VAT** | **OPEN.** Pricing applies 23% VAT and a 5% fee, as before. VAT treatment per listing type is not inferred. Paid production checkout wasn't enabled. | Accountant and owner decision. |

None of these block the controls above. Items 1–3 **block a public launch that collects club registrations under the current policy text** (the text over-states collection, which is the safe direction, but it's still inaccurate). See gate 13 in [12](12-release-gates.md).

## Commands
```bash
npm run test --workspace server        # disposable MySQL; includes privacyMedical, governance, vendorReports, vendorOrders
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-config-fields npm run qa:booking
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-config-operations npm run qa:booking
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-final-security npm run qa:booking
```
