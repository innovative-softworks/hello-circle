import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function OnboardingDoneScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ThemedText type="title">You&apos;re all set</ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          We&apos;ll use this to show you things worth doing nearby.
        </ThemedText>
        <Button label="Start exploring" onPress={() => router.replace('/(tabs)')} />
      </SafeAreaView>
    </ThemedView>
  );
}
