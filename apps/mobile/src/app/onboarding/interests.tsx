import { Ionicons } from '@expo/vector-icons';
import { INTEREST_OPTIONS } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// Icon-card grid (spec §04's "Interests" step) standing in for curated
// per-category photography — INTEREST_OPTIONS is a real 12-item list with
// no per-tag imagery anywhere in this codebase, so a contextual icon per
// real option is the honest equivalent rather than fabricating 12 stock
// photos for tags that don't have any.
const INTEREST_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Badminton: 'tennisball-outline',
  Football: 'football-outline',
  Swimming: 'water-outline',
  Fitness: 'barbell-outline',
  Yoga: 'body-outline',
  Walking: 'walk-outline',
  'Kids activities': 'happy-outline',
  Arts: 'color-palette-outline',
  Learning: 'book-outline',
  'Community events': 'megaphone-outline',
  Outdoor: 'leaf-outline',
  Wellbeing: 'pulse-outline',
};

export default function OnboardingInterestsScreen() {
  const theme = useTheme();
  const { interests, toggleInterest } = useOnboardingStore();

  function handleNext() {
    router.push('/onboarding/availability');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>

          <View style={{ gap: 4 }}>
            <ThemedText type="pageHeading">What are you into?</ThemedText>
            <ThemedText themeColor="textSecondary">Select a few to get better recommendations.</ThemedText>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
            {INTEREST_OPTIONS.map((interest) => {
              const selected = interests.includes(interest);
              return (
                <Pressable
                  key={interest}
                  onPress={() => toggleInterest(interest)}
                  style={{
                    width: '47%',
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? theme.primary : theme.border,
                    borderRadius: Radius.card,
                    padding: Spacing.three,
                    gap: Spacing.two,
                    backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                  }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Ionicons name={INTEREST_ICONS[interest] ?? 'sparkles-outline'} size={26} color={selected ? theme.primary : theme.textSecondary} />
                    {selected && <Ionicons name="checkmark-circle" size={20} color={theme.primary} />}
                  </View>
                  <ThemedText type="smallBold">{interest}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          <Button label="Continue" onPress={handleNext} />
          <Pressable onPress={handleNext} style={{ alignSelf: 'center' }}>
            <ThemedText themeColor="textSecondary">Skip for now</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
