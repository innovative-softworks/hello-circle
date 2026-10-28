# 03 · Proposed architecture, data model and API contract

> PROPOSAL. Nothing here is built. Every table is additive, and every behaviour sits behind a switch that's off by
> default.

## 1. Principles

1. **Extend `(source_type, source_ref)`; don't merge the tables.** `attendance`, `order_acknowledgements`,
   `commerce_orders` and `experience_booking_participants` already hang extra detail off an order this way. The new
   layer does the same, so `bookings`, `registrations`, `program_enrollments`, `experience_bookings` and
   `game_participants` stay as they are.
2. **The order row stays authoritative for status, payment and capacity.** New tables describe what was bought and
   by whom. For capacity, the order row carries the total heads (`party_size` on experiences; a new `guests` count on
   games), so no existing capacity query changes meaning.
3. **One pricing path.** Lines are priced on the server, by the commerce engine where it's live (experiences) and by
   `computePricing(sum(lines))` elsewhere. The customer total still equals the checkout agreement.
4. **Each listing type opts into each part.** A casual game sees none of this unless the host turns on "+1s".
5. **Each feature has a switch.** These go in the existing `app_settings` catalogue (`circleFeatures.ts`,
   `/config/feature-switches`), under a new `participation.*` group.

## 2. Where a community event lives (PD-1)

**Recommended: a fourth experience kind, `kind = 'event'`.** It gets the following for free:
- departures (`experience_sessions`) and `party_size` capacity;
- seat names and acknowledgements;
- the engine pilot, D-01 sellability, moderation and publishing;
- Circle links, taxonomy, discovery, provider cancellation with refund, and move.

What it needs:
- the editor hides adventure-only fields (difficulty, terrain, elevation, fitness) when `kind = 'event'`;
- taxonomy gets an `event` family next to `volunteer` (`taxonomy.ts:38/698–702`; queries currently use
  `kind != 'volunteer'` to mean "adventures and experiences", so every such filter must be updated to exclude `event`
  too);
- the public route alias `/events` and `/events/:id` maps onto the same API.

*Rejected alternative:* a new `events` table plus `event_registrations`. That would be a sixth participation table
with its own checkout type, webhook branch, capacity, refunds and reports, which is exactly the duplication CLAUDE.md
warns about.

## 3. Data model

```
experiences / programs / clubs / centres(rooms) / games      (listing; unchanged)
   │ 1
   ├──< offering_options          (listing_type, listing_id[, scope_id]) — what can be bought
   └──< listing_questions         (listing_type, listing_id) — what is asked

<order row>  bookings | registrations | program_enrollments | experience_bookings | game_participants
   │ 1   (source_type = checkout type literal, source_ref = ref)
   ├──< order_lines               what was bought: option | addon | donation | guest
   ├──< order_attendees           who is coming (seat), optional household link
   │      └──< attendee_attendance  arrival per seat (order-level row stays in `attendance`)
   ├──< order_answers             per order or per seat; question version snapshot
   ├──< external_payments         claimed / due / verified / rejected / expired
   └── (existing) attendance, order_acknowledgements, commerce_orders, payment_reviews, refunds

occurrence_roles   (occurrence_type, occurrence_id) → user or resident, duty, permissions, expires_at
```

### 3.1 `offering_options`
| Column | Type | Notes |
|---|---|---|
| id | VARCHAR(191) PK | |
| listing_type | VARCHAR(20) | `experience | program | club | room | game` |
| listing_id | VARCHAR(191) | |
| scope_id | VARCHAR(191) NULL | An option for one session or departure only (for example a shift) |
| kind | VARCHAR(12) | `option | addon | bundle` |
| label, description | VARCHAR(255), TEXT | e.g. "Participate in Pooja", "Pooja kit and lunch included" |
| price_minor | INT NOT NULL | 0 allowed |
| price_basis | VARCHAR(12) | `per_person | per_booking` (bundles are per_booking) |
| heads_per_unit | INT NOT NULL DEFAULT 1 | Bundle 2+2 → 4; table of 4 → 4; add-on → 0 |
| bundle_slots | JSON NULL | `[{"band":"adult","n":2},{"band":"child","n":2}]` |
| age_band | VARCHAR(12) NULL | `adult | child | infant | senior | any`, with band edges set on the listing |
| capacity | INT NULL | Separate cap for this option (e.g. hall A/B); NULL = shares the listing cap |
| max_per_order | INT NULL | |
| sale_starts_at / sale_ends_at | DATETIME NULL | Early bird, pro-rata; checked on the server at checkout |
| eligibility | VARCHAR(20) DEFAULT 'all' | `all | circle_members` (E6, behind a switch) |
| requires_proof | TINYINT DEFAULT 0 | E5 |
| sort_order, active, row_version | | `row_version` for safe concurrent edits (409 when stale, as in D-08) |
| created_at, updated_at, created_by_user_id | | |

