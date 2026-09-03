import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/onboarding/store';

const VALUE_PROPS = [
  'Find local things to do',
  'Join without needing an existing group',
  'Book community spaces and activities',
  'Build real-world routines',
];

export default function OnboardingWelcomeScreen() {
  const skip = useOnboardingStore((state) => state.skip);

  async function handleSkip() {
    await skip();
    router.replace('/(tabs)');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, justifyContent: 'space-between' }}>
        <Pressable onPress={handleSkip} style={{ alignSelf: 'flex-end' }}>
          <ThemedText themeColor="textSecondary">Skip</ThemedText>
        </Pressable>

        <ThemedView style={{ gap: Spacing.three }}>
          <ThemedText type="title">Find your people</ThemedText>
          {VALUE_PROPS.map((line) => (
            <ThemedText key={line} themeColor="textSecondary">
              • {line}
            </ThemedText>
          ))}
        </ThemedView>

        <Button label="Get started" onPress={() => router.push('/onboarding/location')} />
      </SafeAreaView>
    </ThemedView>
  );
}
