# Admin workspace — UX audit and redesign map (2026-10-14)

Scope: `/admin` (`client/src/pages/AdminDashboard.tsx` + `components/Admin{Commerce,Finance,Policy,Media}.tsx`,
`DemandSignals`, `MarketplaceHealth`, `MarketConfig`, `RecommendationWeightsCard`) and the API under
`/api/admin/*` (`server/src/routes/admin*.ts`). Branch `feature/commerce-engine`, database `hello_circle_dev`.

**Evidence key.** **[B]** = seen in a real browser (headless Chromium via Playwright, signed in as the seeded
dev admin, 1440×900 / 834×1112 / 390×844, every `?tab=`). **[C]** = from reading code or API responses only;
not exercised in a browser. The Claude-in-Chrome session was signed in as a pending vendor and swapping its
session cookie was (rightly) blocked, so all browser evidence comes from Playwright.

No visual reference images were attached to the request, so the design direction comes from the written brief
(cream `#F7F4EC`, forest `#172019`, orange-red `#FF4B24`, Bricolage Grotesque, square corners, thin borders).
These three colours and the font were already the app's tokens.

## 1. Inventory

One route, `/admin`, with `?tab=` deep links (plus `?section=` for Finance). Server guard: `requireAdmin`
for everything; `requireAdminRole(...)` narrows by admin sub-role (`super | finance | support | legal`).

| Tab (`?tab=`) | Purpose / actions | Data source | Server role |
|---|---|---|---|
| Overview (`overview`) | KPI strip, last 5 audit entries, "Review N pending" button | `GET /stats`, `GET /audit` | any admin |
| Pending approval (`pending`) | Approve/reject pending centres & clubs, star (feature), open detail | `GET /listings` (filtered client-side) | any |
| Vendors (`vendors`) | List; detail modal: approve/suspend/reinstate, platform role, provider tier, org, listings | `GET /vendors`, `/organisations`, `/listings` | any |
| All listings (`listings`) | All centres & clubs; approve/reject/delete, feature, assign org | `GET /listings` | any |
| Claims (`claims`) | Approve/reject listing-ownership claims | `GET /claims` | any |
| Host applications (`hostApplications`) | Approve/reject Verified Host badge | `GET /host-applications` | any |
| Place suggestions (`placeSuggestions`) | Approve & publish / reject | `GET /place-suggestions` | any |
| Reviews (`reviews`) | Hide/unhide reviews; moderation reports queue with case view, notes, statement of reasons | `GET /reviews`, `/reports`, `/reports/:id/case` | any |
| Coupons (`coupons`) | Create, pause/resume, archive (reason required) | `GET/POST /coupons` | finance |
| Commercial rules (`commerce`) | Versioned rules, feature switches, history | `/commerce/*` | finance |
| Finance (`finance`) | 15 sections: ledger, simulator, settlements, transfers, debts, credits, rewards, coupon usage, payouts, payment events, refunds, disputes, plans, **field help**, **admin roles** | `/finance/*`, `/help`, `/admins` | finance (help: legal; roles: super) |
| Policies & trust (`policies`) | Policy documents, company details, complaints, trader verification | `/policies/*`, `/complaints`, `/traders` | legal / support |
| Organisations (`organisations`) | Vendor orgs (read-only + per-org feature flags); create custom orgs | `/organisations` | any |
| Demand (`demand`) | Intent clusters (notify), unmet searches | `/demand`, `/demand/intents` | any |
| Marketplace health (`marketplaceHealth`) | Market categories per county, For You weights, liquidity/referrals/funnel | `/marketplace-health`, `/market-categories`, `/recommendation-weights`, … | any |
| Audit (`audit`) | System status + last 200 audit rows | `/status`, `/audit` | any |
| Support (`support`) | Search bookings/registrations/users/sessions/circles; recent Open Bookings & circles | `/support/search`, `/activity-overview` | any |
| Notification templates (`notificationTemplates`) | Override/reset 2 transactional templates | `/notification-templates` | any |
| Media (`media`) | Upload switches, editorial image library | `/admin/media/*` | any |
| **Settings** | **Does not exist.** `?tab=settings` silently renders Overview **[B]**. Settings-like tools are scattered: admin roles + field help inside Finance, market categories + For You weights inside Marketplace health, system status inside Audit. | — | — |

