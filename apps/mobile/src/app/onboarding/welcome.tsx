import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

const VALUE_PROPS: { icon: keyof typeof Ionicons.glyphMap; label: string; tint: 'primary' | 'accent' }[] = [
  { icon: 'people-outline', label: 'Join activities', tint: 'primary' },
  { icon: 'location-outline', label: 'Book local spaces', tint: 'accent' },
  { icon: 'people-circle-outline', label: 'Build communities', tint: 'primary' },
  { icon: 'compass-outline', label: 'Discover adventures', tint: 'accent' },
];

export default function OnboardingWelcomeScreen() {
  const theme = useTheme();
  const skip = useOnboardingStore((state) => state.skip);

  async function handleSkip() {
    await skip();
    router.replace('/(tabs)');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Pressable onPress={handleSkip}>
            <ThemedText themeColor="textSecondary">Skip</ThemedText>
          </Pressable>
        </View>

        <ThemedView style={{ gap: Spacing.four }}>
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="campaign">Good things{'\n'}happen{'\n'}together.</ThemedText>
            <ThemedText themeColor="textSecondary">
              Discover local activities, book spaces, join communities and make real connections.
            </ThemedText>
          </View>
          <ThemedView style={{ gap: Spacing.three }}>
            {VALUE_PROPS.map((prop) => (
              <View key={prop.label} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                <View style={{ width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.backgroundSelected }}>
                  <Ionicons name={prop.icon} size={18} color={prop.tint === 'primary' ? theme.primary : theme.accent} />
                </View>
                <ThemedText>{prop.label}</ThemedText>
              </View>
            ))}
          </ThemedView>
        </ThemedView>

        <View style={{ gap: Spacing.two }}>
          <Button label="Get Started" onPress={() => router.push('/onboarding/location')} />
          <Button label="Sign In" variant="secondary" onPress={() => router.push('/auth/sign-in')} />
          <Pressable onPress={() => router.push('/auth/sign-in')} style={{ alignSelf: 'center', marginTop: Spacing.one }}>
            <ThemedText themeColor="textSecondary">
              Already have an account? <ThemedText themeColor="primary">Sign In</ThemedText>
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}
