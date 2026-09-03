import type { Review } from '@hello-circle/types';

import { request } from './client';

export type ReviewListingType = 'centre' | 'club' | 'game' | 'host' | 'experience';

export function fetchReviews(listingType: ReviewListingType, listingId: string): Promise<Review[]> {
  return request(`/reviews?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function checkReviewEligibility(listingType: ReviewListingType, listingId: string): Promise<{ eligible: boolean }> {
  return request(`/reviews/eligible?listingType=${listingType}&listingId=${encodeURIComponent(listingId)}`);
}

export function submitReview(input: {
  listingType: ReviewListingType;
  listingId: string;
  name: string;
  rating: number;
  comment?: string;
}): Promise<Review> {
  return request('/reviews', { method: 'POST', body: JSON.stringify(input) });
}