## 2. Prioritised findings

### P0 — broken or hidden work
1. **Experiences are invisible to admins.** `GET /listings` returns `experiences` (16 in dev) and `/stats` returns
   `experiencesPending`, and `PUT /experiences/:id/status` + `/experiences/:id/featured` exist, but the UI only
   renders centres and clubs. A pending experience can never be approved from the UI, and the "Review N pending"
   count leaves experiences out. **[C, API response verified]**
2. **No usable section navigation on tablet.** Between 861px and 1024px the rail is hidden and the dashboard
   burger is shown. At ≤860px (all phones, iPad portrait 834px) the only way to switch tabs is avatar menu →
   "Dashboard menu". The page itself has no visible control. **[B]**
3. **Failed loads look like real empty states.** Almost every tab does `fetchX().then(setX)` with no `catch` and
   starts from `[]`. A 403 (e.g. a `support` admin opening Coupons) or network failure shows "No coupons yet" /
   "No vendors yet", and the same empty state flashes during every load. **[C]**
4. **Role-blind navigation.** All 19 tabs show for every admin sub-role. Coupons and Commercial rules call
   finance-only endpoints, so a support/legal admin gets a misleading empty page (see 3). Finance and Policies
   handle this internally; the others don't. **[C]**

### P1 — workflow and safety
5. Approve buttons for listings, claims, host applications, place suggestions and vendor approve/reinstate have
   **no error handling or feedback**. A 409 ("Approve the vendor's account first") is swallowed and the row just
   stays put. Nothing confirms success either. **[C]**
6. **No search, filters, sorting or pagination anywhere** except Support's search box. All listings is one long
   list split into centres/clubs (37+ rows in dev); Audit renders up to 200 rows. **[B]**
7. Featuring a listing is a bare star icon button with only a `title`, no `aria-label` or `aria-pressed`, and no
   confirmation of the change. **[C]**
8. Listing "Assign organisation" is an uncontrolled `<select>` that fires on change with no current value, no
   confirmation and no feedback. **[C]**
9. **Activity is unreadable.** Overview/Audit show raw codes (`vendor.status_changed on user 48c3…`), JSON-ish
   values, and no reason, though `audit_log.reason` is stored. **[B/C]**
10. Several sensitive server actions are **not audit-logged** at all: listing approve/reject/delete, claim
    decisions, review hide/unhide, org assignment. *Backend gap, out of scope for a UI redesign; recorded for a
    follow-up.* **[C]**
11. Unknown `?tab=` silently shows Overview, and tab changes don't update the URL, so the Back button leaves the
    admin entirely and links can't be shared after the first click. **[B/C]**
12. Login redirect nests `returnTo` (`/login?returnTo=/login?returnTo=/admin`) when a non-admin session opens
    `/admin`. **[B]** (Not part of the admin UI; noted only.)

### P2 — layout, consistency, accessibility
13. Oversized personal greeting ("Hello Circle Admin" at ~48px, avatar, eyebrow) on Overview; consumer
    **marketing footer on every admin page**. **[B]**
14. The KPI strip clips horizontally on mobile: the third tile is cut off, with no affordance. **[B]**
15. Pill-shaped filters, green selected states, rounded 16px cards and the dashed empty states clash with the
    square editorial style already used by `ManageCard`. **[B]**
16. Two icons are reused for unrelated items (`TagIcon` for Coupons and Commercial rules, `ClipboardIcon` ×3,
    `TrendUpIcon` ×2), so the rail is harder to scan. **[B]**
17. Report rows put "Suspend" and "Action" side by side in the same red style, and the list shows raw
    `targetType · targetId`. **[B/C]**
18. Reviews show `listingType · listingId` (a UUID) instead of anything readable. **[C]**
19. React key warning in `MarketplaceHealthView` on every load. **[B]**
20. Cookie banner covers the lower third of every admin page until dismissed. Expected behaviour; noted for QA. **[B]**

