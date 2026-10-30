# 22 · Phases K and L: communications, reporting and governance

**Date:** 2026-10-30.
**Branch:** `feature/participation-phase2`. Local commits only, not pushed or deployed:
- Phase K: `18e08fb`, `fcd4bfc`, `760a292`;
- Phase L: `ad05c96`, `5dbb9f2`.

**Validation:** by owner instruction, unit tests and type checks only for now. The full browser and Stripe regression runs once, at the end (see doc 27).

## Phase K: communications and notifications

### 1. Existing functionality found
| Need | Already there |
|---|---|
| Booking or registration confirmation | `notifyNewBookingOrRegistration`: guest email, plus in-app for the vendor, admins and resident |
| Cancellation and refund | `notifyCancellation`, `notifyRefund` |
| Booking changes (halls) | Change proposals and withdrawals |
| Waitlist offers | `waitlist.ts` (honours `waitlistOffers`) |
| Review invitations and feedback | Review-invitation sweep (Trust & Retention) |
| Suggestions for future participation | My Life "For you" and alerts (opt-in) |
| Event instructions | Booking page "get ready" sections (meeting point, what to bring, venue) |
| Partner messages | `vendor_messages`: halls and clubs only, email only, sent in a loop, no audience, preview, status, retry or idempotency |
| Resident preferences | `notification_prefs` (several keys stored but not wired) |

### 2. Missing, and implemented
- **Answer-change notice:** the partner gets an in-app note (never the answers) when a resident edits answers (`notifyAnswersChanged`).
- **Day-before reminder** (`participation/bookingReminders.ts`):
  - covers events and experiences, hall bookings and programme sessions;
  - includes time, place, "show your pass to check in", and a note when answers are missing;
  - once per order and day;
  - wires the existing **"Booking reminders"** preference;
  - **switch `participation.reminders`, off by default.**
- **Partner messages, extended in place** (`participation/partnerMessages.ts`, `routes/vendorMessages.ts`, Messages screen):
  - **Listing types:** any (hall, club, programme, event or experience).
  - **Audience:** resolved on the **server** from the organisation's own listing. It can be narrowed by date or session, and by who: everyone confirmed, checked in, not checked in, or still owing answers. One message per person.
  - **Templates:** approved ones (update, schedule change, arrival, what to bring, check-in, thank you, feedback, own message) with `{name}` and `{listing}`. A template's [bracketed] parts must be replaced before sending.
  - **Preview:** counts and first names only, **never addresses**.
  - **Before sending:** a confirmation dialog, plus **"Send me a test"**, which reaches the sender only.
  - **Delivery:**
    - **idempotent sends** (one per sender and key);
    - **one delivery row per person and channel:** in-app (and push) for signed-in residents, email for everyone;
    - **delivery status and history**;
    - **retries:** at most 3, swept every 5 minutes;
    - stuck rows recovered after 10 minutes.
  - **Outside production** (`NODE_ENV≠production` or `APP_ENV=staging`), email only goes to test domains (`MESSAGE_TEST_ALLOWED_DOMAINS`, default `example.test,example.com`). Anything else is recorded as "held (test site)", so **test notifications never reach real people.**
  - **Links:** reminders and organiser messages open the booking they're about (web, push, and the app's My Life).

### 3. API and database changes
- **API:** `GET /api/vendor/messages/templates`; `POST /messages/preview`, `/messages/test` and `/messages`; `GET /messages`, now with delivery status.
- **Database (all additive):**
  - `vendor_messages`: added `org_id`, `sent_by_user_id`, `audience_json`, `template_key`, `recipient_count`;
  - new tables `vendor_message_deliveries` and `vendor_message_requests`;
  - notification kinds `reminder` and `organiser_message`.

### 4. Permissions and privacy
- **Sending:** sending, preview and test need the **communications** role, and owners always can (the existing rule). Another organisation's listing is refused (403).
- **History:** visible to members of the organisation.
- **Check-in-only staff:** no access.
- **Audit:** one row per send, holding who, which listing and how many. Never the text or the recipients.
- **Delivery rows:** store the order reference and first name only. The email address is looked up at send time.

