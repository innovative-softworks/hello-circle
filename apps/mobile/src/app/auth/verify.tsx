import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addFavourite } from '@/api/favourites';
import { followEntity } from '@/api/follow';
import { verifyMagicLink } from '@/api/residentAuth';
import { useAuthStore } from '@/auth/store';
import { clearPendingAction, getPendingAction } from '@/auth/pendingAction';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Replays a pending favourite/follow action (set by useFavourite/useFollow
// before sending the user through the magic-link round trip) so "the thing
// they tapped" gets saved once they're actually signed in — master-prompt
// §7's "preserve original intent through authentication," adapted for a
// round trip that can background or kill the app in between.
async function replayPendingAction(): Promise<string | null> {
  const action = await getPendingAction();
  if (!action) return null;
  await clearPendingAction();
  if (action.kind === 'favourite') {
    await addFavourite(action.listingType as 'centre' | 'club', action.listingId).catch(() => undefined);
  } else {
    await followEntity(action.followedType as 'vendor' | 'host' | 'centre', action.followedId).catch(() => undefined);
  }
  return action.screenPath;
}

export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    verifyMagicLink(token)
      .then(async (result) => {
        await setSession(result.token, result.email);
        const pendingScreenPath = await replayPendingAction();
        router.replace((pendingScreenPath ?? '/(tabs)/my-life') as never);
      })
      .catch(() => setError('This link has expired or has already been used — request a new one.'));
  }, [token, setSession]);

  const displayError = token ? error : 'This link is missing its token.';

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        {displayError ? (
          <>
            <ThemedText themeColor="danger" style={{ textAlign: 'center' }}>
              {displayError}
            </ThemedText>
            <Button label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
          </>
        ) : (
          <ThemedText themeColor="textSecondary">Signing you in…</ThemedText>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
