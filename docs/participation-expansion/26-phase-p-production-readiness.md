# 26 · Phase P: production-readiness engineering and pilot preparation

**Date:** 2026-10-30.
**Scope:** engineering evidence and remediation. **This is not a release verdict.** The separate Final Master Validation decides GO / CONDITIONAL GO / NO-GO.
**Fix in this phase:** `a84b302` (job failures reported).

## P1 · Security: route guard review (new and changed routes, Phases H–O)
| Route group | Guard | Isolation | Test |
|---|---|---|---|
| `/api/vendor/forms/:type(club\|program\|centre)/:id/*` | Read: org member; write and answers: the listing's role, plus the capability | `vendor_id ∈ req.vendorIds` → 403 | universalForms, vendorReports |
| `/api/orders/:source/:ref/*` (resident) | Guest id, resident or verified email (as the "my …" lists) | Others get 404; no cross-type reads | orderRecords |
| `/api/vendor/orders/:source/:ref` (+ notes) | Order roles; answers and notes for the listing's role only (**not finance**) | Org-scoped → 404 | vendorOrders |
| `/api/vendor/messages*` | Send, preview and test: communications (owner) | The audience comes only from the org's own listing | vendorMessages |
| `/api/vendor/reports/*` | Managers, finance, analyst; counts only | Org filter on every query | vendorReports |
| `/api/admin/governance` | `audit.view` (deny-by-default D-02) | n/a | governance, adminPermissions |
| `/api/games/:id/questions`, `/no-show` | Host only | `host_resident_id` | gameQuestions |
| `/api/make-it-happen/confirm` | Resident, paused switch, form gate | — | compatibility |

**Also confirmed:**
- **Check-in-only staff** stay limited to `/api/vendor/door` (the `requireVendor` allow-list): records, reports and answers return 403 (browser batch `booking-config-operations`).
- **Field level:**
  - answers go to the listing's managers and owner only;
  - exports follow the data-class policy;
  - medical notes are never selected (source scan, `privacyMedical.test.ts`);
  - the special-category switch is locked (409).
- **Audit rows hold no message text, answer values or recipients.**
- **No vulnerabilities found needing a fix.** Async route errors return 500 through `express-async-errors`; they don't hang.

## P2 · Booking reliability
- **Unchanged in Phases H–P:** capacity locks, coupon reservation, pending holds, Stripe checkout agreement, webhook idempotency, payment reviews, refunds.
- **Answers:** checked before any place or credit is taken and written inside the same transaction. A deleted pending hold removes its answers.
- **Form version changes:** stale → 409 `questions_changed`; missing → 409 `form_required`. Covered by unit tests on every type.
- **Existing coverage** (rerun in the final validation): concurrency (`booking-club` concurrent capacity, remediation cancel races), quote expiry, duplicate webhooks, payment failure and review, refund compatibility (Stripe TEST), QR duplicate check-in (`attendee_checkins` unique).
- **No payment business rule changed** to make a test pass.

## P3 · Performance: what's known, not measured
- **New query paths are bounded:**
  - reports at 20,000 bookings, with form completion checked for up to 1,000;
  - audiences at 2,000 people;
  - answers lists at 500;
  - message history at 200.
- **They use existing indexes:**
  - `registration_answers (source_type, source_ref, …)` unique;
  - `attendance.ref` unique;
  - `idx_message_delivery_status`;
  - `idx_order_notes_ref`.
- **Per-order loops** (form completion, the "waiting for answers" audience) are O(orders) small queries. They're acceptable at pilot scale, and the first candidates to batch if they show up.
- **Not measured here:** response times on a production-like server. PERF-P13 needs one; it's in the final validation.

## P4 · Accessibility (WCAG 2.2 AA target): new UI reviewed
| Area | Status |
|---|---|
| Labels | Every new form control has a label (composer, filters, team notes, host questions, registration answers). The resident edit form reuses the existing error summary |
| Live regions | Status and alert roles for preview, send results, errors and "needs your attention" |
| Chart | The weekly chart has `role="img"` with a full text alternative, and the same data is in tables |
| Dialogs | Use the existing `ConfirmDialog`/`Modal` (focus handling as before); no side drawers |
| Phone layouts | Checked in screenshots, with no horizontal scroll in the browser batches |

