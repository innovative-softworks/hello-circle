import { Stack } from 'expo-router';

export default function DetailsLayout() {
  return (
    <Stack>
      <Stack.Screen name="centre/[id]" options={{ title: '' }} />
      <Stack.Screen name="booking/[ref]" options={{ title: '' }} />
      <Stack.Screen name="booking/[ref]/reschedule" options={{ title: 'Change date & time' }} />
      <Stack.Screen name="club/[id]" options={{ title: '' }} />
      <Stack.Screen name="circle/[id]" options={{ title: '' }} />
      <Stack.Screen name="circle/[id]/edit" options={{ title: '' }} />
      <Stack.Screen name="game/[id]" options={{ title: '' }} />
      <Stack.Screen name="game/[id]/going" options={{ headerShown: false }} />
      <Stack.Screen name="game/[id]/confirmation" options={{ headerShown: false }} />
      <Stack.Screen name="hosts/[id]" options={{ title: '' }} />
      <Stack.Screen name="program/[id]" options={{ title: '' }} />
      <Stack.Screen name="experience/[id]" options={{ title: '' }} />
      <Stack.Screen name="receipt/[ref]" options={{ title: '' }} />
    </Stack>
  );
}