What works today: route guard (non-admins are redirected) **[B]**, ConfirmDialogs on destructive rejects/deletes,
reason-required coupon/role changes, Finance/Policy sub-role filtering, focus-trapped modals, no horizontal page
overflow at any size tested **[B]**.

## 3. Route → redesign map (as implemented)

Every pre-existing `?tab=` key still works. `settings` is the only new key, and it gathers existing tools.
`?tab=finance&section=roles|help` now lands on Settings with a notice.

| Group | Item (`?tab=`) | What changed |
|---|---|---|
| **Admin** | Overview (`overview`) | Greeting removed. 7 live metrics, each with its window ("Right now", "Today (server date)", "All time · …"). Approval queue lists the actual items across listings (incl. experiences), claims, host applications, place suggestions and open reports, with "Review next". Quick links. Recent activity in plain language |
| | Pending approvals (`pending`) | Queue table + type/county filters, search, sort, paging. Inline Approve/Reject (reject confirms), plus a review panel showing submission + partner details. Approve stays disabled while the partner account isn't approved, and the panel links to that account. Experiences included |
| | Support (`support`) | Same endpoints. Labelled search form, "Show recent", tables with status badges |
| **Marketplace** | All listings (`listings`) | Status views with counts (All/Pending/Live/Rejected/Other), type/county filters, search, sort, 20/page. Panel keeps approve/reject/feature/delete/assign-organisation (org assignment now needs an explicit Save) |
| | Vendors (`vendors`) | Partner table (status views, type filter, search, paging). Panel: onboarding details, approve/suspend (confirm)/reinstate, platform role + tier, organisation, listings incl. experiences |
| | Claims · Host applications · Place suggestions | Shared review-queue table with search + paging; existing confirms; place suggestions gain a "decided" view (existing `?status=all`) |
| | Organisations · Demand · Marketplace health | Same tools on the shared shell. Market categories + For You weights moved to Settings |
| **Business** | Coupons · Commercial rules · Finance | Coupons rebuilt on shared components (reason still required, audited). Commercial rules/Finance unchanged inside, underline sub-nav. Locked with an explanation for admins without the finance role |
| **Trust & Platform** | Reviews & reports (`reviews`) | Reports table → case panel (notes, statement of reasons, dismiss / mark actioned / suspend with confirms). Reviews table with visibility views, rating filter, paging |
| | Policies & trust · Notification templates · Media | Same workflows, restyled |
| | Audit log (`audit`) | Plain-language entries + reason, with action code/IDs/values under "Technical details". Area/person filters, search, paging. System status moved to Settings |
| | Settings (`settings`) | System status, Admin roles (super only), Field help (super/legal), Market categories, For You weights |

### Found while building (fixed)
- `GET /admin/reviews` returns snake_case columns (`SELECT *`), so the old Reviews tab printed
  `undefined · undefined` for every review's listing. The client now reads both spellings; the API is unchanged. **[C]**
- Focus rings inside the portaled detail panel/sheet resolved to `outline: none` (scoped CSS variable).
  Caught by the keyboard check and fixed. **[B]**
- React key warning in `MarketplaceHealthView`. Fixed. **[B]**

## 4. Implementation notes
- New: `client/src/components/admin/` — `AdminShell` (workspace strip, grouped sidebar, Sections sheet,
  breadcrumbs/heading), `adminUi` (buttons, boxes, metrics, toolbar, view tabs, badges, pager, loading/empty/
  error states, data + action hooks with toast feedback, detail panel), `adminNav` (groups + role mirror),
  `auditFormat` (readable actions), one module per page, `admin.css` (scoped `.adm-*`, light + dark).
- `pages/AdminDashboard.tsx` is now routing only: URL-driven tab (Back/Forward work), role locks, nav counts.
- Data: real endpoints only. One additive read change: `GET /admin/audit` now also returns `audit_log.reason`.
  New client wrapper `setExperienceStatus()` for the existing `PUT /admin/experiences/:id/status`.
- Footer hidden on `/admin*`; consumer header kept.
- `tests/integration/specs/revenue-admin-b.spec.ts`: Field help / Admin roles steps now open `?tab=settings`.

