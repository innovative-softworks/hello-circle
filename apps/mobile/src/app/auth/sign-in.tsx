import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { requestMagicLink } from '@/api/residentAuth';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const schema = z.object({ email: z.string().email('Enter a valid email address') });
type FormValues = z.infer<typeof schema>;

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
      router.push('/auth/check-email');
    } catch {
      setSubmitError('Something went wrong — please try again.');
    }
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText themeColor="textSecondary">
          Enter your email and we&apos;ll send you a link to sign in — no password needed.
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
        <Button label="Send magic link" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
    fontSize: 16,
  },
});
