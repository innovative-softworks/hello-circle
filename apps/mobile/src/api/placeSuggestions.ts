import type { PlaceSuggestion } from '@hello-circle/types';

import { request } from './client';

export interface SuggestPlaceInput {
  suggestedName: string;
  category: 'centre' | 'club';
  area?: string;
  county?: string;
  description?: string;
  contactInfo?: string;
}

// Anonymous-or-signed-in, same X-Client-Id ownership pattern as favourites/
// reports — no account required to suggest a place.
export function submitPlaceSuggestion(input: SuggestPlaceInput): Promise<{ id: string }> {
  return request('/place-suggestions', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchMyPlaceSuggestions(): Promise<PlaceSuggestion[]> {
  return request('/place-suggestions/mine');
}
