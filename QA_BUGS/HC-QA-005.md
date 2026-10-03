# HC-QA-005 — Favourites hydration bypasses private draft visibility

Status: FIXED LOCALLY — NOT DEPLOYED. Severity / priority: P1. Historical reproduction below remains evidence.

## Fix and verification

Latest defensive revalidation: original HC-QA-005 and activity transition tests
pass unchanged. Added a club-session hydration regression (approved -> pending ->
approved parent; favourite row unchanged). It reproduced a 500 caused by `cl.status`
against a `clubs c` join, then passed after correcting only the SQL alias to `c`.
This is an adjacent remediation regression, not a visibility bypass acceptance.
Narrow host-profile/Circle/discovery source-review gaps are documented in
QA_INVITATION_SECURITY_REVIEW.md; no claim that all aggregation paths are certified.

Affected files: server/src/gameVisibility.ts; routes/games.ts, sharing.ts, favourites.ts, follows.ts. A shared viewer-aware activity visibility predicate now protects canonical detail, favourites and host-follow feed. Saved relations are retained; inaccessible/missing resource projections are omitted. Other favourites hydration applies approval/parent gates; private Circle raw cover URLs are never emitted.

Before: original regression failed, 404 detail yet 201 save/200 favourites exposed title and schedule. After: SAME regression passes. Adjacent real API/DB tests cover public activity, own/foreign draft, public-to-private/draft revocation, future scheduled publication, public archived/cancelled history, old unannounced drafts and removed records. Relation snapshots remain unchanged. The host-follow feed omits inaccessible activity metadata. Cancelled/archived public records remain visible as canonical detail allows; these are not assumed private merely by status.

Residual risk: this is not blanket aggregation certification. Source review found Circle upcoming/summary and other query paths needing targeted testing; these are tracked separately during authorization completion, not hidden by this fix. Live deployment and production results remain unverified.

## Phase 5 proposed minimal remediation

The favourites relation is self-scoped but attachListingDetails independently queries resources without authorization. Detail uses canViewPrivateGame plus effective draft visibility. Extract that existing rule into a small shared gameVisibility module and call it from detail, favourites and the host-follow feed (the latter has the same missing filter). Keep exports compatible with current consumers. Omit unavailable rows rather than returning their IDs/metadata; retain favourite relations so restoring visibility restores the saved item. Apply approval/parent-publication gates to the other hydrated listing types, and omit restricted Circles for non-members; never emit raw private Circle cover URLs. No resource deletion, UI redesign or blanket lifecycle exclusion: canonical public archived/cancelled detail remains readable.

Adjacent regression will compare favourites with canonical detail for public, own draft, foreign draft, scheduled/unpublished, archived/cancelled and removed activities; verify visibility revocation after saving; preserve relation rows; and check host-follow feed cannot disclose private drafts. Related source review includes search/discover queries, Circle activity aggregation, host profiles, vendor scoping and notifications. New unrelated defects are not implicitly authorized for remediation.

Affected resource: private draft resident-host activity (`games`). Endpoints: POST /api/favourites and GET /api/favourites. Required role: authenticated resident who knows the resource ID. Victim: another resident/host. API vulnerability demonstrated; browser rendering of the disclosure not yet independently reproduced.

## Safe reproduction

`npm run qa:authorization -- --grep IDOR-LEAKAGE`

1. Host A creates a synthetic activity with lifecycle=draft and visibility=invite using the real API.
2. Resident B requests GET /api/games/:id: 404, correctly withholding the draft.
3. B posts `{listingType: "game", listingId: <fixture ID>}` to /api/favourites.
4. B reads /api/favourites.

Expected: saving should reject inaccessible resources, or hydration must redact/omit their confidential metadata. Knowledge of an ID is not read permission.

Actual: save returns 201; list returns 200 including the victim's exact confidential title and date/time subtitle. Direct detail remains protected. No ID enumeration or arbitrary ID guessing was needed or attempted.

Database evidence: full victim game row remains unchanged. Only the attacker's scoped saved reference is added. Sanitized evidence `.qa-data/<run>/evidence/hc-qa-005.json` records statuses and disclosure booleans, never actual private data. Fixture rows are removed via guarded exact-ID cleanup.

## Cause and remediation recommendation

favourites.ts accepts any supported listing type/ID and `attachListingDetails` hydrates games by ID without applying lifecycle/visibility/ownership checks. This is a separate read path from games.ts's protected detail handler.

Apply canonical viewer-aware visibility to saved-item hydration and validate additions. Recheck on every read because access can change after saving. Review other hydration types (especially restricted Circle media) in a scoped follow-up; broader disclosure is not claimed by this reproduction.

Regression required/preserved: YES, authorization-leakage.spec.ts, intentionally failing. No application remediation in this checkpoint. No credential, ownership, role or payment compromise demonstrated; not P0.
