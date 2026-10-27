# 03 — Page layout and components

## Visitor page — the same frame as the joined page (owner, 2026-10-24)
Left 70%: the Circle banner (photo, avatar, name, facts; a non-open cover stays members-only) and the tab bar (Overview · Activities · About, plus the "…" menu). Right 30%, sticky: the join card on top (Join this Circle / Join Circle / Request to join / Request sent + Withdraw / invite-only / closed), then Members (open Circles, as before) and Circle details.

1–2. Banner and tabs as above.
3. **Overview** (`VisitorOverview`), in the left column:
   - *Life inside this Circle* — mosaic, one large + two small, captions with dates. Only public images: past/upcoming Circle activity photos, the open cover, the venue's photos. Never memories.
   - *What happens in this Circle?* — the organiser's "what we do", plus real facts: usual day/time (≥3 activities, ≥50% share), typical duration, price, activities together in six months.
   - *Come along to something* — next three public activities (date, title, place, duration, price/free, places left, solo/experience badges, "See activity"). States that joining the Circle doesn't book a place.
   - *The people behind this Circle* — organiser (host profile link if verified), member count, who can join, values; *Coming on your own?* only when confirmed.
   - *Your first time with us?* — four steps.
   - *Members plan things together* — open Circles only, counts only ("4 plans being discussed · 3 polls open").
   - *Ready to join …?* closing band, then *More happening near you* (existing).
4. **New Circle** (no activities, no past, no venue photos): *A new Circle is taking shape* replaces highlights; empty sections don't render as empty cards.
5. **Activities tab**: every upcoming activity a visitor may see. **About tab**: the organiser's text, membership type, approval questions.

## Member and organiser
Unchanged member Home, plus for organisers of an unfinished Circle a *Get your Circle ready for visitors* checklist (cover, introduction, first activity).

## Redesign (owner, 2026-10-24, after "I didn't like the design")

Agreed on the design canvas "Circle visitor page redesign", then built:

- **Main column (Overview):** "Come along to something" in the members' Next-up card style (featured activity with
  date tile, "Also coming up" rows); "What it's like" (organiser's words, fact chips incl. community plan/poll counts,
  up to three public photos with captions underneath); the green "Ready to join …?" band; "More happening near you".
- **Rail:** `VisitorJoinPanel` (green header with join mode, member faces for open Circles, counts; next activity;
  the existing `CircleJoinCard` in `bare` mode, so join rules are unchanged; what joining gets you; Share), then
  `VisitorPeopleCard` ("Who you'll meet": organiser, values, who can join, coming on your own), then Circle details.
- **Removed:** "Life inside" mosaic with captions on the photos, "The people behind", "Your first time with us?",
  the "Members plan things together" box, and the members card in the rail.
- **Phone:** the join panel sits straight under the banner (`.ch-body--visitor`, CSS order), the rest of the rail
  after the page; loading uses skeletons, not a spinner.
