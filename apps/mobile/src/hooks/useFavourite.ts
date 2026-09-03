import { router } from 'expo-router';
import { useState } from 'react';

import { addFavourite, removeFavourite } from '@/api/favourites';
import { useAuthStore } from '@/auth/store';
import { setPendingAction } from '@/auth/pendingAction';

export function useFavourite(listingType: 'centre' | 'club', listingId: string, initialSaved: boolean, screenPath: string) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (useAuthStore.getState().status !== 'signedIn') {
      await setPendingAction({ kind: 'favourite', listingType, listingId, screenPath });
      router.push('/auth/sign-in');
      return;
    }
    setPending(true);
    try {
      if (saved) {
        await removeFavourite(listingType, listingId);
        setSaved(false);
      } else {
        await addFavourite(listingType, listingId);
        setSaved(true);
      }
    } finally {
      setPending(false);
    }
  }

  return { saved, pending, toggle };
}