A listing with **no** options behaves exactly as today. Its price column is the single implicit option.

### 3.2 `order_lines`
| Column | Notes |
|---|---|
| id BIGINT PK; source_type VARCHAR(20); source_ref VARCHAR(191); line_no INT | UNIQUE (source_type, source_ref, line_no) |
| line_kind | `option | addon | donation | guest` |
| option_id NULL | NULL for donation and legacy |
| label_snapshot, price_basis_snapshot, age_band_snapshot | Frozen at purchase |
| unit_minor INT, quantity INT, heads INT | heads = quantity × heads_per_unit |
| tax_treatment_snapshot VARCHAR(20) | `standard | exempt | outside_scope`, copied from the approved rule (PD-3) |
| refunded_quantity INT DEFAULT 0, refunded_minor INT DEFAULT 0 | For partial refunds by line (X-01) |

Invariant: `SUM(unit_minor × quantity)` over goods lines = the order's pre-discount subtotal, and
`SUM(heads)` = the order row's `party_size` (or `1 + guests` for games). Both are checked in the same transaction.

### 3.3 `order_attendees` (generalises `experience_booking_participants`)
| Column | Notes |
|---|---|
| id BIGINT PK; source_type; source_ref; seat INT | UNIQUE (source_type, source_ref, seat) |
| line_no INT NULL | Which line the seat belongs to |
| display_name VARCHAR(120) NULL | Optional when the organiser doesn't require names |
| age_band VARCHAR(12) NULL; dob VARCHAR(20) NULL | DOB only when an option needs it (child classes) |
| role VARCHAR(20) DEFAULT 'participant' | `participant | accompanying_adult | carer | guest` |
| household_member_id INT NULL | Prefill from `household_members`; the name is copied, never joined live |
| self_complete_token VARCHAR(64) NULL | E7: the attendee completes their own answers |
| status VARCHAR(12) DEFAULT 'active' | `active | removed` (partial cancellation) |

*Migration:* `experience_booking_participants` stays. Reads use the new table, falling back to the old one, and new
writes go to both while switch `participation.attendees` is on. A backfill copying old rows (`seat`, `name`) is
optional and idempotent.

### 3.4 `listing_questions` / `order_answers`
`listing_questions`:
| Column | Notes |
|---|---|
| id; listing_type; listing_id; version INT | A new version on every edit; answers keep the version they were given under |
| scope | `order | attendee` |
| kind | `short_text | long_text | single_choice | multi_choice | yes_no | number | date | file | consent` |
| prompt, help, choices JSON, required TINYINT | |
| sensitivity | `normal | sensitive | special_category` (special category = religious or health data, PD-6) |
| blocks_when JSON NULL | Answers that refuse the booking (safety-critical) |
| visible_to JSON | Roles that may read the answers, e.g. `["owner","centre_manager","door"]`; default owner + listing managers |
| retention_days INT NULL | After the occurrence ends; NULL = the platform default (needs D-07/DEC-14) |
| active, sort_order | |

`order_answers`: id; source_type; source_ref; seat NULL; question_id; question_version; value TEXT; file_media_id
NULL; answered_by (`booker | attendee`); answered_at; erased_at NULL.

