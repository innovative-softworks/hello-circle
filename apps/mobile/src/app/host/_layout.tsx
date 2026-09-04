import { Stack } from 'expo-router';

export default function HostLayout() {
  return (
    <Stack>
      <Stack.Screen name="games/index" options={{ title: 'Your hosted games' }} />
      <Stack.Screen name="games/new" options={{ title: 'Host an activity' }} />
      <Stack.Screen name="games/[id]/manage" options={{ title: '' }} />
      <Stack.Screen name="games/[id]/edit" options={{ title: 'Edit game' }} />
    </Stack>
  );
}
