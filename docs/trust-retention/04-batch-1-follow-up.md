# Trust & Retention — batch 1 follow-up (2026-10-28, local, uncommitted)

## Review eligibility: before → after
- **Before (batch 1):** a recorded door check-in of a *booking* opened a "Verified booking" review for its holder, even though the holder may not have attended. Session self-check-in alone opened an unlabelled review.
- **After:** a public review needs a completed, uncancelled occurrence **and** an authorised organiser's confirmation that *this person* attended:
  - Sessions: the host's attendance record for the resident's own place. An accepted correction writes the same record.
  - Bookings, registrations, programmes and experiences: the data can't tie the holder to who came (free-text participant names, children's registrations, hall events, group seats). The holder asks "confirm I attended" and the organiser accepts. A door check-in alone confirms the booking, not the person. A later no-show overturns the confirmation.
  - Self-declaration never opens a review.
  - Group bookings: only the holder can review, at most once, and only once their own attendance is confirmed. Other group members can't review (limitation: they have no record).
  - The label is computed live (`verifiedSql`), so every new review shows "Verified attendance" only while its confirmation holds.
  - Older reviews keep no label and can be deleted but not edited.
- The same rule applies to submission, editing, labels, the eligibility endpoint and the review links on the booking page. There are no other review invitations.

## Historical data
- Local `hello_circle_dev`: 12 reviews, all legacy (no occurrence). None were written under the looser rule.
- One legacy duplicate group (3 reviews by `adm-demo` on venue `c2`) was kept as-is; it doesn't conflict with the new index (NULL occurrence).
- Local `hello_circle` (prod copy): never migrated, so no new-rule reviews exist there. Staging and production: batch 1 is not deployed.
- Proposal if older-rule reviews ever exist: keep them visible and counted, with no label; their authors can ask the organiser to confirm. Never delete them.

## Upgrade safety (disposable MySQL 8 container)
Applied the HEAD schema, inserted legacy data, then ran the current `initSchema()` three times:
- Every run was idempotent.
- Counts, ratings and hidden flags were unchanged, and no labels were granted.
- Duplicate inserts are refused (1062).

Partial upgrade test (index dropped, a conflicting row inserted, a column and a table removed):
- Boot now **logs a conflict report and continues**. It used to throw and stop the server.
- No rows were deleted, and the missing column and table were recreated.
- The index is created on the next start once a person resolves the conflict.
- `reviews.ts` also refuses duplicates in code.
- Script: scratchpad `upg/check.sh`.

## Other changes
- **Programme sessions:** each past session can be confirmed separately. New `GET /api/attendance/places/:kind/:ref` returns per-place status for the booking page ("After your visit").
- **Organiser panel:** shows the listing, date and booking name for each request.
- **"Who welcomes newcomers"** (`newcomer_welcome`, max 300 characters, public; phone numbers and emails are refused):
  - Session form (create and edit)
  - Partner participation editor (programmes, experiences, clubs)
  - Venue editor ("On arrival")
  - Shown on detail pages and the booking "Get ready" blocks
- **"What to expect"** on experiences, programmes, venues ("Before you book"), clubs and Sessions:
  - "Not provided by …" vs "Not applicable"
  - Suitability only from attributes the organiser ticked

## Checks performed
- **Server:** 132 files, 1210 tests passed (23 live-provider tests skipped), isolated container.
- **Client:** 43 files, 341 tests passed.
- **Production build:** passes.
- **Browser (Playwright, dev stack on `hello_circle_dev`):** throwaway `qa-trust-*` accounts and data, removed afterwards.
  - Resident:
    - The booking page explains that a door check-in doesn't say who came, and that reviews are closed until confirmation.
    - "Ask to confirm" opens a dialog that takes focus and closes on Escape; the request then shows as pending.
    - Programme bookings list a row per past session.
  - Partner:
    - The request panel shows the listing, date and booking name.
    - Decline stays disabled until a note is written; declined and confirmed requests update the list.
  - Resident sees the outcomes:
    - Declined: the reason, "Ask again" and "Ask HelloCircle to look at it".
    - Confirmed programme: a review link. The review posted with "Verified attendance" and the summary shows 1 review.
  - Host Session form: a phone number is refused; a valid line saves, shows on the public Session page and reloads in the form.
  - Partner programme editor ("Participation experience" dialog), desktop and mobile:
    - A phone number is refused; a valid line saves and shows on the public programme page.
    - The help text is linked to the field.
  - "What to expect": no horizontal overflow at 1280, 820 and 375 px on experience, programme and Session pages.
  - A partner session gets 403 from the admin verification and attendance APIs.
  - No console errors.
- **Not checked visually:** venue and club pages. They're behind the existing `VITE_VENUE_PAGES_PUBLIC` launch flag (off on dev, which shows "Coming soon"); I didn't change the flag. Their fact lists are covered by unit tests.

## Blockers / decisions
- **Admin pages not checked in a browser.** Both dev admin accounts have two-step sign-in. The QA harness only reaches admin by switching the requirement off, which counts as bypassing it, so I didn't use it. Needs: the owner signs in with a code, or approves using the QA harness for this.
- **Owner decision:** the strict rule means venue, club, programme and experience reviews always need the holder to ask for confirmation. Alternative: treat single-person self-bookings as confirmed by a door check-in.
- Identity checks stay unavailable (provider and retention policy needed).
