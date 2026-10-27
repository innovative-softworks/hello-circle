# HelloCircle Navigation — Audit and Implementation (2026-10-22)

Uncommitted. Routes, APIs, permissions and data are unchanged. The detail-page redesign and the venue/club gate were not touched.

## Summary

- **Header structure kept:** Logo · Explore · Circles · Start · Search · Notifications · Account. It already had real unread counts, role-based account items, disclosure semantics and Escape handling.
- **Explore regrouped:**
  - Things to do: Explore everything, Activities, Adventures, Experiences, Events this weekend.
  - Learn & give back: Programmes, Volunteer.
  - Places: only when venues are public.
  - One featured tile: Free Time Mode.
- **Duplicates removed from Explore:** Circles (top-level), a second weekend link that gave different results, Become a host (under Start), and a photo tile linking to the same page a third time.
- **Start:** grouped by intent (Organise something · Build a community · Host or list with us).
- **Tablets:** the Explore panel no longer wraps words one per line at 1024px.

## Before → after

| | Before | After |
|---|---|---|
| Explore entries | 14 links (4 to `/explore`, 2 "weekend") | 10 links, one per destination |
| Explore height at 1440px | 422px (47% of a 900px screen) | 353px |
| Explore height at 1024px | 464px, cramped | 354px |
| "All activities" vs "Activities" | Ambiguous | "Explore everything" vs "Activities" |
| Start | Flat list of 5 | 3 labelled groups |

Screenshots: `screenshots/before-*.png`, `screenshots/after-*.png`.

## Findings by severity

- **P1:** NAV-01 (ambiguous "All activities") and NAV-03 (two different weekend links). Both fixed.
- **P2:**
  - NAV-02, 04, 05, 06: fixed.
  - NAV-09 (programmes and Circles not in search): needs backend approval.
  - NAV-10 (no category level): needs category approval.
- **P3:** NAV-07, 08: fixed.

## Outstanding decisions

1. Add programmes and Circles to `/api/search` (backend change).
2. The category system (21 categories, 3 tables, migration plan): see `docs/hellocircle-category-*.md`.
3. Rename the "My Life" tab to "You": recommended **no**.
4. Show a "Venues — launching soon" entry while venues are gated, or keep it hidden as now.
5. An optional "Popular categories" row in Explore, once categories exist.

## Documents

- `01-current-navigation-audit.md`
- `02-navigation-information-architecture.md`
- `03-navigation-design-specification.md`
- `04-navigation-interaction-specification.md`
- `05-navigation-implementation-report.md`
- `06-navigation-qa-report.md`
