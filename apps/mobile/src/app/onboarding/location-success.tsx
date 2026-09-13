import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { ONBOARDING_PHOTOS } from '@/lib/onboardingPhotos';
import { useOnboardingStore } from '@/onboarding/store';

const CATEGORY_LABELS = ['Activities', 'Spaces', 'Communities'];

export default function LocationSuccessScreen() {
  const homeCounty = useOnboardingStore((state) => state.homeCounty);

  return (
    <View style={{ flex: 1 }}>
      <Image source={{ uri: ONBOARDING_PHOTOS.sunset }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end', padding: Spacing.four }}>
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="editorial" style={styles.light}>
            Hello{'\n'}
            {homeCounty ?? 'there'}
          </ThemedText>
          <ThemedText type="metadata" style={styles.lightSecondary}>
            Great people. Greater days.
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one }}>
            {CATEGORY_LABELS.map((label) => (
              <View key={label} style={styles.pill}>
                <ThemedText type="metadata" style={styles.light}>
                  {label}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>

        <Pressable onPress={() => router.push('/onboarding/interests')} style={[styles.nextButton, { backgroundColor: '#fff' }]}>
          <Ionicons name="arrow-forward" size={22} color="#000" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  light: {
    color: '#fff',
  },
  lightSecondary: {
    color: 'rgba(255,255,255,0.85)',
  },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  nextButton: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginTop: Spacing.four,
  },
});
