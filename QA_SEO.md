# HelloCircle — SEO QA (Phase 10)

**Method:** the server-rendered HTML was fetched from the production client build served by the backend with `VITE_LAUNCH_MODE=public`. `server/src/ogMeta.ts` injects meta per route at request time; the SPA itself never updates the title (065).

## Public pages

| Page | HTTP | robots | Title | Canonical | OG | JSON-LD |
|---|---|---|---|---|---|---|
| `/` | 200 | index, follow | Hello Circle — community centres & sports clubs in Ireland | `/` | title/desc/type/url | Organization |
| `/games` | 200 | index, follow | Join a pickup session — HelloCircle | `/games` | ✔ | — |
| Activity `/games/:id` | 200 | index, follow | "Five-a-side football — HelloCircle" | `/games/:id` | ✔ + image | Event, Place |
| Open Circle | 200 | index, follow | "Clontarf Badminton Circle — HelloCircle" | slug canonical | ✔ + image | Organization |
| Adventure | 200 | index, follow | listing title | slug canonical | ✔ + image | — (086) |
| Programme | 200 | index, follow | listing title | UUID canonical | ✔ + image | — (086) |
| Provider profile | 200 | index, follow | business name | ✔ | ✔ + image | — |
| Local landing `/dublin/badminton` | 200 | index, follow | "badminton in Dublin — HelloCircle" (casing, 086) | ✔ | ✔ | — |
| Centre `/centres/:id` | 200 | **index, follow** | listing | slug | ✔ | LocalBusiness — **but the client redirects to /coming-soon (060)** |

`<meta name="description">` is the same generic sentence on every page; only `og:description` varies (086).

## Private / draft / invite-only content

| Content | Result |
|---|---|
| Draft activity | **404, noindex** ✔ |
| Approval-only Circle | **noindex, nofollow**, title "Private Circle — HelloCircle", no image, no JSON-LD ✔ |
| My Life, profile, manage, vendor, admin, signin, payment, invites (`/i/`) | Disallowed in robots.txt and noindex ✔ |
| Unknown route | NotFound UI, noindex, but **HTTP 200** (soft 404, 086) |
| Unverified host profile | 404, noindex ✔ (links only rendered for verified hosts) |

## Sitemap

- `/sitemap.xml` 200, 2,351 URLs at bulk volume:
  - activities 2,004, Circles 303, clubs 18, centres 17, browse 2;
  - experiences, adventures, programs, provider, plus the home and explore pages.
- Only public, open, active content: draft activities excluded, approval Circles excluded.
- **Problem:** it includes the venue-gated pages (060).
- At real volume a sitemap index will be needed (more than 50,000 URLs, or a 50 MB file).

## robots.txt (public launch mode)

Disallows `/manage`, `/vendor/` (allows `/vendor/signup`), `/admin`, `/profile`, `/bookings`, `/my-life`, `/signin`, `/login`, password and invite flows, `/payment/`, `/book/`, `/register/`, `/games/host`, `/circles/start`, `/i/`. References the sitemap. In pre-launch mode, only marketing pages are allowed (by design).

**Social preview:** the OG and Twitter card tags are present, with images on detail pages. Rendering on real social platforms was not checked (requires public URLs).
