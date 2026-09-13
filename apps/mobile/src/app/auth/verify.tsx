import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addFavourite } from '@/api/favourites';
import { followEntity } from '@/api/follow';
import { verifyMagicLink } from '@/api/residentAuth';
import { fetchMyResidentProfile } from '@/api/residents';
import { useAuthStore } from '@/auth/store';
import { clearPendingAction, getPendingAction } from '@/auth/pendingAction';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ONBOARDING_PHOTOS } from '@/lib/onboardingPhotos';

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
  } else if (action.kind === 'follow') {
    await followEntity(action.followedType as 'vendor' | 'host' | 'centre', action.followedId).catch(() => undefined);
  }
  // 'returnTo' has nothing to replay — just sends the user back to
  // action.screenPath below, same as the other two kinds already do.
  return action.screenPath;
}

export default function VerifyScreen() {
  const theme = useTheme();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    verifyMagicLink(token)
      .then(async (result) => {
        // Store the session first — fetchMyResidentProfile() reads the
        // bearer token from SecureStore via the shared API client, so it
        // needs the token already persisted before it can authenticate.
        await setSession(result.token, result.email, null);
        const { resident } = await fetchMyResidentProfile().catch(() => ({ resident: null }));
        if (resident?.id) await setSession(result.token, result.email, resident.id);
        const pendingScreenPath = await replayPendingAction();
        router.replace((pendingScreenPath ?? '/(tabs)/my-life') as never);
      })
      .catch(() => setError('This link has expired or has already been used — request a new one.'));
  }, [token, setSession]);

  const displayError = token ? error : 'This link is missing its token.';

  if (displayError) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText themeColor="danger" style={{ textAlign: 'center' }}>
            {displayError}
          </ThemedText>
          <Button label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four }}>
        <ActivityIndicator size="large" color={theme.primary} />
        <ThemedText type="pageHeading" style={{ textAlign: 'center', marginTop: Spacing.two }}>
          Signing you in…
        </ThemedText>
        <ThemedText themeColor="textSecondary">Just a moment.</ThemedText>
      </SafeAreaView>
      <Image source={{ uri: ONBOARDING_PHOTOS.friends }} style={styles.bottomPhoto} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  bottomPhoto: {
    width: '100%',
    height: '35%',
  },
});
