import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useRegistrationDraftStore } from '@/registration/store';

export default function RegistrationLayout() {
  const reset = useRegistrationDraftStore((state) => state.reset);
  useEffect(() => reset, [reset]);

  return (
    <Stack screenOptions={{ presentation: 'card' }}>
      <Stack.Screen name="details" options={{ title: 'Your details' }} />
      <Stack.Screen name="medical" options={{ title: 'Medical & consent' }} />
      <Stack.Screen name="review" options={{ title: 'Review & pay' }} />
      <Stack.Screen name="confirmation" options={{ title: 'Confirmed', headerShown: false }} />
    </Stack>
  );
}
