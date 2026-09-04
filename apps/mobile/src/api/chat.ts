import type { ChatFeed, ChatMessage, ChatScopeType } from '@hello-circle/types';

import { request } from './client';

export function fetchChatMessages(scopeType: ChatScopeType, scopeId: string, after?: number): Promise<ChatFeed> {
  return request(`/chat/${scopeType}/${scopeId}/messages${after ? `?after=${after}` : ''}`);
}

export function postChatMessage(scopeType: ChatScopeType, scopeId: string, body: string): Promise<ChatMessage> {
  return request(`/chat/${scopeType}/${scopeId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
}
