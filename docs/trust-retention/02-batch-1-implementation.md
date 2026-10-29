# Trust & Retention — batch 1: what was built (2026-10-28, local, uncommitted)

## Rules now enforced on the server

**Reviews** (`server/src/reviewEligibility.ts`, `routes/reviews.ts`)
- A review is about one *occurrence*: a booking, club registration, programme enrolment, experience booking or Session place.
- Open only when the occurrence is in the past (Ireland date), wasn't cancelled (booking, Session or session date), and attendance is confirmed. An organiser-recorded no-show blocks it.
- `attendance_basis` records what was confirmed:
  - `person`: a Session host recorded this resident. Public label: "Verified attendance".
  - `booking`: the organiser recorded the booking. Public label: "Verified booking", with the note that a group/family booking's reviewer may not have attended.
  - `self_reported`: Sessions only, the participant said they went and the host recorded nothing. No label.
- One review per attendee per occurrence (unique key `uq_review_occurrence`; a racing double submit gives 201 + 409). A group booking gets one review, by the booking's holder.
- No self-reviews: a host can't review themselves or their own Sessions; nobody in the owning organisation (or a resident linked to it) can review its listings.
- Ownership: client id, resident id, or a magic-link-verified email (the same rule as My bookings).
- Authors edit (`PUT /api/reviews/mine/:id`) or delete (`DELETE /api/reviews/mine/:id`, a hard delete with an audit row). Admin hide/restore needs a recorded reason, including hides made through a report.
- Rating summary (`GET /api/reviews/summary`) is computed live from visible reviews: average, count, 1–5 distribution. There is no stored or composite score.
- Replies: partner replies now cover experiences and programmes (org-scoped, `communications` role); hosts can also reply to reviews of their own Sessions.

**Attendance** (`routes/attendanceCorrections.ts`)
- A host check-in of a participant is also written to `attendance` (`kind='game'`, ref `<gameId>:<residentId>`).
- New route: `POST /api/attendance/games/:id/participants/:rid` lets a host record present or no-show.
- Corrections:
  - A participant asks, once per place (`open_key`).
  - The owning organisation (org-scoped, check-in role split) or the host accepts or declines. Declining needs a note.
  - Support (`complaints.handle`) can decide or overturn: `/api/admin/attendance/corrections`.
  - Accepting writes attendance with `source='correction'`. Payments are untouched.

**Verification** (`server/src/verification.ts`, `routes/verificationChecks.ts`)
- Labels, each with its meaning:
  - Email confirmed: residents only. Vendors have no confirmation step.
  - Host application approved: replaces "Verified Host" in public copy.
  - Business details checked.
  - Identity checked / Organiser identity checked: **unavailable**. The server refuses to approve them, and a label can't render even if a row exists.
- Workflow states: pending → more information → approved (internal evidence note required, optional expiry) / declined / withdrawn / expired.
- `rowVersion` guards stale screens.
- The evidence note is visible only to `decisions.internal_notes.view` roles and never reaches the partner.
- Every step is audited and has a D-03 reason where someone is refused.
- Existing permissions are reused (`queues.view`/`queues.decide`, `complaints.handle`); no permission policy changed.
- The commercial `provider_tier` no longer drives any "verified" claim. This affects:
  - the provider profile
  - experience and programme pages
  - activity summaries
  - the partner account line

**Reports** (`routes/reports.ts`)
- `category` is `content` or `safety`; safety reports are listed first for admins.
- `reporter_resident_id` is stored.
- The reporter gets a case ref `R-000123`.
- `/mine` returns `canAppeal`, which links to the existing complaints appeal flow.
- The reporter is never exposed to the reported party.

## UI
- Host profile (`pages/HostProfile.tsx`): 70/30 layout with intro, activities, upcoming Sessions, Circles and reviews. The aside shows checks with meanings, "Identity not checked", hosting since, general area, support and report.
  - The page now exists for any public host, not only approved ones.
  - With no reviews it shows "New to HelloCircle".
- `components/Reviews.tsx`: summary + distribution, verified labels, dates (reviewed / edited / visited), tags, replies, edit/delete own, report with case ref. The form has visit picker, accessible star radios, tags and an explanation of which label the review will carry.
- Provider profile: a "What HelloCircle has checked" section.
- Circle hero: removed the ✓ beside the Circle name (it read as "verified Circle").
- Organiser and host lines now say "Host application approved" / "Approved host".
- Session page: a "What to expect" list. Every field is shown, and empty ones read "Not provided by the host".
- Booking detail: "After your visit" shows the attendance record, a review link when open, the correction request and its status, and a complaints escalation route.
- Partner workspace: Organisation → Business check; Bookings → Attendance requests.
- Host workspace: Reviews → Attendance requests.
- Admin: Marketplace → Verification checks (queue + record page); Trust & Platform → Attendance corrections. Review hide/restore takes a reason. Safety reports carry a badge.
- Report dialog: a "This is a safety concern" option, the case reference on send, and 112/999 guidance.
- Safety page: case ref, category, decided date, "Ask us to reconsider".

## Schema (additive, `initSchema()`)
- `reviews` gains: `resident_id, author_key, occurrence_kind, occurrence_ref, occurrence_date, attendance_basis, tags, updated_at, hidden_reason, hidden_by, hidden_at, vendor_reply_by`. Indexes `uq_review_occurrence` and `idx_reviews_listing` are added.
- `reports` gains `category` and `reporter_resident_id`.
- New tables: `attendance_corrections`, `verification_checks`.
- Existing reviews keep NULL occurrence. They stay visible and carry no verified label.

## Behaviour change to note
Reviews used to open on "paid + past". They now need recorded attendance (or a Session self-confirmation). Venues and clubs that never check people in will get no new reviews until they record attendance or accept corrections. This was intended by the brief, but it deserves an explicit owner nod.
