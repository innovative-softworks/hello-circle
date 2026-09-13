import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { ONBOARDING_PHOTOS } from '@/lib/onboardingPhotos';

// The true first screen of onboarding — full-bleed brand photography, the
// wordmark + tagline, and one big statement, before the functional
// Welcome step. Native splash (app.json's expo-splash-screen config)
// handles the cold-start moment before JS is ready; this is the in-app
// screen that follows it.
export default function OnboardingSplashScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Image source={{ uri: ONBOARDING_PHOTOS.splash }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between', padding: Spacing.four }}>
        <View>
          <ThemedText type="cardHeading" style={styles.light}>
            HelloCircle
          </ThemedText>
          <ThemedText type="metadata" style={styles.lightSecondary}>
            People. Places. Activities.{'\n'}A kinder community.
          </ThemedText>
        </View>

        <View style={{ gap: Spacing.three }}>
          <ThemedText type="campaign" style={styles.light}>
            Find your people.{'\n'}Do more together.
          </ThemedText>
          <Pressable onPress={() => router.push('/onboarding/welcome')} style={[styles.nextButton, { backgroundColor: '#fff' }]}>
            <Ionicons name="arrow-forward" size={22} color="#000" />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  light: {
    color: '#fff',
  },
  lightSecondary: {
    color: 'rgba(255,255,255,0.85)',
  },
  nextButton: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
});