### 5. Tests
- `routes/vendorMessages.test.ts` (8):
  - another organisation, finance and centre managers are refused;
  - the audience is de-duplicated, with session and attendance filters, and the preview holds no addresses;
  - an unfinished template is refused;
  - a send is idempotent, with in-app delivery and the email hold outside production;
  - history and isolation;
  - "send me a test" goes to the sender only;
  - retries stop at the attempt limit;
  - a zero-person audience is recorded, as before.
- `participation/bookingReminders.test.ts` (2).
- `client notificationLink.test.ts`.
- Browser batch `booking-config-messages`: compose, template, preview, confirmation, history and the resident's in-app message. It passed once; it reruns in the final validation.

### 6. Limitations and decisions
- **Decisions:**
  - **Organiser messages** are treated as service messages about one's own booking, with no opt-out. Owner decision.
  - **Reminders:** in-app and push only, behind the switch. Should email be added?
  - **Notification recipients:** answer-change notes go to the listing owner's account only (as new-booking notes do).
- **Limitations:**
  - No scheduled sends, no attachments, no SMS.
  - Answers stay out of messages by design.

## Phase L: reporting and governance

### 1. Existing functionality found
- Partner bookings CSV (finance and analyst), statements, Demand, admin Insights and marketplace health.
- The admin **audit log**, with search and area filters.
- Privacy requests and the field-policy page.

### 2. Implemented
- **Partner Reports tab** (managers, finance, read-only analyst), counts only:
  - **Summary:**
    - registrations by type;
    - attendance (expected, attended, not attended, not marked);
    - capacity;
    - cancellations by month;
    - registration-form completion.
  - **Filters:** date range, **listing type**, **listing** and **date or session**. Always within the caller's organisation.
  - **Registrations over time:** weekly bars, the one trend where a chart helps.
  - **By listing:** orders, cancelled, people, checked in, attendance. This covers programme enrolment, club participation, event performance and hall use.
  - **Check-in activity** by day.
  - **Repeat participation:** a resident, or the same email for guests.
  - **CSV download** (same numbers, audited).
- **Answers export** for club, programme and hall forms:
  - for the listing's role only;
  - only questions marked exportable, in data classes the platform policy allows (never contact details or special categories);
  - audited.
- **Admin → Governance** (`audit.view`):
  - **The audit log by theme:** configuration, registration-field policy, exports, permission changes and privacy requests. Each shows a count and the latest entries (who, what, when; never stored values) and links into the audit log.
  - **"Worth a look":** evidence-based only (10 or more exports by one account in a day; admin sign-in lockouts).
  - **Retention counts:** legacy medical notes; answers past retention.
  - **The open privacy decisions.**

### 3. API and database changes
- **API:** `GET /api/vendor/reports/participation`, `.csv` and `/detail`; `GET /api/vendor/forms/:type/:id/answers.csv`; `GET /api/admin/governance`.
- **Database:** no schema change. The reports read existing rows.

### 4. Permissions and privacy
- **Organisation isolation:** every query is filtered by the caller's organisation; another organisation's listing id returns nothing.
- **No personal data in reports**, which is what lets analysts read them.
- **Medical notes** are never selected (counts only, via the doc 18 helper).
- **Nothing is deleted.**

### 5. Tests
- `routes/vendorReports.test.ts` (6):
  - every section's counts;
  - no personal data;
  - isolation;
  - roles;
  - the period limit;
  - audited CSV;
  - the export policy and roles;
  - the detail filters (including another organisation's id).
- `governance.test.ts`: themes without values, heavy-export indicator, retention counts.

### 6. Limitations
- Reports count at most 20,000 bookings, and form completion checks at most 1,000 (the screen says so).
- No PDF export.
- "Worth a look" doesn't cover failed partner logins: those aren't recorded per account today.

## Screenshots
- `config-40-partner-message-compose.png` and `config-41-partner-message-history.png`: Phase K browser batch.
- `config-34-partner-reports.png`: the first Reports screen. The filters, trend and new sections are captured in the final validation run.
