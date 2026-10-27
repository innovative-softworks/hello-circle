# 06 — Join and onboarding flow

- **Signed out**: Join → `?join=1` is added to the current URL → sign-in with `returnTo` → back on the Circle, `CircleJoinCard` sees `autoJoin` and opens the join step (confirm or request form). The parameter is removed afterwards.
- **Open Circle**: confirm dialog → `POST /api/circles/:id/join` → reload → member Home. Success is shown only after the server confirms (the page reloads membership); errors show inline (`joinError`).
- **Approval Circle**: request form with the organiser's questions and an optional note → pending. Duplicate requests are prevented by the server; the page never prompts again and offers "Withdraw request".
- **Other "Join" buttons** on the page (community preview, closing band, side panel, phone bar) all start the same flow through `joinSignal`.
- **Welcome**: the existing one-time `CircleWelcomePanel` ("Welcome to {Circle}.") with next steps (upcoming activities, introduce yourself, guidelines when present). Not a wizard; "Got it" dismisses it for good.
- **Analytics** (existing `trackEvent`, consent-gated): `circle_join_clicked`, `circle_join_completed`, `circle_join_request_submitted`, `circle_highlights_viewed`, `circle_activity_preview_opened`. Server events unchanged (`circle_viewed`, `circle_joined`, `circle_join_requested`). No new tracking infrastructure.
