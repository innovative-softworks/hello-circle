# Circles 3.1 — 08 Test results (2026-10-28, local)

| Check | Result |
|---|---|
| `server/src/routes/circleLinks.test.ts` (new, isolated Docker MySQL) | pass — member link pending, organiser-only approve (403/409), visitor can't see pending, one link per Circle+listing under concurrency (201/409, 1 row), one listing in 3 Circles (3 links, 1 listing), remove ends only that link + re-link reopens the row, non-member/forged ids refused, approval Circle members-only (403), cancelled listing reads cancelled, member "activity for this Circle" → activity + pending `created_for` link (not official), forged Circle creates nothing |
| Full server suite (isolated) | **129 / 129 files, 1183 pass**, 23 skipped (live-provider) |
| Client tests | 321 / 321 |
| Typecheck client + server | clean |
| Production build (`npm run build`) | builds (existing chunk-size warning only) |
| Browser, dev DB, 1280 + 375 | Member: Create or organise (shows only possible actions; partner types explained) → Link something → search "glendalough" → Suggest to organisers → shows under "Waiting for an organiser". Organiser (temporary dev session): Approve → shows with "Linked by…", live listing block, Plan together, Remove. 375px: no overflow. No console errors. Test link, notifications, audit rows and the temporary session removed |

Not exercised in a browser: partner create-from-Circle (no dev resident who organises a Circle *and* has an approved
linked partner account) — covered by typecheck and the unchanged participation-route rules; volunteering (no dev listing
with dates); venue pages (gated). The guarded Playwright suites were not run.
