import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useMakeItHappenStore } from '@/makeItHappen/store';

export default function MakeItHappenLayout() {
  const reset = useMakeItHappenStore((state) => state.reset);
  useEffect(() => reset, [reset]);

  return (
    <Stack screenOptions={{ presentation: 'card' }}>
      <Stack.Screen name="index" options={{ title: 'Make it happen' }} />
      <Stack.Screen name="results" options={{ title: 'Choose a place' }} />
      <Stack.Screen name="details" options={{ title: 'Your details' }} />
      <Stack.Screen name="confirmation" options={{ title: 'Confirmed', headerShown: false }} />
    </Stack>
  );
}
