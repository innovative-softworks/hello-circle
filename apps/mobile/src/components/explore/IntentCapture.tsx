import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { fetchIntentCount, submitIntent } from '@/api/intents';
import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A compact "notify me" CTA for a dead-end search — backed by the real
// participation_intents system (already fully built server-side, auto-
// notifies a cluster of 3+ once threshold is crossed). Kept deliberately
// small: a pre-filled text input + submit button, not a multi-step flow.
export function IntentCapture({ query, county }: { query: string; county: string }) {
  const theme = useTheme();
  const [activityLabel, setActivityLabel] = useState(query);
  const [submitted, setSubmitted] = useState(false);

  const countQuery = useQuery({
    queryKey: ['intent-count', activityLabel, county],
    queryFn: () => fetchIntentCount(activityLabel, county),
    enabled: activityLabel.trim().length > 0,
  });

  async function handleSubmit() {
    await submitIntent({ activityLabel, county });
    setSubmitted(true);
  }

  if (submitted) {
    return <ThemedText themeColor="primary">We&apos;ll let you know when something like this is available.</ThemedText>;
  }

  return (
    <View style={{ gap: Spacing.two, alignItems: 'center' }}>
      <TextInput
        value={activityLabel}
        onChangeText={setActivityLabel}
        placeholder="What are you looking for?"
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: Spacing.two, color: theme.text, width: '100%' }}
      />
      {countQuery.data && countQuery.data.count > 0 && (
        <ThemedText themeColor="textSecondary">{countQuery.data.count} people already want this</ThemedText>
      )}
      <Button label="Notify me" onPress={handleSubmit} disabled={!activityLabel.trim()} />
    </View>
  );
}
