# 07 — Responsive UX

- **≥1001px**: the joined page's 70/30 frame; the right-hand panel (join card first) is sticky.
- **≤1000px**: the panel stacks under the content as on the joined page; the phone join bar keeps the join action in reach.
- **≤760px**: "What happens" and "People" stack; steps 2×2.
- **≤640px**: mosaic 2-up with the large tile full width; activity rows stack their button.
- Phone sticky join bar (existing) uses the same join flow and doesn't cover content (the page reserves space for it).

Checked at 390 and 1440 with screenshots; the browser spec asserts no horizontal scroll at phone width.
