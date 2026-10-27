# HelloCircle — Public Site: Prepared (Not Activated) Changes

**Date:** 2026-10-21 · Companion to `hellocircle-public-gap-matrix.md`. Nothing in this document has been applied. Each item needs your approval (and, where marked, legal approval) before any code or content changes. No legal text, company address, registration number or policy promise has been written here.

## 1. Legal publication and consent links — PUB-01, 02, 03, 34, 36 (needs legal approval)

**What you need to supply/approve first**
- Approved text for: Privacy Policy, General Terms, Customer Booking Terms, Cancellation, Refund & No-show Policy, Community & Safety Standards, Cookie Policy, Accessibility Statement. The CMS already holds these 18 document keys (`/api/policies`); all are currently unpublished on the dev database. Production state not checked.
- Operator details for Innovative Softworks Technologies Limited (registered address, company number, privacy contact) — see `company-identity-and-email-readiness.md`.

**Publication path (no code):** Admin → Policies → each document → draft → review → publish (existing D-02 `policies.*` permission and audit trail).

**Code changes ready to make once published (each S):**
| Where | Change |
|---|---|
| `client/src/components/AuthForms.tsx:299-300` and `:475-476` | "and Terms" → link to `/policies/general-terms` (new tab, same style as the Privacy link) |
| `client/src/components/AccountSetupDialogs.tsx:135` | Same link in the one-time Terms confirmation |
| Booking kit summary + `PaymentSuccess` confirmation | "Cancellation & refund policy" link to `/policies/cancellation-refunds`, beside the existing server-derived cancellation facts (`components/booking/policy.ts`); no change to refund rules |
| `App.tsx:447` (`/privacy`) | Remove the `PrivacyPolicy.tsx` placeholder fallback once the CMS version exists (show "being prepared" like other policies instead of placeholders) |
| `pages/CookiePolicy.tsx` intro | Replace "The one exception is Google Analytics" with wording that covers analytics **and** advertising cookies (text for legal to approve) |
| `components/Footer.tsx` legal bar | Add "Accessibility" → `/policies/accessibility-statement` |

**Decision:** should paid checkout stay closed in production (`PAID_CHECKOUT`) until the Customer Booking Terms and refund policy are published? Recommended: yes.

## 2. Become-a-host paid-hosting wording — PUB-11 (needs a business decision)

Current FAQ (`pages/BecomeAHost.tsx:14-17`) says sessions are free to run and payments need a provider account. The product lets a Verified Host charge for a session (`server/src/routes/games.ts:118`).

| Option | FAQ answer for "Can I charge people?" | Product change |
|---|---|---|
| A — paid hosting is a launch feature | "Yes, once you're a Verified Host. Apply from your profile; after approval you can set a price on a session. HelloCircle takes payment at checkout." (fee wording only after the fee model is approved) | None |
| B — not at launch | Keep the current FAQ | Switch paid hosting off for launch (existing host-verification switch is on; a separate "paid hosting" switch would be needed — not built) |

Recommended: A, with no fee figures until the partner/host fee model (`/pricing`) is approved.

## 3. Venue and club activation — PUB-09 (needs a business decision)

Activation = set `VITE_VENUE_PAGES_PUBLIC=true` for the client build (and the matching server switch in `server/src/venueLaunch.ts`). Not changed.

Checklist before turning it on:
- Approved venue/club listings with real photos in production.
- Booking (`booking-centre.spec`) and registration (`booking-club.spec`) suites green on the release build.
- Gap PUB-15 Browse labels — done in batch 1.
- Batch 1 already makes Explore's "Compare places" and the local-landing fallback follow the switch automatically.

## 4. Late programme enrolment — PUB-17 (needs a business decision)

Today a programme whose first session has passed is still enrollable at the full price, with no notice. Options (no pricing change is proposed here):

| Option | Behaviour |
|---|---|
| A | Allow, and show "Already started — N of M sessions left" on the card, detail and enrol popup (copy only) |
| B | Close enrolment once the first session starts (server rule change in `programs.ts`) |
| C | Allow until a provider-set cut-off session (new field + rule) |

Recommended: A for launch (copy only); revisit B/C with providers.

## 5. Financial or booking-rule changes

None proposed in batch 1. The items above that would change a rule (2B, 4B, 4C, the `PAID_CHECKOUT` decision) are listed for decision only.
