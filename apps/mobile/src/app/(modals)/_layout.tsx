import { Stack } from 'expo-router';

export default function ModalsLayout() {
  return (
    <Stack screenOptions={{ presentation: 'modal', headerShown: false }}>
      <Stack.Screen name="start-sheet" />
      <Stack.Screen name="share" />
    </Stack>
  );
}
