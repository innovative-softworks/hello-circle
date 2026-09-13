import type { Centre, Club, DiscoverItem, ExperienceSearchResult, SearchParsed } from '@hello-circle/types';

import { request } from './client';

// Rule-based, not an LLM (server has no AI API key/SDK configured) — a
// conversational framing over the exact same structured search /search
// itself runs, via the server's shared runStructuredSearch(). Mirrors
// web's client/src/api/public.ts AskHelloCircleResponse shape exactly.
export interface AskHelloCircleResponse {
  reply: string;
  parsed: SearchParsed | null;
  centres: Centre[];
  clubs: Club[];
  activities: DiscoverItem[];
  experiences: ExperienceSearchResult[];
  totalCentres: number;
  totalClubs: number;
  totalActivities: number;
  totalExperiences: number;
}

export function askHelloCircle(message: string): Promise<AskHelloCircleResponse> {
  return request('/ask', { method: 'POST', body: JSON.stringify({ message }) });
}
