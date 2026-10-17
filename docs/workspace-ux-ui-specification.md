# Workspace UX/UI specification: Admin, Partner, Host

_2026-10-16. This spec builds on what exists; it is not a new design system. Consumer pages are out of scope and stay
as they are (owner direction 2026-10-12: green primary, `ListingCard`, `CtaBand`)._

## 1. Foundations (existing, keep)

| Token | Value | Source |
|---|---|---|
| Page background | `--adm-bg` `#F7F4EC` | `components/admin/admin.css` |
| Panel / header row | `#FFFFFF` / `#FAF8F3` | same |
| Text / muted | `#172019` / `#5B635C` | same |
| Lines | `#E5E1D8` (strong `#CFCABD`) | same |
| Brand accent | `#FF4B24` fill with **ink label `#172019`**. Brand text uses `--adm-brand-ink` `#B02A0B`. | White on `#FF4B24` fails WCAG AA (booking audit 2026-10-11), so never put white text on brand. |
| Focus ring | `--adm-focus` `#FF4B24` | same |
| Display font | Bricolage Grotesque (headings) | `--adm-display` |
| Body font | Inter (workspaces only, bundled in the lazy workspace chunk) | `WorkspaceShell.tsx:7` |
| Radius | **8px for every `--radius-*` inside workspaces** (owner, 2026-10-16) | `body.in-workspace`, `.adm` |
| Dark mode | `prefers-color-scheme` + `data-theme` overrides | `admin.css:38` |

**DEC-01:** the brief asks for a 2px radius. The latest owner instruction (8px) applies until the owner changes it.
Switching is one token change (`--radius-*` under `.adm` and `body.in-workspace`), with no component edits.

## 2. One primitive set (fixes WA-17)

Use **`adminUi.tsx` as the workspace primitive set** for all three workspaces. It already has a pager, a toolbar,
loading rows, empty and error messages, the overflow menu and the modal. Steps:
1. Point `ui.tsx` primitives at the admin ones while `useInWorkspace()` is true: `EmptyState` → `EmptyMessage`,
   `LoadErrorState` → `ErrorMessage` + Retry, `ActionMenu` → `OverflowMenu`. Call sites stay unchanged.
2. Keep one menu implementation (keyboard: arrows, Home/End, Escape returns focus). Remove the other once all callers
   have moved.
3. New workspace code imports from `adminUi` / `workspace/*` only.

## 3. Interaction rules (existing, confirmed by code)
- **No side drawers.** `Drawer` renders the centred `Modal` (`ui.tsx`). The `.slide-in-*` CSS classes have no callers
  and can be deleted.
- **Full pages** for records and complex edits: `?record=<type>:<id>` via `RecordView` (the record is the H1;
  shareable; safe with Back). Listing, programme and experience editors are routes.
- **Centred dialogs** (`AdminModal` / `Modal`) for short forms, approve/reject with a reason, confirmations
  (`ConfirmDialog`: progress, no double submit, stays open on error), and discard checks.
- **Popovers** for row actions (`OverflowMenu`), quick filters and date pickers. The main row action stays visible.
- **Tabs:** horizontal icon tabs (`IconTabs`) for sections of one tool. This is the owner's preference over side lists
  and tile launchers. The tab, filter and record live in the URL (`useUrlTab`, `useUrlParam`, `useRecordParam`).
- **Depth limit:** sidebar → tab → record. No fourth level.
- **Mobile navigation:** full-screen "Sections" sheet (≤1024px); the sidebar collapses to a 64px rail at ≥1025px.

## 4. Page templates (map to existing components)

