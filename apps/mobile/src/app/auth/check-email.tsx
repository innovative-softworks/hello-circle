import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestMagicLink } from '@/api/residentAuth';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function CheckEmailScreen() {
  const theme = useTheme();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleResend() {
    if (!email) return;
    setResending(true);
    try {
      await requestMagicLink(email);
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } finally {
      setResending(false);
    }
  }

  function handleOpenEmailApp() {
    // Best-effort — there's no reliable cross-platform "open the default
    // mail client" API; this opens iOS's Mail app if installed and
    // silently no-ops everywhere else rather than erroring.
    Linking.openURL('message://').catch(() => undefined);
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <View style={{ width: 72, height: 72, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.backgroundSelected }}>
          <Ionicons name="mail-outline" size={32} color={theme.primary} />
        </View>

        <ThemedText type="pageHeading" style={{ textAlign: 'center' }}>
          Check your email
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {email ? (
            <>
              We&apos;ve sent a sign-in link to{'\n'}
              <ThemedText type="smallBold">{email}</ThemedText>
              {'. '}
            </>
          ) : (
            "We've sent a sign-in link. "
          )}
          Click the link to continue.
        </ThemedText>

        <Button label="Open Email App" onPress={handleOpenEmailApp} />

        <Pressable onPress={handleResend} disabled={!email || resending}>
          <ThemedText themeColor="primary">{resent ? 'Sent again ✓' : resending ? 'Resending…' : "Didn't receive it? Resend"}</ThemedText>
        </Pressable>

        <Pressable onPress={() => router.dismissAll()} style={{ marginTop: Spacing.three }}>
          <ThemedText themeColor="textSecondary">Done</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}
