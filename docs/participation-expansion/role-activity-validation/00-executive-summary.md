# 00 · Roles, activities and permissions validation: executive summary

**Date:** 2026-10-30.
**Code:** web worktree `hello-circle-participation-p1`, branch `feature/participation-phase2` @ `2f279ad`, plus the uncommitted pilot remediation, plus this audit's two fixes.
**Nothing was pushed or deployed.**
**Scope:** the five product discussions on roles, activity types, activity creators, the permission matrix, and Host / Vendor / Admin. Each was checked against the code.
**This is not a release verdict.** The Final Independent Validation (CONDITIONAL GO, web-only free and cash pilot) remains authoritative.

## Verdict: **CONDITIONAL PASS**
The role and activity model matches the approved implementation scope:
- **Ownership is correctly separated.** Host owns the activity; the Circle links it; the organisation owns its listings.
- **The server enforces every role.** The UI hides what the server refuses.
- **Admin can't see answers.**

**Two P2 defects were found and fixed** with regression tests:
- **RAV-SEC-01:** staff without the right role, and organisations without the capability, could file listing claims.
- **RAV-DEF-01:** a host could mark someone a no-show before the activity.

**Remaining issues are product decisions, not defects:** taxonomy coverage, host safeguarding rules, manager scope and co-hosting.

## Answers
1. **Real vs conceptual roles.**
   - **Real:**
     - identities: resident and partner/admin;
     - organisation roles: `centre_manager`, `facility_manager`, `finance`, `communications`, `read_only_analyst`, `checkin_staff`;
     - admin roles: `super`, `finance`, `support`, `legal`;
     - Circle roles: `organiser`, `member`.
   - **Ownership, not roles:** host (`games.host_resident_id`), organisation owner (`invited_staff = 0`).
   - **Badge plus gate:** Verified host (paid activities).
   - **Mapped:** club manager → facility_manager; venue manager → centre_manager; activity coordinator → both managers.
   - **Conceptual only:** Circle moderator, organisation "operations" and "admin staff".
2. **Disabled:**
   - off: host questions, reminders;
   - locked: partial cancel, sensitive questions;
   - paused: Make It Happen;
   - unavailable: donations, external payments.
   - **Correction to the discussions:** host **no-show is live**, not off.
3. **Categories:** not sports-only. Social, creative, wellness and community meetups are classifiable. Five examples have no exact home for a resident host: music jams, gardening, clean-ups, family meetups, video gaming. Admin can fix this through configuration (RAV-D-05).
4. **Host, Circle and Vendor ownership:** correctly separated.
   - Circle-linked activities are **one record**; there are no duplicate bookings.
   - A Circle organiser **can't** manage an activity a member hosts. This is stricter than the discussions.
   - Partners don't create "activities"; they use experiences, events, programmes and club sessions.
5. **Navigation:** the four proposed workspaces already exist. Partner menus follow role **and** capability, and admin menus follow permission. Nothing to add.
6. **Main difference from the discussions:** managers are **organisation-wide per listing type**, not limited to assigned listings. Assignments exist for check-in only (RAV-D-01, approval needed).

## Tests (this audit)
| Check | Result |
|---|---|
| Server suite (disposable MySQL), final run | **156 files, 1,394 passed, 0 failed**, 23 skipped (live providers) |
| Client unit | **352 passed** |
| QA harness self-check | **100 passed** |
| Type checks (server, client) and production build | pass |
| `qa:authorization` (fresh isolated QA DB) | **39 batches, 83 passed, 0 failed** |
| `booking-final-security`, `booking-config-capabilities`, `booking-config-operations` | **passed** |
| `booking-final-a11y` (13 pages × 320/375/768/1024/1440) | **passed**, 0 failures |
| New regression tests | `vendorClaimsRole.test.ts` (3; failed 3/3 before the fix), `roleSeparation.test.ts` (4), `gameQuestions.test.ts` (no-show day rule) |

**Not run in this audit:**
- the full 212-batch browser regression and Stripe TEST (run earlier today by the final validation);
- a manual screen-reader pass;
- mobile devices.

## Reports
- [01](01-existing-role-inventory.md) inventory
- [02](02-role-permission-matrix.md) matrix
- [03](03-resident-host-audit.md) resident and host
- [04](04-circle-permissions-audit.md) Circles
- [05](05-vendor-and-staff-audit.md) vendor and staff
- [06](06-admin-capabilities-audit.md) admin
- [07](07-activity-category-and-listing-types.md) categories and listing types
- [08](08-navigation-and-workspace-ux.md) navigation and UX
- [09](09-security-negative-tests.md) negative tests
- [10](10-end-to-end-role-journeys.md) journeys
- [11](11-gap-register.md) gap register
- [12](12-recommendations-and-next-actions.md) next actions
