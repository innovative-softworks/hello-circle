import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Ports web's inline "Propose a time" card — 3 free-text date fields rather
// than a native date picker, matching web's own plain <input type="date">
// simplicity (dates as YYYY-MM-DD strings, same shape the server expects).
export function CreatePollForm({ onSubmit, onCancel }: { onSubmit: (question: string, dates: string[]) => Promise<void>; onCancel: () => void }) {
  const theme = useTheme();
  const [question, setQuestion] = useState('');
  const [dates, setDates] = useState(['', '', '']);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = question.trim().length > 0 && dates.some((d) => d.trim().length > 0);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(
        question.trim(),
        dates.filter((d) => d.trim().length > 0)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two }}>
      <ThemedText type="metadata">What are you planning?</ThemedText>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="e.g. Next badminton session"
        placeholderTextColor={theme.textSecondary}
        style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
      />
      <ThemedText type="metadata">Date options (YYYY-MM-DD)</ThemedText>
      {dates.map((d, i) => (
        <TextInput
          key={i}
          value={d}
          onChangeText={(text) => setDates((prev) => prev.map((v, vi) => (vi === i ? text : v)))}
          placeholder="2026-09-20"
          placeholderTextColor={theme.textSecondary}
          style={{ borderWidth: 1, borderColor: theme.border, borderRadius: Radius.control, padding: Spacing.two, color: theme.text }}
        />
      ))}
      <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one }}>
        <Button label="Propose" onPress={handleSubmit} loading={submitting} disabled={!canSubmit} />
        <Pressable onPress={onCancel} style={{ justifyContent: 'center', paddingHorizontal: Spacing.two }}>
          <ThemedText themeColor="textSecondary">Cancel</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
