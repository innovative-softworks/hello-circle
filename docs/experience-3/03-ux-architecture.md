# Experience 3.0 — 03 UX architecture

Journey: **Discover** (Explore collections, Free Time Mode + Find something for me, Surprise me, Going solo) →
**Plan** (Plan My Day, Circle plans, Circle-to-Circle) → **Join or book** (existing flows only) → **Prepare** (Get
ready on the booking page) → **Participate** → **Remember** (Activity Passport, Circle Memories) → **Next**
(For You, Worth doing again, spot alerts).

| Surface | Route | Pattern |
|---|---|---|
| Free Time Mode results + refine + Surprise me | `/free-time` | existing wizard; refine chips; Surprise in a centred dialog |
| Explore collections | `/explore` | rails under the existing feed, each hidden when empty |
| Spot alert | `/adventures/:id`, `/experiences/:id` | text action under each full departure |
| Get ready / Your sessions | `/bookings/:kind/:ref` | sections under the booking panel |
| Activity Passport | `/my-life/passport` (+ My Life teaser) | full page, editorial timeline by year |
| Plan My Day | `/plan-my-day` (+ My Life "My plans") | 70/30: form left, the day right |
| Circle-to-Circle | `/manage/circles/:id?tab=ideas` | section in Pulse & proposals; propose in a centred dialog |
| Partner on an activity | `/games/:id` | "Together with {Circle}" chip |

No side drawers. Explore menu items are unchanged (owner froze them); Plan My Day is reached from Free Time Mode and
My Life.
