# Document 21 — Technical / Product Traceability Matrix

Business requirement → UX → frontend → API → data → outcome, for the platform's structural features. Also settles the apparent naming overlaps the original brief asked about — most turn out to already be resolved or genuinely distinct, not duplication to fix.

| Module | Feature | User | Screen | API | Entity | Use case | Status |
|---|---|---|---|---|---|---|---|
| Bookings | Room booking | Guest/Resident | BookingFlow.tsx | `POST /bookings/checkout` | bookings, rooms | UC-002 | Implemented |
| Registrations | Club sign-up | Guest/Resident | RegistrationFlow.tsx | `POST /registrations/checkout` | registrations | — | Implemented |
| Circles | Join Circle | Resident | CircleDetail | `POST /circles/:id/join` | circles, circle_members, circle_invites | UC-001 | Implemented |
| Games | Host & join Game | Resident | HostGamePage, GameDetail | `POST /games`, `POST /:id/join` | games, game_participants, waitlist_entries | UC-003 | Partial (visibility unenforced) |
| Programs | Enroll | Guest/Resident | ProgramDetail | `POST /programs/:id/enroll` | programs, program_enrollments | UC-006 | Partial (no cancel route) |
| Passes | Purchase & redeem | Resident | Profile / RegistrationFlow | `POST /passes/checkout` | passes | UC-005 | Partial (no credit restore) |
| Payments | Checkout (shared) | All | Every checkout flow | `checkoutService.ts` | Stripe session | UC-002,005,006 | Implemented |
| Vendor | Signup → approval | Prospective vendor, Admin | VendorSignup.tsx, AdminDashboard.tsx | `POST /signup`, `PUT /vendors/:id/status` | users, organisations | UC-007 | Implemented |
| Vendor Org | Staff invite | Vendor owner | VendorOrg.tsx | `POST /org/staff/invite` | org_invites, users | UC-008 | Implemented |
| Reviews | Leave a review | Resident/Guest | Detail pages | `POST /reviews` | reviews | — | Implemented |
| Notifications | Fan-out on booking events | Vendor, Admin, Guest | Header bell, email | `notifications.ts` | notifications | — | Implemented |
| Chat | Scoped messaging | Resident | ChatPanel (web+mobile) | `GET/POST /:scopeType/:scopeId/messages` | chat_messages | — | Implemented |
| Admin | Moderation console | Admin | AdminDashboard.tsx | `admin.ts` (40+ routes) | most tables | UC-007 | Implemented |

## Resolving the apparent naming overlaps

**Follow vs. Favourite vs. Join vs. Book vs. Register** — All genuinely distinct: Favourite = bookmark with a one-way status upgrade (interested→planning→joined); Follow = subscribe to a vendor/host/centre's update stream; Join = become a Circle/Game participant; Book = pay to reserve a room/slot; Register = sign up for a club. No consolidation needed.

**Activity vs. Event vs. Experience vs. Adventure** — Experience/Adventure are already **one table** (`experiences`, discriminated by `kind`) — not a duplication to fix, already resolved at the data layer even though the frontend presents two browse skins. "Activity" and "Event" aren't persisted entities at all — umbrella UI words only.

**Host vs. Vendor** — Genuinely different actors — see [Document 16](16-host-vendor-operations.md). Not a duplication.

**Explore vs. Search vs. Browse** — `/search` is already a deprecated redirect into Explore's Results Mode — consolidated. Browse remains deliberately separate (plain sort over venues, not ranked scheduled activities) — different data, not a duplicate.

**Saved vs. MyLife** — Saved (favourites) is one of several things aggregated *into* MyLife, not a competing surface.

**Registration vs. Booking** — Different entities entirely (club sign-up vs. room hire) despite both being "make a transaction" flows — not a naming duplication.

---
[← Gap Analysis](20-gap-analysis.md) · [Next: Health & Implementation Audit →](22-health-implementation-audit.md)
