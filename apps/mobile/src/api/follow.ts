import { request } from './client';

export type FollowedType = 'vendor' | 'host' | 'centre';
export type NotificationLevel = 'highlights' | 'everything';

export interface FollowedEntity {
  followedType: FollowedType;
  followedId: string;
  notificationLevel: NotificationLevel;
  name: string | null;
  imageUrl: string | null;
  href: string;
}

export function followEntity(followedType: FollowedType, followedId: string): Promise<{ ok: boolean }> {
  return request('/follows', { method: 'POST', body: JSON.stringify({ followedType, followedId }) });
}

export function unfollowEntity(followedType: FollowedType, followedId: string): Promise<{ ok: boolean }> {
  return request('/follows', { method: 'DELETE', body: JSON.stringify({ followedType, followedId }) });
}

export function fetchMyFollows(): Promise<FollowedEntity[]> {
  return request('/follows');
}
