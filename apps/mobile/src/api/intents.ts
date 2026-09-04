import type { IntentCount } from '@hello-circle/types';

import { request } from './client';

export function fetchIntentCount(activityLabel: string, county: string): Promise<IntentCount> {
  return request(`/intents/count?activityLabel=${encodeURIComponent(activityLabel)}&county=${encodeURIComponent(county)}`);
}

export function submitIntent(input: {
  activityLabel: string;
  county: string;
  preferredDate?: string;
  preferredTimeWindow?: string;
  notes?: string;
}): Promise<{ id: string }> {
  return request('/intents', { method: 'POST', body: JSON.stringify(input) });
}
