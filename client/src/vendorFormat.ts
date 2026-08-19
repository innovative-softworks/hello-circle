// Shared by several vendor-dashboard components — split out of the
// original single VendorDashboard.tsx (see CLAUDE.md). Same
// top-level-utility convention as clientId.ts/favorites.ts/irishCounties.ts.

// `iso` is already a full ISO 8601 UTC timestamp from the server — just
// needs Ireland-timezone display formatting, not further tz massaging.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

export function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" });
}
