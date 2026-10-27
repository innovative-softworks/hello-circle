# Experience 3.0 — 02 Product requirements (as built)

Scope is the gaps found in `01-current-state-audit.md`; everything already in the product was reused, not rebuilt.
Owner decisions (2026-10-23): **D1** Plan My Day uses a labelled rough travel estimate between confirmed places only;
**D2** Circle-to-Circle: the proposing Circle owns the activity, the partner is linked, both organisers must agree;
**D3** the Activity Passport is private only; **D4** spot alerts for experience/adventure departures only. Design
tokens: the Circle Experience 2.0 answer (keep current tokens) applies.

| Requirement | Rule that makes it honest |
|---|---|
| Find something for me (when, time of day, budget, going solo) | Each filter is a fact the listing states; reasons come from the server ("On Saturday morning", "Free", "Within your €20 budget", "Host says people often come on their own"). No scores shown. |
| Free Time Mode fits your time | Only listings with a **stated** length can "fit"; assumed lengths never count. |
| Surprise me | One real suggestion from the best-ranked eligible pool; never repeats one shown in the session; full listings never offered. |
| Going solo | Only `come_alone`, `first_timers_welcome` or `host_introduces` set by the host. Never inferred; no public solo label. |
| Collections / occasions | Free, Under €20, Beginner-friendly, Family day, Outdoors (adventures), Good on your own, This weekend — each from price, a host-set attribute, kind or date. Empty ones are hidden. No "date night" or "local favourites" (no data supports them). |
| Spot alerts | Opt-in on a full departure; never a hold; re-checked by checkout's own capacity rule before sending; once per person; expires at the start; respects the "Waitlist offers" preference. |
| Get ready | Booked customers see the organiser's own meeting, kit, fitness, safety and weather text, plus directions when the place is confirmed. Nothing generated. |
| Programme journey | Each session attended / missed / not recorded / upcoming — only from registers; a past date without a register is "not recorded", never "completed". |
| Activity Passport | Private timeline of organiser check-ins, registers, your own "I went" on activities, and Circles joined. First-time milestones from real dates. No streaks, rankings or sharing. |
| Plan My Day | Up to four stops on one day with stated lengths, inside your window and budget, chained only where travel can be estimated; never "bookable" as a whole; saved plans re-check every stop on each view. |
| Circle-to-Circle | Organiser proposes → partner organiser agrees or declines (optional reason) → proposer creates the activity in the normal form. Partner members can see and join it; nothing else is shared. |

Out of scope (blocked or not built): gift experiences (commercial rules unapproved), venue availability requests
(venue pages gated), weather-aware alternatives (no reliable data source), "opportunity radar" (covered by the
existing host/vendor opportunities), new admin analytics dashboards (events and existing funnels only).
