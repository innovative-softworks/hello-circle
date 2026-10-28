# 09 · Phase 1 implementation report: community events and registration options

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase1`, local only, in worktree `../hello-circle-participation-p1`.
**Base:** `f22294f` (`origin/feature/circles-and-experience-3`, the owner's push that contains streams A–G).

**Not committed, not pushed, not deployed.** Production payments and partial cancellation are not enabled.

## 1. What was built
| Area | Change |
|---|---|
| Event kind | `experiences.kind = 'event'`; partner create/edit allowed only while `participation.events` is on; adventure-only fields (difficulty, distance, elevation, terrain, fitness) cleared for events |
| Visibility | Events are hidden from every public discovery read while `participation.events` is off: lists, search, map, ranking, sitemap, provider profile, category counts. A direct link still opens an approved event |
| Routes | `/events` (list) and `/events/:id` (same detail page); OG/SEO metadata and sitemap know `/events`; links to events use `/events/…` (old `/experiences/:id` links still work) |
| Taxonomy | New category **Culture, faith & celebrations** (subs: cultural festivals, faith gatherings, community celebrations, fundraisers), for experiences and Circles. The existing "Culture & heritage" covers tours, museums and theatre, so it isn't an equivalent |
| Options | `offering_options` per listing: option / add-on / bundle, price, per person or per booking, people per unit, own limit per date, most per booking, sale window. Saved as a whole set under `options_version` (409 when stale). Never deleted, only switched off. The cheapest live option rolls up as the listing's "from" price |
| One VAT treatment per order | Every option is `tax_treatment = 'standard'`; anything else is refused ("a different VAT treatment per option isn't supported yet") |
| Server pricing | `participation/lines.ts` prices `[{optionId, quantity}]` from the database only. The sum goes into today's pricing (legacy `computePricing` or the commerce engine), so VAT, fee, coupons, credit and the checkout agreement are unchanged. Client totals, prices and party size are ignored |
| Capacity | Heads, not orders: `party_size` = Σ heads. Each option's own limit is checked under the session row lock (lock order: session, then options by id). The webhook/review re-check (`orderFits`) and the partner "move booking" also re-check option limits |
| Snapshots | `order_lines` freezes label, description, basis, age band, people per unit, unit price, VAT bps/mode, fee bps and pricing source (`legacy:pricing.ts` or `engine:<rule hash>`) at purchase. Terms acceptance stays in `order_acknowledgements`; engine orders keep `pricing_snapshots`, now with one `commerce_order_lines` row per option (reconciles exactly) |
| Quotes | Engine quotes store the requested lines (`commerce_quotes.lines_json`); a checkout with different lines gets 409 `quote_mismatch`. The generic `/api/commerce/quotes` refuses options listings |
| Partner UI | Wizard offers **Community event** (when on), hides difficulty and fitness for events; new **Registration** tab (`OptionsEditor`) with form conventions, error summary, stale-version reload, switch-off/on; bookings list shows what each booking bought; kind filter includes Community events |
| Resident UI | Booking popup: `OptionPicker` (stepper per option, accessible names, limits, sold out / not on sale), names for each person, server-quoted lines and totals, a "Registration paused" state; detail shows "from · several options"; Events browse page; Explore gets a **Community events** result filter only when events exist (Explore menu untouched) |
| My Life and receipts | `/bookings/mine` and the status route return `lines` + `linesSummary`; My Life card shows the summary; booking page shows **What you booked**; receipt shows the lines (resident receipts); pass label **Event** |
| Partial cancellation | `participation/partialCancel.ts` + `POST /api/experiences/bookings/:ref/remove`. The switch `participation.partial_cancel` is **locked**: admin Settings shows it as locked and the server refuses to switch it on (409). While off, the route answers 404 |
| Switches | `participation.events`, `participation.options`, `participation.partial_cancel`, all **off** by default (admin Settings → Community events and registration) |

## 2. Database migrations (additive, idempotent, no FKs)
- `CREATE TABLE IF NOT EXISTS offering_options` (participation/schema.ts).
- `CREATE TABLE IF NOT EXISTS order_lines` (UNIQUE source_type + source_ref + line_no).
- `experience_bookings.pricing_mode VARCHAR(10) NOT NULL DEFAULT 'single'` (all existing rows read as single).
- `experiences.options_version INT NOT NULL DEFAULT 0`.
- `commerce_quotes.lines_json TEXT NULL`.
- Taxonomy seed: one new category with 4 subcategories (inserted only if missing).

There's no backfill. No existing row changes meaning, and nothing is dropped. Rollback = switches off (see `06-plan.md` §5).

## 3. Files
- **New (10):**
  - server: `participation/{schema,options,lines,partialCancel,eventsVisibility}.ts`, `participation/participation.test.ts`;
  - client: `components/experience/{OptionPicker,OptionsEditor}.tsx`, `components/experience/optionPicker.test.ts`, `pages/Events.tsx`.
- **Changed (47, +756 / −171):**
  - server: `circleFeatures`, `circlePlanListings`, `commerce/engine`, `commerce/payments`, `db/index` (one call), `db/queries`, `myLifePlans`, `ogMeta`, `payments/orderState`, `receipts`, `taxonomy`, and routes `admin`, `categories`, `config`, `experienceHub`, `experiences`, `providers`, `search`, `vendorExperiences`;
  - tests: `taxonomy.test` (21 → 22 categories), `experience3.test` (flips only its own switch groups);
  - client: `App`, `api/{categories,circleExperience,public,vendor}`, `circleFeatures`, `paidCheckout`, `BrowseLayout`, `CheckoutBreakdown`, `ExperienceCreationWizard`, `ExperienceKindBrowse`, `ExperienceSearchCard`, `ReceiptDrawer`, `VendorExperiences`, `admin/AdminSettings`, `categories/CategoryChips`, `commerceDisplay`, `mylife/NextPlan`, `pass/Pass(.css)`, `BookingDetailPage`, `ExperienceDetail`, `Explore`, `MyBookings`, `VendorExperienceEditPage`;
  - shared: `packages/types`.
- **Stripe metadata and webhook contract:** unchanged (`type: "experience"`, `ref`). `stripeWebhook.ts`, `checkoutService.ts` and `pricing.ts` are untouched.

## 4. Test results by gate
| Gate | Result |
|---|---|
| G0 approval | Owner decisions 2026-10-29 (Option A, VAT, category, Explore menu, partial cancel off, KNOTS basis unconfirmed) |
| G1 isolation | Own worktree, own DB `hello_circle_participation_dev`, own ports (API :3021, client :5193). Main checkout, its dev servers, `hello_circle_dev` and `hello_circle` untouched. (Port 3011 was already used by a main-checkout server from another session; it was left alone and Phase 1 moved to 3021) |
| G2 unit + integration | Server suite (disposable MySQL): **136 files, 1,254 passed, 0 failed, 23 skipped** (the live R2/Cloudinary provider tests, off by design). New `participation.test.ts`: 20 tests: U3/U7 validation, S1/S2 compatibility, S3/S4 KNOTS pricing and tampering, S5 race for the last places, S6 webhook capacity re-check, S7 engine quote binding and line reconciliation, S8 snapshots, S9 switch off, S10 visibility, S11 permissions/versions/mixed VAT, receipt lines, G4. Client: **44 files, 343 passed**. Type checks and production build: pass |
| G3 Stripe TEST + browser | **Manual end to end in Stripe TEST mode** on the worktree: partner created an event in the wizard, added 3 options in the Registration tab; a guest chose Pooja × 1, Darshan × 2, extra × 1, paid on Stripe's TEST checkout with Stripe's published test card; webhook confirmed. Booking total = agreement = payment record = Stripe charge = **€125.44** (9,800 + 2,254 VAT + 490 fee); 3 snapshot lines. Phone (375px): options step works, no horizontal overflow. **The guarded `npm run qa:*` Playwright/Stripe suites were not run for Phase 1** (see §5) |
| G4 partial-cancel proof | Passed in `participation.test.ts`: (a) a removal sent twice at once gives one refund, the other 409; (b) provider refusal gives no refund row, seat kept, party unchanged; (c) the provider's own `charge.refunded` isn't counted twice; (d) Σ refunds ≤ paid; (e) ledger balanced; (f) line `refunded_minor` = refund records. Switch stays locked off |
| G5 | Waiting for your review. Nothing committed or pushed |

Screenshots: `docs/participation-expansion/phase1-screenshots/`:
- `01` partner create event;
- `02b`/`02c` Registration tab;
- `03` Events list;
- `04` event page;
- `05` booking options with totals;
- `06` Stripe TEST checkout;
- `07` payment success;
- `08` My Life;
- `09` booking page with "What you booked";
- `10` phone options step.

## 5. Known limitations and outstanding decisions
1. ~~Guarded QA harness not run on this branch.~~ **Done in report 10** (own isolated QA via `QA_PORT_OFFSET`). It pins the QA database to port 13306 and its run folder to the checkout it runs from; that run belongs to the main checkout. Options: run `qa:*` from this worktree after the main checkout's QA container is retired (your call), or after this branch is merged locally into the main checkout. The Stripe TEST path was proven manually instead.
2. **Two pre-existing booking UI spec failures** (`BK-UI-DESKTOP`, `HC-QA-043`, "View full activity" missing since `60929d2`) are still open and not touched here.
3. **KNOTS Pooja basis is unconfirmed.** No commercial configuration was created. The screenshots use an isolated dev database with both options **per person** for illustration; per-booking/family pricing is supported and tested, but not configured for KNOTS.
4. ~~Still labelled "Experience" in a few places~~ **Fixed in report 10.** Was: the payment success pass, the partner "New adventure/experience" title and the event page breadcrumb root. Event links in older components still use `/experiences/:id`, which works. These are small copy follow-ups.
5. **Single-price cash listings keep "cash = paid"** (PD-5 unchanged). Options also work with cash listings under that same rule.
6. **Partial cancellation:** the proof is done, and the switch is locked until you approve. When removing a person, named-seat records aren't edited (the line and head count are).
7. **Out of scope, as agreed:** donations, external payments and cash-due verification, special-category questions, multi-child checkout groups, volunteer operations.
