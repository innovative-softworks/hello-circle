// Shared by saved.tsx's full list and My Life's compact "Saved for later"
// preview, so both route a favourite the same way without duplicating the
// mapping.
export function detailRouteFor(listingType: string, listingId: string): string | null {
  if (listingType === 'centre') return `/(details)/centre/${listingId}`;
  if (listingType === 'club') return `/(details)/club/${listingId}`;
  if (listingType === 'game') return `/(details)/game/${listingId}`;
  return null;
}
