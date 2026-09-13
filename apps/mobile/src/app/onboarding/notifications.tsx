import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// Real categories from the app's actual NotificationPrefs (shared with web's
// Profile.tsx notification settings, same PUT /residents/me/notification-
// prefs endpoint) — not fabricated toggles. Per server/src/notifications.ts's
// own comment, only waitlistOffers/intentMatches currently gate a real send;
// the others are stored signal, same as on web today.
const CATEGORIES: { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }[] = [
  { key: 'openSpots', icon: 'calendar-outline', title: 'Events & Activities', subtitle: 'Open spots near you' },
  { key: 'circleAnnouncements', icon: 'people-outline', title: 'Circle Updates', subtitle: 'Activity from your circles' },
  { key: 'bookingReminders', icon: 'bookmark-outline', title: 'Booking Reminders', subtitle: 'Upcoming bookings' },
  { key: 'waitlistOffers', icon: 'hourglass-outline', title: 'Waitlist Offers', subtitle: 'When a spot opens up' },
  { key: 'recommendations', icon: 'sparkles-outline', title: 'Personalised Recommendations', subtitle: 'Suggestions for you' },
];

export default function OnboardingNotificationsScreen() {
  const theme = useTheme();
  const { notificationPrefs, toggleNotificationPref, complete } = useOnboardingStore();

  async function handleNext() {
    await complete();
    router.push('/onboarding/done');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>

          <View style={{ gap: 4 }}>
            <ThemedText type="pageHeading">Stay in the loop</ThemedText>
            <ThemedText themeColor="textSecondary">Choose what you&apos;d like to receive.</ThemedText>
          </View>

          <View style={{ gap: Spacing.three }}>
            {CATEGORIES.map((category) => (
              <View key={category.key} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                <Ionicons name={category.icon} size={22} color={theme.textSecondary} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="cardHeading">{category.title}</ThemedText>
                  <ThemedText type="metadata">{category.subtitle}</ThemedText>
                </View>
                <Switch
                  value={notificationPrefs[category.key] ?? false}
                  onValueChange={() => toggleNotificationPref(category.key)}
                  trackColor={{ true: theme.primary, false: theme.border }}
                  thumbColor="#fff"
                />
              </View>
            ))}
          </View>

          <Button label="Continue" onPress={handleNext} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
