# 06 · Admin capabilities audit

**Admin sub-roles:** `super`, `finance`, `support`, `legal` (`users.admin_role`).
**Rules:**
- deny-by-default `ADMIN_PERMISSIONS` (`server/src/adminPermissions.ts`);
- one permission per route, enforced by a test that walks every admin router;
- MFA required (OG-07), with step-up for money, suspensions, admin access, settings and deletes.

## 1. Capability inventory
| Area | Where | Permission | Status |
|---|---|---|---|
| Organisation records, status, suspension (D-01) | Admin → Organisations (record page) | `orgs.view` / `orgs.manage` / `orgs.suspend` (Super) | Verified |
| Partner approval | Vendors, Pending approvals | `partners.approve` (Super, Support) | Verified |
| Verification workflow | Verification checks | `queues.view` / `queues.decide` | Verified |
| Capability assignment, limits, templates | Organisation record → Capabilities (`OrgCapabilities.tsx`), `/admin/organisations/:id/capabilities` (GET, preview, PUT) | `orgs.manage` | Verified (config-capabilities, re-run: passed) |
| Categories and subcategories, activation, moderation policy, suggested form | Admin → Categories (`adminCategories.ts`) | `taxonomy.view` / `taxonomy.manage` (Super) | Verified |
| Organisation category eligibility | Organisation record (`category_mode`, `org_category_access`) | `orgs.manage` | Verified |
| Field registry, field policy, sensitive-field locks | Settings → Registration fields (`fieldRegistry.ts`, `field_policies`) | `platform.settings` | Verified |
| Platform form templates | Settings (7 platform templates) | `platform.settings` | Verified |
| Export rules, retention information | Governance (`/admin/governance`, `privacyCounts.ts`) | `audit.view` | Verified (counts only) |
| Users (people), hosts, Circles, orders, activities | Operations group | `support.search`; `activities.moderate`; `orders.cancel` | Verified |
| Admin roles | Settings → admin roles | `admins.manage` (Super) | Verified (D02-MATRIX, D02-LAST-SUPER) |
| Listings oversight | All listings, Pending approvals | `listings.*` | Verified |
| Audit history | Audit log | `audit.view` | Verified |
| Support | Support console | `support.search` | Verified |
| Reports (insights) | Insights | `insights.view` | Verified |
| Platform settings and switches | Settings, feature switches | `platform.settings` (Super) | Verified |
| Commercial governance | Commercial rules, Finance | `commerce.operate`, `finance.operate` (Super, Finance) | Verified, **not changed by this audit** |

## 2. Commercial restrictions (read, not changed)
| Item | State |
|---|---|
| Donations | capability `status: "unavailable"` (PD-3, D-04); can't be switched on from any admin screen |
| External payments | `status: "unavailable"` (PD-4) |
| Partial cancellation | `participation.partial_cancel` **locked** (409 on enable) |
| Special-category (sensitive) questions | `participation.special_category_questions` **locked** |
| Paid hosting | verified hosts only (`mayHostPaid`) |
| Paid booking models | the existing Stripe Checkout agreement and payment reviews (D-10/D-11), unchanged |

## 3. Admin privacy
- **No admin route reads registration answers or the legacy `medical` column.** The only route files that read answer tables are resident order routes and partner routes (`bookings`, `experiences`, `games`, `orderForms`, `programs`, `registrations`, `vendorAttendees`, `vendorForms`, `vendorOrders`, `vendorReports`). Governance shows **counts** (`privacyCounts.ts`).
- Admin accounts can't reach partner routes: `requireVendor` needs `role = 'vendor'`. So holding admin rights doesn't expose an organisation's answers, team notes or answer CSVs.
- Deleting legacy medical notes: no route. That's a legal decision (doc 18).
- `decisions.internal_notes.view` excludes the finance admin role.

**Matches the discussions' rule:** "administrative privileges do not automatically expose protected registration answers or legacy medical information". **Verified by source inspection.** Every admin route declares a permission, and none selects these tables.

## 4. Gaps
- **Discussion 1** marks Admin "Configure registration forms: ✓". **Actual: policy only.** Admin sets the field registry, policies and platform templates, not an organisation's forms. Discussion 4 says "Policy only", which is correct. No change recommended.
- **Admin claim approval** (`PUT /admin/claims/:id/status`) doesn't show or re-check the organisation's capability. With RAV-SEC-01 fixed, partners can't file a claim without the capability, but a claim filed before the fix could still be approved (RAV-D-09, low).
