import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="splash" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="location" />
      <Stack.Screen name="location-permission" />
      <Stack.Screen name="location-success" />
      <Stack.Screen name="interests" />
      <Stack.Screen name="availability" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
