import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { addToCalendar } from '@/lib/calendar';
import { formatPrice } from '@/lib/format';

export default function BookingConfirmationStep() {
  const { ref, totalEuro } = useLocalSearchParams<{ ref: string; totalEuro: string }>();
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  async function handleAddToCalendar() {
    try {
      await addToCalendar({ title: 'Room booking', date: new Date().toISOString().slice(0, 10), notes: `Ref: ${ref}` });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
        <ThemedText type="title">Booking confirmed</ThemedText>
        <ThemedText themeColor="textSecondary">Ref: {ref}</ThemedText>
        {totalEuro && <ThemedText>{formatPrice(Number(totalEuro))}</ThemedText>}
        <Button label="Add to calendar" onPress={handleAddToCalendar} />
        {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}
        <Button label="View in My Life" onPress={() => router.replace('/(tabs)/my-life')} />
      </SafeAreaView>
    </ThemedView>
  );
}
