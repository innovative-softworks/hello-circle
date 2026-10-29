# 04 · Sitemap changes and UX flows

These follow the HelloCircle design system as it stands:
- Inter; green primary; deeper orange public primary button; 12px consumer and 4px workspace controls.
- No drawers (`Drawer` renders `Modal`). Records are pages (`?record=<type>:<id>`, `RecordView` 70/30 with a
  `ContextSection` aside). Forms follow `components/form.tsx`. Failed loads use `LoadErrorState`.
- No page animations; skeletons only. No MUI or Ant Design. Existing components first (`ui.tsx`, `ActionMenu`,
  `ConfirmDialog`, `DetailParts`, the booking box and `Pass`).

## 1. Three levels of participation (progressive disclosure)

| Level | What the organiser sets | What the participant sees | Default for |
|---|---|---|---|
| **Simple** | One price (or free), capacity | Choose a date, count, pay or join | Games, existing listings |
| **Structured** | Several options (age bands, bundles, add-ons) and attendee names | Choose options, then who's coming, then pay | Experiences, events, programmes |
| **Managed** | Plus questions, donation, external payment, volunteers and door team | Plus a questions step, donation and "how will you pay" | Community events, camps, clubs |

The editor opens on **Simple**. A single "Registration" section has a segmented control: *One price · Several
options · Full registration*. Choosing a level reveals its sections. Going back down is blocked once orders exist
that use the higher level ("3 orders use options; deactivate them first").

## 2. Resident (public) sitemap changes

| Route | Change |
|---|---|
| `/events`, `/events/:id` | **New.** Alias for experiences with `kind = event`, plus an Events family in Explore and category browsing. Same detail-page template and booking box |
| `/experiences/:id`, `/adventures/:id`, `/programs/:id`, `/clubs/:id` | The booking box gains an options step when the listing has options |
| `/bookings/:kind/:ref` (My Life booking page) | + lines, attendees (edit names until the cut-off), own answers, external payment state ("Awaiting confirmation · pay to … · reference HC-7Q2K"), a QR for the group, "Remove a person" |
| `/receipts/:ref` | Lines, donation shown on its own, payment method |
| `/a/:token` | **New.** Page where an attendee completes their own questions (E7, later phase); no account needed |
| `/profile` → Household | "Use for bookings" hint; members can be picked in attendee steps |

### 2.1 Booking box: structured flow (EV-01, EX-01)
```
┌ Booking box (right column, sticky) ───────────────┐
│ Sat 28 Nov · 9:00 · Newbridge Town FC             │
│ ── Choose how you'll take part ──                 │
│ ( ) Participate in Pooja        €71 per family    │
│     Pooja kit and lunch included                  │
│ ( ) Individual Darshan          €11 per person    │
│     Lunch included        [ – 2 + ]               │
│ ── Who's coming ── (only if names are required)   │
│  Adults [ – 5 + ]  Children 4–12 [ – 1 + ]        │
│  [ Pick from household ▾ ]                        │
│ ── Add a donation (optional) ──                   │
│  [ €10 ] [ €25 ] [ €50 ] [ Other ]                │
│ ─────────────────────────────────────────────     │
│ Pooja (family)                            €71.00  │
│ Darshan × 2                               €22.00  │
│ Donation                                  €25.00  │
│ Total                                    €118.00  │
│ [ Continue ]  (full width, 48px)                  │
└───────────────────────────────────────────────────┘
```
"Continue" goes to a **checkout page**, not a modal or drawer:
- **Step 1, Details:** booker contact.
- **Step 2, Questions:** booking-level questions first, then per-person questions grouped by person, using
  `FieldLabel`, `RequiredNote` and `FormErrorSummary`.
- **Step 3, Review and pay:** terms and safety acknowledgements, plus "How will you pay?" with card (Stripe) or
  Revolut/bank transfer when the organiser allows it.

