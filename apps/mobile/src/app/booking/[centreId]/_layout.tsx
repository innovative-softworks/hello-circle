import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useBookingDraftStore } from '@/booking/store';

export default function BookingLayout() {
  const reset = useBookingDraftStore((state) => state.reset);
  useEffect(() => reset, [reset]);

  return (
    <Stack screenOptions={{ presentation: 'card' }}>
      <Stack.Screen name="room" options={{ title: 'Choose a room' }} />
      <Stack.Screen name="date-time" options={{ title: 'Date & time' }} />
      <Stack.Screen name="details" options={{ title: 'Event details' }} />
      <Stack.Screen name="review" options={{ title: 'Review & pay' }} />
      <Stack.Screen name="confirmation" options={{ title: 'Confirmed', headerShown: false }} />
    </Stack>
  );
}
