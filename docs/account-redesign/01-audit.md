# Account, Profile, Settings & My Life — audit (Batch 1)

Date: 2026-10-24 · Branch: `feature/circles-and-experience-3` (uncommitted working tree) · Read-only audit, nothing changed yet.

## 1. What exists today

All 16 account sections live in **one file, `client/src/pages/Profile.tsx` (1,856 lines)**, inside `ManageShell`, the
sidebar shell built for the vendor/admin dashboards. The section is picked with `/profile?tab=<key>` (`useUrlTab`).

| Nav label | `?tab=` key | Component | Server API used |
|---|---|---|---|
| Profile details | `account` | `AccountDetailsPanel` (+ `ProfilePhotoRow`) | `GET /residents/me/full`, `PUT /residents/me`, avatar upload/remove, password, Google link, resend verification, export, privacy requests, deactivate |
| Notification settings | `notificationPrefs` | `NotificationPrefsPanel` | `PUT /residents/me/notification-prefs` |
| Interests & Discovery | `preferences` | `ParticipationPreferencesPanel` + `AvailabilityPicker` | `saveOnboarding`, `clearPreferences` |
| Privacy & accessibility | `privacy` | `PrivacyAccessibilityPanel` | accessibility prefs, privacy prefs |
| Payment methods | `payment` | `PaymentMethodsPanel` | list / set default / remove (Stripe) |
| HelloCircle credit | `credit` | `CreditWallet` (only when credits are on) | `fetchMyCredits` |
| Household | `household` | `HouseholdPanel` | household CRUD |
| Saved | `favourites` | `FavouritesPanel` | favourites list / status / remove |
| Following | `following` | `FollowingPanel` | follows, notification level, unfollow |
| Routines | `routines` | `RoutinesPanel` | routines + suggestions |
| Passes | `passes` | `PassesPanel` | `fetchMyPasses` |
| Receipts | `receipts` | `ReceiptsPanel` → `/receipts/:ref` page | `fetchReceipts` |
| Notifications | `inbox` | `NotificationInboxPanel` | paged inbox, mark read |
| Become a host | `hosting` | `HostingPanel` = link + `HostApplicationPanel` + `BecomeProviderPanel` + `SearchAlertsPanel` | host apply/update, become-provider, search alerts |
| Safety Centre | `safety` | `SafetyCentrePanel` | blocked people, my reports |
| Help & Support | `help` | `HelpSupportPanel` (5 static FAQs + mailto) | none |

About 20 places deep-link into these keys: header account menu, footer, notification links, My Life, Circle detail, SmartMatch,
the receipt page and the help guide. **Every key must keep working.**

My Life (`/bookings`, also `/my-life`, `MyBookings.tsx`) shows previews of Saved and Following (`MyLifeSaved`, `MyLifeFollowing`).
Those previews are a second, separate implementation of the same lists.

## 2. Findings by severity

### P0: the page says something the system doesn't do (trust)

| # | Page | Finding | Evidence |
|---|---|---|---|
| A-01 | Notification settings | **7 of the 10 switches do nothing.** The server only reads `waitlistOffers`, `intentMatches` and `marketing`. `bookingConfirmations`, `bookingReminders`, `activityReminders`, `routineReminders`, `openSpots`, `recommendations` and `circleAnnouncements` are saved but never read anywhere. | `server/src/notifications.ts` `PREF_KEY_BY_KIND`; repo-wide grep for each key |
| A-02 | Notification settings | "Booking confirmations" can be switched off, but confirmations are transactional and always sent. That makes the switch misleading. | as above |
| A-03 | Notification settings | No per-channel control exists. One setting covers in-app + push (+ the waitlist email), so an email/in-app/push grid would be fake. | `notifyResident()` applies one `residentAllows` check to both the in-app row and the push |
| A-04 | Privacy & accessibility | Accessibility needs say "Used to improve filtering", but `accessibility_prefs` is stored and never read by any search or filter. | grep `accessibility_prefs`: only the read/write routes |
| A-05 | Saved | Every saved row reads "Community centre — view listing" (the type label). The API already returns `name`, `imageUrl` and `subtitle`; they're just not shown. | `FavouritesPanel` vs `Favourite` type and `MyLifeSaved` (which does use them) |
| A-06 | Payment methods | While loading **and on any error**, the panel returns `null`: a page title over blank space, with no retry. | `PaymentMethodsPanel` `if (unavailable) return null; if (methods === null) return null;` |
| A-07 | Help & Support | FAQ copy is out of date: it says "expand the booking" (bookings are pages now), "apply under Profile", and "Refunds are processed by the venue, not automatically" (D-10 now makes some refunds automatic). | `HELP_FAQS` |

### P1: broken or missing interactions

