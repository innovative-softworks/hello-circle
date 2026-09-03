import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchReceipts } from '@/api/participation';
import { Button } from '@/components/Button';
import { ReceiptQr } from '@/components/my-life/ReceiptQr';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { addToCalendar } from '@/lib/calendar';
import { formatPriceCents } from '@/lib/format';

export default function ReceiptDetailScreen() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  // Re-fetches rather than requiring the caller to pass the row through
  // route params — needed for a cold open (e.g. a future push notification
  // deep-linking straight to a receipt) where no in-memory row exists yet.
  const { data: receipts } = useQuery({ queryKey: ['receipts'], queryFn: fetchReceipts });
  const receipt = receipts?.find((r) => r.ref === ref);

  async function handleAddToCalendar() {
    if (!receipt) return;
    setCalendarStatus(null);
    try {
      await addToCalendar({
        title: receipt.label,
        date: receipt.createdAt.slice(0, 10),
        allDay: true,
        notes: `Ref: ${receipt.ref}`,
      });
      setCalendarStatus('Added to your calendar.');
    } catch {
      setCalendarStatus("Couldn't add to calendar — check calendar permission in Settings.");
    }
  }

  if (!receipt) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: receipt.label }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three, alignItems: 'center' }}>
        <ThemedText type="title" style={{ textAlign: 'center' }}>
          {receipt.label}
        </ThemedText>
        <ThemedText themeColor={receipt.paymentStatus === 'paid' ? 'primary' : 'textSecondary'} style={{ textTransform: 'capitalize' }}>
          {receipt.paymentStatus}
        </ThemedText>
        <ThemedText>{formatPriceCents(receipt.totalCents)}</ThemedText>
        <ThemedText themeColor="textSecondary">Ref: {receipt.ref}</ThemedText>

        <ReceiptQr reference={receipt.ref} />

        <Button label="Add to calendar" onPress={handleAddToCalendar} />
        {calendarStatus && <ThemedText themeColor="textSecondary">{calendarStatus}</ThemedText>}
      </ScrollView>
    </ThemedView>
  );
}
