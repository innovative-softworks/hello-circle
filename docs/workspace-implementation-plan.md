# Workspace implementation plan

_2026-10-16. **Proposed, awaiting Gate 1 approval.** No application code has been changed. Every item traces to a
finding in `workspace-audit.md` (WA-xx) or a decision (DEC-xx)._

## 1. Executive summary
- The management platform already exists and is coherent: one shell, records as pages, no drawers, deny-by-default
  admin permissions and server-enforced partner and host ownership.
- The work that remains is mostly **finishing and hardening**, not new architecture:
  1. Fix the host workspace for linked accounts (WA-01).
  2. Make every failed load visible with Retry (WA-03).
  3. Run the QA suites against the unverified 2026-10-16 redesign (WA-02).
  4. Merge the two workspace primitive sets (WA-17).
  5. Add a small number of read-only directories that already have their data and record pages: admin People, Orders,
     Circles and Hosts; partner All orders and Customers; host Reservations.
- Admin invitations (WA-04) is the only item that adds a privilege-granting flow, so it needs separate approval.
- **No commission, VAT, payout, Stripe configuration or commercial switch changes are in scope.**

## 2. Existing architecture
React + Vite client and an Express + MySQL server in one process (single origin). Three workspaces sit on
`WorkspaceShell`: admin (`AdminShell`, `adminNav.ts`), partner (`PartnerWorkspace`, `vendorTabAccess.ts`) and host
(`HostWorkspace`). Details: `workspace-audit.md` §2.

## 3. Current page inventory
See `workspace-page-inventory.md`: 20 admin tools, 12 partner tabs plus 4 editors, 8 host tabs plus the Circle,
activity and plan pages.

## 4. Target page architecture
See `workspace-information-architecture.md`: 46 modules, 22 Exist, 24 Partial, 0 Missing. §D there gives the minimal
navigation additions.

## 5. Missing pages (recommended)
| Page | Workspace | Finding |
|---|---|---|
| Admin invitations (inside Settings → Admin roles) | Admin | WA-04 / DEC-02 |
| People, Orders, Circles, Hosts (tabs inside Support) | Admin | WA-08 |
| All orders (first tab in Bookings) | Partner | WA-06 / DEC-04 |
| Customers (promoted from Org → Participants) | Partner | WA-11 |
| Reservations | Host | WA-10 |

## 6. Pages requiring redesign
- `/games/host` (create/edit activity) and `/manage/circles/:id` → into `HostWorkspace`.
- Centre editor Rooms / Hours / Availability and club editor Sessions / Waitlist → section cards (WA-09).

## 7. Duplicates to consolidate
- `OverflowMenu` ↔ `ActionMenu`; `EmptyMessage`/`ErrorMessage` ↔ `EmptyState`/`LoadErrorState`; `AdminModal` ↔
  `Modal` (WA-17).
- The unused `.slide-in-*` CSS.
- Partner Org → Participants becomes Customers; the old sub-tab link redirects.

## 8. Shared component architecture
- `adminUi.tsx` and `workspace/*` become the one workspace kit.
- `ui.tsx` stays the consumer kit, and delegates to the workspace kit under `useInWorkspace()`.
- New hook: `workspace/useLoad.ts`.
- New layout: a stacked-row table for ≤720px (`WsListTable` gains a `stack` mode).
- Spec: `workspace-ux-ui-specification.md`.

## 9. Navigation design
Keep every `?tab=` key. Additions are listed in IA §D. No new sidebar groups. Depth stays sidebar → tab → record.

## 10. Route structure
No new top-level routes. New state is held in URL params:
- `/admin?tab=support&view=people|orders|circles|hosts`
- `/vendor?tab=bookings&bsec=all`
- `/vendor?tab=customers` (with `tab=org&section=participants` as an alias)
- `/manage?tab=reservations`

## 11. Role-permission matrix
Current: `workspace-permission-matrix.md`. Changes:
- `admins.invite` (Super only, new). Only if DEC-02 is approved.
- The new admin directories reuse `support.search`. Order money details show only with `finance.payment_state.view`.
- Partner "All orders" is visible to the roles that can see Bookings (managers, finance). Rows are filtered on the
  server by listing type, using the same rule as the existing cancel and refund checks.
