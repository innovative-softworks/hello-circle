import { router } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPriceCents } from '@/lib/format';

import { useMakeItHappenStore } from './_store';

export default function MakeItHappenResultsScreen() {
  const theme = useTheme();
  const { candidates, setField } = useMakeItHappenStore();

  function handleChoose(candidate: (typeof candidates)[number]) {
    setField('chosenCandidate', candidate);
    router.push('/make-it-happen/details');
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.two }}>
          {candidates.map((candidate) => (
            <Pressable
              key={`${candidate.centreId}-${candidate.roomId}`}
              onPress={() => handleChoose(candidate)}
              style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: Spacing.three, gap: 2 }}>
              <ThemedText style={{ fontWeight: '700' }}>{candidate.centreName}</ThemedText>
              <ThemedText themeColor="textSecondary">
                {candidate.roomName} · {candidate.area}, {candidate.county} · Up to {candidate.capacity} people
              </ThemedText>
              <ThemedText themeColor="primary">
                {formatPriceCents(candidate.perPersonCents)}/person · {formatPriceCents(candidate.totalCents)} total
                {candidate.paymentMethod === 'cash' ? ' · cash on arrival' : ''}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
