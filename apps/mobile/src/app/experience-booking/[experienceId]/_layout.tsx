import { Stack } from 'expo-router';

export default function ExperienceBookingLayout() {
  return (
    <Stack screenOptions={{ presentation: 'card' }}>
      <Stack.Screen name="details" options={{ title: 'Book' }} />
      <Stack.Screen name="confirmation" options={{ title: 'Booked', headerShown: false }} />
    </Stack>
  );
}