- Host Reservations: the resident's own bookings only.

## 12. Backend/API requirements
| Endpoint | Change | Notes |
|---|---|---|
| `GET /api/admin/support/people\|orders\|circles\|hosts` | new, read-only, paginated (`limit`, cursor on `created_at,id`) | Reuses the `supportLookup.ts` normalisers; `support.search` |
| `GET /api/admin/listings`, `/vendors`, `/audit` | add optional `limit` and cursor; the current no-parameter behaviour stays as it is | WA-07 |
| `GET /api/vendor/orders` | add a full (non-attention) mode with paging and type/status/date filters | Data is already normalised there |
| `POST /api/admin/admins/invite`, `POST /api/auth/accept-admin-invite`, `DELETE /api/admin/admins/invites/:id` | new (DEC-02) | Token emailed, expiry, single use, audit-logged, Super only |
| `GET /api/games/host/venue-bookings` | reuse as-is | Reservations tab |

## 13. Database requirements
- **Only for DEC-02:** an additive `admin_invites` table (token hash, email, admin_role, invited_by, expires_at,
  accepted_at, revoked_at) created through `initSchema()`.
- Possibly read-path indexes for the directory queries, added only if a measured query needs one.
- No other schema change. No change to the five participation tables.

## 14. Booking workflow dependencies
The new order lists are **read-only**. Cancel, refund and check-in keep going through the existing per-type routes
from the existing record pages. Nothing touches the capacity locking, `offeringSellable` / `assertSellable` or
`selfCancel.ts`.

## 15. Commerce and Stripe dependencies
None. The money columns in the order lists display the stored values from the existing order rows and
`payment_records`, with no recomputation. Paid-launch blockers stay with D-04 / D-09.

## 16. Security risks
| Risk | Mitigation |
|---|---|
| Admin invitations widen privilege | Super only; token hashed at rest, single use, expiry ≤ 72h; the role is fixed by the inviter; audit log on invite, accept and revoke; no self-invite into a higher role; separate approval (Gate 2 rule) |
| Directories expose personal data more broadly | Same permission as Support search; no export button; paginated; internal notes stay gated |
| WA-01 fix changes cross-identity routing | Client-only; the server already authorises by cookie; covered by existing manage specs plus a new one |

## 17. UX/UI improvements
`workspace-ux-ui-specification.md` §§2–8. The main ones: the load-state contract, one primitive kit, stacked mobile
tables and the restyled remaining pages.

## 18. Implementation matrix and priorities

