# HelloCircle — Performance QA (Phase 10)

Measured first; nothing was optimised.

**Environment**
- The isolated exploration stack: tmpfs MySQL 8.0, backend run with `tsx` (dev, uncompiled), and a production client build made with the isolated Vite config and served single-origin by the backend.
- Volumes: first the demo seed (35 venues, a handful of activities). Then a **bulk volume** inserted into the throwaway DB only: 2,005 activities, 303 Circles, 3,004 chat messages, 2,002 notifications.
- Numbers are lab measurements on a laptop, not field data.

## Frontend

| Metric | Result |
|---|---|
| Main bundle | `index-*.js` 340 kB (100 kB gzip); CSS 19 kB |
| Largest chunks | `mapbox-gl` 1.88 MB (528 kB gzip, lazy, only when maps enabled); `googleSignIn` 158 kB (loaded on Home for anonymous visitors even when Firebase is unconfigured, 074); AdminDashboard 67 kB; VendorDashboard 58 kB |
| Route code-splitting | Yes (`lazy()` per page) |

Core Web Vitals, production build, Chromium with 4× CPU throttle and 150 ms latency:

| Page | Mobile FCP / LCP / CLS | Desktop FCP / LCP / CLS | Transfer |
|---|---|---|---|
| `/` landing | 4.0 s / **5.8 s** / 0.006 | 3.6 s / 4.1 s / **0.229** | 386 KB |
| `/home` | 3.3 s / **5.7 s** / **0.281** | 2.7 s / 4.0 s / **0.226** | **2.9 MB** |
| `/explore` | 3.5 s / 3.5 s / **0.428** | 3.0 s / 3.0 s / 0.055 | 506 KB |
| `/games` (2k rows) | 3.3 s / 3.3 s / **0.278** | 3.7 s / 3.7 s / 0.189 | **2.5 MB** |
| Activity detail | 2.6 s / 2.6 s / **0.222** | 1.3 s / 1.3 s / 0.148 | **2.4 MB** |
| Circle detail | 1.9 s / 3.1 s / **0.224** | 0.8 s / 2.0 s / 0.199 | 649 KB |
| Adventure detail | 3.4 s / 3.4 s / **0.227** | 0.8 s / 0.8 s / 0.205 | 450 KB |
| My Life | 2.4 s / 2.4 s / **0.231** | 0.8 s / 2.2 s / 0.091 | 619 KB (23 API calls) |
| Vendor dashboard | 2.1 s / 2.1 s / **0.225** | 0.8 s / 0.8 s / 0.042 | 696 KB |

**INP:** NOT MEASURED. Interaction latency needs field or trace data; the lab proxy attempt didn't produce a reliable value.

## API (single user)

| Endpoint | Demo volume p50 | Bulk volume p50 / p95 | Size at bulk |
|---|---|---|---|
| `/api/discover` | 3 ms | 27 / 62 ms | 49 KB |
| `/api/search?q=badminton` | 16 ms | 88 / 126 ms | 161 KB |
| `/api/games` | 1.6 ms | **321 / 337 ms** | **1.96 MB, 2,003 rows, unbounded** |
| `/api/circles` | 2.9 ms | **231 / 295 ms** | 191 KB, 303 rows, unbounded |
| `/api/centres`, `/api/clubs` | 6–7 ms | 6–8 ms | 25–27 KB |
| `/api/games/:id`, `/api/circles/:id` | 1–2 ms | 2 ms | ~1 KB |
| `/api/residents/me/notifications` | — | 6.5 ms | 322 KB, 2,001 rows, unbounded |
| Circle chat messages | — | 4.6 ms | capped at 200 (good) |

N+1 patterns, confirmed in code and by timing scaling linearly with rows (073):
- `routes/games.ts:202` `Promise.all(rows.map(toGameJson))`, about 4 awaits per row.
- `routes/circles.ts:276-281` `canViewCircleFull` + `toCircleJson` per row.

Repeated or unnecessary calls (074):
- Full `/api/games` fetched by Home and every activity detail page.
- Full county Circle list fetched by Circle detail.
- Participants fetched twice on activity detail; centres twice on Home.
- Five 401-ing authenticated calls on every anonymous page.

## Database

- **Pool:** `connectionLimit: 10`; held steady at 11 server connections under load (pool plus the observer).
- No slow-query log was enabled in the isolated container.
- Inferred from code and timing:
  - Cost scales with rows because of per-row queries (073).
  - List endpoints have no `LIMIT` or cursor.
  - Search does broad matching (p95 6.5 s at 50 concurrent).
- No index changes were made. Before adding indexes, confirm with `EXPLAIN` on the list and search queries at realistic volume; the N+1 dominates today.

## Images

Covered with details in HC-QA-084:
- The Photo component serves one URL per variant: `loading="lazy"` by default, `eager` for heroes, no `srcset`/`sizes`. Absolute positioning inside an aspect-ratio box means images themselves cause no layout shift.
- Heroes are hot-linked from images.unsplash.com at w=1600–1920 for every viewport.
- `/become-a-host` serves a 2000 px AVIF into a 390 px slot.
- Local-mode uploads aren't resized.
- The R2 / AVIF variant pipeline is **BLOCKED**: it needs R2, which is not available in isolation.

## Load (local, isolated)

Mixed browse/search/detail traffic, 20 s per level, no logins or payments (076):

| Users | Throughput | p50 | p95 | Max | Errors |
|---|---|---|---|---|---|
| 10 | 20 rps | 399 ms | 1,260 ms | 1.9 s | 0 |
| 25 | 17 rps | 1,274 ms | 4,162 ms | 5.3 s | 0 |
| 50 | 23 rps | 1,833 ms | 5,773 ms | 6.7 s | 0 |

- CPU sat at about 90% of one core. RSS went from 411 MB to 1.09 GB and stayed there after the load ended (re-check on a compiled build).
- Capacity integrity under concurrency is covered by the booking gate's race tests (6-way races → exactly 1, PASS). Payments were not load-tested.

## Top 5 bottlenecks

1. Unbounded list endpoints with per-row queries: `/api/games`, `/api/circles`, notifications (073).
2. Pages that download whole lists to show a few items: Home, activity detail, Circle detail (074).
3. CLS ~0.22 on almost every route; the footer paints before route content (075).
4. Mobile LCP 5–6 s on landing and Home: large hero images from a third-party host, 2.9 MB transfer (074, 084).
5. Single-process CPU saturation around 20 rps, and search latency under concurrency (076).