A small **standard set** (dietary needs, accessibility, emergency contact, photo consent) can be added in one tap.
Clubs keep their fixed medical and emergency columns (they're the legacy answers), and the editor shows those as
built-in questions.

### 3.5 `external_payments` (R5)
| Column | Notes |
|---|---|
| id BIGINT PK; source_type; source_ref | One active claim per order |
| method | `revolut | bank_transfer | cash_due | cheque | other` |
| amount_minor INT; currency | What the order expects (copied from the order total, never from the client) |
| payer_reference VARCHAR(80) | Shown to the payer: the booking ref, e.g. `HC-7Q2K` |
| claimed_reference VARCHAR(140) NULL; evidence_media_id NULL | What the payer says they sent |
| status | `due | claimed | verified | rejected | expired | withdrawn` |
| hold_until DATETIME | Place held until this deadline; set by rule (PD-4), only ever shortened |
| recorded_by_kind/id, verified_by_user_id, verified_at, rejection_reason | |
| row_version | Double-verify protection (409 when stale) |

Order rows **stay `payment_status = 'pending'`** while a claim is open. Two predicate changes make that hold a place:
- `occupiesCapacitySql()` gains `OR EXISTS (SELECT 1 FROM external_payments x WHERE x.source_ref = <alias>.ref AND
  x.status IN ('due','claimed') AND x.hold_until > NOW())`. The same goes for `gameSeatSql()`.
- Verification runs `settleExternal()`, which applies the same `orderState` re-checks as `settleOrder()`
  (organisation, cancellation, eligibility, capacity). Only then does the row flip to `paid`, and then the existing
  notifications, receipts and ledger fire, with `provider = 'external'`.

The existing "cash = paid" listings are **unchanged** (PD-5). `cash_due` is a new, opt-in method per listing.

### 3.6 `occurrence_roles` (R7)
id; occurrence_type (`experience_session | program_session | game | club_session | booking_day`); occurrence_id;
holder_kind (`user | resident`); holder_id; duty VARCHAR(40) (e.g. "Reception", "Food", "Co-host");
can_check_in TINYINT; can_view_answers JSON (question ids, default none); starts_at; expires_at (default: the end of
the occurrence day); invited_by; status (`invited | active | revoked`).

These roles are **not** partner staff. They never pass `requirePlatformRole()` and only unlock the door API
(§4.4).

### 3.7 `attendee_attendance`
id; source_type; source_ref; seat; status (`present | late | no_show`); checked_at; checked_by_kind/id; source
(`qr | manual | offline_sync`); client_seen_at (E4 conflict detection). The order-level `attendance` row is still
written when the first seat arrives, so reviews, reliability and My Life keep working.

### 3.8 Games (smallest change)
`game_participants.guests INT NOT NULL DEFAULT 0` and `games.allow_guests TINYINT DEFAULT 0`,
`games.max_guests_per_player INT DEFAULT 1`. `gameSeatSql()` callers that `COUNT(*)` move to
`SUM(1 + guests)`. Guests are names only, as `order_attendees` rows with role `guest`. Co-host is an
`occurrence_roles` row on the game.

### 3.9 Family orders on clubs and programmes (PD-8, later phase)
This needs **checkout groups**: `checkout_groups (group_ref, type, total_minor)` + `checkout_group_members
(group_ref, source_ref)`. It also needs a new metadata literal `type = "registration_group"` handled in
`stripeWebhook.ts` *in lockstep*, settling each member through `confirmRegistration()`. That touches the webhook
contract, the agreement amount, payment reviews and refunds, so it needs its own approval.

## 4. API contract proposal

All routes are new. Existing request bodies keep working, because the new fields are optional.

### 4.1 Partner editor (`/api/vendor`, role-gated like their listing type)
| Method | Path | Body / result | Gate |
|---|---|---|---|
| GET | `/listings/:type/:id/options` | `{ options: Option[] }` | listing managers |
| PUT | `/listings/:type/:id/options` | `{ options: Option[], rowVersion }` → replaces the set; options that have been sold are deactivated, not deleted | centre_manager / facility_manager by type |
| GET/PUT | `/listings/:type/:id/questions` | Versioned; editing creates a new version | same |
| GET | `/occurrences/:otype/:oid` | Record page payload: counts by option, heads, money summary (finance only), checks | ORDER_ROLES |
| GET | `/occurrences/:otype/:oid/attendees` | Paged; answers filtered by `visible_to` and role | CUSTOMER_ROLES |
| GET | `/occurrences/:otype/:oid/export.csv?set=attendees|lines|payments|answers` | Formula-safe CSV (same `cell()` as `bookings.csv`); `payments` = finance only; sensitive answers excluded unless `include=sensitive` and the role allows it, logged with `writeAudit()` | per set |
| GET | `/external-payments?status=claimed` | Queue | finance |
| POST | `/external-payments/:id/verify` | `{ rowVersion, note? }` → runs `settleExternal()` | finance (owners unrestricted) |
| POST | `/external-payments/:id/reject` | `{ rowVersion, reason }` | finance |
| POST | `/external-payments/:id/record-cash` | `{ amountMinor, rowVersion }` at the door | finance or an occurrence role with `can_take_cash` (PD-4) |
| PUT | `/occurrences/:otype/:oid/roles` | Invite or revoke door and volunteer roles | owner / listing managers |

### 4.2 Public / resident
| Method | Path | Change |
|---|---|---|
| GET | `/api/experiences/:id` (and other details) | + `options[]` (active, in window, eligible), + `questions[]` (prompts only) |
| POST | `/api/experiences/:id/sessions/:sid/quote` | Body accepts `lines: [{ optionId, quantity }]`, `donationMinor?`; the response gives priced lines. Without `lines`, behaves as today |
| POST | `…/checkout` | + `lines`, `attendees: [{ name?, ageBand?, role?, householdMemberId? }]`, `answers: [{ questionId, seat?, value }]`, `donationMinor?`, `paymentMethod: "card" | <allowed external method>` |
| POST | `/api/orders/:type/:ref/external-claim` | `{ claimedReference?, evidenceMediaId? }` by the booker (client id, or resident when signed in) |
| GET | `/api/orders/:type/:ref` | Adds lines, attendees, answers (own only) and `externalPayment: { status, holdUntil, payTo }` |
| POST | `/api/orders/:type/:ref/attendees/:seat/remove` | Partial cancellation by seat; refund from the line and its policy (`05-rules.md` §3) |

### 4.3 Host (resident) games
`PUT /api/games/:id` + `allowGuests`, `maxGuestsPerPlayer`; `POST /api/games/:id/join` + `guests: [{ name }]`;
`PUT /api/games/:id/co-hosts`.

### 4.4 Door API (occurrence roles and staff)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/door/:otype/:oid` | `{ title, startsAt, expected, arrived, rows: [{ ref, bookerFirstName, surnameInitial, expectedHeads, arrivedHeads, paymentState: "ok" | "pending" }] }`, **never amounts, contact details or answers** unless granted per question |
| GET | `/api/door/:otype/:oid/lookup?q=` | Search by surname or ref |
| POST | `/api/door/check-in` | `{ type, ref, seats?: number[] | "all", clientSeenAt? }` |
| GET | `/api/door/:otype/:oid/offline-pack` | Signed snapshot for E4 (later phase) |

Door access = a partner role on that listing **or** an active `occurrence_roles` row with `can_check_in`. Either way
it's checked on the server for every request.

## 5. Migration considerations
- **Every change is additive.** It goes through `initSchema()` with `CREATE TABLE IF NOT EXISTS`/`ensureColumn`. There
  are no FKs, consistent with the rest of the schema.
- **Watch for the MySQL TEXT + DEFAULT trap** (host trust tier memory): TEXT/JSON columns get no literal default.
- **Backfill:**
  - Old orders get no lines; the read path synthesises a single implicit line from the order row.
  - Seat names: dual-read.
  - `experiences.kind`: there's no backfill; `event` is new.
- **Capacity predicate changes** (`occupiesCapacitySql`, `gameSeatSql`) are the riskiest edits. Each one ships with
  QA tests showing the same result for every existing fixture while the switch is off.
- **Ledger:** add accounts `donations_payable` and `external_receipts`. Before any change, check that
  `ledgerIsBalanced()` still holds and that `recordPaymentConfirmed()` takes `provider: "external"`.
- **Commerce orders:** `syncOrderFromSource()` must copy lines into its snapshot. Old snapshots are never re-priced.
