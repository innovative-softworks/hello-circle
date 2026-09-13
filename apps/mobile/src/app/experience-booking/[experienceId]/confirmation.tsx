import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchExperience } from '@/api/experiences';
import { Button } from '@/components/Button';
import { ConfirmationBadge } from '@/components/detail/ConfirmationBadge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatPrice } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';

export default function ExperienceBookingConfirmationScreen() {
  const { experienceId, ref, totalEuro } = useLocalSearchParams<{ experienceId: string; ref: string; totalEuro: string }>();
  const { data: experience } = useQuery({ queryKey: ['experience', experienceId], queryFn: () => fetchExperience(experienceId) });

  useEffect(() => {
    hapticSuccess();
  }, []);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ConfirmationBadge />
        <ThemedText type="hero" style={{ textAlign: 'center' }}>
          You&apos;re booked.
        </ThemedText>
        {experience && (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {experience.title}
          </ThemedText>
        )}
        {totalEuro && <ThemedText>{formatPrice(Number(totalEuro))}</ThemedText>}
        <ThemedText themeColor="textSecondary">Ref: {ref}</ThemedText>
        <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
      </SafeAreaView>
    </ThemedView>
  );
}
