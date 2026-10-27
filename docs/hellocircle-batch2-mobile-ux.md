# HelloCircle — Batch 2: Mobile-First Layouts and Interactions

**Date:** 2026-10-22 · Proposal only. Existing breakpoints (`packages/design-tokens` `breakpoints`): narrowMobile 560, mobile 640, tablet 860, tabletWide 900, desktop 1024. The prototype used 560 / 760 / 980 for convenience; implementation should use the existing tokens (cards 1→2 columns at 560, header/tab-bar switch at the existing mobile breakpoint, detail rail at 900/1024). Prototype CSS: `docs/hellocircle-batch2-visuals/prototype/proto.css`.

## Global
| | 390 phone | 768 tablet | 1024 small desktop | 1440 desktop | 1920 large |
|---|---|---|---|---|---|
| Nav | Top bar (logo, search icon, menu) + 5-tab bottom bar | Same as phone | Full header | Full header | Full header, content capped at 1360px |
| Gutter | 16px | 24px | 32px | 40px | 40px (centred) |
| Body / H1 | 16 / 30px | 16 / 34px | 16 / 40px | 16 / 46px | same as 1440 |
| Sticky CTA | Detail `mobile-join-bar` fixed **above** the 66px tab bar; page bottom padding reserves both | Same | Rail card (sticky top 92px) | Rail card | Rail card |
| Dialogs | Full-screen, header with close, footer actions pinned | Centred, max 560px | Centred | Centred | Centred |
| Touch targets | Primary ≥ 44px; minimum 24px for inline links | same | – | – | – |

## Discovery (Explore and lists)
| | 390 | 768 | 1024 | 1440 | 1920 |
|---|---|---|---|---|---|
| Search | One pill: query + "where · when" subtitle; tap opens full-screen search with where/when pickers | Pill with where/when segments | Full pill | Full pill | Full pill |
| Chips | Single horizontal scroll row (no wrap) | Scroll row | Wrap | Wrap | Wrap |
| Count / Filters / Sort | One row above chips: count left, Filters right; Sort inside the Filters dialog | Count, Filters, Sort | + List/Map toggle | + List/Map | + List/Map |
| Cards | 1 column, **row card** (120px square image left) | 2 columns | 3 columns | 4 columns | 4 columns (wider) |
| Image ratio | 1:1 thumb | 4:3 | 4:3 | 4:3 | 4:3 |
| First result | ≈ 275px from top (prototype) — target < 600px | in first screen | in first screen | in first screen | in first screen |
| Map | Full-screen map with a bottom result carousel (existing `DiscoveryMap`) | Split 50/50 | Split 40/60 | Split 40/60 | Split 35/65 |

## Detail pages (Activity, Experience, Programme, Venue, Club)
| | 390 | 768 | ≥ 1024 |
|---|---|---|---|
| Media | Full-bleed 4:3 swipe gallery with dots + "Show all"; no-photo band 150px | 16:9 single image | Gallery grid (venue) or 21:9/21:7 band; no-photo band 220px |
| Actions | Icon row (Save, Share, More) above the title, right-aligned | Beside title | Beside title |
| Booking | Sticky bar: price + one CTA; rail content (trust, cancellation) appears inline after facts | Same as phone | Sticky rail 380px |
| Sections | Stacked, 24px rhythm, rules between | Same | 32px rhythm |
| Overflow | Long titles wrap (no truncation); tables become definition lists | | |

## My Life
| | 390 | 768 | ≥ 1024 |
|---|---|---|---|
| Order | Greeting + next line → Needs you → Next up (photo on top) → Coming up → My Circles → Saved → Hosting → This month | Same, Next up photo left | Main column + 340px rail (Saved, Hosting, This month) |
| Upcoming rows | Date block left; title, place, status; action button below | Action right | Action right |
| Empty | "Nothing booked yet" + one CTA — never an empty column | | |

## Booking record
| | 390 | 768 | ≥ 1024 |
|---|---|---|---|
| Order | Header (thumb, ref, title, facts) → **Status card with primary action** → Details → Payment → Cancellation → Timeline → Help | Same | 70/30: details left, status + actions right (sticky) |
| Cancel dialog | Full-screen with Keep / Cancel pinned at bottom | Centred | Centred |

## Circle
| | 390 | 768 | ≥ 1024 |
|---|---|---|---|
| Visitor | 220px hero (full-bleed) → tabs (scroll) → about + faces → plans → values → organiser; sticky "Sign in to join" bar | Same, hero 260px | Hero 300px; join rail |
| Member | Compact header (64px image) → membership strip (Chat, Notifications, More) → tabs → next plan with "I'm going" (screen 1) → planning → poll → announcement | Same | Main + rail (Members, About) |
| Tabs | Sticky under the top bar, horizontal scroll, `?section=` in URL | | |

## Home (Option A)
| | 390 | 768 | ≥ 1024 |
|---|---|---|---|
| Hero | Display 44–56px; one search field (what) + Search; chips scroll | Search with where | Full what/where/when search |
| This weekend | Horizontal card carousel (78% width cards) | 2 columns | 4 columns |
| Categories | Horizontal photo row | 3 columns | 6 columns |
| Bands | Stacked split tiles (240px) | Stacked | Side by side |
| Length | ≈ 3.4 screens (was 9.3) | | ≈ 3.0 screens (was 6.5) |

## Interaction notes for touch
- Swipe gallery uses native scroll snap (no library). Chips scroll with momentum; no hidden horizontal page scroll (sweep checks `scrollWidth`).
- Bottom sheets are not used for complex flows; full-screen dialogs instead (consistent with "no side drawers").
- The cookie banner already steps aside for dialogs and checkout (`CookieNotice.tsx` R3A).
- Keyboard: tabs and chips reachable in order; dialogs trap and restore focus (existing `Modal`).
