import { AVAILABILITY_OPTIONS } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/onboarding/store';

export default function OnboardingAvailabilityScreen() {
  const { availability, toggleAvailability, complete } = useOnboardingStore();

  async function handleNext() {
    await complete();
    router.push('/onboarding/done');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title">When are you usually free?</ThemedText>
        <ThemedText themeColor="textSecondary">Optional — helps us show you things that fit your schedule.</ThemedText>

        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingVertical: Spacing.three }}>
          {AVAILABILITY_OPTIONS.map((option) => (
            <Chip key={option} label={option} selected={availability.includes(option)} onPress={() => toggleAvailability(option)} />
          ))}
        </ScrollView>

        <Button label="Continue" onPress={handleNext} />
        <Pressable onPress={handleNext} style={{ alignSelf: 'center' }}>
          <ThemedText themeColor="textSecondary">Skip for now</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}
