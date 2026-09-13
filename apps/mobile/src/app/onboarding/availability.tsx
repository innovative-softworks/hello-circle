import { Ionicons } from '@expo/vector-icons';
import { AVAILABILITY_OPTIONS } from '@hello-circle/types';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// AVAILABILITY_OPTIONS is a real, fixed 5-value list — "Weekday mornings/
// afternoons/evenings" plus separate "Saturday"/"Sunday" (no individual
// Mon-Fri granularity exists in the data model). Days row below surfaces
// the 2 real day-shaped values; Time of day surfaces the 3 real weekday
// slots. "I'm flexible" is a real quick-select (all 5 on), not a 6th
// fabricated value.
const TIME_OF_DAY: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'Weekday mornings', label: 'Mornings', icon: 'sunny-outline' },
  { value: 'Weekday afternoons', label: 'Afternoons', icon: 'partly-sunny-outline' },
  { value: 'Weekday evenings', label: 'Evenings', icon: 'moon-outline' },
];
const DAYS = ['Saturday', 'Sunday'];

export default function OnboardingAvailabilityScreen() {
  const theme = useTheme();
  const { availability, toggleAvailability } = useOnboardingStore();

  const isFlexible = AVAILABILITY_OPTIONS.every((option) => availability.includes(option));

  function handleFlexible() {
    AVAILABILITY_OPTIONS.forEach((option) => {
      if (isFlexible ? availability.includes(option) : !availability.includes(option)) {
        toggleAvailability(option);
      }
    });
  }

  function handleNext() {
    router.push('/onboarding/notifications');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>

          <View style={{ gap: 4 }}>
            <ThemedText type="pageHeading">When are you usually free?</ThemedText>
            <ThemedText themeColor="textSecondary">Help us suggest relevant activities.</ThemedText>
          </View>

          <View style={{ gap: Spacing.two }}>
            <ThemedText type="eyebrow">Days</ThemedText>
            <View style={{ flexDirection: 'row', gap: Spacing.two }}>
              {DAYS.map((day) => (
                <Chip key={day} label={day} selected={availability.includes(day)} onPress={() => toggleAvailability(day)} />
              ))}
            </View>
          </View>

          <View style={{ gap: Spacing.two }}>
            <ThemedText type="eyebrow">Time of day</ThemedText>
            {TIME_OF_DAY.map((slot) => {
              const selected = availability.includes(slot.value);
              return (
                <Pressable
                  key={slot.value}
                  onPress={() => toggleAvailability(slot.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: Spacing.three,
                    borderWidth: 1,
                    borderColor: selected ? theme.primary : theme.border,
                    backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                    borderRadius: Radius.control,
                    padding: Spacing.three,
                  }}>
                  <Ionicons name={slot.icon} size={20} color={selected ? theme.primary : theme.textSecondary} />
                  <ThemedText style={{ flex: 1 }}>{slot.label}</ThemedText>
                  {selected && <Ionicons name="checkmark" size={18} color={theme.primary} />}
                </Pressable>
              );
            })}
            <Pressable
              onPress={handleFlexible}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.three,
                borderWidth: 1,
                borderColor: isFlexible ? theme.primary : theme.border,
                backgroundColor: isFlexible ? theme.backgroundSelected : theme.backgroundElement,
                borderRadius: Radius.control,
                padding: Spacing.three,
              }}>
              <Ionicons name="infinite-outline" size={20} color={isFlexible ? theme.primary : theme.textSecondary} />
              <ThemedText style={{ flex: 1 }}>I&apos;m flexible</ThemedText>
              {isFlexible && <Ionicons name="checkmark" size={18} color={theme.primary} />}
            </Pressable>
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
