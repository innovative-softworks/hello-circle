# HC-QA-055 — Chat composer silently discards text typed while a message is sending

Severity: P2. Category: DATA. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Chat modal (Circle chat; shared ChatModal for all scopes)
- **Actor:** Circle member
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Open a Circle chat.
2. Send a message, then immediately type and send the next one (5 quick messages).
3. Reload the chat.

- **Expected:** Every message the user typed is either sent or kept in the box.
- **Actual:** Only 2 of 5 rapid messages were persisted ('rapid 1', 'rapid 4'). While sending, Enter is ignored, and when the in-flight send completes setDraft('') wipes whatever the user typed in the meantime.
- **Evidence:** components/ChatModal.tsx:117-133 (if (!body || sending) return; … setDraft('') after await); DB chat_messages ids 3-4 only; Playwright run chat1.mjs.
- **Root cause (if known):** Draft is cleared unconditionally after the request instead of clearing the sent text at send time.
- **Why this severity:** Regression check: HC-QA-022 (inbox ordering) unaffected; this is composer-side.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Composer ignored Enter while a send was in flight and cleared the box when that send completed, wiping text typed meanwhile.
- **Fix:** Ordered send queue: text leaves the box at send time, messages post sequentially in order, a failed message returns to the box ahead of newer typing with an announced error; Send no longer disabled during sends. (`components/ChatModal.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-055` (5 rapid sends with 400 ms latency) FAIL before → PASS (5 persisted, in order, box empty). `-FAILURE`: failed send keeps both the failed and the newer text. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** ChatModal is shared by every chat scope (Circle, activity, club, programme, experience), so all inherit the fix; HC-QA-022 lifecycle chat gate still green.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
