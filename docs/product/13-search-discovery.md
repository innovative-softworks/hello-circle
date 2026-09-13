# Document 13 — Search & Discovery Model

A genuine weighted ranking function was found — not a naive `WHERE + ORDER BY` — confirmed by reading `server/src/routes/discover.ts` and `server/src/personalization.ts` directly.

## The ranking function

`rankScore()` combines multiple signals for every scheduled activity (games, program sessions, club sessions — unified by `listScheduledActivities()`):

| Signal | Weight |
|---|---|
| Currently live | +1000 |
| Recency (not yet started) | `300 − minutesUntilStart/10` decay |
| Fill ratio ≥ 0.5 | `+fillRatio × 100` (surfaces "needs people" activities) |
| Free (no cost) | +20 |
| Has a photo | +10 |
| Personalization bonus | see below |
| Follow-boost (blended pass) | +150 followed host / +100 followed vendor / +120 followed category |

## Personalization (rule-based, explicitly not ML)

`personalizeActivity()` in `personalization.ts` adds, only for a signed-in resident:

- **Interest keyword match** against the onboarding-captured, comma-joined `residents.interests` → +80, with an explainable reason string surfaced in the UI
- **Home county match** → +15
- **Familiarity signal** (games only) → `min(familiarCoParticipants, 3) × 40`, via `countFamiliarCoParticipants()`

## Where the scorer is used vs. not

| | |
|---|---|
| **Uses the ranked scorer** | Home feed, `/explore` Results Mode, `/search` (now a redirect into Explore) |
| **Deliberately does not** | `Browse.tsx`'s centre/club listing — plain explicit sort controls only (price/rating). Called out in-code as a deliberately separate, unbuilt piece of work, not an oversight. |

## Explore.tsx — two modes, one page

**Discovery Mode:** category tiles, "happening today," "this weekend." **Results Mode:** filter/sort toolbar — sort by recommended/soonest/needs-people/price-ascending; category chips (free/outdoors/social/sports); county filter; weekend-date filter. Both modes share one URL-shareable state.

## Reviews (cross-cutting, since eligibility gates discovery trust signals)

One `reviews` table spans centre/club/game/host/experience. Eligibility is enforced server-side, not just UI-gated: centre/club/experience need a matching paid transaction (no past-date requirement); game/host require a signed-in resident who actually joined a *past* game. Admin can soft-hide (never hard-delete).

---
[← Status & State Model](12-status-state-model.md) · [Next: Booking & Transaction Model →](14-booking-transaction-model.md)