**Bank and Revolut path:** the confirmation page uses the `Pass` component in the state "Awaiting confirmation, place
held until Fri 18:00". It shows the payee (as selectable text with a copy button), the amount and the reference, then
an "I've paid" button that records a claim. It never says "Booked" until the payment is verified.

### 2.2 Simple flow (games): unchanged
Join → (pay) → joined. If the host allowed +1s, a single "Bringing someone? [ +1 ]" row appears with an optional
name. Nothing else changes.

## 3. Host (resident, `/manage`) sitemap changes
| Route | Change |
|---|---|
| `/games/host`, `/games/host/:gameId` | Step 2 gains "Allow +1s" (off by default) and "Co-host" (pick a Circle member) |
| `/manage/activities` → game record | Attendees tab shows guests; co-host can check people in |
| `/manage/circles/:id` | "Linked events" list (read-only for Circle organisers unless they are also partner staff) |

Paid community events are sold by partner organisations only (PD-2). A Circle organiser who isn't a partner can host
**free** events through Games-style hosting later; that isn't in this plan.

## 4. Partner (`/vendor`) sitemap changes
| Where | Change |
|---|---|
| Listing editor (`/vendor/experiences/:id`, programmes, clubs, centres/rooms) | New sections, revealed by level: **Options**, **Questions**, **Donations**, **Payment methods** (card; and, when allowed, bank/Revolut with payee details and hold deadline), **Door team** |
| Create menu ("What would you like to organise?") | Activity or game (host), **Community event** (new), Programme, Circle; in the partner workspace these go to the existing editors with `kind` preset |
| **Occurrence record page** `?record=occurrence:<type>:<id>` | **New**, 70/30 `RecordView`. Main: `DetailTabs` *Overview · Attendees · Payments · Check-in · Volunteers · Messages · Export*. Aside: `ContextSection`s for capacity by option, money summary (finance only), checks (unverified payments, missing answers), and the door link |
| **Payments to verify** (Operations) | **New queue** (list → record page `?record=external-payment:<id>`), with a filter in the URL (`useUrlParam`): Claimed · Due · Expired. Verify and reject through `ConfirmDialog` with the reason required on reject |
| **Door mode** `/vendor/door/:otype/:oid` | **New full-screen page** (not a modal): search, QR scan, list of expected/arrived; big tap targets; works for occurrence-role holders too (they reach it from an emailed magic link) |

### 4.1 Door mode (X-03, EV-01 on the day)
```
┌ Satyanarayana Swamy Vratham · Door ───── 152 / 326 arrived ┐
│ [ Search surname or ref…            ]  [ Scan QR ]         │
│ ─────────────────────────────────────────────────────────  │
│ Reddy L.    HC-7Q2K   4 / 8  ● Paid       [ Check in… ]    │
│ Kumar S.    HC-9P1M   0 / 3  ◐ Payment pending — ask an    │
│                                organiser                   │
│ Rao V.      HC-2XQ4   2 / 2  ✓ All in                       │
└────────────────────────────────────────────────────────────┘
"Check in…" opens a ConfirmDialog with one checkbox per seat (or "All 4 remaining").
```

## 5. Admin (`/admin`) sitemap changes
| Where | Change | Permission |
|---|---|---|
| Listing moderation record | Shows options, questions (flags special-category ones), payment methods | `listings.view` / `listings.moderate` |
| Finance → **External payments** | Read-only oversight list across organisations; no verify button for admins by default | `finance.payment_state.view` (new permission `finance.external.verify` only if PD-4 says admins may verify) |
| Settings → Feature switches | `participation.*` group | `platform.settings` |
| Privacy requests | Answers included in access/export; erasure marks `order_answers.erased_at` once D-07 allows | `privacy.requests` |

## 6. Copy rules for these flows
- Say "Awaiting confirmation", never "Booked", until a payment is verified.
- Say "Voluntary donation" and never imply it's tax-deductible.
- Show how each price is charged: "per person" or "per family/booking".
- An error explains what went wrong and what to do next, e.g. "This option sold out while you were choosing.
  Darshan still has 12 places."