| Template | Built from | Must include |
|---|---|---|
| Overview | `PageHeader`, `AttentionBanner`, `AttentionQueue`, `MetricStrip` | Work first (queue sorted by urgency), totals second, recent activity last |
| Directory / list | `Toolbar` (`SearchField`, `SelectField`, `ViewTabs`), table, `Pager`, `LoadingRows` / `EmptyMessage` / `ErrorMessage` | Search, filters and sort in the URL; empty vs no-match vs error; a count; row → record page |
| Record | `RecordView`, `Facts`, `SectionLabel`, decision panel | Breadcrumb back to the filtered list, status tag, primary action, ⋯ secondary actions, history/audit |
| Create/edit form | `SectionCard` + `SettingsSection` + `form.tsx` | `FieldLabel` (required `*` / optional), `FormErrorSummary` (focused, linked), `FieldError`, snapshot cancel, unsaved-changes guard |
| Wizard | `GuidedFlow` (workspace step card + step rail) | Step count, Back keeps data, draft persistence where the flow already has it |
| Calendar | `MonthCalendar` (64px cells in workspaces) + list toggle | Today, legend, item → record |
| Booking management | Bookings tabs + booking record | Separate booking, payment, refund and check-in states |
| Finance | `IconTabs` + attention cards + ledger tables | Every write asks for a reason; amounts in €, entered in € (cents only internally) |
| Reports | Insights icon tabs, `DemandSignalsView` table | Period label on every number |
| Settings | `IconTabs` + `Box` sections | Who can change it (role) shown on locked sections |
| Approval queue | list (oldest first, "Waiting" column) + review page with Approve/Reject & next | Reason dialog (D-03), "All caught up" end state |
| Empty / error | `EmptyMessage` / `ErrorMessage` + Retry; role lock page | Never a silent empty list (WA-03) |

## 5. Loading, error and feedback (the WA-03 contract)
Every data load in a workspace has exactly three visible outcomes:
1. `LoadingRows` / skeleton while loading.
2. The data, or `EmptyMessage`.
3. `ErrorMessage` with **Retry**.

Implementation: one small hook, e.g. `useLoad(fn, deps) → { data, error, loading, reload }`, in `workspace/`. It
replaces the bare `.then(setX)` call sites in the audit's list.

Secondary loads (badges, counts) may fail quietly, but must not render as "0" or "none". Hide the badge instead.

Writes show a toast for success and failure. Destructive writes confirm first.

## 6. Forms
- Group fields by task, not by database column. Required fields are marked; helper text sits under the label.
- Money is entered in **euros** (`OfferParts` set the precedent: the fixed amount used to be typed in cents).
- Dates and times are Ireland wall-clock (`irelandTime.ts`), with the date shown in words.
- A long form (an editor) uses section-card popups that save the whole form. A short task uses a dialog.
- Unsaved changes: `dirty` → discard confirm (`AdminModal`), plus a route guard on editors (`PartnerWorkspace guard`).
- An editor whose record failed to load must not render a saveable blank form (existing rule).

## 7. Responsive
Required check widths: 320, 375, 390, 428, 768, 1024, 1280, 1440, 1920.
- **≤720px:**
  - Toolbars wrap.
  - Tables switch to a **stacked row card**: label/value pairs, with the main action kept. Use this for the tables
    a person works through: queues, bookings, orders, participants. Wide finance and ledger tables may keep
    horizontal scroll inside `.adm-table-wrap`, with the first column sticky.
- **721–1024px:** the sidebar becomes the Sections sheet, and record pages go to one column with the decision panel
  below the content.
- **≥1025px:** the collapsible sidebar; content is capped at 1920px with 24px padding.
- **Acceptance:** zero horizontal page overflow at every width (`document.documentElement.scrollWidth <=
  innerWidth`), and touch targets ≥ 24px.

## 8. Accessibility
- One H1 per page (the tool or record title).
- Tabs use `role="tablist"` with arrow keys. Menus use `role="menu"` with roving focus.
- Dialogs trap and restore focus.
- `aria-invalid` / `aria-describedby` on fields with errors.
- Visible focus on the cream background (orange ring).
- Never rely on colour alone for status: `StatusTag` carries text.
- `Button` forwards only whitelisted `aria-*` props; extend the whitelist rather than passing hyphenated props that get
  dropped.
- Reduced motion is respected (`admin.css:915`).
