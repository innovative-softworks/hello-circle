# Circles 3.1 — 07 Implementation log (2026-10-28)

| ID | Change | Files | Migration | Tests | Status |
|---|---|---|---|---|---|
| G1/G2 | `circle_listing_links` + routes, organiser approval, notifications (organisers on a member suggestion; members once when a link goes live; linker on decision) | `server/src/routes/circleLinks.ts` (new), `index.ts`, `db/index.ts` | new table | `circleLinks.test.ts` | Done |
| G3 | Create or organise dialog | `components/circle/CreateOrOrganise.tsx` (new), `pages/CircleDetail.tsx` | — | browser | Done |
| G4 | Partner create pages carry the Circle (`?circleId`, `?kind`), banner, attach on first save, retry | `CircleCreationBanner.tsx` (new), `VendorExperienceEditPage.tsx`, `VendorProgramEditPage.tsx`, `ExperienceCreationWizard.tsx` | — | typecheck | Done (not browser-run, see 08) |
| G5 | Member "activity for this Circle" | `routes/games.ts`, `HostGamePage.tsx`, `api/resident.ts` | — | 2 tests | Done |
| G6 | Linked section | `CircleLinkedListings.tsx` (new), `CirclePlanListing.tsx` | — | browser | Done |
| G7 | Admin links review/removal | `adminOperations.ts`, `AdminOperations.tsx`, `api/admin.ts` | — | admin permission walk | Done |
| G8 | Share vs Plan on listing pages | `PlanWithCircle.tsx` | — | typecheck | Done |
