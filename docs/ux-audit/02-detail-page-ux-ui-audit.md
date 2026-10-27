# 02 — Detail Page UX/UI Audit

Section-by-section review of the seven detail types. Finding IDs continue across reports 02–05 (`DP-xx`). Severity:
- **P0:** wrong money, data loss or a safety risk.
- **P1:** blocks or misleads a booking.
- **P2:** clear friction or a trust gap.
- **P3:** polish.

**There are no P0 findings.** Nothing found charges the wrong amount or loses data, and the server rejects every invalid action the page offers (see DP-01).

## Overall shape today

| Page | Phone length (390px, screens) | Desktop layout | Sections in order (desktop main column, then side panel) |
|---|---|---|---|
| Activity | 4.9 | 65 / 35 | back + Share/Save/Report · cover · type · title · price chip · summary · About · What to bring · Who's going · Hosted by · Location · Latest update · More like this ‖ booking card · Good to know · Cancellation & updates · "Can't make this one?" band |
| Adventure / Experience | 6.3 / 5.8 | 65 / 35 | cover · title + price · summary · meeting point chip · About · What to expect · Details · Hosted by · Meeting point + map · Reviews · More like this ‖ booking card · Good to know · Cancellation |
| Programme | 5.1 | 65 / 35 | cover · title + price · About · What to expect · Programme details · What to bring · Schedule · Hosted by · Where · Reviews · More like this ‖ booking card · "One sign-up, every session" |
| Venue | 5.1 | 60 / 40 | cover · rating · title + actions · Follow · description · Facilities · Location · Programmes & classes · Reviews · "Manage this centre?" ‖ hire card |
| Club | 4.4 | 60 / 40 | as venue, with "What's included" |
| Circle | 7.8 | own hero | hero · From this Circle · Upcoming plans · Recently together · About · You might also like · Moments |
| Provider profile | 8.9 | own | hero gallery · stats · Upcoming listings · Good to know |

The three dated types (activity, experience, programme) already share one layout: the 70/30-style main column with a booking card on the right. Venue and club use an older layout. The Circle is deliberately different and stays out of scope (owner, Batch 2).

## A. Header and navigation

- The global header is consistent and its edges now line up with the page (Batch 2 width change).
- The back link names the list ("All sessions", "All adventures", "All programs", "All community centres"). It is a fixed link, not a real "back": arriving from Explore or search and pressing it lands on a different list than you came from.
- No breadcrumb or category link. The type label above the title ("OPEN PLAN", "ADVENTURE", "PROGRAM") is not a link.

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-20 | all detail pages | all | Back link is a fixed link to one list ("All sessions") | Arriving from Explore, Home or search, Back goes somewhere else; filters are lost | Users re-search from scratch | P2 | Use history back when the previous page was in-app, with the list link as fallback; keep the list's URL filters | `GameDetail.tsx` back link; walk from `/explore` | Code-reviewed | Low | none |
| DP-21 | activity | activity | Type label "OPEN PLAN" is the internal name for an activity | Visitors don't know what an "open plan" is; the same thing is called session, activity and game elsewhere | Confusion about what they are joining | P2 | One public term (open decision D-B2-5 terminology) | `activity-free-upcoming-1440.png` | Verified | Low | product decision |

## B. Gallery and first impression

- **What works:** one 16:9 cover on every type (Batch 2); arrows, dots and a counter that opens the full-screen viewer; skeleton while loading; layout shift (CLS) 0.000 on all seven types.
- **Dev data problem:** the same yoga photo is the cover of "Five-a-side Football" and "Wicklow Way Guided Hike", and a swimming photo covers "Photography Walk". This comes from `server/src/scripts/seedAdminDemo.ts` (data, not page code), but it makes every demo and staging review look broken.

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-22 | `/games/adm-demo-game-*`, `/adventures/demo-experience-1` | activity, adventure | Covers unrelated to the activity (yoga for football and hiking, swimming for a photography walk) | Destroys first impression in demos and staging; looks untrustworthy | Reviewers and testers misjudge the page | P2 | Fix the admin demo seed's photo choice per activity label. Check production data separately (not checked) | `activity-free-upcoming-1440.png`, `J15-cancelled-activity.png`; DB query | Verified (dev data) | Low | data |
| DP-23 | `/clubs/s2`, all covers at 1920 | club, all | Club cover image is 800px wide but shown at 976–1512px; other covers are 900px shown at 1100px on 1920 screens | Soft, upscaled photos on desktop, the most visual moment of the page | Lower perceived quality | P2 | Ask the media pipeline for a width matched to the frame (srcset 800/1200/1600) | `dpaudit.json` "blurry" | Verified (measured) | Medium | media pipeline |
| DP-24 | programme, activity without photo | programme, activity | No-photo cover is a pale panel with a small icon at full 16:9 height (460px on desktop) | Large empty area above the title pushes content and price down | Weak first impression; slower scan | P3 | For no-photo listings use a shorter typographic cover (the Batch 2 no-photo card style) | `programme-no-upcoming-1440.png`, `programme-with-sessions` at 1920 | Verified | Low | none |

