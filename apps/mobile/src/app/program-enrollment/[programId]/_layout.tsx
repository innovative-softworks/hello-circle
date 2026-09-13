import { Stack } from 'expo-router';

export default function ProgramEnrollmentLayout() {
  return (
    <Stack screenOptions={{ presentation: 'card' }}>
      <Stack.Screen name="details" options={{ title: 'Enroll' }} />
      <Stack.Screen name="confirmation" options={{ title: 'Enrolled', headerShown: false }} />
    </Stack>
  );
}