| # | Page | Finding |
|---|---|---|
| A-08 | My Life | "View all" next to Saved and Following goes to `/profile` (Profile details), not `?tab=favourites` / `?tab=following`. |
| A-09 | Following | A followed **venue** (`followedType: "centre"`) is labelled "Host". Only `vendor` gets "Provider". |
| A-10 | Passes | `expiresAt` is returned but never shown. A pass has no status (active / used up / expired) and no link to its club. |
| A-11 | Routines | No way to create a routine by hand or change its time, though `updateRoutine` accepts `time`. "Cancel" removes a routine with no confirmation. No weekly view. Load errors leave the list empty without saying so. |
| A-12 | Household | Add has no validation feedback (the button is just disabled). Errors are swallowed. Ticking guardian consent on a row saves instantly, with no feedback and no undo. No edit (name/DOB) though `updateHouseholdMember` exists. |
| A-13 | Saved | Remove is instant and silent, with no undo. Filters reset on Back. No search. |
| A-14 | Inbox | No "Mark all as read". No unread filter. No date grouping. No timestamps shown. |
| A-15 | Profile details | Name/county editing is one shared edit mode. Clicking the pencil on "Home county" also opens Name. County is free text, though the app has an Irish counties list (`BecomeProviderPanel`). Avatar errors only show in the row description. No success feedback on save, and a failed save fails silently. |
| A-16 | Interests | Three save models on one screen: chips need Save, Switches need Save, but similar switches on other pages save instantly. No unsaved-change warning when leaving. The "Saved" label never clears after a further edit. |
| A-17 | Notification / privacy switches | Instant save with no error handling. A failed request leaves the switch showing a value that wasn't saved. |
| A-18 | Safety Centre | Reports show raw values (`centre · spam`, `pending`). No dates. No explanation of what happens after a report. No way to start a report from here (reporting happens in context; that's fine, but the page should say where). |
| A-19 | Receipts | No search or status filter. Dates are raw `YYYY-MM-DD`. No print/download. |
| A-20 | Hosting | Four stacked boxes with no hierarchy. The "Go to your Hosting dashboard" ghost button sits above the application, even for someone who has never hosted. "Search alerts" has nothing to do with hosting. |

### P2: structure, consistency, accessibility

| # | Finding |
|---|---|
| A-21 | The identity banner (name + **email** + county + member since) repeats on all 16 sections. The email is repeated again on Profile details. |
| A-22 | Below 1025px the sidebar is hidden. Sections are reachable only through the header burger, and `/profile` on a phone opens straight onto Profile details. There is no account home listing the sections. |
| A-23 | Navigation groups don't match their contents: "Household & plans" holds Saved, Following, Receipts and the inbox. "Your data" and "Deactivate" are hidden at the bottom of Profile details. |
| A-24 | Everything is a white bordered card (Saved, Following, Passes, Receipts, Household, Help). There's no difference in shape between a library page (Saved) and a settings page. |
| A-25 | Section headings are 12px uppercase grey (`colors.faint`) `<h2>`s. They're weak, and the contrast is borderline. |
| A-26 | Chip toggles in Interests (interests, radius, area tenure) have no `aria-pressed`. Availability does. |
| A-27 | Icons mix the in-house set (`components/icons`) in Profile with `lucide-react` in the header menu. |
| A-28 | `ManageShell` renders with the `fade-panel` entrance animation. You asked for no page animations (2026-10-22). |
| A-29 | Empty states all use a `ChevronRightIcon` and most have no action (Passes, Receipts, Routines, Inbox). |

## 3. What the brief asks for that the system can't do (won't be faked)

| Brief item | Reality | Plan |
|---|---|---|
| Email / in-app / push grid | One switch per category, no channels | Show categories honestly; say which ones are always sent. Channels need a backend change (decision D-2). |
| Household "invite member", "pending invitations", permissions | Household = dependants you register for (name, DOB, guardian consent). Not accounts. | People-first redesign of what exists. No invitations. |
| Following "People / Circles" tabs | Follow types: provider, host, venue | Tabs only for types the user actually follows. |
| Add payment method | Cards are saved only through Stripe Checkout's "save my details" (by design) | Explain that clearly. No add form. |
| Larger text / reduced motion / contrast settings | Don't exist. The OS `prefers-reduced-motion` is already respected. | Explain that system settings are followed. No fake toggles. |
| Support request status / live chat | Support is email only | Searchable FAQ + Contact page + email. No status list. |
| Receipt download | No PDF endpoint | Client-side "Print / save as PDF" with print styles (no backend). |
| Profile bio / visibility | Bio exists only for Verified Hosts (`hostBio`) | Show the bio only for hosts, edited where it is today. |
| Routine auto-booking | Routines are reminders, not bookings | Say so on the page. |

## 4. Conflicts with your earlier design decisions

The brief's brand table differs from choices you made recently:

| Brief | Current (your decisions) |
|---|---|
| Corners 2–6px, buttons rectangular | Public buttons **12px** (2026-10-24), cards 16px, controls 10px; workspaces 4px |
| Accent `#FF4B24` for primary buttons | Primary = **`#d7380f` + white** (4.7:1). `#FF4B24` + white fails AA (3.3:1) and is kept for accents only. |
| Typography: Bricolage Grotesque | Headings Bricolage, **body Inter** (2026-10-22) |
| "No page animations" (not in the brief) | You asked for skeletons only (2026-10-22) |

## 5. Proposed information architecture

```
/profile                    Account home (phones: list of sections; desktop: goes to Profile)
ACCOUNT        Profile ............................. ?tab=account
               Interests & discovery ............... ?tab=preferences
               Notification settings ............... ?tab=notificationPrefs
               Privacy & accessibility ............. ?tab=privacy
               Sign-in & security .................. ?tab=security        (new key: split out of account)
               Payment methods ..................... ?tab=payment
               HelloCircle credit .................. ?tab=credit          (only when credits are on)
HOUSEHOLD      Household ........................... ?tab=household
MY LIFE        Saved ............................... ?tab=favourites
               Following ........................... ?tab=following
               Routines ............................ ?tab=routines
               Passes .............................. ?tab=passes
               Receipts ............................ ?tab=receipts
               Notifications ....................... ?tab=inbox
HOSTING        Hosting (Become a host / Manage) .... ?tab=hosting
SUPPORT        Safety Centre ....................... ?tab=safety
               Help & support ...................... ?tab=help
               Your data & account ................. ?tab=data            (new key: export, requests, deactivate)
```

- Every existing key keeps its meaning. `?tab=account` still opens Profile.
- My Life previews keep their place on `/bookings` but render the **same row components** as the full pages, and "View all"
  points at the right tab.
- Search alerts move from Hosting to Notification settings ("Alerts you've saved").
- No side drawers. Simple fields edit inline; confirmations use the centred `ConfirmDialog`; the privacy request keeps its
  centred `Modal`; on phones the section menu is the account home page, not a burger overlay.

## 6. Build plan (batches, as in the brief)

1. **Foundation.** `AccountShell` (replaces `ManageShell` here only; compact identity, grouped nav, phone account home,
   no fade), `account.css`, and shared parts: `AccountSection`, `SettingRow`, `InlineField`, `ChoiceChip`, `SegmentedTabs`,
   `SearchField`, `SaveBar` + unsaved-changes guard, `StatusTag`, `useToast`. Split `Profile.tsx` into
   `pages/account/*.tsx`, one file per page.
2. **Personal account.** Profile, Interests, Notification settings, Privacy, Sign-in & security, Your data.
3. **Personal activity.** Saved, Following, Routines, Passes, Receipts, Inbox.
4. **Household & payments.**
5. **Hosting & support.** Hosting, Safety Centre, Help (searchable).
6. **QA.** Client tests, typecheck/build, browser pass at 320–1920 against `hello_circle_dev`, before/after screenshots.

No server, schema, payment or permission changes in any batch unless you approve one (see decisions).

## 7. Revision 2026-10-24 — fewer sidebar items (owner request)

The sidebar went from 18 items to 7 settings plus Help:
Profile · Interests & discovery · Notifications · Privacy & safety · Sign-in & data · Payments · Household · (Help & support).

| Old tab | Now |
|---|---|
| Saved, Following, Routines | My Life tabs: `/bookings?tab=saved|following|routines` (plus Overview, Bookings, Circles) |
| Receipts, Passes, HelloCircle credit | Payments tabs: `/profile?tab=payment&view=receipts|passes|credit` |
| Safety Centre | Lower half of Privacy & safety |
| Your data & account | Lower half of Sign-in & data |
| Notifications inbox | Still `/profile?tab=inbox`, reached from the header bell; not in the sidebar |
| Hosting | Still `/profile?tab=hosting`; reached from the account menu ("Become a host") |

Every old `?tab=` key redirects (`ACCOUNT_REDIRECTS` in `pages/Profile.tsx`); `/bookings#my-bookings` and `#my-circles` open the matching My Life tab.

Account menu (`navConfig.accountItemKeys`, `AccountMenuContent`): identity → My Life (+ Saved and Messages on the phone sheet only; desktop has header icons) → Hosting/Manage → Settings · Payments & receipts · Help & support → Dark mode · Sign out. "My bookings", "My Circles", per-Circle "Manage …" rows and the Notifications row were removed.
