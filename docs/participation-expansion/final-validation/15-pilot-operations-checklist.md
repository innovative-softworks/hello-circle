# 15 · Pilot operations checklist (Irish web pilot)

**How to use this:** every `[ ]` is open until someone with authority ticks it and writes their name and date. Placeholders in `⟨angle brackets⟩` must be filled by the owner. **Nothing here has been signed off.** No organisation has been contacted and no real participant onboarded.

## 1. Pilot organisation(s)

| Item | Value | Signed off |
|---|---|---|
| Organisation legal name | ⟨name⟩ | [ ] |
| Type (community centre / club / event organiser / programme provider) | ⟨type⟩ | [ ] |
| Organisation contact (day-to-day) | ⟨name, role, email⟩ | [ ] |
| Organisation operational owner (accountable for their data and staff) | ⟨name, role⟩ | [ ] |
| HelloCircle relationship owner | ⟨name⟩ | [ ] |
| Pilot start and planned end dates | ⟨dates⟩ | [ ] |

## 2. Approvals required before go-live
- [ ] **Data-processing terms** signed with each pilot organisation (controller/processor roles, purposes, retention, sub-processors). Owner: ⟨legal⟩
- [ ] **Privacy policy** updated and approved. The change summary for legal review is in [14](14-pilot-remediation.md) §7; nothing has been published. Owner: ⟨legal⟩
- [ ] **Organiser messages consent model** accepted: "service messages about the person's own booking, no marketing" (see [08](08-communications-and-reporting.md)). Owner: ⟨owner + legal⟩
- [ ] **Cash on arrival, if used:** explicit commercial approval (who collects, receipts, refunds, VAT treatment). It is *not* approved by default because online payment is disabled. Owner: ⟨owner + accountant⟩
- [ ] **Approved capabilities** per organisation, set by an admin (Admin → Organisations → capabilities), and recorded here: ⟨list⟩
- [ ] **Production configuration verified (read-only)** by an authorised operator (§6). Owner: ⟨operator⟩

## 3. Staff onboarding (per organisation)
- [ ] Owner account approved; organisation record checked.
- [ ] Staff invited with the **least role** needed (centre manager / facility manager / finance / communications / read-only analyst / check-in only).
- [ ] Training done:
  - door check-in: by pass or name, and partial groups;
  - the booking record: answers and team notes;
  - Messages: audience, preview, "send me a test";
  - Reports and authorised exports: who can see what.
- [ ] Each staff member has made a test booking on a **test listing** and checked in that test booking.

## 4. Support, incidents and monitoring

| Item | Value |
|---|---|
| Support rota (pilot weeks) | ⟨names, hours⟩ |
| Escalation owner (data or privacy incident) | ⟨name⟩ |
| Escalation owner (booking or payment issue) | ⟨name⟩ |
| Contact route given to the organisation | ⟨email / phone⟩ |

**Incident handling:**
1. **Record it:** time, what, who is affected, and the correlation id from `[error-report]`.
2. **Contain it:**
   - turn the switch off (Admin → Settings);
   - or pause the listing;
   - or suspend the organisation (D-01).
3. **Assess personal-data impact:** escalate to ⟨privacy owner⟩. A breach that may need notifying is assessed within 72 hours (GDPR Art. 33).
4. **Tell the organisation;** tell residents if they are affected.
5. **Write a post-incident note.**

**Monitoring:**
- `/api/health`;
- `[error-report]` lines and the webhook (background jobs report failures);
- payment-review alerts (only relevant if paid bookings are ever enabled);
- a daily check of Admin → Exceptions during the pilot.

## 5. Backup, rollback and pause
- [ ] **Nightly DB and uploads backups** confirmed running. The last restore drill is on record. An off-server copy is still to be decided. Owner: ⟨ops⟩
- **Rollback:**
  - turn the feature switch off first;
  - redeploy the previous commit if needed (schema changes are additive);
  - restore from backup only for data loss.
- **Pause criteria (any one):**
  - a cross-organisation data exposure;
  - a wrong booking or capacity count affecting a real person;
  - a privacy complaint not resolved in ⟨n⟩ days;
  - more than ⟨n⟩ support tickets per 100 bookings;
  - the organisation asks to pause.
- **Exit criteria:** planned end date reached, or a pause not resolved within ⟨n⟩ days. Then data is handled per the data-processing terms.

## 6. Production configuration check (read-only, authorised operator only)
This validation had **no production access**, so production state is **BLOCKED / unverified**. An authorised operator runs the following read-only queries on the production database (no writes) and records the output here:

```sql
SELECT `key`, value FROM app_settings
 WHERE `key` IN ('participation.reminders','participation.host_questions','participation.partial_cancel',
                 'participation.special_category_questions','commerce.open_booking',
                 'participation.events','participation.options','participation.attendees','participation.checkin');
SELECT org_id, flag_key, enabled FROM feature_flags WHERE flag_key IN ('donations','external_payments') AND enabled = 1;  -- expect 0 rows
```

| Check | Expected value |
|---|---|
| Server environment variable `PAID_CHECKOUT` | unset or `closed`. Production fails closed when unset (`releaseGates.ts`). |
| Live Stripe keys | none present, unless and until paid bookings are approved |
| `participation.reminders`, `participation.host_questions`, `commerce.open_booking` | absent or `false` |
| `participation.partial_cancel`, `participation.special_category_questions` | absent or `false` (they can't be switched on: locked, 409) |

Record: ⟨operator, date, output attached⟩ [ ]

## 7. Success criteria (measured weekly)
- Registrations completed without support: target ⟨x%⟩.
- Form completion rate (Reports → Registration forms): ⟨x%⟩.
- Check-in time per person at the door: ⟨x s⟩.
- Partner message delivery: in-app delivered / attempted.
- Repeat participation (Reports → Repeat participation).
- Support tickets per 100 bookings: ≤ ⟨n⟩.
- **Zero** cross-organisation data incidents.

## 8. Known limitations to tell pilot partners
- **Free bookings only.** Online payment is disabled. Cash on arrival only if approved (§2).
- **Web only.** There is no mobile app.
- **Turned off for the pilot:** day-before reminders, host questions on resident activities, removing one person from a group booking, sensitive (health or religion) questions, and Make It Happen.
- **Reports, events:** bookings and people are counted separately. "Not recorded" means nobody marked it; it is not a no-show.
- **Reports, clubs:** check-ins show per listing, not yet in the summary table.
- **Programmes:** "finished" means every session is past. There's no attendance threshold for completion.
- **Volunteers:** run as an experience. Applicants are confirmed directly; there's no approval step.
- **Accessibility:** the automated checks pass. A full screen-reader review is still to be done.
