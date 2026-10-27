# 04 — Membership state matrix

| State | Who | Page | Primary action |
|---|---|---|---|
| A | Signed out | Visitor page | "Join this Circle" → sign-in; `returnTo` carries `?join=1`; back on the Circle the join step opens by itself |
| B | Signed in, not a member, open Circle | Visitor page | "Join Circle" → confirm → member Home + welcome |
| B | Signed in, not a member, approval Circle | Visitor page | "Request to join" → existing request form (questions + note) → pending |
| C | Request pending | Visitor page, no join prompts anywhere | "Request sent" + explanation + "Withdraw request"; side panel shows the status |
| D | Member | Existing member Home | — |
| E | Organiser | Existing member Home (+ setup checklist for an unfinished Circle) | Manage Circle |
| F | Invite-only, not a member | Visitor page with the teaser data only (no activities, no venue photos) | "Ask the organiser for an invite" (or "Accept invite" when invited) |
| F | Invited | Visitor page | "Accept invite" |
| G | Closed Circle | Visitor page | No join; "This Circle is closed to new activity" |
| G | Removed (D5) | Visitor page | No join; "You can't rejoin this Circle" |

Verified in the browser: A, B (open via `?join=1`), B (approval), C, D, E (new Circle). See 09.
