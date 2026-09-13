import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { requestMagicLink } from '@/api/residentAuth';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const schema = z.object({ email: z.string().email('Enter a valid email address') });
type FormValues = z.infer<typeof schema>;

// Passwordless-only by design (see CLAUDE.md's architecture notes) — no
// social/OAuth sign-in exists anywhere in this stack (server or web), so
// none is added here either rather than shipping dead buttons.
export default function SignInScreen() {
  const theme = useTheme();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit({ email }: FormValues) {
    setSubmitError(null);
    try {
      await requestMagicLink(email);
      router.push({ pathname: '/auth/check-email', params: { email } });
    } catch {
      setSubmitError('Something went wrong — please try again.');
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="pageHeading">Sign In</ThemedText>
        <ThemedText themeColor="textSecondary">
          Enter your email and we&apos;ll send you a magic link.
        </ThemedText>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            />
          )}
        />
        {errors.email && <ThemedText themeColor="danger">{errors.email.message}</ThemedText>}
        {submitError && <ThemedText themeColor="danger">{submitError}</ThemedText>}
        <Button label="Send Magic Link" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />

        <View style={{ flex: 1 }} />

        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', fontSize: 12 }}>
          By continuing you agree to our{' '}
          <ThemedText themeColor="primary" style={{ fontSize: 12 }} onPress={() => Linking.openURL('https://hellocircle.ie/privacy')}>
            Privacy Policy
          </ThemedText>
          .
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
    fontSize: 16,
  },
});
