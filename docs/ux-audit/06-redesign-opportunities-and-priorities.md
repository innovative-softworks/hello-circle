# 06 — Redesign Opportunities and Priorities

## Count of findings

| Severity | Verified | Code-reviewed | Hypothesis | Total |
|---|---|---|---|---|
| P0 | 0 | 0 | 0 | **0** |
| P1 | 4 | 0 | 0 | **4** |
| P2 | 14 | 6 (DP-07, 15, 20, 32, 38, 41) | 0 | **20** |
| P3 | 11 | 0 | 1 (DP-40) | **12** |
| **All** | **29** | **6** | **1** | **36** |

Full list:
- **P1:** DP-01, 02, 03, 04.
- **P2:** DP-05, 06, 07, 11, 13, 14, 15, 18, 20, 21, 22, 23, 25, 27, 32, 34, 35, 37, 38, 41.
- **P3:** DP-12, 24, 26, 28, 29, 30, 31, 33, 36, 39, 40, 42.

**UI only:** DP-01, 02, 03, 04, 11, 12, 13 (link part), 14, 20, 24, 25, 26, 27, 28, 29, 30, 33, 34, 35, 37, 39, 41, 42.

**Needs API or data:**
- DP-06: favourites type for a whole programme.
- DP-07: cancellation hours on the centre detail response.
- DP-15: series siblings.
- DP-22: demo seed.
- DP-23: image sizes.
- DP-31: recommendation ranking.
- DP-32: save merge at sign-in.
- DP-36: request sharing.

**Needs a decision:** DP-05 (sign-in rule), DP-18 (map consent), DP-21 (terminology), DP-26 (Follow), DP-38 (headline price inc. or ex. VAT).

## Prioritised recommendations

| Rank | Recommendation | Findings | User impact | Complexity | Dependency |
|---|---|---|---|---|---|
| 1 | Ended state for past activities: no spots, no join; offer upcoming dates | DP-01 | Stops a misleading dead end after sign-in | Low | none |
| 2 | An action in every "No dates yet" panel and sticky bar ("Tell me when dates are added") | DP-02 | Captures demand that currently has nowhere to go | Low | none |
| 3 | One "Key facts" row; remove repeated facts and the second summary | DP-04 | Pages ~1.5 screens shorter on phones; the date, price and meeting point visible early | Medium | none |
| 4 | Phones: booking facts and cancellation before recommendations; no duplicated booking card | DP-03, DP-39 | Terms read before booking | Medium | none |
| 5 | One action row on every type: Share · Save · Report, 24px targets | DP-06, DP-11, DP-26 | Consistency, AA targets | Low | API for whole-programme saves |
| 6 | Experience booking as a full step page with a running total | DP-37, DP-41 | Fewer form errors on phones | Medium | none |
| 7 | Policy and price truth: cancellation hours from settings; all-in price wording | DP-07, DP-38 | Promises match what the system does | Low | API field; price decision |
| 8 | Trust: "Hosted by / Run by" block on every type with the host's review summary; provider link for venues and clubs | DP-13, DP-14, DP-28 | More confidence for first-timers | Low–Medium | data link org → provider |
| 9 | Alternatives where a listing can't be booked: cancelled, full, past, other dates in a series | DP-15, DP-34 | Recovers bookings | Medium | API (series) |
| 10 | Venue / club pages moved onto the shared detail layout | DP-12, DP-25, DP-13 | One system to maintain | Medium | owner decision (venue launch gate) |
| 11 | Media: correct demo photos; responsive image sizes | DP-22, DP-23, DP-24 | Better first impression | Low–Medium | media pipeline |
| 12 | Back that returns to where you came from | DP-20 | Less re-searching | Low | none |
| 13 | Map privacy: disable Mapbox telemetry or cover it in consent | DP-18 | Compliance | Low | legal |
| 14 | Visitor saves: explain, merge at sign-in | DP-32 | Keeps intent | Medium | API |
| 15 | Performance hygiene: one request per resource on activity pages | DP-36 | Faster on slow phones | Medium | none |

## Competitive benchmark (heuristic, no live research)

This comparison is a **heuristic assessment from general product knowledge**, not fresh research; no external sites were visited during this audit.

| Pattern | Seen in | HelloCircle today | Adopt / adapt / avoid |
|---|---|---|---|
| Key facts row under the title (duration, group size, language, cancellation) | Airbnb Experiences, GetYourGuide | Facts repeated in 3–4 places | **Adopt** (DP-04) |
| Date chooser inside the booking card with other dates listed | GetYourGuide, ClassPass, Eventbrite | Single date per activity page | **Adapt**: show other dates of a series (DP-15) |
| "Free cancellation until …" with an exact time, computed per booking | GetYourGuide, Airbnb | Hard-coded "48h" text on venues | **Adopt** with the real policy (DP-07) |
| All-in price shown up front | Airbnb (EU), Eventbrite fee disclosure | Ex-VAT/fee price on activities | **Adopt** after the price decision (DP-38) |
| Players / spots list with skill level and a clear join state | Playtomic, Meetup | "Who's going" + spots | **Keep**; add the ended state (DP-01) |
| Space listing with capacity, hourly rate and rules, request vs instant book | Peerspace | Rooms with rate and deposit | **Adapt**: say clearly whether hire is instant (DP-07) |
| Group page with upcoming events and members | Meetup | Circle page | **Keep** (owner: no Circle layout change) |
| Countdown and scarcity banners | Eventbrite, GetYourGuide | Spots-left badge only | **Avoid** urgency pressure; keep honest counts |
| Sticky phone bar with price + date + button | Airbnb, GetYourGuide | Price + spots + button | **Adopt** the date (DP-39) |
