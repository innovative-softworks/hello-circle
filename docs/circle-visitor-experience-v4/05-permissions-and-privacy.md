# 05 — Permissions and privacy

Decisions approved by the owner (2026-10-24):
1. Highlights use only public pictures — venue photos, the Circle's own past/upcoming activity photos and the open cover. **Memories stay members-only (D4).**
2. Approval Circles show organiser text, upcoming activity titles/dates, organiser and member count — **no member names, no polls**.
3. "Coming on your own?" shows only when the organiser says so (`circles.solo_welcome`) or most of the Circle's activities are marked come-alone.
4. Open Circles: polls and plans remain public on the server as before, but the visitor page shows **counts only**.
5. Invite-only Circles stay a teaser.

`GET /api/circles/:id/visitor` returns: join mode, member count, organiser name (+ resident id only when verified, for the public host profile), the organiser's about/what-we-do/who-can-join/values (about only for invite), cover URL (open only), upcoming (via `circleOwnGames` + `filterViewable`, so private/members-only activities are never included), past activities with attended **counts**, venue photos, usual pattern, solo flag, and (open only) poll/plan counts.

Never returned: member names or ids, chat, memories, Pulse wishes, availability, poll questions or votes, plan titles, a non-open cover. Covered by server tests (`circleExperience.test.ts`, "Circle Experience 4.0") and the browser spec (`circle-visitor-4.spec.ts`).

No permission was widened: existing endpoints and their rules are unchanged.
