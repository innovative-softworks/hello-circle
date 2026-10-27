// DP-02 (detail-page audit, 2026-10-22) — when nothing can be booked, the
// panel's action takes the person to the existing "tell us when" interest
// form at the foot of the page (same intents API, nothing new to store) and
// puts the cursor in its first field.
export function scrollToInterest(headingId: string) {
  const heading = document.getElementById(headingId);
  if (!heading) return;
  const section = heading.closest("section") ?? heading;
  section.scrollIntoView({ block: "start" });
  const field = section.querySelector<HTMLElement>("input, textarea, select, button");
  field?.focus({ preventScroll: true });
}
