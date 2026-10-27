# Circles 3.1 — 03 Architecture

Three operations, three paths — never one ambiguous action:

1. **Create listing** — the listing's existing create page and API, unchanged. The Circle is carried as `?circleId`
   (partner pages → official `circle_id` via the existing participation route, which only accepts Circles the org
   organises) or `circleId` / `shareToCircleId` on `POST /api/games`. Nothing trusts the URL: the server re-checks.
2. **Link listing** — new `circle_listing_links` (one table for every type): `circle_id, listing_type, listing_id,
   relationship (shared | created_for), status (pending | approved | declined | removed), note, linked_by,
   decided_by/at, removed_by/at`, `UNIQUE(circle_id, listing_type, listing_id)`. A listing can be linked to any number of
   Circles, once each. Removing sets `removed` (the row and the listing stay); re-linking reopens the same row.
   Official Circles (`experiences|programs|clubs.circle_id`) are read alongside as `official`, read-only.
3. **Create plan** — Circles 3.0 `circle_plans` (with `listing_*`). "Plan together" on a link creates a plan; a link is
   never a plan and never a booking.

Listing state is always read live (`resolvePlanListing`, same filters as the listing's public page), so cancellation,
unpublishing and organisation suspension show immediately; visitors of an open Circle never see restricted or
unavailable listings. Create-then-link: the activity is committed first; if the link fails the response says so
(`circleLink.ok = false`) and `POST /api/circles/:id/links` retries safely (unique key → no duplicate link, the
activity isn't re-created). Concurrency: `SELECT … FOR UPDATE` on the link key inside a transaction.
