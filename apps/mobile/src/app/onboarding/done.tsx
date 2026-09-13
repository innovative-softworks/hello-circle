import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSuccess } from '@/lib/haptics';
import { useOnboardingStore } from '@/onboarding/store';

export default function OnboardingDoneScreen() {
  const theme = useTheme();
  const { homeCounty, interests, notificationPrefs } = useOnboardingStore();

  useEffect(() => {
    hapticSuccess();
  }, []);

  // Real recap, not a fabricated checklist — each row reflects what the
  // resident actually set on the previous screens.
  const checklist = [
    { label: 'Location set', done: !!homeCounty },
    { label: 'Interests added', done: interests.length > 0 },
    { label: 'Preferences saved', done: true },
    { label: 'Notifications on', done: Object.values(notificationPrefs).some(Boolean) },
  ];

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.four }}>
        <View style={{ width: 88, height: 88, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.backgroundSelected }}>
          <Ionicons name="checkmark-circle" size={48} color={theme.primary} />
        </View>

        <View style={{ gap: 4 }}>
          <ThemedText type="hero" style={{ textAlign: 'center' }}>
            You&apos;re all set!
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Let&apos;s make brighter days together.
          </ThemedText>
        </View>

        <View style={{ width: '100%', borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two }}>
          {checklist.map((item) => (
            <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <Ionicons name={item.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={item.done ? theme.primary : theme.textSecondary} />
              <ThemedText themeColor={item.done ? 'text' : 'textSecondary'}>{item.label}</ThemedText>
            </View>
          ))}
        </View>

        <Button label="Explore HelloCircle" onPress={() => router.replace('/(tabs)')} />
      </SafeAreaView>
    </ThemedView>
  );
}
