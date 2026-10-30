# 04 · Circle permissions audit

## 1. Model
| Item | Implementation |
|---|---|
| Roles | `circle_members.role` = `organiser` \| `member`. The creator becomes organiser (`circles.ts:1433`); organisers can promote (`/promote`) and demote, and a Circle can have several organisers |
| Moderator | **No role.** Organisers can mute a member (`/mute`, `muted_until`), remove them (writes `circle_restrictions`, D5) and moderate content (`CircleModerationTab.tsx`) |
| Creation | any resident (`requireResident`); no host status needed |
| Join modes | open / approval / invite; `circle_invites`, join requests |
| Visibility | non-members see the visitor page (`circles.visitor_experience`, counts only) |
| Admin | `support.search` (read), close via admin Circles; no membership powers |

## 2. Circle-linked activities: one record, no duplicates
- **Organiser path:** `POST /api/games` with `circleId` (and optionally a confirmed `planId`) creates **one** `games` row with `games.circle_id`. Only an organiser of that Circle may send `circleId` (`games.ts:1804`, 403 otherwise).
- **Member path:** `shareToCircleId` creates the activity (host = member) and then a `circle_listing_links` row with `relationship = 'created_for'`. It waits for an organiser. The retry route `POST /api/circles/:id/links` can't create a second activity or a second link.
- **Partner listings** in a Circle are also links (`circle_listing_links`), never copies.
- **Participation** is always `game_participants` on the one activity. No Circle-side booking table exists, so **there are no duplicate booking or participation records.** This matches the discussions' rule ("one underlying record").
- **Visibility:** an organiser-created activity takes the Circle's join mode (open → public, otherwise `circle`). `canViewGame` admits members (and partner-Circle members, owner decision D2) for every read, join, quote, ICS and update.

## 3. Who manages a Circle-linked activity
| Action | Host | Organiser (not host) | Member | Outsider |
|---|---|---|---|---|
| Edit, cancel, move, participants, check-in, no-show | ✓ | **—** (403) | — | — |
| Approve the link into the Circle | — | ✓ | — | — |
| Remove the link (`DELETE /circles/:id/links/:linkId`; the activity itself is untouched) | ✓ if they linked it | ✓ | ✓ if they linked it | — |
| Join | ✓ | ✓ | ✓ | only if public |

The discussions' rule is "do not automatically grant all Circle members activity-management permissions; organisers only within granted permissions". It is **met, and stricter**: an organiser who isn't the host can't manage the activity either. That's the current, consistent rule (one owner per activity). Letting organisers co-manage would need a co-host concept: RAV-D-02 / D-03, approval needed.

## 4. Verification
| Check | Result | Evidence |
|---|---|---|
| Organiser of A manages Circle B (rename, promote, remove, announce) | 403, unchanged | `roleSeparation.test.ts` (new) |
| Member attaches an activity as the Circle's own | 403 | `roleSeparation.test.ts` |
| Organiser manages a member-hosted Circle activity (participants, cancel, edit, remove) | 403, unchanged | `roleSeparation.test.ts` |
| Members-only content to outsiders | 403/404 | `circles.test.ts` (8 negative cases), `circle-visitor-4.spec.ts` |
| Invite-only bypass on join | refused | HC-QA-016 (authorization suite, re-run today: passed) |
| Member communications | organiser announcements, polls, chat; aggregate counts only, never names, in Pulse and Free Time Match (`circleExperience.ts`) | Circle Experience 2.0 tests |

**Status:** Implemented and verified. No defect found.
