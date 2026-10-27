# 09 — QA results (2026-10-24)

| Suite | Result |
|---|---|
| Server (isolated Docker profile) | 1,135 passed, 23 skipped — incl. 5 new visitor tests |
| Client unit | 321 passed |
| Production build | passes |
| `product-circle-visitor-4` (new) | passed — signed-out view + join keeps intent (`returnTo` has `join=1`); approval request → pending, no further prompts, withdraw offered; `?join=1` → join → welcome + Next up; visitor data has no member ids and no counts for approval; phone no horizontal scroll; switch off → old page |
| Circle regression (switch off in QA): product-circle-experience-2, product-circles-a/b/c, product-gaps-circle, lifecycle-circle-membership, lifecycle-circle-planning, lifecycle-findings-circles, lifecycle-ui-desktop, lifecycle-ui-responsive, stage-b-circles | all passed |

## Screenshots (`screenshots/`)
- Before: 01 open signed-out (desktop), 02 approval non-member, 03 open signed-out (phone).
- After: 04 open signed-out (desktop, full page), 05 phone, 06 approval non-member, 07 request form, 08 pending, 09 new Circle visitor, 10 new Circle organiser setup, 11 member Home unchanged, 12 approval on phone, 13 successful join → welcome.

No real emails were sent (SMTP blank), no payments, no production data touched; QA ran in the isolated container; dev screenshots used `hello_circle_dev` fixtures.
