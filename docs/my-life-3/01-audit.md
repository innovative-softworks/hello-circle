# My Life 3.0 — Phase 0 audit and gap analysis (2026-10-25)

Review page: https://claude.ai/artifact/G5kRn2A46VqHbNykPT56o2 (private to the owner).
Owner direction: keep the current My Life look; adopt the brief's features into it ("don't change, adopt").

## Summary
- 7 brief items already built, 15 partly there, 1 missing; 5 pieces of new server work, each needing approval.
- Phases 1–2 are client-only and use data the app already returns.

## Reuse map (existing → brief)
| Brief | Existing |
|---|---|
| What are you up for? | Explore `mood` (active, move, chill, social, creative), `when` (today/tomorrow/weekend), smart match + go solo (`experience.smart_match`, `go_solo`), Free Time Mode `/free-time`, volunteer experience kind |
| Pulse | `GET /me/needs-attention` (payment_incomplete, waitlist_offered, join_request, circle_invitation, plan_activity_creation, plan_confirmation, open_poll), `GET /follows/feed`, Circle next meetups, notifications inbox (read state) |
| Made for your week / For Me | `GET /discover/for-you` sections with reasons, `components/ForYouSections.tsx`, `GET /discover/next-best`, `GET /discover/new-here` |
| Next moments | My Life cards; `/bookings/:kind/:ref` pages (QR, cancel, reschedule) |
| Plan together | Circle plans (ideas, interest, polls, convert to Session); Plan My Day (`day_plans`) |
| Highlights / Passport | Your activity block; `/my-life/passport` + `GET /api/experience/passport` (`experience.activity_passport`) |
| Bookings & payments | Account → Payments (cards, receipts, passes, credit) — link, don't duplicate |
| Routines | `/me/routines` CRUD, `/me/routine-suggestions` (no reminders sent) |
| Preferences | Account → Interests & discovery, Notifications, Privacy & safety |
| Flags | `circleFeatures.ts` catalogue (`circles.*`, `experience.*`) |
| Analytics | `logEvent` server events (booking_completed, game_joined, circle_joined, activity_saved, attended, repeat_joined, …) |

## Missing / needs server work (approval)
1. D3 Plan Together with friends outside a Circle: plans, participants, options, votes, invites; private by default.
2. D4 Dismiss/read state for Pulse and recommendations (cross-device).
3. Read-only summary of unread Circle discussions across joined Circles.
4. D5 Saved availability alerts and routine reminders (scheduled jobs + notification settings; opt-in).
5. My Life analytics events via the existing analytics path.

## Architecture (D2)
For You (was Overview) · My Plans (was Bookings; Routines inside; Payments link) · My Circles · Saved (Following inside) · Passport (switch-gated). Old `?tab=` keys redirect.

## Decisions requested
D1 keep current look (recommended) · D2 five tabs · D3 Plan Together scope · D4 dismiss storage · D5 new notifications opt-in · D6 `mylife.*` switches (on in dev only).

## Untouched
Stripe/VAT/fees/refunds/settlement, auth/RBAC, booking rules, privacy rules (totals not names), today's style, popups for forms, no drawers. No commit/push/deploy without approval.
