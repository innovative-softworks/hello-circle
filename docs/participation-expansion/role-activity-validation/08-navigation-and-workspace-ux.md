# 08 · Navigation and workspace UX

The discussions propose four workspaces. **All four already exist**, and they share one shell (`WorkspaceShell.tsx`, cream system, 70/30 `RecordView` record pages, no side drawers). No new shell or page is needed.

| Discussion workspace | Built as | Route | Guard |
|---|---|---|---|
| Discover & My Life | consumer site + bottom tab bar (`MobileTabBar.tsx`) | `/`, `/explore`, `/my-life`, `/circles`, `/profile` | public / resident |
| Host | `HostWorkspace.tsx` | `/manage*` | resident session (`PersonalAccountGate` when a partner session tries it) |
| Partner Workspace | `PartnerWorkspace.tsx` | `/vendor*` | partner session; tabs by role + capability |
| Platform Admin | `AdminShell` + `adminNav.ts` | `/admin*` | admin; items by permission (`useAdminCan`) |

**Switching:** the account menu's "Personal ⇄ {business}" switcher (`Header.tsx`, `/api/manage/workspaces`, `/switch`). It shows only the sides this person actually has.

## 1. Proposed destinations vs. built
**Resident:**

| Destination | Built |
|---|---|
| Explore | ✓ |
| My Life | ✓ |
| Circles | ✓ |
| Saved | ✓ |
| Notifications | ✓ |
| Profile | ✓ |

**Host:**

| Proposed | Built as |
|---|---|
| Overview | Overview |
| My Activities | Activities |
| Participants and attendance | inside each activity record: participants, waitlist, check-in, no-show, answers |
| Circles | Circles |
| My Life | consumer side |

The host workspace also has Reservations, Calendar, Insights, Earnings, Reviews and Offers.

**Vendor:**

| Proposed | Built as |
|---|---|
| Overview | Overview |
| Listings | Listings, Programmes, Experiences |
| Calendar | Calendar |
| Bookings, Participants | Bookings, Customers |
| Forms | inside each listing's record (Questions tab) |
| Messages | Messages |
| Reports | Reports |
| Staff, Organisation, Settings | Organisation |
| Finance | Earnings, Offers |

The vendor workspace also has Check-in, Reviews and Demand.

**Admin:**

| Proposed | Built as |
|---|---|
| Overview | Overview |
| Organisations | Organisations |
| Verification | Verification checks |
| Users | People, Vendors, Hosts |
| Capabilities | inside the Organisation record |
| Categories | Categories |
| Field Policies | Settings → Registration fields |
| Governance | Governance |
| Audit Logs | Audit log |
| Support | Support |
| Finance Rules | Commercial rules, Finance |
| Settings | Settings |

**Assessment:** every conceptual destination is reachable.
- The ones that aren't top-level are nested where the record lives: forms on the listing, capabilities on the organisation.
- That follows the 70/30 record-page rule and avoids duplicate pages.
- **No top-level items were added**, and none are recommended.

## 2. Permission-driven hiding (verified)
| Rule | Where | Evidence |
|---|---|---|
| Partner tabs by staff role | `VENDOR_TAB_ROLES` | `vendorTabAccess.test.ts`; check-in-only staff see only Check-in |
| Partner tabs by capability | `VENDOR_TAB_CAPABILITIES` (listings, programs, experiences, checkin) | config-capabilities (re-run: passed) |
| Admin items by permission | `adminNav.ts` `permissions` | D02-MATRIX |
| Host questions UI | hidden while `participation.host_questions` is off | `gameQuestions.test.ts`, host record |
| Host "Didn't come" | **now hidden before the activity day** (`HostActivitiesTab.tsx`, this audit) | RAV-DEF-01 |

**Client and server agree:** the claims gap (RAV-SEC-01) was the one place where the API allowed what the UI hid.

## 3. Responsive and accessibility check
**Batch `booking-final-a11y`** (`tests/integration/specs/final-a11y.spec.ts`), **re-run today on a fresh isolated QA DB: PASSED, 0 failures.**
- **Pages:** 13 participation pages across all four workspaces:
  - partner: reports, messages, form builder, registration record, door;
  - resident: registration form, registration detail, My Life;
  - host: activity record;
  - admin: governance, categories, organisations, settings.
- **Widths:** 320, 375, 768, 1024 and 1440 px (65 page views).
- **Enforced:** no horizontal scroll, one visible H1, a `<main>` landmark, named controls, keyboard focus visible (375 and 1440).
- **Measured, not enforced:** small targets (mostly inline text links, e.g. 85×16), contrast.
- **Results:** `.qa-data/final-a11y.json`.

**Not covered this pass:**
- a manual screen-reader pass;
- the Circle organiser pages at all widths (covered earlier by the Circle suites);
- new screenshots: this audit relied on the automated checks plus the existing screenshots in `../final-validation/screenshots/` and `../phase2-screenshots/`.

## 4. UX gaps (no change made; for review)
| ID | Gap | Suggestion |
|---|---|---|
| UX-1 | A Circle organiser who didn't host an activity sees it in the Circle but has no management controls. That's correct by rule, but the page doesn't say who manages it | Show "Organised by {host}" on Circle activity cards (copy only) |
| UX-2 | "Didn't come" was clickable on future activities and failed silently | Fixed (hidden until the day) |
| UX-3 | Small inline link targets (16 px tall) in workspace breadcrumbs and links | Existing, documented in final validation 09; WCAG 2.2 target-size exceptions apply to inline links |
