# HelloCircle — global workspace UX/UI summary

_2026-10-20, branch `feature/workspace-detail-pages`. Local only: not committed, pushed or deployed. The page-by-page status is in
`hellocircle-global-ux-ui-tracker.md`, and the evidence (tests, audits, screenshots) is in `hellocircle-global-ux-ui-qa.md`._

## What changed, in one paragraph

The Admin, Partner and Host workspaces now share one visual language:
- a light cream workspace background (#FBF9F4), near-black primary buttons, orange used only as an accent;
- sections separated by thin dividers instead of boxes;
- one key-numbers strip style;
- a tinted icon and colour per kind of fact;
- compact header actions with a ⋯ menu for rare and destructive actions;
- a ⋯ options menu on every list row.

Each page uses one of six templates matched to its job (below), not one layout for everything. Record pages use a 70/30 layout; the context column sits on the same background, separated by a thin vertical divider. Nothing here changes a business rule, permission, price or payment path.

## Templates and where they apply

| Template | Used for | What it looks like |
|---|---|---|
| **A, Dashboard** | Admin Overview, Finance overview, Insights; Partner Overview, Earnings, Demand; Host Overview, Insights, Earnings | Full width. Decisions and exceptions first (attention row, queue), then a key-numbers strip, then recent activity. No decorative charts were added. |
| **B, Directory** | People, Orders, Activities, Circles, Hosts, All listings, Vendors, Organisations, Coupons, Audit log; Partner Customers, Listings, Programmes, Experiences, Offers; Host Activities, Reservations, Circles, Offers | Page header with its main action, then the filter bar, then a full-width table or record collection. Every row has a quiet Open and a ⋯ menu. A section that would repeat the page title doesn't show it again. |
| **C, Record** | 29 record pages: listing, vendor, organisation, person, order, activity, claim, host application, place suggestion, report, privacy request, 7 finance records; partner booking, customer, staff; host activity, Circle | 70% main column (header, key numbers, optional tabs, sections with dividers) and 30% context column (same background, divider line on its left; stacks below 1,100px). |
| **D, Form** | Partner venue, club, experience and programme editors; new-venue wizard; host activity form | Dedicated pages. Editors are sections with an Edit popup each, plus a readiness rail. Wizards are kept where they guide a first listing. |
| **E, Operational** | Pending approvals, Exceptions, Finance (reviews, disputes, events, refunds, settlements, transfers, payouts, debts), Plans & credit, Reviews & reports, Privacy; Partner Bookings, Calendar, Messages, Reviews; Host Calendar, Reviews | Built around the task: queues, tables, calendars, bulk actions where a real action exists, confirmations that state the consequences. |
| **F, Settings** | Admin Settings, Commercial rules, Policies & trust, Notification templates, Media; Partner Organisation (settings, trader details), Pro; Host Pro | Grouped settings. On Partner Organisation and Trader details, each group's title is on the left and its fields in a readable column (about 680px) on the right; stacked below 1,000px. |

## Shared system (one design system, no second one)

Everything is built on the existing workspace system. The tokens and classes are in `client/src/components/admin/admin.css`:
- `--adm-*` colours;
- `--tone-*` colours by meaning;
- `--adm-aside` (now transparent);
- `--adm-primary`;
- `wd-*` for the detail template;
- `ws-*` for workspace parts.

| Area | Component |
|---|---|
| Shell, navigation, breadcrumbs, page header, tabs | `WorkspaceShell`, `PageHeader`, `IconTabs`/`ViewTabs` (unchanged structure; tabs tightened) |
| Record page | `RecordView` (`aside`, `stats`), `DetailParts` (`DetailSection`, `DetailFacts`, `DetailStats`, `DetailHero`, `DetailTabs`, `ContextSection`, `ContextActions`, `CopyValue`, `DetailIcon`) |
| Icons and colour | `workspace/detailIcons.ts`: one icon and tone per kind of fact, chosen from the heading's words |
| Sections | `Box` (adminUi): divider-separated; doesn't repeat its page's title or description |
| Tables | `useRowSelection`, `SelectAllHeader`, `SelectCell`, `BulkBar`, `RowMenu` (adminUi); `WsListTable`, `QueueTable`, `DirectoryTable` use them |
| Key numbers | `DetailStats`, `StatTile`/`KpiStrip`, admin overview cards: one strip style |
| Settings layout | `.ws-settings` |

## Interaction standards applied

- **Buttons:** one primary per page or workflow, near-black for contrast. Secondary actions are outlined; row actions are quiet text that shows an outline on hover. Destructive actions are in ⋯ menus and confirmed.
- **Header actions:** 32px buttons beside the ⋯ menu.
- **Tables:** denser rows (9px cell padding). Every list row has a ⋯ menu with its existing actions and a "Copy" option. Checkboxes and bulk bars appear only where a real action exists today: vendors (approve), claims, host applications and place suggestions (approve), reviews (hide/unhide), reports (dismiss), partner notifications (mark read), plus the existing pending listings and bookings.
- **Dialogs:** centred, unchanged (`ConfirmDialog`/`AdminModal`); no side drawers anywhere.
- **States:** loading, empty, error and permission states were already distinct (`LoadErrorState`, `RecordState`, `ErrorMessage`) and are kept.
- **Target size (WCAG 2.5.8):** breadcrumbs, record-title links in tables and the field-help "i" have at least a 24px hit area.

## Decisions for the owner

1. **Dashboard extras the brief mentions but the data doesn't support yet.** Partner "occupancy" has no stored figure. A partner or host earnings summary on the dashboard would repeat the Earnings balance, which only moves once the "Financial ledger" switch is on. Nothing was invented: say if you want the existing balance tiles on the dashboards.
2. **Missing record pages** (need backend reads): admin Circle details, host participant details, a separate host reservation page.
3. **Bulk actions beyond today's actions** (for example bulk suspend or bulk cancel) need new rules and endpoints, so they weren't built.
4. **Typography:** headings and key numbers use Bricolage Grotesque as the brief asks. Body text in all three workspaces is Inter, an earlier owner decision for the workspace shell; public pages keep Figtree. Say if you want Bricolage for body text too. It's a display face and reads less well at small sizes.

## UX polish (VectorLab audit, owner-approved 2026-10-20)

The owner's choices were "2: Option A · 3: Approve · 4: Approve · 5: Not now · 6: Approve · 7: Approve · 8: Approve". Item 1 (44px tap targets on every touch control) got no choice and wasn't built.

| # | Change | Where |
|---|---|---|
| 2A | A faint 1px frame on list tables (`--adm-frame`, drawn inside the table) on screens 901px and wider. Record-page tables keep their own frame; phones keep stacked cards. Dates and the Open / ⋯ columns stay on one line. | `admin.css` |
| 3 | Phone lists: one divider under the tab row instead of two; the select box sits in each card's top-right corner; tab rows fade on the side that has more tabs (`IconTabs` sets `data-more-start` / `data-more-end`). | `admin.css`, `adminUi.tsx` |
| 4 | A real tooltip (`data-tip`) on hover and keyboard focus replaces the browser's own tooltip on the ⋯ menu, photo arrows, copy buttons, the close-sections button and the collapsed sidebar. The ⋯ button is 36px square, 44px on touch screens. | `ActionMenu.tsx`, `DetailParts.tsx`, `WorkspaceShell.tsx`, `admin.css` |
| 6 | `useFormErrors().control()` checks a field when the person leaves it (required, email, web address, min/max), using the browser's own validity checks. These errors show under the field only, not in the summary, and clear on the first keystroke. | `form.tsx` |
| 7 | `useFormDraft` and `DraftBanner`: the venue, club and experience editor pop-ups and the new-programme form keep unsaved edits in this browser (14 days) and offer "Restore changes / Discard". Saving or cancelling removes the draft. | `form.tsx`, `SectionCard.tsx`, `sectionSave.ts`, editors |
| 8 | Confirm buttons name what they act on ("Delete listing", "Remove session", "Revoke invite", "Reset two-step sign-in"; 10 buttons). 179 padding, margin and gap values in `admin.css` moved onto the 4/8px grid. The sidebar no longer animates its width. `.ux-profile.md` records the owner's design rules. | various |

## Spacing rhythm and tabs (owner, 2026-10-20)

- **Tabs:** the first tab's label lines up with the page edge (section tabs, record tabs, editor tabs and filter views). There's no line under tab rows; only the selected tab keeps its underline.
- **One vertical rhythm on the 8px grid:**
  - page header to content: 24px;
  - tab row to content: 24px, even inside columns that add their own gap;
  - section heading to search or list: 16px;
  - search and filters to the list: 16px, with no line under the search bar because the table has its own frame;
  - list to pager: 16px.
- **Measured** on every tab row in the 120 page views: the first tab starts at 0px on all 47 rows, and 42 of the 47 rows have exactly 24px to the box below. The other five are content alignment, not spacing: a heading centred against its button (Coupons, Messages) and the centred empty-state message (Reviews).

### Breadcrumb and KPI cards (owner, 2026-10-20)

- Breadcrumb: links (24px tap target) and plain crumbs share one centre line; the trail stays on one line and the
  current page truncates with an ellipsis on narrow screens instead of wrapping onto a "/"-led second line. The title
  sits 32px below the breadcrumb on every page.
- KPI cards (record key numbers, overview cards, partner/host number strips, totals): white card (`--adm-panel`) with
  a hairline frame and 8px radius; dividers between numbers stay; 16px inner padding on every cell, phones included.
