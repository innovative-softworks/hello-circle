import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ presentation: 'modal' }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="check-email" options={{ title: 'Check your inbox' }} />
      <Stack.Screen name="verify" options={{ title: 'Signing in…', headerShown: false }} />
    </Stack>
  );
}
