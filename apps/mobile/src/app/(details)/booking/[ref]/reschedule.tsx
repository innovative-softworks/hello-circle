import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { rescheduleBooking } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { fetchReceipts } from '@/api/participation';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { TIME_SLOTS } from '@/lib/bookingConstants';

function nextNDays(n: number): string[] {
  const days: string[] = [];
  const start = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Deliberately doesn't call fetchAvailability first (that needs roomId/
// duration, which Receipt doesn't carry) — the server's own reschedule
// endpoint already re-validates opening hours, overlaps and the booking
// window against the chosen slot, so a real conflict surfaces as a normal
// error message here rather than needing a second live-availability call.
export default function RescheduleBookingScreen() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const queryClient = useQueryClient();
  const candidateDays = useMemo(() => nextNDays(30), []);
  const { data: receipts } = useQuery({ queryKey: ['receipts'], queryFn: fetchReceipts });
  const receipt = receipts?.find((r) => r.ref === ref);

  const [date, setDate] = useState(receipt?.date ?? candidateDays[0]);
  const [time, setTime] = useState(receipt?.time ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!time) return;
    setSubmitting(true);
    setError(null);
    try {
      await rescheduleBooking(ref, date, time);
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['my-participation'] });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reschedule this booking — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Change date &amp; time</ThemedText>
          {receipt?.date && (
            <ThemedText themeColor="textSecondary">
              Currently {receipt.date}
              {receipt.time ? ` at ${receipt.time}` : ''}
            </ThemedText>
          )}

          <ThemedText type="sectionHeading">New date</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {candidateDays.map((day) => (
              <Chip key={day} label={day.slice(5)} selected={date === day} onPress={() => setDate(day)} />
            ))}
          </ScrollView>

          <ThemedText type="sectionHeading">New time</ThemedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
            {TIME_SLOTS.map((slot) => (
              <Chip key={slot} label={slot} selected={time === slot} onPress={() => setTime(slot)} />
            ))}
          </View>

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Button label="Save new time" onPress={handleSave} loading={submitting} disabled={!time} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
