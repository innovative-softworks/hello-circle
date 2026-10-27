# HelloCircle — Batch 2: Design System Proposal

**Date:** 2026-10-22 · Proposal only. Builds on `client/src/index.css` (CSS variables), `client/src/theme.ts`, `packages/design-tokens` and `pages/homeEditorial.css`. Prototype implementation: `docs/hellocircle-batch2-visuals/prototype/proto.css`.

## 1. Principles
Clarity over decoration · discovery before promotion · one obvious primary action per view · hierarchy from type and rules, not boxes · shared parts, not identical pages.

## 2. Colour
| Role | Token (existing) | Value | Use |
|---|---|---|---|
| Page | `--color-bg` | `#F7F4EC` cream | All consumer pages |
| Ink / forest | `--color-text` | `#172019` | Text, dark chips (selected), dark secondary buttons |
| Surface | `--color-surface` | `#FFFFFF` | Panels, cards with borders, dialogs |
| Panel | `--color-panel` | `#EFEBE1` | Quiet backgrounds, skeletons |
| Border | `--color-border` / `-strong` | `#E4DFD3` / `#D3CDBF` | Rules, controls |
| **Primary action** | `--color-green` | `#1E7A4C` (white text 5.33:1) | Book / Join / Enrol / Search / Confirm — one per view (decision D-B2-1 offers forest instead) |
| Brand accent | `--color-brand` / `--hx-orange` | `#FF4B24` | Eyebrows, display highlights, Home hero search, host/partner promos. **Text on it is always forest** (5.0:1); white fails (3.34:1) — PUB-44 |
| Orange text | `--color-orange` | `#B8320F` | Eyebrow text on cream |
| Status | green `#EAF4EE/#175F3B`, amber `#FCF3D9/#7A5600`, red `#FBEAEA/#B00020`, blue `#E9F0FC/#2F4FA8`, grey `#EFEBE1/#3B433C` | Pills: confirmed/available · pending/attention · failed/danger · info/refund/Circle plan · neutral | Always text + colour, never colour alone |
| No-photo tones (new) | sport `#1F4D36`, social `#6B2A1A`, learn `#2B3A59`, outdoor `#3D4A22`, place `#4A3F33`, circle `#172019` | White 9.5–16.7:1; peach date `#FFB39F` 5.5–9.7:1 | `NoPhotoMedia` only |
Rule: Home's `--hx-*` variables map onto these tokens (same values today) so the two systems can't drift. Dark mode keeps the existing overrides.

## 3. Typography (existing fonts: Bricolage Grotesque display, Figtree body)
| Step | Size desktop → phone | Weight / line-height | Use |
|---|---|---|---|
| Display | clamp(40px, 6vw, 88px) | 800 / 0.9, uppercase optional | Home hero, closing bands |
| H1 | clamp(30px, 3.4vw, 46px) | 800 / 1.1 | One per page (titles of listings, pages) |
| H2 | clamp(22px, 2.2vw, 28px) | 800 / 1.15 | Section titles |
| H3 | 18px | 700 / 1.25 | Card titles (17px in grids), panel titles |
| H4 | 15px | 700 / 1.3 | Sub-groups, list items |
| Body | 16px | 400 / 1.5 | Descriptions, long text (max 64ch) |
| Support | 14px | 400–500 / 1.45 | Secondary lines, metadata |
| Label | 13px | 600–700 | Form labels, chips, tabs |
| Caption | 12px | 500 | Timestamps, fine print (never for actions) |
| Eyebrow | 12px | 700, uppercase, +0.06em | Kind/section markers ("/ MY LIFE", "ADVENTURE") |
| Button | 15px (14px small) | 700 | All buttons |
Today pages use 23 distinct inline sizes, mostly 12.5–14px for body; the scale lifts body copy to 16px and secondary to 14px. Migration is per template, not a global find-and-replace.

## 4. Spacing and layout
- 4px base: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Page gutter: `clamp(16px, 3vw, 40px)`; content max 1360px; reading width 64ch.
- Section rhythm: 32px between sections inside a page (24px on phones), separated by a 1px rule rather than a new card.
- Cards: 14–16px radius on media, no card box around listing text (text sits on cream); panels (rails, dialogs) use surface + border, 24px padding (16px on phones).
- Detail template: main + 380px rail (desktop ≥ 981px); rail stacks below 980px; booking record uses 70/30.
- Forms: label above field, 8px gap, 16px between fields, error under the field (existing `components/form.tsx`).
- Avoid: cards inside cards, shadows except dialogs and the mobile sticky bar, gradients except photo scrims.

## 5. Components
| Component | Status | Notes |
|---|---|---|
| `Button` | existing | Variants: primary (green), secondary (white + border), quiet (underlined text), brand (orange + forest text), danger (outline red; filled only inside confirm dialogs). Min height 44px (36px small) |
| `IconButton` | existing pattern | 40px circle, always `aria-label` |
| `Chip` | existing (`FilterDropdown`, quick chips) | 36px; selected = forest fill; toggle chips use `aria-pressed` |
| `Pill` | existing (`StatusBadge`) | 24px; status colours above |
| `DiscoveryHeader` | **new** | Title, pill search (what / where / when), optional subtitle |
| `FilterBar` | **new** | Type chips with counts · count · Filters (active count) · Sort · List/Map |
| `FilterDialog` | **new** on `Modal` | Centred / full-screen; only relevant groups; "Show N results" |
| `ListingCard` | existing, extended | Anatomy in proposal §B; row variant for phones |
| `NoPhotoMedia` | **new** | Card and hero sizes; tone by category family |
| `DetailActions` | **new** on `ActionMenu` | Save, Share; More → Report, Follow, Invite |
| `TrustRow` | **new** | 2–4 short facts with check icons; copy needs sign-off |
| `SessionList` | **new** | Done / next / upcoming sessions |
| `UpcomingItem` | from `ParticipationTimeline` | Date block, title, place, status pill, one action |
| `NextUpCard` | from `MyLifeNextUp` | Photo/no-photo, status, actions |
| `StatusCard` | **new** | Booking status + one primary action |
| `MembershipStrip` | **new** | Member pill, Chat (unread), notifications, More |
| `SectionTabs` | **new** on `useUrlParam` | Links with `aria-current`; sticky under header |
| `Modal`, `ConfirmDialog`, `ActionMenu`, `EmptyState`, `LoadErrorState`, `CardSkeleton`, `PhotoGallery` | existing | Reused unchanged |

## 6. States (every list and record)
Loading → skeleton at final size · Empty → explains why + one action · Filtered-empty → offer to widen/clear · Error → alert + Try again, never "0" · Not found → "no longer available" + similar (Batch 1) · Signed out → single card with Sign in (Batch 1) · Pending/review payment → amber, never "booked" · Success → green with next step.

## 7. Interaction rules
Full pages for complex tasks (booking, enrolment steps, records); centred dialogs for short decisions (filters, cancel, report); popovers for contextual options (More, sort). No side drawers. One primary action per view; secondary actions as secondary/quiet buttons; destructive actions only behind a confirm dialog that names the item.
