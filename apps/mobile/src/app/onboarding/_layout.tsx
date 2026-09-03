import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="location" />
      <Stack.Screen name="interests" />
      <Stack.Screen name="availability" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
