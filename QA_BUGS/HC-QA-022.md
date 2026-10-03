# HC-QA-022 — Chat inbox returns 500 once a resident has two conversations with messages

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/chat.ts buildInbox.
Root cause confirmed: the inbox sort called `bt.localeCompare(at)` on `lastMessage.createdAt`, which mysql2 returns as a `Date` (pool has no `dateStrings`). The comparator only runs with ≥2 items, so it threw TypeError → 500 once two conversations had messages. Fix: order by instant (`getTime()`), newest first, with the global `chat_messages.id` as a same-second tie-breaker; conversations without messages last. Nothing suppressed or filtered.

Verification (isolated QA, real API/MySQL/browser): HC-QA-022 (original) and HC-QA-022-CROSS-SCOPE: 0 → valid empty, 1 → valid, 5 conversations across circle×2/game/club/program returned with correct identity, latest message, unread (2 → 1 after reading one), newest-first order; an inaccessible Circle and other residents' conversations never appear. UI: Circle chat button and /chats work with multiple conversations (LC-UI-DESKTOP-PARTICIPANT).
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-022'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P1. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-022:'`. It must turn green after a fix without editing the assertion.

## Journey
Circle chat (Part 19)

## Expected
GET /api/chat/mine returns 200 with one item per conversation; the Circle page shows its Group chat button; /chats lists conversations; Header unread badge works.

## Actual
GET /api/chat/mine returns 500 as soon as two conversations both have a last message. In the browser the Circle's Group chat button disappears (ListingChatButton swallows the error and renders nothing) and /chats shows no conversations (evidence: lc-ui-desktop-participant chatButtonAfterSecondConversation=0, chatsPageShowsFirstConversation=0). Any active member of two Circles loses chat entry points.

## Likely source
`server/src/routes/chat.ts` buildInbox sorts with `bt.localeCompare(at)` where `lastMessage.createdAt` is a mysql2 `Date` (pool has no `dateStrings`), so the comparator throws TypeError. Pre-existing (route not in the uncommitted diff); not a Stage B regression. Unit tests likely mock string dates.

## Proposed minimum fix (not applied)
Compare timestamps numerically (e.g. `new Date(b).getTime() - new Date(a).getTime()`) or serialize before sorting; add a 2-conversation case to chat tests.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
