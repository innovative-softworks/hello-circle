# 24 · Phase N: resident-hosted games and activities

**Date:** 2026-10-30.
**Commits:**
- web: `b7229fc`;
- mobile: `ea46242`.

Both are local; nothing is pushed.

## 1. Current-state audit (reused as is)
| Capability | Existing implementation |
|---|---|
| Creating an activity, ownership | `POST /api/games`, `games.host_resident_id`; a resident host, not a vendor |
| Participant list (host) | `GET /games/:id/participants/manage` (host only); a public, name-only preview |
| Join requests | Approval mode: `game_join_requests`, approve or decline, withdraw |
| Waitlist | Join, leave and offer, with the waitlist sweep |
| Instructions | `description`, `equipment_needed`, `meeting_instructions` |
| Communication | Host updates (`/updates`, which notify participants) and activity chat |
| Cancel, move, recurring | `/cancel`, `/move` (with any venue booking), series |
| Attendance | Self check-in, host check-in per participant (attendance table, review eligibility), self-confirmed attendance |
| Circle link | Circle plans → games (`planId`), partner Circles; `canViewGame` visibility for every read and join |
| My Life | Upcoming and past activities |

## 2. Missing, and implemented
- **Participation questions from an approved library** (`participation/gameQuestions.ts`):
  - **The library:** "Your level", "Preferred position", "Equipment", "Preferred team or group", "I'll arrive on time for the start".
  - **What the host chooses:** up to **3** questions, and which are required. **No own wording**, so nothing sensitive can be asked. The same wording, type and length validation runs as for every form.
  - **No partner builder:** the vendor form routes refuse `game` (404).
  - **One engine:** the same question, answer and version tables (`listing_type 'game'`; answers keyed `<gameId>:<residentId>`).
  - **At join:** answers are checked **before** a place is taken (`form_required`, `questions_changed`, `answer_required`) and saved with the join, request or pending checkout.
  - **Who sees answers:** **the host only**, in their participant list. The public preview never shows them.
  - **When answers are removed:** when someone leaves, is removed, is declined or withdraws.
  - **Retention:** answers count by the activity date.
- **Host attendance:**
  - **"Didn't come"** (`POST /games/:id/participants/:rid/no-show`) for the host only;
  - **repeat-safe:** marking it again changes nothing, and a later check-in overrides it.
  - **No QR needed** for informal games.
- **Web UI:**
  - **Join:** the join confirmation (desktop card and phone bar) shows the questions. A game that asks questions never joins in one tap.
  - **Quick join:** quick-join buttons (lists, venue page, discovery) open the activity page instead.
  - **Host's Manage → activity record:** answers next to each participant, the "Didn't come" button, and "Questions for people joining" (pick and required).
- **Mobile app:** the game screen shows the host's questions and sends the answers, and reloads if they changed.
- **Switch:** **`participation.host_questions`, off by default.**

## 3. API and database changes
- **API:**
  - `GET` and `PUT /api/games/:id/questions` (host);
  - `POST /api/games/:id/participants/:residentId/no-show`;
  - `GET /api/games/:id` adds `participationQuestions`;
  - `/participants/manage` adds `answers`;
  - join accepts `answers` and `questionsVersion`.
- **Database:** `games.questions_version` (additive).

## 4. Permissions and privacy
- **Hosts** never gain organisation, capability, export or vendor permissions.
- **Circle-linked games** keep the Circle visibility check before join (unchanged); host and Circle-organiser powers stay separate.
- **No sensitive, financial or identity questions** are possible.

## 5. Acceptance
| # | Criterion | Status |
|---|---|---|
| 1 | Create a game | Existing |
| 2 | Another resident joins | Existing; with questions, tested |
| 3 | Approved questions answered | Implemented and tested |
| 4 | The host manages participants | Existing, plus answers |
| 5 | The host records attendance | Check-in existed; no-show added and tested |
| 6 | Circle permissions respected | Existing `canViewGame` before join (unchanged) |
| 7 | No vendor-only capabilities | Tested: the vendor builder refuses `game` |
| 8 | Private information protected | Tested: answers host-only and removed on leave |

## 6. Tests
- `participation/gameQuestions.test.ts` (6):
  - off by default;
  - host-only, library-only, at most three;
  - checked at join, with host-only answers;
  - no-show and check-in, repeat-safe;
  - answers removed on leave;
  - no vendor builder.
- The existing game suites pass (`games`, `gameJoinApproval`): 40 tests together.
- Mobile Jest.

## 7. Limitations and decisions
- **Abandoned paid checkout:** when one expires, the answers stay until the person joins again (overwritten) or leaves. They're never shown to anyone but the host.
- **Owner decisions:** switch the feature on? Is three questions the right limit?
