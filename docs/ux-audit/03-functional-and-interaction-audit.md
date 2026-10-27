# 03 — Functional and Interaction Audit

**Method:** each control was clicked in a real browser at 390px and 1440px with all writes blocked. "Result" is what happened up to the point where a write was attempted. Raw results: `journeys.json`; screenshots `screenshots/J*.png`.

## Interaction inventory

| Control | Where | Trigger → what happens | Feedback | Escape / focus | Works? |
|---|---|---|---|---|---|
| Back link ("All sessions" …) | all dated types, venue, club | Goes to a fixed list (`navigate("/games")`) | — | — | Works, but not a true back (DP-20) |
| Share | all types | Phone: native share sheet when available. Otherwise a centred "Share" dialog with copy-link and a share event | Dialog titled with the listing name | Esc closes; focus moves into the dialog | Yes (J7) |
| Save | activity, experience, venue, club, Circle | Signed in: saved to the account. **Visitor: saved only in this browser** (`favorites.ts`); button changes to "Saved" | Button label changes; no explanation | — | Works; see DP-32 |
| Report | activity, experience, venue, club, Circle | Centred dialog with a reason field | Labelled dialog | Esc closes; focus on the first field | Yes (J8). Missing on programme, host and provider pages (DP-06) |
| Invite | programme, experience, Circle | Invite dialog / share | — | — | Seen, not exercised |
| Cover arrows / dots / swipe | multi-photo covers | Moves one photo; the counter "1 / 5" opens the full-screen viewer | Counter and dot state update | Viewer: Esc closes, focus returns to the counter | Yes (J9). Dots are under 24px (DP-11) |
| View map | activity, experience, programme, venue, club | Loads Mapbox in place with a pin and popup | Map appears | Focus goes to "Close popup" | Works; telemetry issue (DP-18) |
| Get directions | activity, venue | Opens Google Maps in a new tab | — | — | Seen, not exercised |
| Book this adventure / Register for this experience | experience | Centred dialog: name, party size (−/+), email, phone, coupon, names for extra people, min-age / safety / terms ticks, live quote ("Calculating total…"), "Continue to pay" → Stripe | Quote shown in the footer | Esc closes; on phones focus goes to the dialog (no keyboard pop-up) | Opens (J1); quote request blocked by the audit |
| Enroll | programme | Centred enrolment dialog | — | Esc closes | Opens (J2) |
| Sign in to join | activity, Circle | Goes to `/signin` with a "You're joining …" context card and return path | Context card shows date, place, spots | Focus on email | Yes (J3, J11). Also offered on past activities (DP-01) |
| Check availability | venue | `/book/:centreId`, step 1 of 4: room | Step header | Focus on body (not the step heading) | Yes (J4) |
| Register my child | club | `/register/:clubId`, step 1 of 3, quote request | Step header | Focus on body | Yes (J5) |
| I'm interested in … | no-date experience, programme, past/full activity | Sends an interest record (`POST /api/intents`) immediately, anonymous allowed | Not confirmed in the audit because the write was blocked | — | Request fires; the result screen wasn't checked |
| Add day, time or budget (optional) | interest form | Expands an input | — | — | Seen |
| Or start a plan yourself → | interest band | Link to plan creation | — | — | Seen |
| Follow | venue, club | Follows the listing for updates | — | — | Not exercised (write) |
| Cancel / leave | booking details page | Confirm dialog → in-place Cancelled state | Covered by the Batch 2 tests (B2-BOOKING) | — | Yes (QA suite) |
| Review form | past activity you attended; experience after a booking | Rating and text | — | — | Not exercised (needs an eligible booking) |

## Loading, error and empty states

| State | What shows | Assessment |
|---|---|---|
| Loading | Page spinner (delayed 0.25s) and cover skeleton; CLS 0.000 on all types | Good |
| Listing removed or not found (`/games/qa-removed-id`) | "This plan is no longer available." and a single link | Thin: no suggestions or search (DP-33) |
| Listing not approved (`/adventures/adm-demo-exp-1`) | "This adventure is no longer available." (API 404) | Acceptable for visitors; wording says "no longer" for something that never was public (DP-42) |
| Cancelled activity | Red banner "Plan cancelled", panel "Cancelled · This plan is no longer happening." | Clear. Alternatives only appear further down under "More like this" (DP-34) |
| Past activity | **Looks open**: "1 spot left", "Sign in to join" | Broken (DP-01) |
| Needs players (minimum not reached) | Panel headline "Needs players" | Shown even when the date has passed (DP-01) |
| No upcoming dates (programme / experience) | Panel "No dates yet" with no action | Dead end in the panel (DP-02) |
| Full | "Full" headline (code) | Not observed: no full listing in dev data |

