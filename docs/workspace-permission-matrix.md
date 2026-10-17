# Workspace permission matrix

_2026-10-16, taken from the code. The server is the enforcement point in every row; client hiding is UX only._

## 1. Super Admin: sub-roles × permissions

Source: `server/src/adminPermissions.ts` (the single table). It is deny-by-default:
- An empty or unknown `admin_role` is denied everything.
- No session → 401. A non-admin, or a role without the permission → 403.
- `adminPermissions.test.ts` fails if any admin route has no declared permission.

Client mirror: `GET /api/admin/permissions` → `useAdminCan()`.

| Permission | Super | Finance | Support | Legal | Used by (page) |
|---|:-:|:-:|:-:|:-:|---|
| `workspace.view`, `audit.view`, `support.search`, `insights.view`, `decisions.view` | ✓ | ✓ | ✓ | ✓ | Overview, Audit, Support, Insights, decision history |
| `decisions.internal_notes.view` | ✓ |  | ✓ | ✓ | Record pages (internal note) |
| `admins.manage` | ✓ |  |  |  | Settings → Admin roles |
| `partners.view` | ✓ | ✓ | ✓ | ✓ | Vendors |
| `partners.approve` | ✓ |  | ✓ |  | Vendor record: approve |
| `partners.suspend`, `partners.platform_role`, `partners.tier` | ✓ |  |  |  | Vendor record |
| `listings.view` | ✓ | ✓ | ✓ | ✓ | Pending, All listings |
| `listings.moderate`, `listings.edit`, `listings.feature` | ✓ |  | ✓ |  | Listing record |
| `listings.delete` | ✓ |  |  |  | Listing record (⋯ menu) |
| `queues.view` | ✓ |  | ✓ | ✓ | Claims, Host applications, Place suggestions |
| `queues.decide` | ✓ |  | ✓ |  | same |
| `orgs.view` | ✓ | ✓ | ✓ | ✓ | Organisations |
| `orgs.manage`, `orgs.suspend` (D-01) | ✓ |  |  |  | Organisation record |
| `reviews.view/moderate`, `reports.view/moderate`, `complaints.handle`, `traders.view` | ✓ |  | ✓ | ✓ | Reviews & reports, Policies & trust |
| `traders.verify`, `policies.manage`, `help.edit`, `templates.view/edit` | ✓ |  |  | ✓ | Policies, Settings → Field help, Templates |
| `templates.delete` (reset to default) | ✓ |  |  |  | Templates |
| `demand.notify` | ✓ |  | ✓ |  | Insights → notify residents |
| `media.view`, `media.editorial` | ✓ |  | ✓ |  | Media; uploads outside `/api/admin` |
| `media.delete` | ✓ |  |  |  | Media |
| `platform.settings` | ✓ |  |  |  | Settings (market categories, weights, switches) |
| `finance.operate` | ✓ | ✓ |  |  | Finance, Plans & credit |
| `finance.payment_state.view` | ✓ | ✓ | ✓ |  | Finance (read-only for support) |
| `commerce.operate`, `coupons.manage` | ✓ | ✓ |  |  | Commercial rules, Coupons |
| `commerce.governance_switches`, `coupons.delete` | ✓ |  |  |  | Commercial switches, coupon delete |

**Gaps:**
- No permission or route exists to *create or invite* an admin (WA-04). If DEC-02 is approved, the recommendation is a
  new `admins.invite` permission, Super only.
- Resident restriction has no permission because it has no lever (D-07).

## 2. Partner: organisation owner vs invited staff

Source:
- `requireVendor` + `attachVendorIds` on `/api/vendor/*`. "Own" means any listing whose `vendor_id` is in
  `orgVendorIds()`.
- `requirePlatformRole` / `assertPlatformRole` in `server/src/auth.ts`. The owner (`invitedStaff = false`) passes every
  role check.
- Client tab mirror: `client/src/vendorTabAccess.ts`.

| Area / action | Owner | Centre mgr | Facility mgr | Finance | Comms | Analyst | Server check |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Overview, Calendar, Org (read) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `requireVendor` |
| Centres: create, edit, rooms, hours, blocks, publish, pause, duplicate, delete | ✓ | ✓ |  |  |  |  | `requirePlatformRole("centre_manager")` + ownership |
| Clubs: create, edit, sessions, waitlist offer | ✓ |  | ✓ |  |  |  | `requirePlatformRole("facility_manager")` + ownership |
| Programmes (by listing type), experiences | ✓ | ✓ | ✓ |  |  |  | `assertPlatformRole` + ownership |
| Programme / experience refunds | ✓ |  |  | ✓ |  |  | finance |
| Bookings: cancel, resend, check-in | ✓ | ✓ (hall) | ✓ (club) |  |  |  | `centre_manager` for hall bookings, `facility_manager` for club registrations |
| Bookings: refund | ✓ |  |  | ✓ |  |  | finance |
| Messages (broadcast), review replies | ✓ |  |  |  | ✓ |  | communications |
| Offers (coupons) | ✓ |  |  | ✓ |  |  | finance + ownership of the scoped listing |
| Earnings, payout account, venue splits | ✓ |  |  | ✓ |  |  | router-level `requirePlatformRole("finance")` |
| Plan changes (Pro checkout, cancel, resume, billing portal, redeem) | ✓ |  |  |  |  |  | finance router + owner-only `canManage` |
| Demand | ✓ |  |  | ✓ |  | ✓ | finance, read_only_analyst |
| Org profile, policies, staff invite/role/remove (D-08) | ✓ |  |  |  |  |  | `invitedStaff` check (owner only) |
| Listing claims | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **no role check: decision D-06** |

**State overrides, which apply before any role:**
- **pending**: setup checklist only.
- **suspended user**: no access; the reason is shown (D-03).
- **organisation suspended**: read-only obligations page, and every new sale is refused (D-01).
- **removed member**: 403 `removedFromOrg` (D-08).

## 3. Host: resident ownership

There are no roles. Ownership is per record:
- **Activity (game)**: `games.host_resident_id = req.resident.id` on remove, refund, check-in, updates, cancel, edit,
  lifecycle and waitlist offer.
- **Circle**: `isOrganiser(circleId, residentId)` on edit, status, members (remove, promote, demote), invites, join
  requests, plan confirm and poll close.
- **Paid activity**: needs `commerce.paid_games_require_verified_host` (default on) or payout eligibility (P2-17).
- **Plan and payouts**: the resident themself (`hostPlanRouter`, `hostPayoutsRouter`); payout onboarding is refused
  unless they are a verified host or have hosted a priced game.
- **Splits**: only the game's host may propose; the venue's org owner or finance staff decide.

**Cross-identity:**
- `POST /manage/switch` mints the other side's session for an already-linked account, and is audit-logged.
- **WA-01**: when both sessions are held, the client routes `/manage` to `/vendor`. That is a client routing defect,
  not a permission leak: the server would accept the resident session.

## 4. Direct URL access (code-reviewed)
- `/admin` with no admin session → redirect to sign-in. The nested `returnTo` was reported 2026-10-14 and not
  re-verified.
- An admin tool the role lacks → lock page; its API calls → 403.
- `/vendor?tab=<hidden>` for staff → Overview + toast; APIs → 403.
- `/vendor/centres/:id` for another org's listing → `ownsCentre` refuses on the server.
- `/manage?tab=activities&record=activity:<other host's game>` → APIs return 403/404.
- `/receipts/:ref` for someone else's receipt → "not found".
