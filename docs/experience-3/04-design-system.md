# Experience 3.0 — 04 Design system

Reused, not new: shared tokens (`--radius-card` 16px, `--radius-button` 4px, pill chips, orange primary CTA, Inter
body, Bricolage headings — owner decisions kept per Circle 2.0 D2), `ui.tsx` (Button, Modal, ConfirmDialog,
EmptyState, LoadErrorState, Skeleton), `form.tsx` (FieldLabel, FieldError), `DiscoverCard` with its
"Why recommended", and the Circle 2.0 layout classes in `components/circle/circleExperience.css`
(`.ce-layout` 70/30, `.ce-guide`, `.ce-row(s)`, `.ce-chip` with `aria-pressed`, `.ce-pill`, `.ce-link`).

One filled primary per screen (Plan my day / Save this plan / Show another); everything else ghost or text actions.
No animations added (owner rule). Empty states always offer a real next step, never invented results.
