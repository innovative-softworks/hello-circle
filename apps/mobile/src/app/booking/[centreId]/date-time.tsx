import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchAvailability, fetchAvailabilityRange } from '@/api/bookings';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DURATION_OPTIONS, TIME_SLOTS } from '@/lib/bookingConstants';

import { useBookingDraftStore } from '@/booking/store';

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

export default function DateTimeStep() {
  const { centreId } = useLocalSearchParams<{ centreId: string }>();
  const { roomId, date, time, duration, setField } = useBookingDraftStore();
  const candidateDays = useMemo(() => nextNDays(30), []);
  const [selectedDate, setSelectedDate] = useState(date ?? candidateDays[0]);

  const rangeQuery = useQuery({
    queryKey: ['availability-range', centreId, roomId],
    queryFn: () => fetchAvailabilityRange(centreId, roomId!, candidateDays[0]),
    enabled: !!roomId,
  });
  const dayQuery = useQuery({
    queryKey: ['availability', centreId, roomId, selectedDate, duration],
    queryFn: () => fetchAvailability(centreId, roomId!, selectedDate, duration),
    enabled: !!roomId && !!selectedDate,
  });

  const closedDates = new Set(rangeQuery.data?.closedDates ?? []);
  const bookedTimes = new Set(dayQuery.data?.bookedTimes ?? []);
  const dayClosed = dayQuery.data?.closed ?? false;

  function handleNext() {
    if (!time) return;
    setField('date', selectedDate);
    router.push({ pathname: '/booking/[centreId]/details', params: { centreId } });
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="sectionHeading">Duration</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {DURATION_OPTIONS.map((option) => (
              <Chip key={option.hours} label={option.label} selected={duration === option.hours} onPress={() => setField('duration', option.hours)} />
            ))}
          </ScrollView>

          <ThemedText type="sectionHeading">Date</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            {candidateDays
              .filter((day) => !closedDates.has(day))
              .map((day) => (
                <Chip key={day} label={day.slice(5)} selected={selectedDate === day} onPress={() => setSelectedDate(day)} />
              ))}
          </ScrollView>

          <ThemedText type="sectionHeading">Time</ThemedText>
          {dayClosed ? (
            <ThemedText themeColor="textSecondary">Closed on this date.</ThemedText>
          ) : (
            <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              {TIME_SLOTS.map((slot) => (
                <Chip
                  key={slot}
                  label={slot}
                  selected={time === slot}
                  onPress={() => !bookedTimes.has(slot) && setField('time', slot)}
                />
              ))}
            </ScrollView>
          )}

          <Button label="Continue" onPress={handleNext} disabled={!time || dayClosed} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
