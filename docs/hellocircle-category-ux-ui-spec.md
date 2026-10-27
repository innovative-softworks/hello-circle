# HelloCircle — Category UX/UI Spec (Phase 0 proposal)

Existing tokens: Bricolage Grotesque, cream background, green primary (owner decision), current radii. No side drawers. Full pages for complex editing; centred dialogs for confirmations.

## Public discovery

- **Lists** (`/games`, `/experiences`, `/adventures`, `/programs`, `/circles`, `/volunteer`, and gated venues/clubs):
  - Under the existing search card, one row of **category chips**: only categories with results, scrollable on phones (`chips-scroll-mobile`).
  - Choosing a category shows a second row of subcategory chips. The URL updates (`?category=&sub=`) and the results and count refresh in place.
  - Changing the type (Explore) clears incompatible category and subcategory but keeps location, date and keyword.
- **Explore:** the type chips stay first. With a type chosen, its category chips appear. With no type, the categories are the cross-family concepts (e.g. "Racket sports" across activities, programmes and clubs).
- **Empty category:** "No badminton near Dublin this week" plus three things to do: clear the filter, a related subcategory with results, or "Tell me when there's one" (existing interest form).
- **Phones:** results stay within the first screen. Chips take a single 44px row each; there's no category directory above the results.
- **Home:**
  - keep the editorial layout;
  - "Popular right now" shows up to 8 categories that have live inventory (counts only when reliable);
  - no grid of 80 cards.

## Detail pages

- The eyebrow becomes a breadcrumb: `Activity › Racket sports › Badminton`. Each part links to the list filtered by it.
- Tags (participation attributes) sit in the existing participation block.
- "More like this" uses the same subcategory first, then the category.
- Nothing else on the detail pages changes (current 70/30 layout).

## Host forms (activity, Start Circle)

1. **What are you organising?** A searchable `CategoryPicker`: type "badm…" and get "Badminton — Racket sports". Choosing a subcategory sets the category. The title field stays free text and is pre-filled from the subcategory, but can be edited.
2. **Tags (optional):** checkboxes from the approved list.

Other rules:
- Edit keeps the saved IDs; a disabled category shows "No longer offered — choose another".
- Errors are shown under the field, with the summary at the top (existing pattern).

## Vendor forms (programme, club, experience/adventure/volunteer, venue/room)

- Same picker, filtered to the categories valid for that form's listing type (venue/room: facility categories only).
- No free-form category creation. A "Can't find yours? Suggest a category" link sends a request to admins (optional, phase 3).

## Admin — Categories (`/admin?tab=categories`, permission `taxonomy.manage`)

- **Directory (table):**
  - columns: type families, category, subcategory count, listings using it, active, discoverable, sort order, last updated;
  - filters for family, status, visibility, usage, and an "Uncategorised listings" view.
- **Record page** (`?record=category:<id>`, 70/30):
  - Overview
  - Subcategories (inline reorder)
  - Listings using it
  - Discovery settings
  - SEO
  - Change history (audit log)
- **Create/edit:** full page. Name, ID (locked after save), slug, description, parent, families, icon, image, sort order, active, discoverable, SEO title and description.
- **Actions:**
  - activate/deactivate, show/hide, reorder;
  - merge into another (dialog shows the listing count and the redirect);
  - aliases, usage, archive.
  - Delete only when unused.

## Accessibility

- Pickers are labelled comboboxes with listbox semantics (or native `select` when the list is short) and announce their result count.
- Chips are toggle buttons with `aria-pressed`, 44px tall on phones.
- Focus returns to the trigger after a dialog closes.
