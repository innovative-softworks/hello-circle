# 11 · Gap register

**Severity:**
- **P1:** must fix before the pilot;
- **P2:** fix soon;
- **P3:** minor.

**Complexity:**
- **S:** under a day;
- **M:** a few days;
- **L:** a week or more.

## A. Defects (existing behaviour broken)
| ID | Role | Feature | Expected | Actual | Evidence | Sev | Security impact | UX impact | Reuse | Solution | Cx | Approval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RAV-DEF-01 | Host | No-show | A no-show can only be recorded once the activity is under way | Could be recorded any time before. It blocks the participant's review of the host and shows "missed" in My Life. The button was visible on future activities | `games.ts` `/no-show`; `reviewEligibility.ts`; `myLifePlans.ts` | P2 | integrity: retaliation against reviews | silent failure risk | partner rule `vendorExperiences.ts:694` | **FIXED:** 409 before the activity day; button hidden until then; test updated | S | no (defect) |

## B. Security gaps
| ID | Role | Feature | Expected | Actual | Evidence | Sev | Security impact | UX impact | Reuse | Solution | Cx | Approval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RAV-SEC-01 | Read-only, finance, communications, check-in staff; organisations without the capability | Listing claims | Same gate as creating that listing type | No role or capability check; any member could file a claim | `vendorListings.ts` `POST /claims`; `vendorClaimsRole.test.ts` fails 3/3 on old code | P2 | privilege: read-only role could mutate; capability bypass (an admin still decides) | none for allowed users | `assertPlatformRole`, `assertCapability` | **FIXED** | S | no (defect) |

## C. Missing agreed functionality
**None found.** Everything approved in Phases 1–P that concerns roles is present (doc 27 matrix verified against code). The discussions' proposals that aren't built were never approved, so they're listed under D.

## D. Product enhancements (from the five discussions; not approved; not built)
| ID | Role | Feature | Discussions expect | Actual | Sev | Reuse | Recommendation | Cx | Approval |
|---|---|---|---|---|---|---|---|---|---|
| RAV-D-01 | Manager | Listing-scoped managers | Managers access only assigned listings | Managers are organisation-wide per listing type; assignments exist for check-in only | P3 | `listing_staff_assignments`, `doorScope` | Keep as is for the pilot (small organisations). If needed, add an optional "assigned listings only" flag per staff member, reusing the assignment table | M–L | **yes** |
| RAV-D-02 | Host, Circle organiser | Co-host | Add a co-host | One owner per activity (`host_resident_id`) | P3 | Circle organiser roles | Defer; if approved, a `game_cohosts` table checked next to `host_resident_id` in the 23 host handlers | M | yes |
| RAV-D-03 | Circle | Circle moderator | A moderator who helps manage participation | Several organisers + mute/remove | P3 | promote/demote | **Don't add a role**; "promote to organiser" covers it. Revisit only if organisers want a limited helper | S–M | yes |
| RAV-D-04 | Circle organiser | Manage member-hosted Circle activities | ◐ in the discussions | Host-only (stricter) | P3 | — | Keep host-only; show "Organised by {host}" on the Circle card (UX-1) | S | yes |
| RAV-D-05 | Host | Activity categories | Music jams, gardening, clean-ups, family meetups, video gaming as activities | Not in family A, or no subcategory | P3 | Admin → Categories (no code) | Super admin adds family A to Music / Kids & family / Volunteering, and subcategories Gardening, Video gaming, Meditation, Sketching | S (config) | yes (taxonomy owner) |
| RAV-D-06 | Host | Higher-risk activity safeguarding | Restrict children's supervised activities, formal coaching, commercial workshops, ticketed events for hosts | Only paid → verified host, plus `min_age` | P2 (policy) | category `moderation_policy`, `mayHostPaid` | Owner and legal decide; then a per-category "partners only" flag reusing `moderation_policy` | M | **yes (legal)** |
| RAV-D-07 | Host | Archive | Archive completed activity | No archive state | P3 | lifecycle | Not needed: past activities leave lists automatically | — | yes |
| RAV-D-08 | Org | Activity Coordinator / Operations roles | Named roles | Mapped to managers | P3 | `PLATFORM_ROLES` | **Don't add roles** (brief rule); document the mapping in partner help | S (docs) | yes |
| RAV-D-09 | Admin | Claim review shows capability | — | Admin approval doesn't show or check the organisation's capability | P3 | `capabilityFor` | Show the capability state on the claim review; refuse approval when off | S | yes |
| RAV-D-10 | Host | Host messages | "Limited" participant messages | Updates, chat and instructions (no e-mail campaigns) | — | — | Matches the discussions; nothing needed | — | — |

## E. Intentional restrictions (not overridden)
| Item | State | Owner |
|---|---|---|
| Host questions | `participation.host_questions` **off** (tested in the test DB only) | owner |
| Day-before reminders | `participation.reminders` **off** | owner |
| Partial cancellation | **locked** | owner + accounting |
| Special-category questions | **locked** | legal |
| Make It Happen | **paused** | owner |
| Donations, external payments | capability `unavailable` | PD-3 / PD-4 |
| Paid hosting | verified hosts only | existing |
| Partner forms on games | refused (owner decision, Phase H) | owner |
| One organisation per account | D-A2 | owner |
| Admin can't read answers or medical notes | by design | — |
| Mobile registration forms | built; device testing and app release outstanding | owner |
