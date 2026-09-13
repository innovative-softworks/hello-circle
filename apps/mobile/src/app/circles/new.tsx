import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createCircle, type CircleJoinMode } from '@/api/circles';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/auth/store';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { JOIN_MODES } from '@/components/circle/CircleEditForm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnboardingStore } from '@/onboarding/store';

// "Start a Circle" (spec §19/§34) — only `name` is required server-side, so
// this stays a short form; everything else can be filled in later from the
// Circle's own edit screen (circle/[id]/edit.tsx). County isn't editable
// here — it always follows the resident's home county (same as every other
// county-scoped creation flow in the app) rather than introducing a
// separate county picker just for this one form.
export default function NewCircleScreen() {
  const county = useOnboardingStore((state) => state.homeCounty);
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  const [name, setName] = useState('');
  const [activityLabel, setActivityLabel] = useState('');
  const [about, setAbout] = useState('');
  const [joinMode, setJoinMode] = useState<CircleJoinMode>('open');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await createCircle({
        name: name.trim(),
        activityLabel: activityLabel.trim(),
        county: county ?? undefined,
        about: about.trim(),
        joinMode,
      });
      router.replace(`/(details)/circle/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!signedIn) {
    return (
      <ThemedView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="pageHeading">Start a Circle</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in to start a Circle.</ThemedText>
          <Button label="Sign in" onPress={() => router.push('/auth/sign-in')} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three }}>
          <ThemedText type="pageHeading">Start a Circle</ThemedText>
          <ThemedText themeColor="textSecondary">A persistent group around something you do together — walking, five-a-side, board games, anything.</ThemedText>

          {error && <ThemedText themeColor="danger">{error}</ThemedText>}

          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Weekend Walkers" />
          <Field label="What do you do?" value={activityLabel} onChangeText={setActivityLabel} placeholder="e.g. Coastal walks" />
          <Field label="About" value={about} onChangeText={setAbout} multiline placeholder="Tell people what to expect" />

          <View style={{ gap: Spacing.two }}>
            <ThemedText type="metadata">Who can join</ThemedText>
            <View style={{ gap: Spacing.two }}>
              {JOIN_MODES.map((mode) => (
                <Chip key={mode.value} label={mode.label} selected={joinMode === mode.value} onPress={() => setJoinMode(mode.value)} />
              ))}
            </View>
          </View>

          <Button label="Create Circle" onPress={handleCreate} loading={submitting} disabled={!name.trim()} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText type="metadata">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: Radius.control,
          padding: Spacing.two,
          color: theme.text,
          minHeight: multiline ? 80 : undefined,
        }}
      />
    </View>
  );
}
