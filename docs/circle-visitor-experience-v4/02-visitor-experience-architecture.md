# 02 — Visitor experience architecture

One route (`/circles/:id`), two experiences, chosen per viewer:

```
features["circles.visitor_experience"] && joinState ∉ {member, organiser}  → visitor page
otherwise                                                                    → existing Circle page (member Home, or the old visitor page when the switch is off)
```

- **Switch**: `circles.visitor_experience` in `server/src/circleFeatures.ts` (group circles, default off; admin Settings → Circle features). The endpoint answers 404 while off; the client also falls back to the old page.
- **Data**: `GET /api/circles/:id/visitor` (`routes/circles.ts`) — one call, visitor-safe for every join mode (see 05).
- **Client**: `client/src/components/circle/CircleVisitor.tsx` (`VisitorOverview`, `VisitorActivities`, `VisitorAbout`) inside the joined page's frame (banner, tabs, sticky right-hand panel), wired in `pages/CircleDetail.tsx`. Styles: the `cv-*` block in `components/circle/circleExperience.css`.
- **Joining** stays in `CircleJoinCard` (new props: `bare`, `autoJoin`, `joinSignal`), so every rule and dialog is the existing one.
- **New field**: `circles.solo_welcome` (TINYINT NULL; NULL = not said), set on Manage Circle → Details.

Flow: Discover → Explore → Trust → Join → Welcome (existing panel) → member Home.
