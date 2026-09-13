# Document 12 — Status & State Transition Model

Every literal status value found in code, not inferred names.

### Booking / Registration
```
pending → paid / failed
(active, implicit) → cancelled
```
Two independent columns, deliberately — cancellation can never race the Stripe webhook.

### Game
```
pending_participants → open → cancelled
```
No `completed` state exists — a past-dated game is filtered out of "upcoming" queries, never transitioned.

### Game participant
```
pending_payment → joined
```
Attendance is a separate tri-state: `NULL` (unconfirmed) / `0` / `1`, self-reported.

### Circle
```
active → closed
```
No re-open route, no hard delete. Membership itself has no status — a row simply exists or doesn't.

### Circle invite / join request
```
pending → accepted / declined
```

### Program
```
draft → published → paused → archived
```

### Program enrollment
```
confirmed
```
Inserted directly at this status; no further transition (including cancellation) exists anywhere in the router — see [Doc 20](20-gap-analysis.md).

### Pass
```
pending → paid
```
Expiry and exhaustion are computed at redemption time, never written back as a status.

### Centre / Club / Experience (listing)
```
pending → approved / rejected / deleted
```

### Vendor account
```
pending → approved / suspended
```

### Favourite
```
interested → planning → joined
```
One-way upgrade path only — never auto-downgraded.

### Waitlist entry
```
waiting → offered → claimed / expired
```

### Report
```
pending → dismissed / actioned / suspended
```
`suspended` triggers a real cascade (e.g. auto-closing a circle or hiding a review), not just a label.

### Review
```
visible → hidden
```
Admin soft-hide only — no hard delete, no edit route.

---
[← Data & Domain Model](11-data-domain-model.md) · [Next: Search & Discovery →](13-search-discovery.md)