**Not done:** a full keyboard and screen-reader pass across all pages (final validation's a11y batches).

## P5 · UI consistency
- **Reused throughout:** the existing workspace components (`RecordView` 70/30, `Box`, `Facts`, `adm-*`), the consumer booking kit, the design tokens and the card styles.
- **No new layout systems** and no redesign of unrelated pages.

## P6 · Privacy and governance: open legal and owner decisions
1. **Privacy policy wording:** it still says medical information is collected at club registration (doc 18 §1). Needs legal review.
2. **Legacy medical notes:** lawful basis, retention and possible erasure. Counts are available to admin (Governance) and to operators (doc 18 script).
3. **Registration-answer retention periods:** none set; counts only; no automatic deletion.
4. **Notification consent:** organiser messages and reminders treated as service messages for one's own bookings. Reminders are in-app only, behind a switch.
5. **Data exports:** the policy allows exportable classes. Confirm which classes may be exported (contact and special categories never).
6. **Paid booking eligibility, VAT treatment, donations, external payments:** not decided; not enabled.
7. **Feature switches awaiting approval:** `participation.reminders`, `participation.host_questions`, `participation.partial_cancel` (locked), `participation.special_category_questions` (locked).

## P7 · Operations and monitoring
| Area | State |
|---|---|
| Health check | `GET /api/health` |
| Error reporting | `[error-report]` lines, plus an optional webhook (scrubbed) |
| **Job monitoring** | **Fixed:** the 9 scheduled sweeps now report failures through `reportException` (they only logged before) |
| Notification failures | Partner messages have per-delivery status, retries and "held on test site" |
| Payment webhook alerts | Existing payment-review sweep and alerts (D-10/D-11) |
| Backups | Nightly DB and uploads with a restore drill (existing ops) |
| Rollback | Schema changes are additive and idempotent (no down-migrations needed); code rollback is redeploying the previous commit. New features sit behind switches that are off |

## P8 · Irish pilot preparation (synthetic data only; no real participants or payments)
**Representative organisations:**
- community centre (halls with a booking form);
- sports club (registration form, kit questions);
- event organiser (an event with options and attendees);
- programme provider (a programme with sessions and a register);
- resident host (an activity with host questions).

**Organisation onboarding checklist (admin):**
1. Approve the partner and create or confirm the organisation.
2. Set capabilities (Phase B–D templates) and allowed categories (Phase E).
3. Check field policy (Phase F) and keep special categories locked.
4. Give staff roles (owner, managers, finance, communications, analyst, check-in only).
5. Confirm notification templates and policy texts.

**Vendor setup checklist:**
1. Listing details and category.
2. Registration form (template → preview → publish).
3. Sessions or rooms.
4. Test booking with a test account.
5. Check-in staff.
6. Messages ("Send me a test").
7. Reports.

**Staff training checklist:**
- **Door check-in:** by pass or name, and partial groups.
- **The booking record:** answers and team notes.
- **Messages:** audience and preview.
- **Reports and exports:** what each role can see.

**Resident journey checklist:**
1. Find the listing.
2. Book or register, answering the questions.
3. See the confirmation.
4. My Life: answers, change answers, status.
5. Arrive and check in.
6. Review.

**Support procedures:**
- Find the person or order (Admin → Support).
- Record page and audit log.
- Payment reviews (Finance).
- Privacy requests.

**Feedback collection:**
- Partner and resident feedback forms (existing `feedback`).
- A weekly call with each pilot organisation.

**Success metrics:**
- Registrations completed without support.
- Form completion rate (Reports).
- Check-in time per person.
- Message delivery rate.
- Repeat participation.
- Support tickets per 100 bookings.
- No cross-organisation data incidents.

**Incident and rollback:**
- Switch the feature off (admin Settings).
- Pause the listing or organisation (D-01).
- Redeploy the previous commit.
- Restore the DB from the nightly backup only for data loss.
- Every incident logged with a correlation id.

## Known limitations carried into validation
- The mobile app is not device-tested.
- Make It Happen is paused.
- Reports are bounded.
- The full browser, Stripe TEST and accessibility regression runs in the Final Master Validation.
