# HelloCircle — UI completion (2026-10-14)

_Local, uncommitted work on `feature/commerce-engine`. Covers the UI-completion brief (no side drawers, record pages,
editors in the shell, confirmations, overviews, error states) and the two technical gaps (Stripe Connect onboarding,
webhook reconciliation), plus a **second pass** the same day: record pages for claims, host applications, place
suggestions and finance records; form error summaries; anchored action menus; the two remaining silent failures; and
the customer/admin side of the payment-review state. Results are in `hellocircle-completion-validation.md`; open
policy questions are in `hellocircle-operating-decisions.md` (D-01 to D-11). **The product isn't complete:** the
remaining gaps are listed in §6._

---

## 1. Interaction model now in place

| Task size | Pattern | Implementation |
|---|---|---|
| Substantial record work (view, decide, manage) | **Dedicated record page** with a stable URL inside the workspace | `?record=<type>:<id>` via `useRecordParam()` (`client/src/useUrlTab.ts`); `RecordView` / `RecordState` (`components/workspace/RecordView.tsx`) |
| Long forms (listing editors) | **Full page inside the workspace shell** | `PartnerWorkspace` (`components/workspace/PartnerWorkspace.tsx`) wraps the four editor pages |
| Several secondary actions on a row | **Anchored overflow menu** beside the visible main action | `ActionMenu` (`components/ActionMenu.tsx`) |
| Short task / confirmation | **Centred dialog** | `Modal`, `ConfirmDialog` (`components/ui.tsx`). `Drawer` now renders a centred `Modal`, so the remaining callers can't slide in |
| Mobile workspace navigation | **Full-screen section menu** | `WorkspaceShell` "Sections" sheet (`.adm-sheet`, `inset:0`); resident `NavSidebar` is full-screen too |
| Desktop workspace navigation | Grouped sidebar (kept) | `WorkspaceShell` at ≥1025px, collapsible (admin) |

**No slide-in panels remain in the client.** `grep slide-in-left|slide-in-right` over `client/src/**/*.tsx` returns
nothing. The CSS classes are still defined (and covered by reduced motion) but unused.

### Drawers removed or replaced
| Before | After |
|---|---|
| Admin `DetailPanel` (listing, vendor, report case) — right slide-over | `ListingRecord`, vendor record, `ReportCasePage` record pages. `DetailPanel` deleted from `adminUi.tsx` |
| Partner `BookingDetailModal` | `BookingRecord` page (`record=booking:<ref>`) |
| Host `ParticipantsModal` | `ActivityRecord` page (`record=activity:<id>`) |
| Resident `ReceiptDrawer` from Profile → Receipts | `/receipts/:ref` page (`pages/ReceiptPage.tsx`). `ReceiptDrawer` is now only used by the dev-only `CommercePreview`; its `ToneChip` is shared |
| `Drawer` (Header mobile menu, browse filters, Learn more, Games, Explore, coupon redemptions) | Same callers, now rendered as a centred `Modal` (no code changes at call sites) |
| Workspace "Sections" sheet (slid in, partial width) | Full screen, sticky header, no slide |
| Resident `NavSidebar` (240px slide-in from left) | Full screen, `role=dialog`, focus on Close |

## 2. Shared UI system

- **Tokens:** the workspace palette (`#F7F4EC` background, `#FFFFFF` panels, `#172019` text, `#5B635C` secondary,
  `#FF4B24` accent, `#E5E1D8` borders), Bricolage headings and Inter body are scoped to `.adm` / `.ws`.
- **Corners as tokens:** `--radius-control` / `--radius-card` / `--radius-pill`. They're 10/16/999px on consumer
  pages and **2px inside the workspace** (`.adm`, `.adm-sheet`, `.adm-panel`, `body.in-workspace` for portalled
  dialogs). `theme.ts`'s `radius.control|card|pill` resolve to these vars. Literal radii were converted in 21
  files. The old broad override `.ws [style*=border-radius]` is gone.
- **New components:** `RecordView`, `RecordState`, `WorkspaceShell` `HeaderContext`/`useRecordHeader`,
  `PartnerWorkspace`, `HostWorkspace`, `ScopedWorkspace`, `useLoadFailure` + `LoadFailed`
  (`components/admin/loadFailure.tsx`), `useUrlParam`, `useRecordParam`, and `usePaged(..., urlParam)` (page number
  kept in the URL).
