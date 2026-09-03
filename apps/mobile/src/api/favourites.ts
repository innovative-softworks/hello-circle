import type { Favourite, FavouriteStatus } from '@hello-circle/types';

import { request } from './client';

export function fetchFavourites(): Promise<Favourite[]> {
  return request('/favourites');
}

export function addFavourite(
  listingType: Favourite['listingType'],
  listingId: string,
  status?: FavouriteStatus
): Promise<{ ok: boolean }> {
  return request('/favourites', { method: 'POST', body: JSON.stringify({ listingType, listingId, status }) });
}

export function removeFavourite(listingType: Favourite['listingType'], listingId: string): Promise<{ ok: boolean }> {
  return request('/favourites', { method: 'DELETE', body: JSON.stringify({ listingType, listingId }) });
}

export function updateFavouriteStatus(
  listingType: Favourite['listingType'],
  listingId: string,
  status: FavouriteStatus
): Promise<{ ok: boolean }> {
  return request('/favourites/status', { method: 'PUT', body: JSON.stringify({ listingType, listingId, status }) });
}
