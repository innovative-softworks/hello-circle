import { Stack } from 'expo-router';

export default function CirclesLayout() {
  return (
    <Stack>
      <Stack.Screen name="new" options={{ title: 'Start a Circle' }} />
    </Stack>
  );
}
