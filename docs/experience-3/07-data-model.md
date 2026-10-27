# Experience 3.0 — 07 Data model (additive, `initSchema()`)

| Table / column | Purpose | Keys |
|---|---|---|
| `experience_spot_alerts` | one alert per person per departure | UNIQUE (session_id, resident_id); open-alert index |
| `day_plans` | saved Plan My Day plans (items JSON, ≤4 stops, ≤50 plans/person) | index (resident_id, date) |
| `circle_collaborations` | Circle-to-Circle proposals and their state | indexes on proposer/partner + status |
| `games.partner_circle_id` | partner Circle of a shared activity | — |
| app_settings keys | 8 `experience.*` + `circles.collaboration` | — |

No foreign keys (project convention). No migration touches existing rows. Retention: spot alerts expire at the
departure; saved plans until the resident deletes them; erasure of these tables waits on D-07 like everything else.
