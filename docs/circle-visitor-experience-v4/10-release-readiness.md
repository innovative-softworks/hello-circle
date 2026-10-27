# 10 — Release readiness

**Status: ready for owner review. Not committed, pushed or deployed.**

Before switching `circles.visitor_experience` on anywhere:
1. Owner review of the visitor page (screenshots in `screenshots/`, or `hello_circle_dev`).
2. Organisers should add a cover, a short introduction and "what we do" — the page is built from these. The new "Do people often come on their own?" setting is optional.
3. Roll out with the switch (admin Settings → Circle features), staging first; flip off to return to the old page instantly. No data migration is needed beyond the additive `solo_welcome` column.

Known limits:
- Covers of non-open Circles stay members-only, so approval Circles show the placeholder in the introduction.
- Highlights depend on public activity/venue photos; Circles without them show the remaining sections (no empty cards).
- Analytics events go to the existing consent-gated dataLayer only.
