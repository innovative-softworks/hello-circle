# Trust & Retention — confirmation, revocation and isolated QA (2026-10-28, local, uncommitted)

## Final attendance and review rules

| State | What it means | Label | Score / count |
|---|---|---|---|
| **Confirmed** | An authorised organiser confirmed *this person* attended a past, uncancelled occurrence. Sessions: the host's record for the resident's own place. Bookings, registrations (adult only for direct confirmation), programmes, experiences: an accepted confirmation, either the organiser's own (`origin = 'organiser'`) or an accepted request. A door check-in confirms the booking, not the person. | "Verified attendance" | Counted |
| **Disputed** | An open attendance request exists for the same place (e.g. the attendee contests a host's no-show). | Removed while open | Kept |
| **Revoked** | The organiser later records a no-show/absence, or withdraws their confirmation (reason required). | Removed at once | Kept. The review is **flagged** (one pending system report, "don't hide it just because it's critical") and audited (`review.attendance_changed`); never hidden automatically. |
| **Support decision** | Support hides the review through the existing report case with a recorded reason. The author is notified with the case reference (`R-000123`) and can ask for reconsideration through the existing appeal route (Complaints & appeals; `R-` references are accepted). | — | Removed from count and average at once (live aggregation) |
| **Restored** | Attendance is put back (present, or an accepted request) and no dispute is open. | Returns automatically | Counted |
| **Legacy** | Reviews written before attendance-based eligibility (no occurrence, or an older basis). | Never | Counted; author can delete, not edit |

No path deletes or rewrites a review because attendance changed. Labels are computed live (`verifiedSql`), so there's nothing to backfill.

## Duplicate protection

- **Normal operation:** `review_claims` (primary key = SHA1 of subject, occurrence, author) is inserted in the **same transaction** as the review. `uq_review_occurrence` is kept as a second guard.
- **Legacy conflicts block the unique index:** the claim's primary key still makes each submit atomic. The earlier check-then-insert was replaced (it was not race-safe without the index).
- **Upgrades:**
  - Claims are backfilled with `INSERT IGNORE` (earliest review per group).
  - Historical duplicates keep no claim and stay untouched.
  - The boot-time conflict report is unchanged.
- **Deleting your own review** releases its claim, so the author can review again. Admin-hidden reviews keep their claim.
- **Tests (isolated MySQL):**
  - 5 simultaneous submits, with and without the index → exactly one 201.
  - Independent attendees submitting concurrently → both 201.
  - Edit then delete, then resubmit → 201.
  - `initSchema()` run twice → historical duplicates and claims unchanged.

## Organiser confirmation

- **Where:** Partner workspace → Bookings → "Confirm who attended". Covers the last 60 days of past hall bookings, experience bookings and programme sessions.
- **What each row shows:** listing, date, holder name, "booked for N people (only they are confirmed)", door status, open request, confirmed, review submitted.
- **How it works:**
  - One row at a time; there is no bulk action.
  - The dialog says the other guests aren't marked.
  - Org-scoped, with the check-in role split (bookings: centre manager; others: facility manager).
  - An open request is accepted rather than duplicated.
  - **Withdraw** requires a reason, is audited, flags any review and notifies the resident.
- **Resident:** gets an in-app notification through the existing `notifyResident` path (no email). The booking page shows "Not confirmed yet" → "Confirmation pending" → "Attendance confirmed · review available" → "Review submitted". The review needs no request.
- **Not offered:** child club registrations — the account holder is a guardian. They use the request route.
- **Sessions:** hosts keep using participant check-in, which is already person-level.

## Isolated QA (repository QA harness)

- **Environment recovery:** the previous run's `environment.json` (its generated credentials) was missing, cause unknown.
  - Its container was stopped (not removed) and its manifest moved to `.qa-data/qa_9d63726cbc259f00/retired-missing-environment-manifest.json`.
  - A fresh run was provisioned with `qa:db:setup`, verified with `qa:preflight:connected` and seeded with `qa:db:seed`.
  - No guard changed.
- **New suite `npm run qa:trust`:** batches trust-admin, trust-venue and trust-confirm. `VITE_VENUE_PAGES_PUBLIC=true` is passed **only** to the trust-venue child process; dev and launch flags are unchanged.
- **Admin access:** the QA persona and two disposable role-restricted admins (support, finance) exist only in the QA database, where QA disables admin two-step sign-in for its own personas. Existing dev admin accounts were not used.
- **trust-admin covers:**
  - Verification: empty state, failed request with retry, list and record at 1280/820/375 with no overflow.
  - Dialogs: Escape closes them; focus moves into the dialog.
  - Approve stays disabled until the evidence note is written; status and history update.
  - Decline needs a category and an explanation the partner sees; audit trail checked.
  - Attendance corrections: support settles a declined dispute (note required).
  - Reviews: hide and restore need a reason; the hidden reason shows.
  - Safety reports carry their badge; the system attendance flag is visible.
  - Reconsideration via appeal with an `R-` reference.
  - Finance admin: "Not included in your admin role" and 403 from the APIs.
  - Support admin can read the evidence note; a stale version is refused (409).
- **trust-venue:** venue "Before you book" and club "What to expect" at three widths:
  - newcomer and arrival lines;
  - "Not applicable" vs "Not provided by …";
  - partner save paths refuse phone numbers;
  - the support link is reachable by Tab and has a visible focus ring.
- **trust-confirm:** the full organiser → resident → review journey in the real UIs.

**Bug found by QA:** `--color-focus` isn't defined on public pages, so every focus ring in `trust.css` resolved to no outline. Fixed with a fallback to `--color-text`.

## Known limits / decisions
- **Restricted evidence:** every admin role that can open the verification queue (super, support, legal) may also read internal notes, so evidence restriction is enforced by the API but no current role sees the record without the note. To exercise it, a future role would need queue access without `decisions.internal_notes.view`.
- **Venue booking prep:** the booking page's "Get ready" block exists for Sessions and experiences only; venue hire bookings don't show the arrival line there yet.
- **Dev admin pages** still need a person with a two-step code to look at them on the dev stack. The isolated QA run covers the behaviour.

## Next batch: Your next plan → attend → review → go again / follow host
1. **My Life "Your next plan" card:** combine the next commitment with what to expect (meeting point, who welcomes newcomers, what to bring, status, help) and the booking link. Reuse `myLife.ts` and the `WhatToExpect` builders.
2. **Attend:** day-of state on the card ("today", check-in where it exists). After the occurrence, "Did the organiser confirm you?" uses `/api/attendance/places`.
3. **Review:** an in-app invitation only once attendance is confirmed. Uses the existing notification preferences (add a `reviewInvites` preference *with* its enforcement in `PREF_KEY_BY_KIND`), sent from the organiser-confirm path.
4. **Go again:** after a confirmed visit, show the next open date of the same series or listing (`games.series_id`, programme next session, experience sessions). It never books automatically.
5. **Follow host / series:** extend `follows` with `series`, and notify on a new date through the existing follow notification levels. Add a "Follow host" prompt on the booking page after attendance.
6. **Tests:** isolated server tests plus a `qa:trust`-style journey spec; no real email.