## Findings

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-01 | `/games/demo-game-1` (11 Oct), `/games/adm-demo-game-1` (past, paid), `/games/demo-game-17` | activity | A past activity still shows "1 spot left" / "10 spots available" / "Needs players" and a "Sign in to join" button. The sign-in page then says "You're joining … 1 spot left". The server refuses the join (`getEffectiveGameLifecycle` → `completed`), so the user hits an error only after signing in | Misleading availability; dead end after a sign-in | Lost trust; wasted sign-ups from shared or old links | P1 | Show an "Ended" state on past dates (panel, badge and sticky bar) using the lifecycle the API already applies, with "See upcoming dates" / "More like this" as the action | `J13-past-activity.png`, `activity-past-390.png`; `server/src/gameVisibility.ts:20` | Verified | Low | none (lifecycle data exists) |
| DP-06 | `/programs/:id`, `/host/:id`, `/provider/:id` | programme, host, provider | No Save and no Report on programmes; no Report on host or provider profiles | Inconsistent actions; no way to flag a programme or a person | Safety gap for the profiles; lost saves | P2 | One shared action row (Share · Save · Report) on every detail type | `dpaudit.json` inventory 1440 | Verified | Low | API: favourites accept `program_session` but not a whole programme (`server/src/routes/favourites.ts:24`) |
| DP-32 | all saveable types | all | A visitor's Save is kept only in this browser; the "Saved" page needs an account; nothing says so | Saves vanish on another device, and visitors can't find them | Lost intent | P2 | On a visitor's first save, a small note: "Saved on this device — sign in to keep it". Merge local saves at sign-in | `SaveButton.tsx:32-37`, `favorites.ts` | Code-reviewed | Medium | API (merge on sign-in) |
| DP-33 | `/games/:id` not found | all | Not-found page has one link and nothing else | Dead end from old links | Drop-off | P3 | Same page shell with a search box and "Popular near you" | `activity-removed-390.png` | Verified | Low | none |
| DP-34 | cancelled activity | activity | Cancelled panel has no action; alternatives are far below | User must scroll to find a replacement | Drop-off | P2 | Put "Find another time" / "More like this" in the cancelled panel | `J15-cancelled-activity.png` | Verified | Low | none |
| DP-42 | `/adventures/adm-demo-exp-1` | experience | A pending (never published) listing says "This adventure is no longer available." | Wording implies it existed and was removed | Minor confusion from a shared draft link | P3 | "This page isn't available" with search and suggestions (shared with DP-33) | `experience-not-approved-390.png` | Verified | Low | none |
| DP-35 | `/book/:id`, `/register/:id` | venue, club | After the page change, focus stays on `body`; the step heading isn't focused or announced | Screen-reader users aren't told they are on step 1 of 4 | Accessibility | P2 | Focus the step heading on each step | `journeys.json` J4/J5 focus | Verified | Low | none |
| DP-36 | `/games/:id` | activity | 16 API calls on load; `/api/games` fetched 3 times, `/api/config` twice | Extra load on slow phones | Slower first paint | P3 | Share one request per resource | `dpperf` measurement | Verified | Medium | none |
| DP-37 | experience booking dialog | experience | A long form (name, party size, email, phone, coupon, more names, three ticks) in a dialog on a phone, with the total showing "Calculating total…" until the quote returns | A substantial workflow in a dialog, against the "full pages for substantial work" rule; the total is hidden while the form is filled | Errors and abandonment on phones | P2 | Move experience booking to a full page like venues and clubs (`/book/...` step pattern) | `J1-adventure-book.png` | Verified | Medium | none |

## UI vs backend

- **Backend correct, UI wrong:** DP-01 (past activities), DP-02 (the panel has no action, but the interest API exists).
- **Backend gap behind a UI gap:** DP-32 (no save merge at sign-in) and DP-06 (whether favourites support a whole programme). These need API work, not only UI.
