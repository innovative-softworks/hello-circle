import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchProgram } from '@/api/programs';
import { Button } from '@/components/Button';
import { ConfirmationBadge } from '@/components/detail/ConfirmationBadge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatPrice } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';

export default function ProgramEnrollmentConfirmationScreen() {
  const { programId, ref, totalEuro } = useLocalSearchParams<{ programId: string; ref: string; totalEuro: string }>();
  const { data: program } = useQuery({ queryKey: ['program', programId], queryFn: () => fetchProgram(programId) });

  useEffect(() => {
    hapticSuccess();
  }, []);

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ConfirmationBadge />
        <ThemedText type="hero" style={{ textAlign: 'center' }}>
          You&apos;re enrolled.
        </ThemedText>
        {program && (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {program.title} at {program.listingName}
          </ThemedText>
        )}
        {totalEuro && <ThemedText>{formatPrice(Number(totalEuro))}</ThemedText>}
        <ThemedText themeColor="textSecondary">Ref: {ref}</ThemedText>
        <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
      </SafeAreaView>
    </ThemedView>
  );
}
