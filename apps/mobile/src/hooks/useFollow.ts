import { router } from 'expo-router';
import { useState } from 'react';

import { followEntity, unfollowEntity, type FollowedType } from '@/api/follow';
import { useAuthStore } from '@/auth/store';
import { setPendingAction } from '@/auth/pendingAction';

export function useFollow(followedType: FollowedType, followedId: string, initialFollowing: boolean, screenPath: string) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (useAuthStore.getState().status !== 'signedIn') {
      await setPendingAction({ kind: 'follow', followedType, followedId, screenPath });
      router.push('/auth/sign-in');
      return;
    }
    setPending(true);
    try {
      if (following) {
        await unfollowEntity(followedType, followedId);
        setFollowing(false);
      } else {
        await followEntity(followedType, followedId);
        setFollowing(true);
      }
    } finally {
      setPending(false);
    }
  }

  return { following, pending, toggle };
}