- **`Button` now forwards `aria-label` / `aria-describedby` / `aria-busy` / `aria-expanded` / `aria-controls` /
  `aria-pressed`.** Before this they were silently dropped, which TypeScript doesn't catch for hyphenated props.
- **Headings:** every workspace tab now starts its section headings at h2 under the shell's h1. Heading levels
  were normalised across 20 components.

## 3. Screens completed

### Record pages (stable URL, server-enforced, back with filters preserved, labelled statuses, sections, actions, states)
| Record | URL | Statuses shown separately | Actions | States |
|---|---|---|---|---|
| Admin · listing | `/admin?tab=listings&record=centre:<id>` (and `club:` / `experience:`) | Listing review · Partner account | Approve & publish, Reject listing, Delete listing (all confirmed) | loading, missing, error + retry |
| Admin · partner account | `/admin?tab=vendors&record=vendor:<id>` | Account status · tier · organisation | Approve, Suspend account / Reinstate account (confirmed; copy states what suspension does today — D-01) | loading, missing, error |
| Admin · report case | `/admin?tab=reviews&reports=1&record=report:<id>` | Report status · target | Dismiss, Mark actioned, Suspend content (confirmed; optional statement of reasons) | loading, missing, error |
| Partner · booking / registration | `/vendor?tab=bookings&record=booking:<ref>` | **Booking · Payment · Refund · Check-in** | Check in, Cancel booking ("Keep booking" default), Refund (confirmed) | loading, missing, error |
| Host · activity | `/manage?tab=activities&record=activity:<id>` | Activity · Places | Offer a place (waitlist), Remove participant, Refund (confirmed) | loading, missing, error |
| Resident · receipt | `/receipts/<ref>` | Receipt status (paid / refunded / …) with the price breakdown | Back to receipts (read-only) | loading, signed-out (401), not found or not yours (403/404 → same message), error + retry |
| Admin · listing claim *(2nd pass)* | `/admin?tab=claims&record=claim:<id>` | Claim · Partner account | Approve claim (blocked with the reason while the partner account isn't approved), Reject claim; related: Open partner account, Open listing; history: the listing's audit entries | loading, restricted (403), missing ("only claims waiting for a decision can be opened"), error + retry; decided state kept on the page |
| Admin · host application *(2nd pass)* | `/admin?tab=hostApplications&record=host:<residentId>` | Application | Approve as Verified Host, Decline; history: the resident's host-status audit entries | as above |
| Admin · place suggestion *(2nd pass)* | `/admin?tab=placeSuggestions&record=suggestion:<id>` (decided ones too) | Suggestion (waiting / published / rejected) | Approve & publish, Reject; related: Open published listing | as above |
| Admin · settlement *(2nd pass)* | `/admin?tab=finance&section=settlements&record=settlement:<id>` | **Settlement · Transfer** | — (read-only); related: its transfers | loading, restricted, missing, error |
| Admin · transfer *(2nd pass; was a modal)* | `…&section=transfers&record=transfer:<id>` | **Transfer · Reversed** | Reverse part of an allocation (existing operation: amount + audited reason); related: settlement, each booking's order | as above |
| Admin · payment event *(2nd pass)* | `…&section=events&record=event:<id>` | **Processing** (needs review / failed / processed / stored) | Replay (existing; audited reason); for a checkout mismatch, a step-by-step **investigation path**; related: the order | as above |
| Admin · refund *(2nd pass)* | `…&section=refunds&record=refund:<id>` | **Refund · Kind** | — ; related: the order | as above |
| Admin · dispute *(2nd pass)* | `…&section=disputes&record=dispute:<id>` | **Dispute · Recovery** | Recover from partner / HelloCircle absorbs (existing; once lost; audited reason) | as above |
| Admin · order (payment hub) *(2nd pass)* | `…&record=order:<type>:<ref>` | **Payment · Refunded · Disputes · Release to partner** | Refund… (existing admin refund; amount optional, who bears it, audited reason); related: refunds, disputes; frozen allocation shown | as above; "No payment recorded" explained |

List filters in those lists are URL parameters, so returning from a record restores them: admin listings
`q/type/view/county/sort/page`, partner bookings `bview/bstatus/bwhen/bq`, host activities `astatus/awhen/aq`, claims
and host applications `q/page`, place suggestions `view/q/page`, and finance `section` plus the payment-events filter
`events`. Old `?open=` admin links are still honoured. The finance records use only existing finance endpoints; three
of them (`/settlements/:id`, `/payments?ref=`, `/allocations/:type/:ref`) already existed on the server and just
gained client wrappers. Finance lists are capped at the latest 200 rows server-side; an older record says it can't be
found from its list. Decisions in the three admin queues now happen on the record page behind a confirmation; the
list rows have a **Review** button. The admin overview's queue items open the specific record.

### Forms (2nd pass)
One convention in `components/form.tsx`, applied to the centre, club and experience editors, the programme form and
the finance reason fields:
- **Markers:** a required field shows ` *` after its label and its control has `required`; an optional one shows
  "(optional)"; each form says "Fields marked * are required." once. Every label is now tied to its control
  (`htmlFor`/`id`).
- **Error summary:** after a failed save, `FormErrorSummary` lists every problem, takes focus (with a visible
  outline), and each entry is a link to its field. A collapsed `SettingsSection` holding an errored field opens so the
  link can reach it. Each field also shows its own message, tied with `aria-describedby`/`aria-invalid`. Editing a
  field clears only that field's message.
- **Failed saves:** a server failure goes into the same summary ("Couldn't save: …"); everything typed stays.
- **Duplicate submits:** Save is disabled and reads "Saving…" while a save is in flight (verified: two clicks, one
  request).
- **Unsaved changes:** unchanged from the first pass (the guard covers the Back link, breadcrumb, sidebar and mobile
  menu), re-verified.
- **Defects fixed on the way:** the centre, club and experience editors loaded their record with no failure handling,
  so a failed load left a blank form that **Save would have written over the real listing**. They now show
  "Couldn't load…" with retry and no form. Adding or editing a room swallowed failures; both now report them, and room
  Save can't be double-submitted.

### Action menus (2nd pass)
`ActionMenu` (WAI-ARIA menu button): Enter/Space/↓ opens on the first item, ↑ on the last; arrows wrap; Home/End;
Escape closes and returns focus to the button; Tab or an outside click closes. It's positioned against the viewport
(flips above near the bottom, clamped to the edges) in a portal, and follows the workspace radius tokens. Choosing an
item returns focus to the button first, so a confirmation it opens hands focus back there. Used where rows carried
several secondary actions; the main action stays a visible button:
- **Host activity rows:** visible Manage activity + Share; menu: Check-in, Edit activity, Post an update, Duplicate /
  Host again, Cancel activity… (danger, separated).
- **Partner listing cards and table rows:** visible Edit (and View live listing); menu: Copy public link, Pause/Resume
  bookings, Duplicate, Delete listing…. This also fixed **four icon-only buttons per table row that had no accessible
  name**.
- **Circle plan rows:** visible Participants; menu: Edit plan, Post an update, Cancel plan….

Record headers with two or three decision buttons (booking, listing, claim…) keep them visible; a menu wouldn't be
clearer there.

### Payment review state (2nd pass)
- **Customer:** the six order status endpoints now return `paymentReview: true` while the order is still pending and a
  paid Checkout event for it is parked in review (`paymentUnderReview()` in `payments/checkoutAgreement.ts`, joined
  through `checkout_agreements`). The confirmation page shows **"Your payment needs a quick check"**: not booked,
  don't pay again, contact us with the reference. It promises no outcome, since none is decided (D-10/D-11). A failed
  status request is now "We couldn't check your payment just now" with **Check again**, no longer "We couldn't find
  that booking".
- **Admin:** the overview shows **Payment events needing review** (finance/super only), linking to the filtered
  events list. Each event's record page explains the investigation path.
- **Safety:** the agreement check and its "no override" rule are untouched. See the completion-validation doc for
  the retry, duplicate and replay tests.

### Editors inside the workspace shell
`/vendor/centres/:id`, `/vendor/clubs/:id`, `/vendor/programs/:id` and `/vendor/experiences/:id` now render in
`PartnerWorkspace`: sidebar, breadcrumb "Partner workspace › Listings › <name>", and **every navigation goes through
the editor's existing unsaved-changes guard** (sidebar, breadcrumb, mobile menu). Each editor has load-error and
missing states. A rejected listing shows `ListingReviewNotice` ("Not approved yet — changes needed") with **Resubmit
for review**. Resubmission is blocked while there are unsaved changes. No rejection reason is shown, because none is
recorded (D-03).

### Overviews
- **Partner:**
  - The setup checklist shows one line: "Setup · N of M done / Next: <task>", with a single action button and an
    expandable `<details>` list.
  - Steps separate **Account approved by HelloCircle** from **Listing submitted for review** and **Listing approved
    by HelloCircle** (server `/auth/setup-status`, with a test).
  - Tiles read "Approved centres/clubs" with "None approved yet" at zero (previously "0 · live"), "Listing views",
    and "Unread notifications".
  - The nav label is "Experiences".
- **Admin:** report-queue items open the report record. The listings and partners metrics link to their filtered
  lists.
- **Host:** the attention list and invitations show a failure alert with retry instead of an empty "all clear".

### Confirmations (`ConfirmDialog`, used everywhere above)
- The title names the action and the record.
- The body states real consequences, e.g. "No reason is recorded or sent to the partner". (The suspend dialog
  originally said listings "stay public and bookable", which was wrong; corrected 2026-10-14 to say new bookings are
  refused for that person's listings while they stay visible.)
- Destructive actions use the danger style.
- The confirm button shows "Working…" and is disabled while pending. Escape and the backdrop are disabled while
  working.
- On failure the dialog stays open with a `role=alert` message. On success the record reloads.
- Focus returns to the trigger.

## 4. Error states and reporting

**Silent catches.** Loads where an empty result would be read as "nothing there" or "all clear" now show a failure
with retry:
- AdminFinance (13 sections)
- AdminPolicy (complaints, traders, policies)
- AdminCommerce (orders, rule diff)
- the admin listings, vendors and report records
- partner listings/stats, bookings, registrations, experience departures and bookings, club sessions and waitlist,
  sent messages, Action needed, payout account, venue splits
- host activities, attention and invitations
- resident receipts, chats, complaints and policies

**72 catch sites remain, classified as intentional or optional.** Each is best-effort, and failing quietly is the
right outcome:

| Class | Examples (file) |
|---|---|
| Share / clipboard / native | `ShareSheet` (8), `native.ts` (3), `NativePushSync`, `api/sharing.ts` |
| Analytics / counters / badges (fall back to 0) | `header/useHeaderData`, `MyStuffContext`, `HostCalendarTab` counters |
| Optional enrichment on public pages (section hidden) | `CircleDetail` (5), `CentreDetail`, `ClubDetail`, `ProgramDetail`, `Game*Card`, `Circle*Card`, `GameParticipants`, `CircleMembersCard` |
| Fail-open on purpose | `PolicyAcceptanceGate`/`AccountSetupDialogs` (don't block the app if the check fails), `CookieNotice`, `chunkRecovery` |
| Draft / localStorage | `BookingFlow`, `RegistrationFlow`, `companyDetails` |

**Fixed in the second pass:**
- **Experience credit balance:** a failed check is now "We couldn't check your HelloCircle credit just now, so none
  is applied. You can still book and pay by card", with **Check again**. Credit is never pre-selected or assumed, and
  card checkout is unchanged.
- **Review eligibility:** a failed check is now "We couldn't check whether you can review this right now", with
  **Try again**. It's no longer shown as "only guests who booked can review". The server still enforces eligibility on
  post.
- **The reviews list itself:** it had no failure handling at all; it now shows "Couldn't load reviews" with retry.
- **Review form labels:** the inputs only had placeholders; they're now labelled.
- **Connect dashboard button:** the payout card showed *Open Stripe dashboard* for v2 accounts that hadn't finished
  onboarding, which the server always refuses with 409. The button now follows the server's rule.
- **Leaving Stripe onboarding early:** Stripe can't tell "not submitted" from "being reviewed" for a fresh v2 account
  (it lists requirements lazily), so a partner who left Stripe's pages early could be shown *Under review* with no way
  back. Until onboarding has completed, the card now also offers **Continue setup with Stripe** in that state, with a
  one-line explanation. Found by a Stripe test-mode run; see the validation doc §1c.

**Error reporting (provider-neutral):**
- **Client:** `client/src/errorReporting.ts` captures window errors, unhandled rejections and render crashes. It
  scrubs emails, tokens and IDs, deduplicates, caps reports at 10 per page, and sends them with `sendBeacon` to
  `POST /api/client-errors` (rate-limited to 30 per 15 minutes per IP).
- **Server:** `server/src/errorReporting.ts` writes one `[error-report]` JSON log line (route with IDs collapsed,
  scrubbed message, no bodies, headers or user data). It optionally POSTs to `ERROR_REPORT_WEBHOOK_URL`. No paid
  service, no SDK.
- Both sides have unit tests.

## 5. Technical gaps addressed

**Stripe Connect onboarding (test mode).** Reproduced with the guarded Stripe test configuration. Two app defects
were found and fixed in `server/src/payments/connect.ts`:
1. A brand-new Accounts v2 account was treated as "onboarding complete" because v2 computes requirements lazily (an
   empty list). The app then asked Stripe for an `account_update` link, which Stripe refuses before onboarding.
   Completion now needs evidence (v2: transfers capability active; v1: `details_submitted`). The state machine has an
   `onboarding_incomplete` rule, and a new `onboarding_returned_at` column distinguishes "submitted, under review"
   from "never submitted".
2. The Express dashboard link was requested for accounts that hadn't finished onboarding (500). It's now guarded, and
   provider errors surface as a sanitised 502.

`SANDBOX-CONNECT-A` passes against Stripe test mode. Completing hosted onboarding itself needs a person (hCaptcha);
see the completion-validation doc.

**Webhook reconciliation.** `checkout_agreements` (session ID → type, ref, amount, currency) is written when every
Checkout Session is created (`checkoutService.ts`). The webhook calls `verifyCheckoutAgreement` before confirming. It
checks:
- the session belongs to the same type/ref
- the session ID matches
- it's paid
- the `amount_total` and currency match

On a mismatch it throws `NeedsReviewError`, so the event is parked for review and never marked paid. Sessions created
before this change fall back to matching the row's stored `stripe_session_id`. Deposits and discounts are covered,
because the agreement is the server-computed line-item total. Pricing, VAT, fees, deposits and cancellation are
unchanged. Tests: `checkoutAgreement.test.ts` (6) plus the existing webhook tests.

## 6. Remaining gaps (not done — be explicit)

- **Record pages still missing:** partner debts, bank payouts, credits/Pro subscriptions, reward points and coupon
  usage (finance lists, no detail endpoint or no inspection need identified); programme enrolments and experience
  bookings (partner side) have no participant record page; there's no admin page for a resident account (host
  applications link to none).
- **Claims and host applications can't be reopened once decided.** Their endpoints only list pending items. The
  decision is in the audit log, and the record page says so.
- **Record history is "latest 200 audit entries" filtered client-side**, as before. Claim decisions are logged against
  the listing, so a claim's history includes the listing's other changes, and the page says so.
- **Forms:** the convention is applied to the four editors, the programme form and the finance reason fields. Other
  forms (club/centre creation wizards, signup, host game form, Circle settings, Profile) still use their older label
  styles; they weren't changed in this sprint.
- **Menus:** only the three row types above. Other rows with several buttons (admin listing table, coupons, partner
  experiences and programmes lists) weren't changed in this pass.
- **Payment review:** a parked paid order stops holding its place after 30 minutes (D-10), and there's no in-app way
  to close a parked event after a Dashboard refund (D-11). Both are proposed, not built.
- **Not built because they're policy decisions** (D-01 to D-11): hiding suspended partners' listings, admin sub-role
  moderation gates, rejection/suspension reasons, re-review of approved edits, staff claim permissions, resident
  suspension/deletion, staff removal, published pricing rules, Pro fee model, parked-payment hold and close-out.
- The `ManageShell` resident shell (Profile, Circle management) uses the shared full-screen menu but not
  `WorkspaceShell`. That's intentional: it isn't a business workspace.
- The **mapbox chunk is still 1.9 MB** (existing build warning; out of scope).
- There's a stray `undefined/` folder at the repo root with four screenshots dated 2026-10-12, from earlier work.
  It's untouched and untracked.

## 7. Screenshots

`docs/hellocircle-ui-completion/` (QA personas and synthetic data only):
- **First pass:** admin listing record, admin record missing, report case and confirm, vendor record, partner
  booking record, cancel confirm, centre editor in the shell, bookings load failure, empty filtered bookings, mobile
  sections menu, host activity record (desktop and mobile), resident receipt page, receipt failure, signed-out receipt.
- **Second pass:**
  - Queue records: claim record with the approve confirmation, host application record, place suggestion record.
  - Finance: payment event "needs review" with the investigation path, unpaid order record.
  - Customer: "Payment needs a quick check".
  - Forms: partner form error summary, failed-save summary.
  - Menus: host row action menu (desktop and mobile).
  - Failure states: credit check failed, review check failed.