## 5. Validation (2026-10-14)
- `client`: `tsc` clean, `vitest` 266/266 (8 new tests for nav/roles/audit wording), production build OK. `server`: `tsc` clean.
- **Not run:** server Vitest suite (needs Docker; the daemon wasn't running) and the guarded `npm run qa:*` integration harness.
- Browser **[B]**, headless Chromium, dev admin, `hello_circle_dev`:
  - All 20 tools × desktop/tablet/mobile: one H1 each, no console errors, no horizontal overflow, no footer.
  - 62/62 interaction checks: sidebar + Sections-sheet navigation, Back button, unknown-tab notice, moved-section
    redirect, `?section=` deep link, search/filters/status views/sort/pagination, approve (request shape + success
    toast), server 409 surfaced, reject confirm + cancel sends nothing, panel focus-in / Tab trap / Escape / focus
    return, confirm-over-panel Escape, feature toggle, vendor ↔ listing cross-links, overview queue → item,
    simulated error/empty/slow-loading states, coupon form validation, accessible names on every visible control
    across 7 pages, visible focus ring, support-role locks (UI simulated by overriding `/auth/me`; server
    enforcement unchanged and not re-tested).
  - **No writes reached the database.** Every write request was intercepted and answered in the browser. Approving
    the demo listing for real would have notified that partner's 1 follower, so the approval flow was verified
    against intercepted responses, not end to end.

## 6. Out of scope (left for the owner)
- Server-side audit logging for listing/claim/review decisions (finding 10).
- Server-side pagination: lists are fully loaded today, and the redesign paginates client-side.
- The nested `returnTo` login redirect (finding 12).

## 7. Visual spec pass (cream reference spec, later on 2026-10-14)

The reference image itself was again not attached; this pass follows the written spec.

| Spec item | Implementation |
|---|---|
| Palette (#F7F4EC / #FFFFFF / #172019 / #5B635C / #FF4B24 / #E5E1D8) | Exact values on `.adm` roots in light mode; dark mode keeps the app's theme variables |
| Light cream "Admin workspace" strip, account + View platform | Done (was dark) |
| ~220px grouped sidebar, orange rule + subtle bg + bold active | 220px; collapsible to a 64px icon rail |
| Compact footer | `© HelloCircle · Admin workspace` + View platform / Help & contact / Privacy / Cookies |
| Type & spacing (30px title, 18px panel headings, 14px body, 12–13px labels, 24/32 padding, 24 gaps, 40px controls) | Applied in `admin.css` |
| Primary orange-red with contrast-checked label | `#172019` on `#FF4B24` ≈ 5.3:1 (white would be ≈ 3.3:1, fails). Older embedded tools' green primary buttons now also render orange-red inside the workspace |
| Icons 18px, one library | Lucide outline at 18px |
| Tables: header tint, 56px rows, money right-aligned, overflow menu, bulk bar only after selection | Listings: Approve + Review visible, Reject / Feature / Delete in "More actions". Pending rows selectable → bulk Approve (skips partners not yet approved) / Reject, each confirmed, with one summary |
| Detail panels: information / documents / activity / decisions | Listing + vendor panels. "Documents" says plainly that these workflows don't collect documents (none invented). Activity = this record's entries from the latest 200 audit rows, with a note on what the server doesn't log |
| Labels above fields, required markers, errors beside fields | Coupons and custom-organisation forms validate on submit and show errors beside each field |
| Internal vs shared notes | Coupon reasons and report investigation notes: "Internal — visible to admins only". Report statement of reasons: "not currently shown to the reporter or the affected person" (verified: nothing outside admin reads it). Complaint decisions already say "the submitter sees this" |
| Tablet/mobile tables as readable rows | Redesigned tables stack into labelled rows up to 900px |

Body text stays **Inter** (owner's explicit request earlier the same day); headings are Bricolage Grotesque. The spec's "Typography: Bricolage Grotesque" would also replace the body font. That's a one-line change in `admin.css` (`--adm-body`) if wanted.

Known limitation: three older embedded tables (Commercial rules version history, Policies documents, Field help) still scroll sideways inside their own panel on phones; the page itself doesn't. They weren't converted to stacked rows because integration specs drive their table rows on phones.
