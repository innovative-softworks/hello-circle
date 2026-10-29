# 08 · Step 1: protecting existing work (report). STOPPED before Phase 1

**Date:** 2026-10-28 16:40 IST.
**Result:** Step 1 is complete. **Step 2 hasn't started**, because a stop condition applies (§5).

Nothing was staged, stashed, discarded, committed, pushed or merged. No worktree or branch was created, and no code,
schema or data was changed. The only files written are this report and the backup in §1.

## 1. Backup (non-destructive copy)
`/private/tmp/claude-501/-Users-gopaallyamala-Documents-Isoftworks-HelloCircle-hello-circle/0712063f-c2aa-4b45-9f12-c19ad676198a/scratchpad/wt-backup-20261028-1639/`

| File | Content |
|---|---|
| `HEAD.txt` | `473dbfa…` (the commit the patch applies to) |
| `status-uall.txt` | 213 entries (the 212 files plus `07-phase1-preparation.md`) |
| `tracked.patch` | `git diff --binary` of all 92 modified tracked files (375 KB). **Verified:** `git apply --check --reverse` passes against the working tree |
| `untracked.tgz` | All 121 untracked files (30 MB, mostly screenshots) |

To restore onto `473dbfa`: `git apply tracked.patch && tar -xzf untracked.tgz`. The scratchpad is session storage,
so copy the folder somewhere permanent if you want to keep it.

## 2. Inventory
- **213 entries** (`git status -uall`): 92 modified tracked files (+2,586 / −1,060), 121 untracked files.
- **Last edit outside these docs:** 13:04 today (`docs/trust-retention/06-next-plan-journey.md`). Nothing has been
  edited in the last 3.5 hours.
- **Dev servers running** from the main checkout: two `tsx watch` + `vite` pairs (PIDs 8977/8978, 12109/12110). I
  left them alone.
- **Type check of the combined tree:** `server tsc --noEmit` exit 0 and `client tsc --noEmit` exit 0. The tree is
  internally consistent.

## 3. Which changes are already in `origin/staging`
**None of streams A–G.**
- Every new module (e.g. `reviewEligibility.ts`, `verification.ts`, `cardWord.ts`, `exploreFilters.ts`,
  `BoardingPass.tsx`) is missing from every remote branch (`origin/staging`, `origin/main`,
  `origin/feature/*`).
- `origin/staging` (`ba913af`) contains exactly this branch's committed history (PR #15).
- **Open PRs:** 0 (GitHub API, public repo, read-only). There's no PR carrying this work.

## 4. Dependencies among streams (from imports)
The streams **can't be separated file by file**. Several files carry two streams at once:

| File | Streams | Evidence |
|---|---|---|
| `server/src/routes/games.ts` | A + B (+F) | imports `myLifePlans`, `newcomerWelcome` (A) and `categoryLabels` (B) |
| `server/src/routes/experiences.ts` | A + B (+F) | `verification` (A), `categoryLabels` (B) |
| `server/src/routes/programs.ts` | A + B | `verification` (A), `categoryLabels` (B) |
| `server/src/index.ts` | A + E | trust routers and sweep (A); `dotenv/config` first (E) |
| `client/src/pages/BookingDetailPage.tsx` | A + D | `trust/AfterYourVisit`, `VenueGetReady` (A); `BoardingPass` (D) |
| `client/src/components/mylife/NextPlan.tsx` | A depends on D | imports `pass/BoardingPass` |
| `client/src/pages/Explore.tsx`, `ExperienceSearchCard.tsx` | B + C | `cardWord` (B), `exploreFilters` (C) |
| `client/src/pages/ExperienceDetail.tsx`, `CentreDetail`, `ClubDetail`, `ProgramDetail`, `GameDetail` | A (+F) | `trust/WhatToExpect` |

The integration order would have to be **D, then B, then C, then A**. E, F and G can go anywhere, and the mixed files
go with A, the last stream they depend on.

## 5. Why I stopped
Option A says to "safely preserve and **integrate** existing streams before starting Phase 1 from an appropriate
`origin/staging` baseline". Two things block that:
1. **Integrating means committing (and pushing, so the work reaches `origin/staging`).** The same instruction says not
   to do that automatically, and the work isn't mine (see memory: owner runs parallel sessions).
2. **`origin/staging` is missing required changes.** Phase 1 has to edit 17 of these same files, so starting from
   today's `origin/staging` is effectively Option B, which wasn't chosen.

Both match the stop conditions ("branch ownership or integration is unclear"; "the selected baseline is missing
required changes").

## 6. What would unblock Phase 1 (pick one)

| Choice | What happens | Who does it |
|---|---|---|
| **1. You land the streams** (recommended if these sessions are yours) | You commit streams A–G however you like, push, and merge a PR into `staging`. I then create `../hello-circle-participation-p1` on `feature/participation-phase1` from the updated `origin/staging` and start Phase 1 | You |
| **2. Authorise me to integrate them** | On a new local branch `integration/streams-2026-10-28` from `473dbfa`, I make four commits in dependency order: (1) D booking pass, (2) B cards + C explore, (3) A trust incl. the mixed files + E dotenv + F/G, (4) docs. `.DS_Store` stays out. I run the server and client suites (isolated profile), report, then push and open a PR to `staging` **only if you also authorise the push**. Phase 1 starts from `origin/staging` after you merge | Me, with your explicit "commit" (and "push") for these streams |
| **3. Switch to Option B** | Phase 1 worktree from `origin/staging` now; the streams stay uncommitted in your checkout; rebase and resolve the 17 overlapping files later | Me, after you change the decision |

Until you choose, the working tree stays exactly as it is.
