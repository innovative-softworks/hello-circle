# 02 — Risk register (P0–P3)

- **P0:** blocks launch of paid Connect flows, or is a live legal or money exposure today.
- **P1:** must be fixed before the pilot.
- **P2:** before general release.
- **P3:** hygiene.

The "Status" column reflects this branch: earlier hardening fixed several items (prefixed R, see
`docs/commerce-risk-register.md`).

| ID | P | Area | Risk | Evidence | Recommended action | Status |
|---|---|---|---|---|---|---|
| P0-1 | P0 | Legal | **Signup records acceptance of "Terms" that don't exist.** The checkbox links only to `/privacy`; `terms_version` is an env string with no document behind it | `MagicLinkCompleteAccount.tsx:90-95`, `terms.ts` | Policy CMS (Stage 4) with General Terms and Customer Booking Terms; acceptance stores key, version and hash | open |
| P0-2 | P0 | Legal | **The live Privacy Policy shows placeholders:** `[Company Legal Name]`, `[Registered Address, Ireland]`, `[privacy@yourdomain.ie]`. There is no identified data controller | `PrivacyPolicy.tsx:40-41,104` | Fill the facts (blocking decision B1); the CMS refuses publication while `[[…]]` placeholders remain | open |
| P0-3 | P0 | Money | **No record of what HelloCircle owes partners.** All money sits on the platform balance and settlement is manual | `checkoutService.ts:32-40` | Ledger, settlements, Connect transfers (Stages 2 and 5) | open |
| P0-4 | P0 | Money | **Disputes and refunds made directly in Stripe are invisible.** There is no handler for `charge.dispute.*` or `charge.refunded` | `stripeWebhook.ts:450-476` | Webhook event store and handlers. With Connect these must reverse transfers (disputes are never auto-reversed) | open |
| P0-5 | P0 | Commercial | **The live price model contradicts the brief.** Customers pay +5% fee and +23% VAT on top; the brief says the displayed price is the price paid, with the fee deducted from the partner | `pricing.ts:5-8` | Blocking decision B3 (repricing). Ship behind a flag via the rules engine | open |
| P0-6 | P0 | Stripe | **The Stripe platform account country, legal entity and Connect eligibility are unknown** to the codebase | not in repo | Blocking decision B1/B2. Stop if not IE/EEA | open |
| P1-1 | P1 | Authz | **Admin has no sub-roles.** Every admin can change finance, policy and moderation; there is no finance, support or legal separation | `routes/admin.ts:18` | `admin_role` (super/finance/support/legal) with per-route gates | open |
| P1-2 | P1 | Money | **Refunds are full-only.** The €100 deposit can't be returned on its own, and a manual partial refund blocks in-app refunds | `checkoutService.ts:200-238` | Partial refunds with explicit allocation reversal | open (R7) |
| P1-3 | P1 | Money | **No webhook event persistence.** Idempotency comes from row state only; there's no replay, dead-letter queue or out-of-order handling | `stripeWebhook.ts` | `webhook_events` table: unique event id, safe replay, manual-review queue | open |
| P1-4 | P1 | Money | **Financial status fields are updated in place,** with no append-only history | participation tables | Ledger entries plus status history; corrections by reversal | open |
| P1-5 | P1 | Commercial | **Cash bookings include a 5% fee that is never collected** | `bookings.ts` cash branch | Under the new model, cash orders accrue a receivable from the partner, or are disallowed for paid plans (decision B9) | open (R15) |
| P1-6 | P1 | Legal | **No DSA trader identification.** Customers aren't shown the actual supplier (business or private individual) at checkout | checkout pages | Trader verification, plus supplier identity on listing, checkout and receipt | open |
| P1-7 | P1 | Legal | **No complaint/appeal workflow** for moderation decisions. Reports exist; appeals don't | `routes/reports.ts`, `admin.ts` | Complaints and appeals module (Stage 4) | open |
| P1-8 | P1 | Data | **Money in mixed units:** whole euros in `rooms.rate`, `clubs.price` and `centres.from_price` | `db/index.ts:142,166,179` | Normalise at the engine boundary. Never mix in calculations | open (R11) |
| P1-9 | P1 | Ops | **Rate limiter is in memory.** It resets on restart and isn't shared across instances | `rateLimit.ts` | Acceptable for one instance. Revisit before scaling | open |
| P2-1 | P2 | Security | **CORS reflects any origin unless `PUBLIC_ORIGINS` is set.** The prod value isn't verifiable from the repo | `index.ts:116-125` | Confirm `PUBLIC_ORIGINS` on prod/staging (ops check) | verify |
| P2-2 | P2 | Data | **No foreign keys or row versions** (optimistic locking) | schema | New finance tables get FKs between themselves; legacy tables stay app-enforced (decision B10) | open |
| P2-3 | P2 | Privacy | **No data-retention implementation** (no purge or anonymise jobs) | grep: none | Retention rules per data class; financial records retained by law | open |
| P2-4 | P2 | Legal | **Accessibility statement absent;** WCAG target undeclared | — | CMS document plus an audit pass | open |
| P2-5 | P2 | Money | **The Open Booking split charges joiners on top of the booker's full payment** | `pricing.ts:29-41` | Decide under the new model (B11) | open (R26) |
| P2-6 | P2 | Money | **Passes recognise GMV at purchase, with no refund or expiry handling** | `routes/passes.ts` | Model passes as prepaid credit (§14) or a per-session settlement | open |
| P3-1 | P3 | UX | **Client duplicates server pricing constants** for bookings, registrations and passes | `api/public.ts:291` | Server quotes everywhere | open (R18) |
| P3-2 | P3 | Data | **`subtotal_cents` stores the post-discount amount** on legacy rows | `registrations.ts:112` | Snapshots are authoritative for new orders | open (R12) |

Previously fixed on this branch: unscoped vendor coupons and negative amounts (R4); the coupon-validation oracle
(R5); the boot backfill marking unpaid rows paid (R8); suspended vendors still taking orders (R14); unverified
paid hosts (R3); pass bounds (R10); unaudited admin coupon changes (R6); the session-cancel coupon leak (R28).
