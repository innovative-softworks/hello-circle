# 04 — Navigation Interaction Specification

## Desktop menus (existing behaviour, verified)

| Action | Result |
|---|---|
| Click Explore / Start / Account | Opens that panel; any other panel closes (one open at a time) |
| Click the open trigger again | Closes it |
| Escape | Closes the panel and returns focus to its trigger (`aria-controls` lookup); ignored while a dialog is open |
| Outside click, route change | Closes the panel |
| Tab | Moves through the panel's links in reading order |
| Semantics | Disclosure buttons (`aria-expanded`, `aria-controls`) with plain links; no ARIA `menu` roles. Start groups are `role="group"` with a labelled heading |

## Phone

- Explore and Start tabs open dialogs (`aria-haspopup="dialog"`, `aria-expanded`); focus is trapped, Escape closes, and focus returns to the tab.
- Tabs that navigate expose `aria-current="page"`.

## Search

- Typing shows recent searches, popular suggestions and "Search for '…'".
- Enter goes to `/explore?q=…` (one search engine: `/api/search`).
- Circles get a "Search Circles for '…'" option.
- **Gap (needs backend approval):** programmes and Circles aren't in `/api/search` results.

## Authentication and roles

- Start items are visible to visitors. The pages ask a guest to sign in and return them afterwards (`signInHref`); the server requires a resident to create anything.
- Account items come from `accountItemKeys()`. Admin items appear only for an admin session; resident items only with a resident session. Notification badges use real unread counts (`useHeaderData`).
- Make It Happen and List your venue are hidden by state (commerce switch, vendor session), not removed from the routes.

## Reduced motion

Panels use the existing `pop-in` class, which is disabled under `prefers-reduced-motion`. There are no page or route animations (owner decision).
