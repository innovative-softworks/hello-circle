// A real local-time-of-day greeting, computed off the viewer's own clock —
// originally written for ManageHome.tsx's Host Overview (Host Experience
// Polish), extracted here so Vendor's Overview (Vendor Experience Polish)
// can share the exact same wording instead of re-deriving it.
export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
