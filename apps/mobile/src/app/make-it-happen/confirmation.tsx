import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ConfirmationBadge } from '@/components/detail/ConfirmationBadge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatPrice } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';

export default function MakeItHappenConfirmationScreen() {
  const { ref, totalEuro } = useLocalSearchParams<{ ref: string; totalEuro: string }>();

  useEffect(() => {
    hapticSuccess();
  }, []);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ConfirmationBadge />
        <ThemedText type="hero" style={{ textAlign: 'center' }}>
          It&apos;s happening.
        </ThemedText>
        <ThemedText themeColor="textSecondary">Ref: {ref}</ThemedText>
        {totalEuro && <ThemedText>{formatPrice(Number(totalEuro))}</ThemedText>}
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          We&apos;ve booked the space — invite people to join before it starts.
        </ThemedText>
        <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
      </SafeAreaView>
    </ThemedView>
  );
}
