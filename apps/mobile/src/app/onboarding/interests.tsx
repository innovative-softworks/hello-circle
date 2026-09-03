import { INTEREST_OPTIONS } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/onboarding/store';

export default function OnboardingInterestsScreen() {
  const { interests, toggleInterest } = useOnboardingStore();

  function handleNext() {
    router.push('/onboarding/availability');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText type="title">What are you into?</ThemedText>
        <ThemedText themeColor="textSecondary">Pick as many as you like — you can change these later.</ThemedText>

        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingVertical: Spacing.three }}>
          {INTEREST_OPTIONS.map((interest) => (
            <Chip key={interest} label={interest} selected={interests.includes(interest)} onPress={() => toggleInterest(interest)} />
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