## C. Title and summary

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-04 | `/adventures/:id`, `/games/:id` | adventure, activity | The same facts repeat. Adventure shows difficulty 4 times (summary line, What to expect, Adventure details, Good to know) and duration 3 times. Activity shows capacity 5 ways ("4 spots left" badge, "4 spots available", "0/4 joined", "4 people" twice). The summary sentence repeats as the first line of "About" | Long pages (adventure 6.3 phone screens) with little new information per scroll | Key details (meeting point, cancellation) sink below repeats | P1 | One "Key facts" row under the title, one details section, no second summary. The booking card shows availability only | `adventure-with-departure-390-full.png`, `activity-free-upcoming-390-full.png` | Verified | Medium | none |
| DP-25 | venue, club | venue, club | Star rating sits above the title; price is only in the side card ("Hire from €18/hour"); on phones the first visible price is a programme's €8 at 1,410px | On phones the hire price is far below and the first price seen belongs to something else | Price confusion | P2 | Put "from €18/hour" in the title block on every width | `dpaudit.json` priceTop (venue 1,410px at 390) | Verified | Low | none |
| DP-26 | venue, club | venue, club | "+ Follow" floats alone to the right under the description | Unclear what following does or where updates go | Low use, visual noise | P3 | Fold Follow into the Save/Share/Report action row, or explain it | `venue-three-rooms-1440-full.png` | Verified | Low | product decision |

## D. Booking panel (see report 04 for flows)

- **Desktop:** the card is sticky and the main button sits at 311–335px on dated types, inside the first screen.
- **Venue and club:** 710–731px, still inside a 900px-tall window.
- **Phones:** the sticky bar shows the button on the first screen for every bookable type.

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-03 | dated types on phones | activity, adventure, programme | Below "More like this", the whole booking card is repeated in the page, followed by "Good to know" and "Cancellation". The sticky bar already carries the button | The duplicate card is redundant, and cancellation terms end up after the recommendations | Cancellation terms are read late or not at all | P1 | On phones show the booking facts and cancellation inside the page before recommendations; keep only the sticky bar | `adventure-with-departure-390-full.png` | Verified | Medium | none |

## E. Main content

- **Experiences** carry the richest content model (itinerary, equipment, transport, safety, weather, eligibility, accessibility).
- **Activities** have a thinner model: description, equipment, surface, setting, accessibility, meeting instructions, cancellation text.
- **Weakness:** sections are flat headings of equal weight; nothing is collapsible; safety and accessibility don't stand out for adventures.

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-27 | adventure | adventure | Safety, fitness and weather sit among equal-weight sections near the bottom of the page | Important "can I do this?" information is hard to find | Wrong-fit bookings; more cancellations | P2 | A "Is this right for you?" block near the top: difficulty, fitness, minimum age, accessibility. Long lists collapsible | `adventure-with-departure-390-full.png` | Verified | Medium | none |
| DP-12 | venue, club | venue, club | Headings jump from the H1 straight to H3 ("Facilities", "Location", "Programs & classes"), with H2 "Reviews" below them | Breaks the heading outline screen-reader users rely on | Harder navigation for screen-reader users | P3 | H2 for page sections | `dpaudit.json` outline | Verified | Low | none |

## F. Host and vendor information

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-13 | venue, club | venue, club | Owner shown as plain text ("Managed by Cork County Council"); no link to a provider profile, unlike experiences and programmes | Inconsistent trust signal; no way to see the operator's other listings | Lower trust | P2 | Same "Hosted by / Run by" block as other types, linking to `/provider/:id` when one exists | `venue-three-rooms-1440-full.png` | Verified | Low | data (provider profile link per org) |
| DP-28 | `/host/:id` | host | Host profile is 1.9 phone screens with no Report and no photo cover; "Reviews" heading appears twice (H4 tab and H2) | Thin trust page for the person you'll meet | Lower trust for peer-hosted activities | P3 | Add Report; one Reviews heading | `host-profile-390.png`, outline | Verified | Low | none |

Trust claims check: no verified badge, rating or review was shown that the data didn't support. The Verified Host badge is driven by `host_status`. Venue ratings come from real `reviews` rows (3 in dev).

## G. Location and meeting point

- **What works:** maps are click-to-load ("View map"), so no map script loads until asked. Venues say "Approximate area — not an exact address". Activities link "Get directions".
- **Duplication:** adventures show the meeting point twice (a chip near the title and a section further down).

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-18 | any page after "View map" | all | Opening the map loads Mapbox GL, which sends its own telemetry (`POST …/events/v2`) even when analytics cookies were declined | Third-party tracking outside the consent choice | Privacy/compliance risk | P2 | Turn off Mapbox telemetry, or cover the map in the cookie notice | `journeys.json` J10 aborted requests; `SinglePinMapImpl.tsx` | Verified | Low | legal decision |
| DP-29 | activity, programme | activity, programme | Map placeholder is a large grey box (≈230px) with "View map" | A lot of space for an empty box | Longer page | P3 | Show the address and directions link with a small "Show map" button | screenshots | Verified | Low | none |

## H. Reviews and recommendations

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-14 | `/games/:id` | activity | No public reviews or host rating on the activity page; a review form appears only for people who attended a past activity | The most-used type has the least social proof | Lower join rate for first-timers | P2 | Show the host's review summary in "Hosted by" (data exists on the host profile) | outline at 1440; `GameDetail.tsx` | Verified | Low | none |
| DP-30 | experience, programme | experience, programme | Empty review state "No reviews yet" with a full section and a note on who can review | Takes a section to say nothing | Longer page | P3 | When empty, one line in the key facts ("New — no reviews yet") | `adventure-with-departure-390-full.png` | Verified | Low | none |
| DP-31 | activity | activity | "More like this" on a football page includes "Book Club Discussion"; "Needs players" page's first CTA-like control is a recommendation | Weak relevance | Wasted space | P3 | Rank by the same activity label, then area | `activity-needs-players` inventory | Verified | Medium | API |

## I. Bottom of page

Every dated type ends with the dark "Can't make this one?" band (interest form plus "Or start a plan yourself"), then the footer.
- **Works well:** on full or past pages.
- **Problem:** on an open page with spots it competes with the main action.
- **Programmes and experiences with no dates:** the interest form is the only action, and it sits at the very bottom (see DP-02 in report 04).
