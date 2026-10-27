# Circles 3.1 — 06 Database and API

**Migration** (additive, `initSchema`): `CREATE TABLE IF NOT EXISTS circle_listing_links (…)` with
`UNIQUE KEY uq_circle_listing (circle_id, listing_type, listing_id)`, `idx_circle_links_status`, `idx_circle_links_listing`.
No backfill, no foreign keys (convention). Rollback: drop the table; nothing else references it.

| Endpoint | Notes |
|---|---|
| `GET /api/circles/:id/links` | visitors (open Circles), members, organisers; includes `official` partner listings |
| `POST /api/circles/:id/links` `{ listing: { type, id }, note? }` | 201 `{ id, status }`; 400 bad ref; 403 non-member; 404 not visible / no Circle; 409 finished, private elsewhere, already linked (`linkId`), closed |
| `POST /api/circles/:id/links/:linkId/approve` · `/decline` | organiser; 409 when already decided |
| `DELETE /api/circles/:id/links/:linkId` | organiser or the person who linked it; ends the link only |
| `POST /api/games` `+ shareToCircleId` | 403 before creating if not a member; response `circleLink: { ok, status? , error? }` |
| `GET /api/admin/operations/circles/:id/planning` | now also `links` |
| `POST /api/admin/operations/circles/:id/links/:linkId/remove` | `reports.moderate`, reason ≥ 10, organisers told, audited |

Client: `fetchCircleLinks`, `linkListingToCircle`, `decideCircleLink`, `removeCircleLink` (`api/resident.ts`),
`adminRemoveCircleLink` (`api/admin.ts`); components `CreateOrOrganise.tsx`, `LinkListingDialog.tsx`,
`CircleLinkedListings.tsx`, `CircleCreationBanner.tsx`; `CreateGameInput.shareToCircleId`.
