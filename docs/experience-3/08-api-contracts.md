# Experience 3.0 — 08 API contracts

All resident routes use the existing session; 404 while the switch is off; structured `{ error, field? }` errors.

- `GET /api/discover/free-time` — new optional params (smart_match): `when=today|tomorrow|weekend|YYYY-MM-DD` (400 if past/invalid), `partOfDay=morning,afternoon,evening`, `maxPriceCents`, `limit≤12`, `surprise=1`, `exclude=id,…`; (go_solo) `solo=1`. Response shape unchanged; `matchReasons` gain stated reasons.
- `GET /api/discover/collections?county=` → `{ collections: [{ key, title, description, items }] }`.
- `POST|DELETE /api/experiences/:id/sessions/:sessionId/spot-alert`; `GET /api/experiences/spot-alerts/mine`. 409 when places exist, already booked, or not bookable.
- `GET /api/experience/passport` → `{ entries, milestones, memoriesShared }` (private, no-store).
- `GET /api/experience/programmes/:ref/journey` → `{ title, sessions[{date,time,state}], totals }` (owner only; else 404).
- `POST /api/experience/plan-my-day` `{ date, startTime, endTime, maxPriceCents?, county?, mood?, origin?, exclude? }` → `{ stops, totalPriceCents, assumptions, bookable: false }`.
- `GET|POST /api/experience/plans`, `PUT|DELETE /api/experience/plans/:id` (owner only; items validated, same-day, internal hrefs only).
- `GET|POST /api/circles/:id/collaborations`, `POST …/:cid/respond {accept, reason?}`, `POST …/:cid/withdraw` (organisers; partner-only respond).
- `POST /api/games` accepts `collaborationId` (with `circleId`); 409 unless accepted; series refused. Game JSON gains `partnerCircle`.
- Admin: `GET /api/admin/config/feature-switches`, `PUT /api/admin/config/feature-switches/:key` (`platform.settings`, audited). `GET /api/config` gains `experienceFeatures`.

Rate limits on every new write (30–60 per 15 min).
