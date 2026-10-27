# 03 — Navigation Design Specification

Uses the existing tokens:
- Bricolage Grotesque display type;
- cream background;
- orange-red for Explore/Start labels and active underline;
- green primary buttons (owner decision);
- Lucide icons at 20–21px, stroke `ICON_STROKE` (1.9).

## Desktop (≥1200px)

- Header row: height 70px; content aligned to the page container (1,560px, 24px gutter).
- **Explore panel:**
  - full width under the header, content in the page container;
  - columns: Things to do (2 columns) · Learn & give back · Places · featured tile (260–280px);
  - height measured at 1440px: **353px** (was 422px).
- **Rows:** icon, title (15.5px, 700), one-line description (13px muted), divider between rows, 44px+ hit area.
- **Featured tile:** one orange-tint tile with a CTA ("TRY IT →").
- **Start panel:** 340px, three labelled groups (11.5px uppercase muted labels), rows as above.

## Tablet (861–1199px)

- The search field collapses to an icon.
- **Explore:**
  - "Things to do" keeps two columns, titles only;
  - Learn & give back and Places keep their descriptions;
  - the featured tile becomes a slim row across the panel;
  - height at 1024px: **354px** (was 464px, with words wrapping one per line).

## Phone (≤860px)

- Tab bar: 5 tabs, 62px + safe area; the sticky booking bar sits on top of it (unchanged).
- Explore and Start: full-height centred dialogs with groups as on desktop; rows 48px tall.
- No side drawers anywhere.

## States

- **Hover/focus:** row background tint; 2px green focus outline (existing `.hc-mega-row:focus-visible`).
- **Active section:** orange underline on Explore/Start/Circles (`isUnder` path rules).
- **Current page:** `aria-current="page"` on the matching row.
