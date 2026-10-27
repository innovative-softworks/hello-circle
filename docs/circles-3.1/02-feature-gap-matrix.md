# Circles 3.1 — 02 Feature gap matrix

| Feature | Create from Circle | Link existing | Tested |
|---|---|---|---|
| Activities | **Built** — organiser: the Circle's own activity (existing `circleId`); member: `shareToCircleId` → activity + pending link | **Built** (link or plan) | Server tests; browser (dialog) |
| Adventures | **Built** for an organiser with a linked partner account: switches to the partner workspace, `/vendor/experiences/new?circleId&kind=adventure`, Circle saved as official Circle on first save (existing org rule); otherwise explained | **Built** | Typecheck; vendor path not browser-run (no organiser with a partner account in dev data) |
| Experiences | Same as adventures (`kind=experience`) | **Built** | as above |
| Events | Not a listing type — offered as "Event = an activity with a date" (decision 3.0-E1) | via activities | — |
| Programmes | Same rule, `/vendor/programs/new?circleId`; sessions stay inside the programme | **Built** (programme; plans can name a session) | Typecheck |
| Volunteering | Same rule (`kind=volunteer`); approval unchanged | **Built** | Typecheck |
| Places | Not created from a Circle (venue managers only); `/suggest-place` exists for missing places | **Built** ("Suggest a place" → link a centre/club; never claims a booking) | Server test (venue in 3.0) |
| Circle plans | **Exists** (3.0), reachable from the dialog | "Plan together" from any link | 3.0 tests |
| Polls | **Exists**, reachable from the dialog | — | existing tests |

Other gaps closed: approval of member links (G2), linked section with type filter and remove (G6), admin review/removal (G7),
Share vs Plan on listing pages (G8). Not built: nothing else from the brief's P0/P1; P2 items were decided in 3.0.