| ID | Workspace | Page | Existing | Gap | Priority | Complexity | Dependencies | Action |
|---|---|---|---|---|---|---|---|---|
| F1 | All | 25 tabs/screens | `.then(setX)` with no catch | Hangs or empty on failure (WA-03) | **P1** | S | none | Add `useLoad` + `ErrorMessage`/Retry at every listed call site; hide failing badges |
| H1 | Host | `/manage` | Redirects to `/vendor` when a vendor session exists | Linked accounts locked out (WA-01) | **P1** | S | DEC-03 | Render the host workspace whenever a resident session exists; redirect only when there is none; add a spec |
| Q0 | All | 2026-10-16 redesign | Specs edited, not run | Unverified (WA-02) | **P1** | M (run time) | Owner approves restoring the QA profile | Run `qa:product`, `qa:validation`, `qa:revenue`, `qa:booking`, `qa:lifecycle`, `qa:authorization`; fix the regressions found |
| A1 | Admin | Settings → Admin roles | List + role change | No invite (WA-04) | P1 | M | DEC-02; separate security approval | Invite / accept / revoke flow + `admin_invites` |
| F2 | All | primitives | Two kits | WA-17 | P2 | M | F1 | Delegate `ui.tsx` → workspace kit; one menu |
| F3 | All | list tables | `overflow-x` only | WA-12 | P2 | M | F2 | `stack` mode ≤720px; overflow test at 9 widths |
| A2 | Admin | Support | Search + records | No directories (WA-08) | P2 | M | none | People / Orders / Circles / Hosts tabs + paginated endpoints |
| A3 | Admin | Listings, Vendors, Audit | Full fetch; audit 200 | WA-07 | P2 | M | none | Cursor pagination (backward compatible) |
| V1 | Partner | Bookings | Hall + Club only | WA-06 | P2 | M | DEC-04 | "All orders" tab over `/vendor/orders` |
| V2 | Partner | Customers | Org → Participants | WA-11 | P2 | S | none | Promote to nav; alias the old link |
| V3 | Partner | Centre/club editor sections | Older styling | WA-09 | P2 | M | F2 | Section cards for rooms, hours, blocks, sessions, waitlist |
| H2 | Host | Reservations | Endpoint only | WA-10 | P2 | S | none | New tab listing the host's venue bookings, linked activity, status |
| H3 | Host | `/games/host`, `/manage/circles/:id` | Consumer layout | WA-09 | P2 | L | F2 | Wrap in `HostWorkspace`; section cards; keep the forms' behaviour |
| A4 | Admin | Settings | API only | WA-13 | P3 | XS | none | Maps on/off switch with a reason |
| H4 | Host | Activity record | none | No venue cost shown alongside | P3 | S | none | Read-only "Venue booking: ref, amount paid" line; no calculations |
| V4/H5 | Partner/Host | Account menu | Nested | Findability | P3 | XS | none | Direct links to account & security and the host profile |
| F5 | All | CSS | Unused `.slide-in-*` | Dead code | P3 | XS | none | Delete |
| — | Admin | Resident suspension, GDPR queue | none | WA-05 | blocked | — | D-07 | none until D-07 is decided |
| — | All | Tickets, CMS, peak pricing, documents, ticket types, host Messages | none | — | not planned | — | DEC-09 | none |

**Order:** F1 → H1 → Q0 (gate) → F2 → A2/A3 → V1/V2 → H2 → F3 → V3/H3 → P3 items. A1 runs when separately approved.

## 19. QA and acceptance criteria
- **Every item:**
  - client `tsc` and Vitest pass; server `tsc` and Vitest pass (isolated profile).
  - The relevant `qa:*` suite passes on the final code. No test is reported passing unless it was executed.
- **F1:** for each listed screen, a forced 500 shows `ErrorMessage` + Retry, and Retry recovers. A component test per
  hook state.
- **H1:** a linked account holding both cookies opens `/manage` and sees the host workspace. A vendor-only session is
  still sent to `/vendor`. A new spec in `tests/integration`.
- **A1:**
  - A non-super gets 403.
  - Expired, reused or revoked tokens are refused.
  - The accepted admin has exactly the invited role.
  - Three audit rows (invite, accept, revoke).
  - Rate-limited.
- **A2/V1/H2:** results match the per-type sources for seeded fixtures. Pagination is stable (no duplicates or gaps).
  Role filters match the matrix. Read-only (no write routes added).
- **F3:** zero horizontal overflow at 320/375/390/428/768/1024/1280/1440/1920 on every workspace list page per role.
- **Accessibility:** keyboard-only pass on the new tabs, menus and dialogs. Axe has no serious or critical issues
  (`product-a11y-*` pattern).
- **Isolation:** all of this runs in the isolated QA container (Stripe TEST mode only). Nothing runs against
  `hello_circle`, staging or live Stripe.

## 20. Rollback and release plan
- **Local only.** No commit, push or deploy without explicit owner instruction.
- Suggested grouping when told: one commit per sprint group.
- **Rollback:**
  - Client changes revert per commit.
  - The new endpoints are additive and backward compatible: lists without parameters behave as today.
  - `admin_invites` is additive, has no down migration, and is harmless if left unused.
  - The H1 fix is a single component change.
- **Release order when approved:** staging first (existing release branch process), a manual check per role, then
  production.
- **Blockers that stay outside this plan:** D-04 / D-09 (paid commercial model), D-07 (resident suspension and
  deletion), and the hand-run Stripe Express onboarding.
