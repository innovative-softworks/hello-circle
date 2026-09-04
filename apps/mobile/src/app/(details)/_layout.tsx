import { Stack } from 'expo-router';

export default function DetailsLayout() {
  return (
    <Stack>
      <Stack.Screen name="centre/[id]" options={{ title: '' }} />
      <Stack.Screen name="club/[id]" options={{ title: '' }} />
      <Stack.Screen name="circle/[id]" options={{ title: '' }} />
      <Stack.Screen name="circle/[id]/edit" options={{ title: '' }} />
      <Stack.Screen name="game/[id]" options={{ title: '' }} />
      <Stack.Screen name="receipt/[ref]" options={{ title: '' }} />
    </Stack>
  );
}
