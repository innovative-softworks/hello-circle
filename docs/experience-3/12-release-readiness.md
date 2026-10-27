# Experience 3.0 — 12 Release readiness

| Feature | Classification |
|---|---|
| Free Time Mode duration fix | Complete and verified (applies without a switch) |
| Find something for me (when / time / budget) | Complete and verified |
| Going solo | Complete and verified |
| Surprise me | Complete and verified |
| Collections and occasions | Complete and verified |
| Spot alerts (experience departures) | Complete and verified |
| Get ready (experiences, activities) | Complete and verified |
| Programme journey | Complete and verified |
| Activity Passport (incl. volunteering history) | Complete and verified |
| Plan My Day + saved plans | Complete and verified |
| Circle-to-Circle activities | Complete and verified |
| Admin switches card (grouped) | Implemented but not fully verified (browser only, no automated admin test) |
| Weather-aware alternatives | Blocked (no reliable data source) |
| Gift experiences | Blocked (commercial rules unapproved) |
| Venue availability requests | Blocked (venue pages gated) |
| New admin experience-analytics dashboards | Not implemented (existing funnels/events only) |
| Existing features in the brief (map, invitations, rehost, For You, host/vendor insights, My Life hub) | Already implemented before this work; reused, not changed |

Switch state: all `experience.*` and `circles.collaboration` default **off** in code. In local `hello_circle_dev`
they are **on**, with `ce3-` demo data, for review. Staging and production untouched. Nothing committed, pushed or
deployed.

Before any release: owner review of the screens (`screenshots/`); fix or update CAT-PUBLIC for the new Activities
filters; turn switches on in staging one at a time (order in `10-implementation-roadmap.md`); D-07 erasure rules to
cover the new tables.
