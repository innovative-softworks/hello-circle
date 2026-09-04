// Translates the server's web-shaped push `path` (pushPathFor() in
// server/src/notifications.ts) into a mobile route — the same "web path
// needs translation" problem already solved for DiscoverItem.href (Phase 2)
// and ParticipationEntry.href (Phase 3).
export function mapNotificationPath(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('/centres/')) return `/(details)/centre/${path.slice('/centres/'.length)}`;
  if (path.startsWith('/clubs/')) return `/(details)/club/${path.slice('/clubs/'.length)}`;
  if (path.startsWith('/games/')) return `/(details)/game/${path.slice('/games/'.length)}`;
  if (path.startsWith('/circles/')) return `/(details)/circle/${path.slice('/circles/'.length)}`;
  // ref present but kind is unknown from the path alone — the receipt
  // screen needs a kind param, so My Life is the honest fallback.
  if (path.startsWith('/bookings')) return '/(tabs)/my-life';
  // /provider/, /host/, or unrecognized — no navigation, same fallback web
  // itself has for the "intent" kind (no detail page).
  return null;
}
