import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { queryClient } from '@/api/queryClient';
import { useAuthStore } from '@/auth/store';
import { useOnboardingStore } from '@/onboarding/store';
import { initSentry } from '@/lib/sentry';
import { logEvent } from '@/lib/analytics';
import { addLinkListener, getInitialDeepLink } from '@/lib/linking';

SplashScreen.preventAutoHideAsync();
initSentry();

function navigateForDeepLink(path: string, params: Record<string, string>) {
  if (path === 'verify' && params.token) {
    router.push({ pathname: '/auth/verify', params: { token: params.token } });
    return true;
  }
  return false;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const hydrateOnboarding = useOnboardingStore((state) => state.hydrate);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    // Single boot sequence — hydrate auth + onboarding and check the
    // cold-start URL together, then make exactly one navigation decision.
    // Checking the initial URL here (rather than only inside the 'url'
    // listener below) avoids a race where onboarding's redirect could fire
    // before a magic-link cold start is recognized, hijacking it.
    Promise.all([hydrateAuth(), hydrateOnboarding(), getInitialDeepLink()]).then(([, , deepLink]) => {
      SplashScreen.hideAsync();
      logEvent('app_opened');
      const handledDeepLink = deepLink ? navigateForDeepLink(deepLink.path, deepLink.params) : false;
      if (!handledDeepLink && !useOnboardingStore.getState().hasSeenOnboarding) {
        router.replace('/onboarding/welcome');
      }
    });
  }, [hydrateAuth, hydrateOnboarding]);

  useEffect(() => {
    // Ongoing deep links while the app is already running (not the
    // cold-start case, handled above).
    return addLinkListener(navigateForDeepLink);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="(modals)" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="(details)" options={{ headerShown: false }} />
              <Stack.Screen name="auth" options={{ headerShown: false, presentation: 'modal' }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            </Stack>
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
