# Circles 3.1 — 09 Security review

| Threat (brief §16) | Control | Evidence |
|---|---|---|
| Unauthorised listing creation | Partner types go through the partner session and its existing role checks; activities through `POST /api/games` rules | unchanged routes; dialog hides what you can't do |
| Unauthorised Circle linking | `addListingLink` requires membership; organisers approve | tests (403) |
| Cross-Circle / private access | approval/invite Circles' links members-only; private activity only linkable to its own Circle; listings resolved per viewer | tests |
| Forged Circle / listing ids | server lookups; forged Circle on `shareToCircleId` → 403 **before** creating | tests |
| Duplicate submissions / concurrency | unique key + `FOR UPDATE` | concurrency test |
| Approval bypass | status set server-side from the caller's role | tests |
| Ownership manipulation | links never write to listing tables; official Circle only via the existing org-checked route | code |
| Unauthorised link removal | organiser or the person who linked it; admin with `reports.moderate` + reason | test (403) + admin permission walk |
| Suspended / cancelled listings | live resolution (`orgActiveSql`, status) | test (cancelled) |
