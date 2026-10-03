# HelloCircle — Product gaps (not defects)

Features that do not exist today, identified during Phase 7 lifecycle validation
(2026-10-01). These are **not** confirmed regressions and were **not** implemented
during Phase 7 remediation. Confirmed defects live in `QA_BUGS/` (HC-QA-022..033).

| Gap | Current behaviour (verified) | Classification | Why |
|---|---|---|---|
| Revoke a sent activity invitation | No route or UI (`DELETE /api/invitations/:id` → 404). A pending invitation keeps granting visibility of a private activity until it expires (30 days) or is answered. | **REQUIRED BEFORE MVP** | Privacy: a mis-sent invite to an invite-only activity exposes its time/place with no way to withdraw it. |
| Revoke a pending Circle invitation | No route or UI. A pending organiser invite also acts as a join shortcut into an invite-only Circle. The organiser can only remove the member after they join. | **PRODUCT DECISION REQUIRED** (lean required) | Same privacy shape as above for invite-only Circles. Remove-after-join is a partial workaround. |
| Activity visibility selection in the host UI | The UI never sends `visibility`. Since HC-QA-023, Circle plans inherit the Circle's privacy (open → public, approval/invite → circle). Standalone activities are always public in the UI. Invite-only/circle-only for standalone activities are API-only. | **PRODUCT DECISION REQUIRED** | Whether hosts may create private standalone activities, and whether an organiser may deliberately make a private Circle's plan public. |
| Circle privacy change does not re-scope existing plans | Changing a Circle's join mode later does not change the visibility of plans already created. | **PRODUCT DECISION REQUIRED** | Inheritance happens at creation only. |
| Chat message edit/delete | No routes (`PUT`/`DELETE /api/chat/messages/:id` → 404). Reporting a message exists. | **POST-MVP** (re-check under privacy/GDPR review) | Moderation path exists. Self-delete is commonly expected but not blocking for lifecycle correctness. |
| Archive in the host UI | Archive exists only via `POST /api/games/:id/lifecycle`. Since HC-QA-028 it is administrative: blocked while other participants are joined (cancel first). | **POST-MVP** | Cancel covers the user-facing need. Archive is housekeeping. |
| Scheduling UI (`publish_at`, booking open/close windows) | Fully supported by the API and read-time lifecycle. No host UI. | **POST-MVP** | The publish/coming-soon/draft UI covers launch needs. |
| Follower/search-alert/intent notifications for scheduled publication | Side effects fire only when an activity is effectively active at creation, or on an explicit coming soon → active transition. An activity that becomes visible via `publish_at` never triggers them. | **PRODUCT DECISION REQUIRED** (required if a scheduling UI ships) | Read-time lifecycle has no publication event to hook. Needs a sweep or an event design. |
| Waitlist promotion when the host increases capacity | Not automatic. Since HC-QA-026 the host's manual "offer" works whenever a real spot exists. | **POST-MVP** | Manual path is safe and available. Automation is a convenience. |
| Hard delete of an activity | No route (by design: cancel/archive keep history and payment records). | Not a gap — intended | — |

## Observations noted for later triage (not tested in Phase 7)

- The chat inbox's last-message preview does not apply the mutual-block filter
  that the message list itself applies. Observed in code only. Phase 7 did not
  include broad security exploration, so this is recorded for the next security review, not asserted.
- Experience-departure chat was not included in the HC-QA-022 cross-scope
  regression (it needs session/booking fixtures). The inbox fix is scope-agnostic,
  and Circle, game, club and program were exercised.

## Booking gaps identified in Phase 8 (2026-10-01), not defects

| Gap | Current behaviour (verified) | Classification | Why |
|---|---|---|---|
| Self-cancel for experience bookings and programme enrolments in the UI | Both APIs exist (`/api/experiences/bookings/:ref/cancel`, `/api/programs/enrollments/:ref/cancel`), but My Life has no cancel control for either. Only hall bookings and club registrations have one. | **REQUIRED BEFORE MVP** | Paid bookings must be cancellable by the booker without contacting support. |
| Expiry of stale pending holds | **Closed by HC-QA-041 remediation.** Holds stop counting after 30 minutes at read time; the provider's expired event marks them failed. A periodic cleanup of old `failed` rows is optional housekeeping. | Resolved (housekeeping optional) | — |
| Waitlists for programmes and experiences | None (by design today; only clubs and activities have waitlists). | **POST-MVP** | Capacity is enforced; waitlists are a convenience. |
| Notifying participants when a programme session is cancelled | The vendor session cancel only flips the session status (the enrolment covers the whole programme). | **PRODUCT DECISION REQUIRED** | Whether a single-session change warrants a notice. |
| Vendor-initiated date change for booked experience/programme sessions | Not supported (only guest reschedule for hall bookings; host date edits for activities). | **POST-MVP** | — |
| Centre/club/programme booking pages in the current launch configuration | Behind the venue launch gate (`/centres/`, `/clubs/`, `/book/`), so they were verified at API level only. | Configuration, not a gap | — |

## Phase 9 — Stripe TEST mode (2026-10-01)

