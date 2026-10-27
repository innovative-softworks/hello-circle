# HelloCircle — Batch 2: Implementation Roadmap

**Date:** 2026-10-22 · Proposal only. Sizes: S ≤ 1 day, M 2–5 days, L 1–2 weeks (one engineer familiar with the codebase). Each phase ends with client + server suites, `qa:product`, `qa:booking`, `qa:lifecycle`, a new screenshot spec, and stops for review. No phase changes pricing, Stripe, booking lifecycle, permissions, schema or launch gates.

## Dependency check (why the order differs slightly from the brief)
Inspected: `ListingCard` is used by Activities and Home; Explore uses `DiscoverCard`/`DiscoverRow`; Programmes/Experiences/Volunteer use `BrowseLayout`; detail pages each own their toolbar and join card; My Life links currently point at listing pages; Circle detail is self-contained.
- The **type/spacing tokens and `NoPhotoMedia`** are used by every later phase → a small foundation phase first (B2-0).
- **Booking record (B2-C) before My Life (B2-D):** My Life rows should open the record; building My Life first would mean relinking twice.
- **Circles (B2-E)** depends only on B2-0 and `DetailActions` → can run in parallel with B2-C/D.
- **Home (B2-F)** reuses cards and `TrustRow` → last.

## Phases
| Phase | Scope | Depends on | Effort | Risk | Exit check |
|---|---|---|---|---|---|
| **B2-0 Foundation** | Type + spacing tokens; `--hx-*` mapped to shared tokens; `NoPhotoMedia`; PUB-44 CTA contrast fix | – | S–M | Low | No visual change except PUB-44; contrast spec passes |
| **B2-A Shared discovery** | `ListingCard` anatomy + row variant; `DiscoveryHeader`, `FilterBar`, `FilterDialog`; Explore single grid + grouped programmes; then Activities; then Programmes/Experiences/Volunteer (BrowseLayout); Circles; Browse last (gated) | B2-0 | L | Medium (URL params, 8 card types) | First result < 600px at 390; URL params unchanged; no overflow at 5 widths |
| **B2-B Shared details** | `DetailActions`, no-photo hero, `TrustRow` (after D-B2-7), `SessionList`; apply to Activity, Experience, Programme, Club, Venue; profiles | B2-0 | M | Low | One Share per page; Report in More; title + CTA in first screen at 1440 |
| **B2-C Booking record** | Route `/bookings/:kind/:ref`; adapters per kind (scope per D-B2-4); `StatusCard`; cancel via `ConfirmDialog`; links from confirmation page and receipts | B2-0 | L | Medium | Each kind renders all its states from real data; not-yours = not found; cancel spec green |
| **B2-D My Life** | Header line; Next up; `UpcomingItem` across kinds incl. joined Circle plans; rail reorder; remove account buttons | B2-C | M | Low–Medium | Seeded resident with one item per kind sees all, each opens its record |
| **B2-E Circle member experience** | Visitor/member layouts; `MembershipStrip`; `SectionTabs` (`?section=`); planning/poll rows | B2-0, B2-B (`DetailActions`) | M | Medium | Member at 390 sees strip + next plan in screen 1; lifecycle-circle specs green |
| **B2-F Home + polish** | Option per D-B2-2; header search hidden on `/`; terminology sweep (D-B2-5); CTA colour rule (D-B2-1) | B2-A, B2-B, decisions | M (A) / L (B) | Medium | ≤ 3.5 screens at 390 (A); one search input visible |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Breaking bookmarked/shared discovery URLs | Keep every current query param; add a URL round-trip spec |
| Card migration regressions across 8 components | Adapters first; migrate one list per PR; screenshot spec per list |
| Booking record exposing another person's booking | Reuse existing ownership checks (resident_id / client id) only; authorization spec for cross-user access |
| Copy claims in trust rows | Ship only after D-B2-7 sign-off |
| No visual-diff tooling | Screenshot evidence via `shot()` in new specs, reviewed per phase |

## Not in Batch 2
Legal publication, venue/club activation, paid checkout, late-enrolment rule, terminology beyond the approved list, threaded Circle discussions, map on Explore/Activities/Circles (PUB-40).
