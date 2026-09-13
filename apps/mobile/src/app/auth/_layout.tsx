import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ presentation: 'modal', headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="check-email" />
      <Stack.Screen name="verify" />
    </Stack>
  );
}