| Gap | Detail | Classification | Note |
|---|---|---|---|
| Real webhook delivery not exercised | Phase 9 delivered events signed locally with a per-run secret through the real verifier (`constructEvent`), wrapping real test-mode objects. Stripe's own delivery (Dashboard endpoint or `stripe listen`) was not used. | **REQUIRED BEFORE LAUNCH** | Configure the production endpoint and its secret, and smoke one real delivery in a staging environment. |
| Refund events not consumed | `charge.refunded` / `refund.updated` are ignored. Refunds made in the Stripe Dashboard aren't reflected locally. | POST-MVP / **DECISION** | Refunds should go through HelloCircle, or the app should start handling these events. |
| No partial refunds | Only full refunds exist (N/A in Phase 9). | POST-MVP | — |
| Unsigned webhook in dev without a secret | With no `STRIPE_WEBHOOK_SECRET` and `NODE_ENV` ≠ production, unsigned events are still accepted (documented dev convenience). | **DECISION** | Consider requiring an explicit opt-in env flag so a staging environment never accepts unsigned events. |
| Cancelled-pending checkouts stay payable | Guests can't cancel a pending checkout (409). The provider page stays open until its 30-minute expiry, and payment then confirms consistently. | POST-MVP | Expire the Stripe session when a pending hold is abandoned in-app, if an abandon action is ever added. |
| Coupon held during open checkout | Since HC-QA-050, an open checkout reserves its coupon use for up to 30 minutes. | Accepted trade-off | Documented in QA_BOOKING_MODEL.md. |
| No event-ID ledger | Duplicate deliveries are safe because every transition is conditional (verified), but event IDs aren't recorded. | POST-MVP | An event log helps support and forensics. |
| Server Vitest suite targets the dev DB | `npm run test --workspace server` uses `server/.env` (the development DB), so it was not run in the isolated QA phases. | **REQUIRED** (tooling) | Point it at an isolated database. |


## Phase 10 — product gap review (2026-10-02/03)

Reclassified for MVP and staging. Nothing was implemented.

### Known items (requested review)

| Gap | Phase 10 observation | Classification |
|---|---|---|
| Activity invitation revocation | Still no route or UI | **REQUIRED BEFORE MVP** (unchanged — privacy) |
| Experience cancellation UI (booker self-cancel) | API exists; My Life has no control | **REQUIRED BEFORE MVP** (unchanged) |
| Programme cancellation UI (booker self-cancel) | API exists; My Life has no control | **REQUIRED BEFORE MVP** (unchanged) |
| Programme waitlist | None | POST-MVP |
| Experience waitlist | None | POST-MVP |
| Refund reconciliation (Dashboard refunds / `charge.refunded`) | Not consumed; refunds must go through HelloCircle | **PRODUCT DECISION REQUIRED** (either forbid Dashboard refunds operationally or consume the events before launch) |

### New gaps found in Phase 10

| Gap | Observation | Classification |
|---|---|---|
| Circle members notified of new plans | Not implemented, although the UI promises it (HC-QA-056) | **REQUIRED BEFORE MVP** (or remove the promise — decision) |
| Vendor onboarding emails (received / approved / admin alert) | None sent (HC-QA-058) | **REQUIRED BEFORE MVP** |
| What vendors are told while venues are gated | Dashboard says "Live" (HC-QA-059) | **PRODUCT DECISION REQUIRED** |
| Resident uploads without R2 | Impossible in local mode (HC-QA-062) | **PRODUCT DECISION REQUIRED** (require R2 in every non-dev environment, or extend the fallback) |
| Host notified on every free join/leave | Only on full / paid leave (by design) | PRODUCT DECISION REQUIRED |
| Circle invite by email / link to non-residents | Invite requires an existing resident ID | POST-MVP |
| Activity/booking confirmation emails for free joins | None (in-app only) | PRODUCT DECISION REQUIRED |
| Pagination / bounded lists for games, Circles, notifications | None (HC-QA-073) | **REQUIRED BEFORE public launch at scale** (POST-MVP at pilot volume) |
| Preview before publishing an activity | None | POST-MVP |
| Sign in with Apple | Placeholder button only | POST-MVP (hide the button until built — decision) |
| Pre-consent Google Fonts and Unsplash hot-links | Third-party requests before consent | PRODUCT DECISION REQUIRED (privacy review) |
| Cross-browser automation (Firefox/WebKit) | Engines not installed | REQUIRED BEFORE STAGING SIGN-OFF (tooling) |

## Phase 10A updates (2026-10-03)

| Gap | Phase 10A outcome |
|---|---|
| Circle members notified of new plans | **Implemented** (HC-QA-056): once per member per plan, when the plan becomes bookable. Decision: the UI promise stands |
| Vendor onboarding emails | **Implemented** (HC-QA-058): application received + approved. An admin "new vendor waiting" email is still not sent (POST-MVP / DECISION) |
| Resident uploads without R2 | **Resolved for local mode** (HC-QA-062): local storage with validation; restricted covers private. R2 remains required for production-quality variants |
| Draft activity sharing | **Decision recorded:** drafts are private and not shareable (Share hidden; the API 404 stands) |
| Lazy-route chunk-load recovery (e.g. stale tab after deploy) | New, **POST-MVP** (observed via BRW-1) |
