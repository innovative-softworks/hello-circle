import type { SearchResult } from '@hello-circle/types';

import { request } from './client';

export function search(q: string): Promise<SearchResult> {
  return request(`/search?q=${encodeURIComponent(q)}`);
}
